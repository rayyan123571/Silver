/*
 * SQLite persistence layer using sql.js (WASM build of SQLite).
 * Chosen over better-sqlite3 so `npm install` never needs a native compiler
 * toolchain on the user's Windows machine — it "just runs".
 *
 * The whole database lives in memory and is flushed to a single .sqlite file
 * in the Electron userData folder after every write (debounced).
 */
const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')

let SQL = null
let db = null
let dbFilePath = null
let saveTimer = null

function locateFile(file) {
  // sql.js ships sql-wasm.wasm next to its dist entry point.
  const dir = path.dirname(require.resolve('sql.js'))
  const full = path.join(dir, file)
  // In a PACKAGED build the .wasm is asarUnpack'd (see electron-builder "asarUnpack"),
  // so it physically lives under `app.asar.unpacked`, NOT inside the read-only
  // `app.asar` archive that require.resolve() points at. Remap so sql.js reads the
  // real on-disk file. In dev there is no "app.asar" segment, so the path is
  // returned unchanged. This only changes WHERE the wasm is read from — no DB
  // query, schema, or behaviour is affected.
  const marker = `app.asar${path.sep}`
  return full.includes(marker) ? full.replace(marker, `app.asar.unpacked${path.sep}`) : full
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 200)
}

function flush() {
  if (!db || !dbFilePath) return
  try {
    const data = db.export()
    fs.writeFileSync(dbFilePath, Buffer.from(data))
  } catch (e) {
    console.error('DB flush failed:', e)
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT,
  rate_tezabi_tola REAL,
  parchi_charges REAL,
  fc_per_gram REAL,
  rate_tezabi_gram REAL,
  point REAL,
  slip_count INTEGER,
  raw_print_mode TEXT,   -- 'auto' (regex-match thermal) | 'force' (always raw)
  print_scale REAL       -- thermal render magnification, 1.0–1.35 (default 1.15)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  mobile TEXT,
  address TEXT,
  image TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no INTEGER,
  customer_id INTEGER,
  date TEXT,
  ts TEXT,
  kind TEXT,        -- 'cash' | 'udhar'
  direction TEXT,   -- 'in' | 'out' (shop perspective)
  category TEXT,    -- gold_sell, gold_buy, gold_give, gold_take, cash_give, cash_take, adjustment
  sona_wazan REAL,
  point REAL,
  khalis_sona REAL,
  rate REAL,
  qeemat REAL,
  cash_amount REAL,
  sona_diya REAL,   -- legacy (assay/کچا سونا); never written any more, kept so old rows stay readable
  cash_diya REAL,   -- legacy (assay/کچا سونا); never written any more, kept so old rows stay readable
  updated_at TEXT,  -- ISO date (yyyy-mm-dd) the row was last inserted/edited
  note TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no INTEGER,
  type TEXT,
  customer_id INTEGER,
  date TEXT,
  ts TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL,
  comment TEXT,
  date TEXT,        -- YYYY-MM-DD for reliable range filtering
  ts TEXT           -- full ISO timestamp (date + time) recorded
);

-- Scratch store for in-progress UNSAVED parchis (openReceiptNo == null on screen).
-- One row per unsaved parchi (the operator may keep several open at once via New);
-- each holds a JSON snapshot of the composing form ONLY. Read/written exclusively
-- by listDrafts/upsertDraft/deleteDraft/clearDrafts. Nothing in the transactions
-- ledger, getShopTotals, any report, or any customer balance ever touches this
-- table — so unsaved drafts are invisible to totals/reports by construction.
CREATE TABLE IF NOT EXISTS drafts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT
);

-- نیا سودا — deals list (khareed/farokht). Self-contained: nothing in the
-- transactions ledger, totals, or any existing report reads these tables.
-- receipt_no tags the saved entry with the parchi it was entered under.
CREATE TABLE IF NOT EXISTS naya_soda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  rate REAL,
  wazan REAL,
  type TEXT,                        -- 'khareed' | 'farokht'
  date TEXT,                        -- YYYY-MM-DD
  status TEXT DEFAULT 'bakaya',     -- 'bhugtan' | 'bakaya'
  receipt_no INTEGER,               -- parchi the entry was saved under (nullable)
  created_at TEXT
);

-- Per-receipt in-progress نیا سودا form values (ONE row per parchi number). The
-- form auto-persists here as it is typed, so unsaved values are never lost and
-- reappear when that parchi number is reopened. Cleared when the entry is saved
-- (محفوظ کریں) or the form is emptied. Pure scratch — no report reads it.
CREATE TABLE IF NOT EXISTS naya_soda_draft (
  receipt_no INTEGER PRIMARY KEY,
  payload TEXT,
  updated_at TEXT
);
`

// Lightweight, idempotent migration. `CREATE TABLE IF NOT EXISTS` never alters
// an existing table, so databases created before the address/image columns
// existed must be patched in place. Safe to run on every startup: we only ADD a
// column when PRAGMA table_info shows it is missing.
function migrateSchema() {
  // The unsaved-parchi draft store started as a single-row `draft` table; it is now
  // the multi-row `drafts` table. Drop the obsolete one (it only ever held transient
  // scratch data, never ledger data) so nothing stale lingers.
  try { db.run('DROP TABLE IF EXISTS draft') } catch (e) { /* ignore */ }

  const cols = query('PRAGMA table_info(customers)').map((r) => r.name)
  if (!cols.includes('address')) db.run('ALTER TABLE customers ADD COLUMN address TEXT')
  if (!cols.includes('image')) db.run('ALTER TABLE customers ADD COLUMN image TEXT')

  // settings.slip_count — number of slip copies to print. Default to 1 on old DBs.
  const sCols = query('PRAGMA table_info(settings)').map((r) => r.name)
  if (!sCols.includes('slip_count')) {
    db.run('ALTER TABLE settings ADD COLUMN slip_count INTEGER')
    db.run('UPDATE settings SET slip_count = 1 WHERE slip_count IS NULL')
  }

  // settings.raw_print_mode — thermal routing: 'auto' (regex-match the default
  // printer name) or 'force' (always use the raw ESC/POS path). Default 'auto'.
  if (!sCols.includes('raw_print_mode')) {
    db.run("ALTER TABLE settings ADD COLUMN raw_print_mode TEXT")
    db.run("UPDATE settings SET raw_print_mode = 'auto' WHERE raw_print_mode IS NULL")
  }
  // settings.print_scale — thermal render magnification (1.0–1.35). Default 1.15:
  // the approved final receipt design was approved printed at printScale 1.15, so
  // real receipts match that physical size. The setting stays adjustable.
  if (!sCols.includes('print_scale')) {
    db.run('ALTER TABLE settings ADD COLUMN print_scale REAL')
    db.run('UPDATE settings SET print_scale = 1.15 WHERE print_scale IS NULL')
  }
  // ONE-TIME: align existing DBs with the approved 1.15 default (older builds had
  // 1.0). Guarded by a flag column so it runs exactly once and never stomps a
  // value the user deliberately picks later in Defaults.
  if (!sCols.includes('print_scale_115')) {
    db.run('ALTER TABLE settings ADD COLUMN print_scale_115 INTEGER')
    db.run('UPDATE settings SET print_scale = 1.15')
    db.run('UPDATE settings SET print_scale_115 = 1')
  }

  // expenses.ts — full timestamp. Patch DBs that had expenses before it existed.
  const xCols = query('PRAGMA table_info(expenses)').map((r) => r.name)
  if (xCols.length && !xCols.includes('ts')) db.run('ALTER TABLE expenses ADD COLUMN ts TEXT')

  // transactions.sona_diya / cash_diya — LEGACY columns from the removed assay
  // flow. Nothing writes them any more; they are still patched in so a database
  // that predates their removal keeps a stable column set and old rows stay
  // readable. Do not reuse these names for anything new.
  const tCols = query('PRAGMA table_info(transactions)').map((r) => r.name)
  if (!tCols.includes('sona_diya')) db.run('ALTER TABLE transactions ADD COLUMN sona_diya REAL')
  if (!tCols.includes('cash_diya')) db.run('ALTER TABLE transactions ADD COLUMN cash_diya REAL')
  // updated_at — ISO date a transaction was last inserted/edited (for the balance
  // report's تاریخ column). try/catch swallows the duplicate-column error too.
  if (!tCols.includes('updated_at')) {
    try { db.run('ALTER TABLE transactions ADD COLUMN updated_at TEXT') } catch (e) { /* already exists */ }
  }

  // naya_soda.receipt_no — tag saved deals with the parchi they were entered on.
  // Patch DBs created before the نیا سودا ↔ receipt linkage existed. The draft
  // table itself is created by SCHEMA (CREATE TABLE IF NOT EXISTS), no migration.
  const nCols = query('PRAGMA table_info(naya_soda)').map((r) => r.name)
  if (nCols.length && !nCols.includes('receipt_no')) {
    try { db.run('ALTER TABLE naya_soda ADD COLUMN receipt_no INTEGER') } catch (e) { /* already exists */ }
  }
}

function seedSettings() {
  const r = db.exec('SELECT COUNT(*) AS c FROM settings')
  const count = r.length ? r[0].values[0][0] : 0
  if (!count) {
    // Seed the date to TODAY (local), never a hardcoded string.
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    db.run(
      `INSERT INTO settings (id, date, rate_tezabi_tola, parchi_charges, fc_per_gram, rate_tezabi_gram, point, slip_count, raw_print_mode, print_scale)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [today, 9000, 100, 80, 772, 100, 1, 'auto', 1.15]
    )
  }
}

async function init(userDataDir) {
  if (db) return
  SQL = await initSqlJs({ locateFile })
  dbFilePath = path.join(userDataDir, 'silver.sqlite')
  if (fs.existsSync(dbFilePath)) {
    const buf = fs.readFileSync(dbFilePath)
    db = new SQL.Database(new Uint8Array(buf))
  } else {
    db = new SQL.Database()
  }
  db.run(SCHEMA)
  migrateSchema()
  seedSettings()
  // The working date ALWAYS starts on TODAY at every launch. settings.date is only
  // the DEFAULT date for NEW parchis — historical parchis keep their own date in
  // transactions/receipts, so this never touches saved data. The user can still
  // change it during a session, but reopening the app always shows the current day
  // (fixes the stale/previous date that used to persist across restarts).
  db.run('UPDATE settings SET date = ? WHERE id = 1', [todayISO()])
  flush()
}

/* ---------- helpers ---------- */

function rowsFrom(res) {
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}

function query(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// Today's LOCAL date as yyyy-mm-dd — matches how the app stores dates elsewhere.
function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function run(sql, params = []) {
  db.run(sql, params)
  scheduleSave()
}

function lastInsertId() {
  const r = db.exec('SELECT last_insert_rowid() AS id')
  return r[0].values[0][0]
}

// The bottom-bar inventory counters (پیس / 1-5-10 تولہ بار). These are COUNTS of
// physical items, tracked in their own ledger: an اندراج against one of these
// targets carries its number in meta {unit, count} and leaves cash_amount and
// khalis_sona at 0, so it can never add grams to the چاندی total or rupees to کیش.
const COUNT_TARGETS = new Set(['piece', 'bar1Tola', 'bar5Tola', 'bar10Tola'])

// The four METAL trade categories. A metal row carries meta {unit}: 'gold' (or no
// meta at all, e.g. every row saved before units existed) means the entry is plain
// grams; a COUNT_TARGETS unit means it is bars/pieces and belongs on a counter.
const METAL_CATS = new Set(['gold_sell', 'gold_buy', 'gold_give', 'gold_take'])

// Mirrors GRAMS_PER_TOLA in src/logic/units.js — the renderer's units.js is ESM and
// cannot be required from this CommonJS main-process file, so the constant is
// duplicated. Keep the two in sync.
const GRAMS_PER_TOLA = 11.664
const BAR_GRAMS = {
  bar1Tola: GRAMS_PER_TOLA,
  bar5Tola: 5 * GRAMS_PER_TOLA,
  bar10Tola: 10 * GRAMS_PER_TOLA
}

// How many ITEMS a metal trade represents, for a given count unit. `n` is the
// number the user typed on that row (stored as khalis_sona).
//
// BARS have a known weight, so the count is DERIVED from it: n grams / bar weight,
// to 3dp. Entering 58.32g on a 5-tola row = 1 bar.
//
// PIECE is different: a piece has no fixed weight, so nothing can be derived. The
// rule is that the number entered IS the piece count — type 3 on a پیس row and the
// piece counter moves by 3 (signed by direction: take/buy +3, give/sell −3). Note
// the consequence: on a پیس row the entered number is read as a COUNT here while
// still being priced as GRAMS (qeemat = n × rate) and still hitting the customer
// ledger as grams. To change the rule, change this one branch.
function unitCount(unit, n) {
  const amount = Number(n) || 0
  if (unit === 'piece') return amount
  const per = BAR_GRAMS[unit]
  if (!per) return 0
  return Math.round((amount / per) * 1000) / 1000
}

// transactions.meta is a TEXT column, so a row read back from SQLite hands it over
// as a JSON string (or null). Parse defensively — a malformed/legacy value must
// degrade to "no meta", never throw and take the whole totals sweep down with it.
function parseMeta(meta) {
  if (!meta) return null
  if (typeof meta === 'object') return meta
  try { return JSON.parse(meta) } catch { return null }
}

/* ---------- API ---------- */

// The union of every saved receipt_no across both tables a parchi can touch
// (receipts snapshot + transactions ledger). Used by the nav queries below.
const RECEIPT_NOS_SQL = `
  SELECT receipt_no AS rn FROM transactions WHERE receipt_no IS NOT NULL
  UNION
  SELECT receipt_no AS rn FROM receipts WHERE receipt_no IS NOT NULL`

const api = {
  getRates() {
    const r = query('SELECT * FROM settings WHERE id = 1')
    return r[0] || null
  },

  saveRates(rates) {
    // raw_print_mode / print_scale use COALESCE so a caller that omits them keeps
    // the stored value (never nulls a print setting it didn't mean to touch).
    run(
      `UPDATE settings SET date=?, rate_tezabi_tola=?, parchi_charges=?, fc_per_gram=?, rate_tezabi_gram=?, point=?, slip_count=?,
              raw_print_mode=COALESCE(?, raw_print_mode), print_scale=COALESCE(?, print_scale) WHERE id=1`,
      [
        rates.date,
        rates.rate_tezabi_tola,
        rates.parchi_charges,
        rates.fc_per_gram,
        rates.rate_tezabi_gram,
        rates.point,
        rates.slip_count != null ? rates.slip_count : 1,
        rates.raw_print_mode != null ? rates.raw_print_mode : null,
        rates.print_scale != null ? Number(rates.print_scale) : null
      ]
    )
    return api.getRates()
  },

  // ── Unsaved-parchi DRAFTS (one row per in-progress parchi). Store ONLY JSON
  // snapshots of the composing form; completely separate from transactions/
  // receipts, so they NEVER affect totals, ledgers, or reports. listDrafts returns
  // RAW payload strings (the renderer parses each inside try/catch, so a corrupt/
  // tampered row is skipped without crashing). upsertDraft with seq == null INSERTs
  // a new draft and returns its seq; with a seq it UPDATEs that row.
  listDrafts() {
    return query('SELECT seq, payload FROM drafts ORDER BY seq ASC')
  },

  upsertDraft(seq, payload) {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
    if (seq == null) {
      run('INSERT INTO drafts (payload) VALUES (?)', [json])
      return { ok: true, seq: lastInsertId() }
    }
    run('UPDATE drafts SET payload = ? WHERE seq = ?', [json, seq])
    return { ok: true, seq }
  },

  deleteDraft(seq) {
    if (seq == null) return { ok: true }
    run('DELETE FROM drafts WHERE seq = ?', [seq])
    return { ok: true }
  },

  clearDrafts() {
    run('DELETE FROM drafts')
    return { ok: true }
  },

  findCustomers(q) {
    if (!q || !q.trim()) {
      return query('SELECT * FROM customers ORDER BY name LIMIT 50')
    }
    const s = q.trim()
    const like = `%${s}%`
    const prefix = `${s}%`
    // Also match on a numeric id so users can search by record number.
    const idNum = /^\d+$/.test(s) ? Number(s) : -1
    // Rank NAME-prefix matches FIRST, then other (contains / mobile) matches, then
    // alphabetical. Without this a plain "%z%" ordered by name + LIMIT 50 could push
    // the "Zafer…" prefix hits the user actually wants past the 50-row cut-off in a
    // large customer list — so typing "z" showed nothing. (SQLite LIKE is
    // case-insensitive for ASCII, so 'z%' matches 'Zafer'.)
    return query(
      `SELECT * FROM customers
       WHERE name LIKE ? OR mobile LIKE ? OR id = ?
       ORDER BY (CASE WHEN name LIKE ? THEN 0 ELSE 1 END), name
       LIMIT 50`,
      [like, like, idNum, prefix]
    )
  },

  // The id the NEXT inserted customer will receive — for the ID preview only.
  // Reads SQLite's AUTOINCREMENT bookkeeping; never inserts. sqlite_sequence has
  // no row for a table until its first insert, so fall back to 1.
  peekNextCustomerId() {
    try {
      const r = query("SELECT seq FROM sqlite_sequence WHERE name = 'customers'")
      return r[0] && r[0].seq != null ? r[0].seq + 1 : 1
    } catch {
      return 1
    }
  },

  // Full saved-customer list (UNBOUNDED), ordered by name. Used ONLY by the main
  // screen's strict name-autocomplete cache, which must know EVERY saved name so a
  // customer late in the alphabet (past findCustomers('')'s 50-row cut-off) can
  // still have its first letter typed / be selected. findCustomers stays capped
  // for its search box + dropdown, so nothing else changes.
  listAllCustomers() {
    return query('SELECT * FROM customers ORDER BY name')
  },

  getCustomer(id) {
    const r = query('SELECT * FROM customers WHERE id = ?', [id])
    return r[0] || null
  },

  upsertCustomer(c) {
    // The form stores the picture as a base64 data URL. Accept either `image`
    // (DB/column name) or `imagePath` (older form field name) so both callers work.
    const image = c.image ?? c.imagePath ?? null
    if (c.id) {
      run('UPDATE customers SET name=?, mobile=?, address=?, image=? WHERE id=?', [
        c.name || '',
        c.mobile || '',
        c.address || '',
        image,
        c.id
      ])
      return api.getCustomer(c.id)
    }
    run('INSERT INTO customers (name, mobile, address, image, created_at) VALUES (?, ?, ?, ?, ?)', [
      c.name || '',
      c.mobile || '',
      c.address || '',
      image,
      new Date().toISOString()
    ])
    return api.getCustomer(lastInsertId())
  },

  getFirstCustomer() {
    const r = query('SELECT * FROM customers ORDER BY id ASC LIMIT 1')
    return r[0] || null
  },

  getLastCustomer() {
    const r = query('SELECT * FROM customers ORDER BY id DESC LIMIT 1')
    return r[0] || null
  },

  getNextCustomer(currentId) {
    if (currentId == null) return api.getFirstCustomer()
    const r = query('SELECT * FROM customers WHERE id > ? ORDER BY id ASC LIMIT 1', [currentId])
    return r[0] || null
  },

  getPrevCustomer(currentId) {
    if (currentId == null) return api.getLastCustomer()
    const r = query('SELECT * FROM customers WHERE id < ? ORDER BY id DESC LIMIT 1', [currentId])
    return r[0] || null
  },

  // Next parchi number = the LOWEST free positive integer across BOTH tables
  // (transactions AND receipts). Normally this is just MAX+1 (sequential, no
  // gaps), but when a receipt number has been FREED (see freeReceipt) it leaves a
  // gap, and that freed number is handed back for REUSE — intended in this single-
  // shop offline app. Unioning both tables (same source as nav) avoids handing
  // back a number that still exists in either.
  nextReceiptNo() {
    const rows = query(`SELECT DISTINCT rn FROM (${RECEIPT_NOS_SQL}) WHERE rn IS NOT NULL ORDER BY rn ASC`)
    const used = new Set(rows.map((r) => Number(r.rn)))
    let n = 1
    while (used.has(n)) n++
    return n
  },

  // Whether a receipt_no is already SAVED (has transactions or a receipt snapshot).
  // Used as a save-time guard so a brand-new parchi can never overwrite another.
  receiptNoExists(n) {
    if (n == null) return false
    const rows = query(`SELECT 1 FROM (${RECEIPT_NOS_SQL}) WHERE rn = ? LIMIT 1`, [n])
    return rows.length > 0
  },

  // ALL saved receipt numbers (distinct, ascending). Read-only — feeds the
  // renderer's merged ◀/▶ navigation timeline (saved receipts + unsaved drafts,
  // ONE order by parchi number), which needs the full set rather than a single
  // gap-tolerant neighbour like getNextReceiptNo/getPrevReceiptNo.
  listReceiptNos() {
    const rows = query(`SELECT DISTINCT rn FROM (${RECEIPT_NOS_SQL}) WHERE rn IS NOT NULL ORDER BY rn ASC`)
    return rows.map((r) => Number(r.rn))
  },

  // FREE a receipt number: delete every row under it (transactions + receipts) so
  // nothing remains and the number becomes available for reuse. Atomic. This is
  // STEP 2 of "parchi free" — only called when a parchi has no customer AND no
  // entries. Flushed so the freeing persists across restart.
  freeReceipt(receiptNo) {
    if (receiptNo == null) return { ok: false, message: 'receipt_no required' }
    let removedTxns = 0
    try {
      const c = query('SELECT COUNT(*) AS c FROM transactions WHERE receipt_no = ?', [receiptNo])
      removedTxns = (c[0] && c[0].c) || 0
      db.run('BEGIN')
      db.run('DELETE FROM transactions WHERE receipt_no = ?', [receiptNo])
      db.run('DELETE FROM receipts WHERE receipt_no = ?', [receiptNo])
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('freeReceipt failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush()
    return { ok: true, receipt_no: receiptNo, removedTxns }
  },

  // ── Parchi navigation (First / Last / Next / Prev) ──────────────────────────
  // A saved parchi's receipt_no can live in `receipts` (full snapshot), in
  // `transactions` (ledger line-items), or both, so every query unions the two.
  // Numbering can have GAPS after deletions, so Next/Prev are relative ("next
  // existing receipt_no", not current±1). All return null when there's no match.
  getFirstReceiptNo() {
    const r = query(`SELECT MIN(rn) AS n FROM (${RECEIPT_NOS_SQL})`)
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getLastReceiptNo() {
    const r = query(`SELECT MAX(rn) AS n FROM (${RECEIPT_NOS_SQL})`)
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getNextReceiptNo(current) {
    if (current == null) return api.getFirstReceiptNo()
    const r = query(`SELECT MIN(rn) AS n FROM (${RECEIPT_NOS_SQL}) WHERE rn > ?`, [current])
    return r[0] && r[0].n != null ? r[0].n : null
  },

  getPrevReceiptNo(current) {
    if (current == null) return api.getLastReceiptNo()
    const r = query(`SELECT MAX(rn) AS n FROM (${RECEIPT_NOS_SQL}) WHERE rn < ?`, [current])
    return r[0] && r[0].n != null ? r[0].n : null
  },

  // One-time fresh start: wipe all transactions + receipts and reset AUTOINCREMENT
  // so the next parchi is receipt_no 1. Customers (names) are kept. Intended,
  // destructive — only called from the explicit "reset data" path.
  resetTransactions() {
    run('DELETE FROM transactions')
    run('DELETE FROM receipts')
    run("DELETE FROM sqlite_sequence WHERE name IN ('transactions','receipts')")
    return { ok: true, nextReceiptNo: 1 }
  },

  // Load a saved parchi by its receipt number (for the StatusBar receipt search).
  // A parchi is stored two ways, both keyed by receipt_no:
  //   1. receipts.payload — a full JSON snapshot of the parchi (rates + نقد/ادھار
  //      entries + customer). This is the source of truth for reconstructing the
  //      parchi EXACTLY as saved.
  //   2. transactions   — the individual ledger line-items (used for balances).
  // We prefer the payload when present, and always also return the transaction
  // rows so old parchis (saved before payloads existed) still reload their
  // line-items. Returns null only when neither exists.
  getReceiptByNo(receiptNo) {
    const rows = query(
      `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.receipt_no = ? ORDER BY t.id ASC`,
      [receiptNo]
    )
    // Newest saved snapshot for this receipt_no, if any.
    const recs = query(
      'SELECT * FROM receipts WHERE receipt_no = ? ORDER BY id DESC LIMIT 1',
      [receiptNo]
    )

    if (recs.length) {
      const rec = recs[0]
      let payload = {}
      try { payload = JSON.parse(rec.payload || '{}') } catch { payload = {} }
      const first = rows[0]
      return {
        receipt_no: receiptNo,
        date: rec.date || (first && first.date) || null,
        customer_id: rec.customer_id,
        customer: payload.customer ||
          (first ? { id: first.customer_id, name: first.customer_name, mobile: first.customer_mobile } : null),
        payload,
        rows
      }
    }

    if (!rows.length) return null
    const first = rows[0]
    return {
      receipt_no: receiptNo,
      date: first.date,
      customer_id: first.customer_id,
      customer: { id: first.customer_id, name: first.customer_name, mobile: first.customer_mobile },
      rows
    }
  },

  // Filtered customer report. Filter by customer (id preferred, else name LIKE),
  // date range (date BETWEEN from AND to), and optional category. Rows are ordered
  // by date, receipt_no. Totals reuse getCustomerLedger's EXACT sign logic
  // (out = +1 the customer owes us, in = -1) so a report's totals equal the
  // ledger balance for the same customer/period.
  getReport(opts = {}) {
    const { customerId, name, from, to, category } = opts || {}
    const where = []
    const params = []
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
    if (from) { where.push('t.date >= ?'); params.push(from) }
    if (to) { where.push('t.date <= ?'); params.push(to) }
    if (category) { where.push('t.category = ?'); params.push(category) }
    where.push("t.category <> 'adjustment'") // manual اندراج never shows in reports
    const rows = query(
      `SELECT t.*, c.name AS customer_name
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.date ASC, t.receipt_no ASC, t.id ASC`,
      params
    )
    let total_gold = 0
    let total_cash = 0
    for (const t of rows) {
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') total_gold += sign * (t.khalis_sona || 0)
      if (t.category === 'cash_give' || t.category === 'cash_take') total_cash += sign * (t.cash_amount || 0)
    }
    return { rows, total_gold, total_cash }
  },

  // اندراج رپورٹ — the ONE place manual adjustments (category 'adjustment') are
  // shown; every other report/ledger excludes them. Returns adjustment rows only,
  // newest first, optionally within a date range. cash_amount = رقم لی/دی amount,
  // khalis_sona = چاندی لی/دی grams; direction 'in'/'out' gives the sign.
  getAdjustmentsReport(opts = {}) {
    const { from, to } = opts || {}
    const where = ["category = 'adjustment'"]
    const params = []
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(
      `SELECT id, date, ts, direction, cash_amount, khalis_sona, note
       FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`,
      params
    )
    return { rows }
  },

  // Group-1 (balance style) report: one aggregated row PER CUSTOMER for a single
  // category, with NO date filter. Optional customer (id or name) narrows to one.
  // total_khalis / total_cash are the summed amounts (a category is single-
  // direction, so the sum equals the magnitude of that customer's ledger
  // contribution for it). Empty/null-safe.
  reportGroup1(opts = {}) {
    const { category, customerId, name } = opts || {}
    const where = ['t.category = ?']
    const params = [category]
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
    const rows = query(
      `SELECT t.customer_id, c.name AS customer_name,
              SUM(COALESCE(t.khalis_sona, 0)) AS total_khalis,
              SUM(COALESCE(t.cash_amount, 0)) AS total_cash,
              MAX(t.date) AS date,
              MAX(t.updated_at) AS updated_at,
              COUNT(*) AS cnt
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       GROUP BY t.customer_id, c.name
       ORDER BY c.name ASC`,
      params
    )
    let total_gold = 0
    let total_cash = 0
    for (const r of rows) {
      total_gold += Number(r.total_khalis) || 0
      total_cash += Number(r.total_cash) || 0
    }
    return { rows, total_gold, total_cash }
  },

  // ── NET balance reports for the four GROUP1 buttons ────────────────────────
  // (چاندی لینی ہے / چاندی دینی ہے / رقم لینی ہے / رقم دینی ہے)
  // reportGroup1 sums ONE category and never nets give against take — a customer
  // who took 5g and returned 4.65g still showed 5g under لینا. These net the
  // PAIR per customer in ONE SQL pass, with the sign convention copied from
  // getCustomerLedger: sign = direction 'out' ? +1 : -1 (positive net = the
  // customer owes the shop). side 'lena' keeps nets > +EPS, 'dena' keeps nets
  // < -EPS and returns the magnitude. Amounts come back under the SAME field
  // names reportGroup1 used (total_khalis / total_cash) so the existing report
  // columns work unchanged. EPS kills float-dust ghost rows; a settled (zero)
  // customer appears in NEITHER list. reportGroup1 itself stays untouched.
  _netBalanceReport({ side, opts, cats, col, out, eps, round }) {
    const { customerId, name } = opts || {}
    const where = [`t.category IN ('${cats[0]}','${cats[1]}')`]
    const params = []
    if (customerId != null && customerId !== '') { where.push('t.customer_id = ?'); params.push(customerId) }
    else if (name && String(name).trim()) { where.push('c.name LIKE ?'); params.push(`%${String(name).trim()}%`) }
    const raw = query(
      `SELECT t.customer_id, c.name AS customer_name,
              SUM((CASE WHEN t.direction = 'out' THEN 1 ELSE -1 END) * COALESCE(t.${col}, 0)) AS net,
              MAX(t.date) AS date,
              MAX(t.updated_at) AS updated_at,
              COUNT(*) AS cnt
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE ${where.join(' AND ')}
       GROUP BY t.customer_id, c.name
       ORDER BY c.name ASC`,
      params
    )
    const rows = []
    let total = 0
    for (const r of raw) {
      const net = Number(r.net) || 0
      if (side === 'lena' ? net <= eps : net >= -eps) continue
      const amount = round(Math.abs(net))
      rows.push({
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        [out]: amount,
        date: r.date,
        updated_at: r.updated_at,
        cnt: r.cnt
      })
      total += amount
    }
    return {
      rows,
      total_gold: out === 'total_khalis' ? total : 0,
      total_cash: out === 'total_cash' ? total : 0
    }
  },

  // side = 'lena' (net > 0: customer owes gold) | 'dena' (net < 0: shop owes)
  reportGoldBalanceNet(side, opts = {}) {
    return api._netBalanceReport({
      side,
      opts,
      cats: ['gold_give', 'gold_take'],
      col: 'khalis_sona',
      out: 'total_khalis',
      eps: 0.0005, // grams
      round: (v) => Math.round(v * 1000) / 1000 // 3dp — no float-dust in the list
    })
  },

  reportCashBalanceNet(side, opts = {}) {
    return api._netBalanceReport({
      side,
      opts,
      cats: ['cash_give', 'cash_take'],
      col: 'cash_amount',
      out: 'total_cash',
      eps: 0.5, // rupees — display rounding stays with fmtMoney
      round: (v) => v
    })
  },

  addTransaction(t) {
    run(
      `INSERT INTO transactions
        (receipt_no, customer_id, date, ts, kind, direction, category,
         sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        t.receipt_no,
        t.customer_id || null,
        t.date,
        t.ts || new Date().toISOString(),
        t.kind,
        t.direction || null,
        t.category,
        t.sona_wazan || 0,
        t.point || 0,
        t.khalis_sona || 0,
        t.rate || 0,
        t.qeemat || 0,
        t.cash_amount || 0,
        t.sona_diya || 0,
        t.cash_diya || 0,
        t.updated_at || t.date || todayISO(), // fresh rows carry their entry date
        t.note || '',
        t.meta ? JSON.stringify(t.meta) : null
      ]
    )
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { id: lastInsertId() }
  },

  // Manual balance adjustment (دستی اندراج) — a ONE-SHOT transaction that nudges
  // ONE bottom-bar counter by a fixed amount. category 'adjustment' is applied
  // ONLY by getShopTotals and is EXCLUDED from every ledger / report / listing, so
  // it can never re-apply or leak into a customer's account. No customer, no
  // receipt. direction 'in' adds to the counter, 'out' subtracts.
  //
  // Two families of target, and they are SEPARATE LEDGERS:
  //   'cash'            → cash_amount (rupees)
  //   'gold'            → khalis_sona (grams)
  //   COUNT_TARGETS     → meta {unit, count} — a COUNT of pieces/bars, NOT grams.
  // A count entry writes cash_amount = 0 AND khalis_sona = 0, so it is structurally
  // incapable of moving the کیش or چاندی(gram) totals: the only place its number
  // lives is meta.count, which only the counter loop in getShopTotals reads.
  //
  // What `amount` MEANS depends on the target, and this is the important bit:
  //   bar1Tola/bar5Tola/bar10Tola → amount is a WEIGHT IN GRAMS. The bar COUNT is
  //     derived here, via the very same unitCount() the نقد/ادھار metal rows go
  //     through — so the same weight always yields the same count whether it was
  //     entered in اندراج or traded on the panel. They cannot drift apart.
  //   piece → amount IS the count (a piece has no fixed weight to derive from).
  //   cash / gold → amount is rupees / grams, exactly as before.
  addAdjustment(a = {}) {
    const target = a.target === 'gold' || COUNT_TARGETS.has(a.target) ? a.target : 'cash'
    const direction = a.direction === 'out' ? 'out' : 'in'
    const amount = Number(a.amount) || 0
    if (!(amount > 0)) return { ok: false, message: 'amount must be positive' }
    const isCount = COUNT_TARGETS.has(target)
    const isBar = BAR_GRAMS[target] != null
    // Bars: grams → count. Piece: unitCount returns the amount unchanged.
    const count = isCount ? unitCount(target, amount) : 0
    // Keep the entered grams on a bar row too, so the stored row still says what
    // the user actually typed and the count can be re-derived / audited later.
    const meta = isCount
      ? JSON.stringify(isBar ? { unit: target, grams: amount, count } : { unit: target, count })
      : null
    run(
      `INSERT INTO transactions
        (receipt_no, customer_id, date, ts, kind, direction, category,
         sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        null, null, todayISO(), new Date().toISOString(), 'adjustment', direction, 'adjustment',
        0, 0, target === 'gold' ? amount : 0, 0, 0, target === 'cash' ? amount : 0, 0, 0,
        todayISO(), a.note || 'دستی اندراج',
        meta
      ]
    )
    flush() // immediate persist: adjustments must survive a restart
    return { ok: true, id: lastInsertId(), target, direction, amount, count }
  },

  // Edit an existing transaction by id (Part 1). Only whitelisted columns can be
  // changed. Missing/unknown id is a graceful no-op.
  updateTransaction(id, fields = {}) {
    if (id == null) return { ok: false }
    const allowed = ['customer_id', 'date', 'category', 'direction', 'kind',
      'khalis_sona', 'cash_amount', 'sona_wazan', 'point', 'rate', 'qeemat', 'note']
    const sets = []
    const params = []
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) { sets.push(`${k} = ?`); params.push(fields[k]) }
    }
    if (fields.meta !== undefined) { sets.push('meta = ?'); params.push(fields.meta ? JSON.stringify(fields.meta) : null) }
    if (!sets.length) return { ok: true, unchanged: true }
    // Stamp the last-edit date (yyyy-mm-dd) so the balance report's تاریخ column
    // shows when the row was last updated.
    sets.push('updated_at = ?'); params.push(todayISO())
    params.push(id)
    run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params)
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, id }
  },

  // Delete a transaction by id (Part 1). Missing id is a graceful no-op.
  deleteTransaction(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM transactions WHERE id = ?', [id])
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, id }
  },

  // ── Expenses (اخراجات) ──────────────────────────────────────────────────────
  // Add an expense. Stores amount, comment, date (YYYY-MM-DD) and ts = full ISO
  // timestamp (date + time) of the moment it is recorded.
  addExpense(e = {}) {
    const ts = new Date().toISOString()
    run('INSERT INTO expenses (amount, comment, date, ts) VALUES (?, ?, ?, ?)', [
      Number(e.amount) || 0,
      e.comment || '',
      e.date,
      ts
    ])
    return { id: lastInsertId(), ts }
  },

  // Edit a single expense by id. Only amount / comment / date may change; ts (the
  // originally recorded time) is left untouched. Flushed so it persists. Missing
  // id is a graceful no-op.
  updateExpense(id, fields = {}) {
    if (id == null) return { ok: false }
    const allowed = ['amount', 'comment', 'date']
    const sets = []
    const params = []
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = ?`)
        params.push(k === 'amount' ? (Number(fields[k]) || 0) : fields[k])
      }
    }
    if (!sets.length) return { ok: true, unchanged: true }
    params.push(id)
    run(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`, params)
    flush()
    return { ok: true, id }
  },

  // Delete a single expense by id. Flushed so it persists. Missing id = no-op.
  deleteExpense(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM expenses WHERE id = ?', [id])
    flush()
    return { ok: true, id }
  },

  // Delete ALL expenses (fresh start) and reset the id sequence so ids restart at
  // 1. Only the expenses table is touched — transactions/receipts/ledger untouched.
  // Flushed so it persists across restart.
  resetExpenses() {
    let removed = 0
    try {
      const c = query('SELECT COUNT(*) AS c FROM expenses')
      removed = (c[0] && c[0].c) || 0
      db.run('BEGIN')
      db.run('DELETE FROM expenses')
      db.run("DELETE FROM sqlite_sequence WHERE name = 'expenses'")
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('resetExpenses failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush()
    return { ok: true, removed }
  },

  // READ-ONLY: sum of expense amounts on a given date. Kept for any per-day
  // callers; the bottom-bar cash DISPLAY now uses getExpensesTotalUpTo instead
  // (expenses must reduce cash permanently, not just on their entry day). Touches nothing.
  getExpensesTotalForDate(date) {
    const r = query('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE date = ?', [date])
    return r[0] ? (Number(r[0].s) || 0) : 0
  },

  // READ-ONLY: sum of ALL expense amounts up to AND INCLUDING the given date.
  // Feeds the bottom-bar cash DISPLAY (cash − every expense so far), so an expense
  // stays subtracted after the settings date rolls forward. Touches nothing.
  getExpensesTotalUpTo(date) {
    const r = query('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE date <= ?', [date])
    return r[0] ? (Number(r[0].s) || 0) : 0
  },

  // Expenses within an inclusive date range, ordered by ts (so same-day entries
  // sort by time), then id. From/To are normalised so the smaller date is "from"
  // even if the user enters them reversed. Empty/null-safe.
  getExpenses(fromDate, toDate) {
    let from = fromDate || null
    let to = toDate || null
    if (from && to && String(from) > String(to)) { const t = from; from = to; to = t }
    const where = []
    const params = []
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(
      `SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts ASC, id ASC`,
      params
    )
    return rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 }))
  },

  // ── نیا سودا ────────────────────────────────────────────────────────────────
  // Deals list — its own tables only; never touches the transactions ledger,
  // customer balances, or any existing report. receipt_no tags the entry with the
  // parchi it was saved under (nullable).
  addNayaSoda(r = {}) {
    const ts = new Date().toISOString()
    run(
      `INSERT INTO naya_soda (name, rate, wazan, type, date, status, receipt_no, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.name || '',
        Number(r.rate) || 0,
        Number(r.wazan) || 0,
        r.type === 'farokht' ? 'farokht' : 'khareed',
        r.date || todayISO(),
        'bakaya',
        (r.receipt_no != null && Number.isFinite(Number(r.receipt_no))) ? Number(r.receipt_no) : null,
        ts
      ]
    )
    return { id: lastInsertId(), ts }
  },

  // ── نیا سودا per-receipt draft (in-progress, unsaved form values) ────────────
  // Read this parchi's saved-in-progress نیا سودا form values (or null). Pure
  // scratch — nothing else reads it.
  getNayaSodaDraft(receiptNo) {
    if (receiptNo == null) return null
    const rows = query('SELECT payload FROM naya_soda_draft WHERE receipt_no = ?', [Number(receiptNo)])
    if (!rows.length) return null
    try { return JSON.parse(rows[0].payload || '{}') } catch { return null }
  },

  // Upsert this parchi's in-progress form values (one row per receipt_no).
  saveNayaSodaDraft(receiptNo, form = {}) {
    if (receiptNo == null) return { ok: false }
    run(
      'INSERT OR REPLACE INTO naya_soda_draft (receipt_no, payload, updated_at) VALUES (?, ?, ?)',
      [Number(receiptNo), JSON.stringify(form || {}), new Date().toISOString()]
    )
    return { ok: true }
  },

  // Drop this parchi's draft (on save or when the form is emptied).
  clearNayaSodaDraft(receiptNo) {
    if (receiptNo == null) return { ok: false }
    run('DELETE FROM naya_soda_draft WHERE receipt_no = ?', [Number(receiptNo)])
    return { ok: true }
  },

  // Rows of one status ('bhugtan' | 'bakaya'), newest first. Optional from/to
  // (YYYY-MM-DD) filter on the `date` column — inclusive; empty = no bound.
  listNayaSoda(status, from, to) {
    const where = ['status = ?']
    const params = [status || 'bhugtan']
    if (from) { where.push('date >= ?'); params.push(from) }
    if (to) { where.push('date <= ?'); params.push(to) }
    const rows = query(`SELECT * FROM naya_soda WHERE ${where.join(' AND ')} ORDER BY id DESC`, params)
    return rows.map((r) => ({ ...r, rate: Number(r.rate) || 0, wazan: Number(r.wazan) || 0 }))
  },

  // Move one row between بھگتان and بقایا. Flushed so it persists. Missing id = no-op.
  setNayaSodaStatus(id, status) {
    if (id == null) return { ok: false }
    run('UPDATE naya_soda SET status = ? WHERE id = ?', [status === 'bakaya' ? 'bakaya' : 'bhugtan', id])
    flush()
    return { ok: true, id }
  },

  // Delete a single سودا row by id. Flushed so it persists. Missing id = no-op.
  deleteNayaSoda(id) {
    if (id == null) return { ok: false }
    run('DELETE FROM naya_soda WHERE id = ?', [id])
    flush()
    return { ok: true, id }
  },

  // Record a settlement / return (Part 2). A settle is a NORMAL transaction in
  // the opposite direction for the same customer — the original parchi is never
  // touched. It is tagged (note + meta.settle) so reports can identify it, and it
  // adjusts the customer's balance purely through getCustomerLedger's sign sums.
  settleTransaction(t) {
    const meta = Object.assign({ settle: true }, t.meta || {})
    return api.addTransaction({ ...t, note: t.note || 'قسط/واپسی', meta })
  },

  saveReceipt(r) {
    run(
      `INSERT INTO receipts (receipt_no, type, customer_id, date, ts, payload)
       VALUES (?,?,?,?,?,?)`,
      [
        r.receipt_no,
        r.type,
        r.customer_id || null,
        r.date,
        r.ts || new Date().toISOString(),
        JSON.stringify(r.payload || {})
      ]
    )
    return { id: lastInsertId() }
  },

  // Save a parchi with UPSERT semantics: one receipt_no always maps to exactly
  // one current version. We DELETE every prior row for that receipt_no (both the
  // header/payload and its transaction line-items) and INSERT the current ones,
  // all inside a single BEGIN/COMMIT so it is atomic (never half-deleted). This is
  // what makes editing work: removed entries stay removed, changed values replace
  // old ones, and no duplicate/stale rows accumulate. New parchis just find
  // nothing to delete. Reuses the SAME receipt_no passed in (edits don't renumber).
  replaceReceipt({ receipt: r = {}, transactions = [] } = {}) {
    const rno = r.receipt_no
    if (rno == null) return { ok: false, message: 'receipt_no required' }
    const nowIso = new Date().toISOString()
    try {
      db.run('BEGIN')
      db.run('DELETE FROM transactions WHERE receipt_no = ?', [rno])
      db.run('DELETE FROM receipts WHERE receipt_no = ?', [rno])
      db.run(
        `INSERT INTO receipts (receipt_no, type, customer_id, date, ts, payload)
         VALUES (?,?,?,?,?,?)`,
        [rno, r.type || 'parchi', r.customer_id || null, r.date, r.ts || nowIso, JSON.stringify(r.payload || {})]
      )
      for (const t of transactions) {
        db.run(
          `INSERT INTO transactions
            (receipt_no, customer_id, date, ts, kind, direction, category,
             sona_wazan, point, khalis_sona, rate, qeemat, cash_amount, sona_diya, cash_diya, updated_at, note, meta)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            rno,
            t.customer_id || null,
            t.date || r.date,
            t.ts || nowIso,
            t.kind,
            t.direction || null,
            t.category,
            t.sona_wazan || 0,
            t.point || 0,
            t.khalis_sona || 0,
            t.rate || 0,
            t.qeemat || 0,
            t.cash_amount || 0,
            t.sona_diya || 0,
            t.cash_diya || 0,
            t.updated_at || t.date || r.date || todayISO(),
            t.note || '',
            t.meta ? JSON.stringify(t.meta) : null
          ]
        )
      }
      db.run('COMMIT')
    } catch (e) {
      try { db.run('ROLLBACK') } catch { /* ignore */ }
      console.error('replaceReceipt failed:', e)
      return { ok: false, message: String(e && e.message ? e.message : e) }
    }
    flush() // immediate persist: close the ~200ms debounce data-loss window
    return { ok: true, receipt_no: rno, count: transactions.length }
  },

  // beforeReceiptNo (optional): count ONLY the parchis numbered BEFORE this one —
  // which is exactly the ادھار receipt's سابقہ ("what this customer owed before this
  // parchi"). It used to derive that as (full balance − the on-screen form's net),
  // which quietly assumed the ledger already held what the form shows. It does not,
  // the moment you type an entry onto a parchi that is already saved: the ledger has
  // no such row yet, the subtraction ran backwards, and سابقہ went NEGATIVE on a
  // customer's very first receipt (چاندی دی 34 → سابقہ −34).
  //
  // "Before", not "any other parchi": navigating BACK to parchi 1 must still show no
  // سابقہ even once parchi 2 exists — a later parchi is not history. Rows with no
  // receipt_no are kept (they belong to no parchi, so this one never owns them).
  // Called with no second argument (statements, customer list) it is unchanged.
  getCustomerLedger(customerId, beforeReceiptNo) {
    // manual اندراج rows carry no customer_id, but exclude by category too for safety.
    const before = Number(beforeReceiptNo)
    const hasBefore = Number.isFinite(before)
    const txns = query(
      `SELECT * FROM transactions WHERE customer_id = ? AND category <> 'adjustment'
       ${hasBefore ? 'AND (receipt_no IS NULL OR receipt_no < ?)' : ''} ORDER BY ts ASC, id ASC`,
      hasBefore ? [customerId, before] : [customerId]
    )
    let gold = 0
    let cash = 0
    const rows = txns.map((t) => {
      // direction 'out' = shop gave to customer (customer owes), 'in' = received
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') {
        gold += sign * (t.khalis_sona || 0)
      }
      if (t.category === 'cash_give' || t.category === 'cash_take') {
        cash += sign * (t.cash_amount || 0)
      }
      return { ...t, balance_gold: gold, balance_cash: cash }
    })
    return { rows, balance_gold: gold, balance_cash: cash }
  },

  // Every customer with their running gold + cash balance, computed in ONE pass
  // over the transactions table (not N ledger queries). The per-transaction math
  // is IDENTICAL to getCustomerLedger: sign = 'out' ? +1 : -1 (shop gave to
  // customer = customer owes), gold from gold_give/gold_take on khalis_sona, cash
  // from cash_give/cash_take on cash_amount. Customers with no transactions are
  // included with a zero balance. Sorted by name ASC.
  listCustomersWithBalances() {
    const customers = query('SELECT id, name, mobile, image FROM customers ORDER BY name ASC')
    const txns = query(
      'SELECT customer_id, direction, category, khalis_sona, cash_amount FROM transactions'
    )
    const bal = new Map() // customer_id -> { gold, cash }
    for (const t of txns) {
      if (t.customer_id == null) continue
      let b = bal.get(t.customer_id)
      if (!b) { b = { gold: 0, cash: 0 }; bal.set(t.customer_id, b) }
      const sign = t.direction === 'out' ? 1 : -1
      if (t.category === 'gold_give' || t.category === 'gold_take') {
        b.gold += sign * (t.khalis_sona || 0)
      }
      if (t.category === 'cash_give' || t.category === 'cash_take') {
        b.cash += sign * (t.cash_amount || 0)
      }
    }
    return customers.map((c) => {
      const b = bal.get(c.id) || { gold: 0, cash: 0 }
      return {
        id: c.id,
        name: c.name,
        mobile: c.mobile,
        image: c.image,
        balance_gold: b.gold,
        balance_cash: b.cash
      }
    })
  },

  getDaybook(date) {
    const txns = query(
      "SELECT t.*, c.name AS customer_name FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.date = ? AND t.category <> 'adjustment' ORDER BY t.ts ASC, t.id ASC",
      [date]
    )
    const totals = {
      gold_in: 0,
      gold_out: 0,
      cash_in: 0,
      cash_out: 0
    }
    for (const t of txns) {
      if (t.direction === 'in') {
        totals.gold_in += t.khalis_sona || 0
        totals.cash_in += (t.qeemat || 0) + (t.cash_amount || 0)
      } else if (t.direction === 'out') {
        totals.gold_out += t.khalis_sona || 0
        totals.cash_out += (t.qeemat || 0) + (t.cash_amount || 0)
      }
    }
    return { txns, totals }
  },

  listDates() {
    return query("SELECT DISTINCT date FROM transactions WHERE category <> 'adjustment' ORDER BY date DESC")
  },

  getShopTotals() {
    const txns = query('SELECT * FROM transactions')
    let cash = 0
    let gold = 0
    let parchun = 0
    // Inventory counters — their OWN ledger, fed only by meta {unit, count} on
    // اندراج rows. Nothing here reads khalis_sona, and nothing above reads
    // meta.count, so grams and counts can never cross over.
    const counts = { piece: 0, bar1Tola: 0, bar5Tola: 0, bar10Tola: 0 }
    for (const t of txns) {
      // Manual balance adjustment (اندراج): direction-signed into کیش / چاندی /
      // the inventory counters ONLY. `continue` so the general metal line below
      // never double-counts it, and it never touches parchun.
      if (t.category === 'adjustment') {
        const s = t.direction === 'in' ? 1 : -1
        cash += s * (t.cash_amount || 0)
        gold += s * (t.khalis_sona || 0)
        // A count اندراج carries cash_amount = khalis_sona = 0, so the two lines
        // above are no-ops for it and this is the ONLY line that moves it.
        const m = parseMeta(t.meta)
        if (m && COUNT_TARGETS.has(m.unit)) counts[m.unit] += s * (Number(m.count) || 0)
        continue
      }
      const goldSign = t.direction === 'in' ? 1 : -1
      // A metal trade lands on EXACTLY ONE of the two ledgers, never both:
      //
      //   unit 'gold' / no meta  → grams, into tezabi_sona. Unchanged behaviour, and
      //                            the path every pre-existing row takes.
      //   unit bar*/piece        → items, into that counter. Its grams are NOT added
      //                            to tezabi_sona — the `else` makes double-counting
      //                            structurally impossible.
      //
      // Sign is goldSign, the SAME rule the gram total uses: 'in' adds, 'out'
      // subtracts. So نقد خریدا (gold_buy) and چاندی لی (gold_take) add to the
      // counter; فروخت (gold_sell) and چاندی دی (gold_give) subtract from it.
      const tUnit = (parseMeta(t.meta) || {}).unit
      if (METAL_CATS.has(t.category) && COUNT_TARGETS.has(tUnit)) {
        counts[tUnit] += goldSign * unitCount(tUnit, t.khalis_sona)
      } else {
        gold += goldSign * (t.khalis_sona || 0)
      }
      // Bottom-bar کیش moves ONLY on an explicit cash hand-over: کیش لیا adds,
      // کیش دیا subtracts. A نقد parchi's qeemat (gold_sell / gold_buy) is a
      // priced metal line, NOT a cash movement, and must never touch this box —
      // it still shows up in the daybook and the نقد reports, which price those
      // rows themselves off `qeemat`.
      if (t.category === 'cash_take') cash += t.cash_amount || 0
      if (t.category === 'cash_give') cash -= t.cash_amount || 0
      parchun += t.point || 0
    }
    // A counter with a net of 0 goes back as null, which the StatusBar renders as
    // "-" — an empty counter reads as "nothing here", not a hard zero. Round to 3dp
    // first: a derived bar count (grams / 11.664) carries float dust, so a truly
    // settled counter can land on 1e-16 instead of 0 and would show as a number.
    const orNull = (n) => {
      const r = Math.round(n * 1000) / 1000
      return r === 0 ? null : r
    }
    return {
      cash,
      tezabi_sona: gold,
      parchun,
      piece: orNull(counts.piece),
      bar1Tola: orNull(counts.bar1Tola),
      bar5Tola: orNull(counts.bar5Tola),
      bar10Tola: orNull(counts.bar10Tola)
    }
  }
}

module.exports = { init, api, flush }
