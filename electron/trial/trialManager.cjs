// ─── Trial / licensing manager ───────────────────────────────────────────────
// main.cjs calls initializeTrial() once at startup to stamp the trial record, then
// checkTrial(): an expired result shows the standalone gate window (gateWindow.cjs)
// instead of the app. Licence keys, activation and encryption are later steps.
//
// Two files, both in the Electron userData folder that already holds the SQLite
// database (main.cjs passes app.getPath('userData') to db.init):
//   trial.dat  — installDate, lastRunDate, machineId, version + HMAC signature.
//   install.id — the permanent installation identity, written once, never touched.
//
// The trial fails CLOSED. Anything that makes the record untrustworthy — an edited
// file, a deleted one, a wound-back clock, an unusable install date — counts as
// expired. The one bypass that remains is deleting the whole userData folder; see
// APP_SECRET below for how far this protection honestly goes.
//
// Plain JSON, not encrypted.
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const { execFileSync } = require('child_process')
const { app } = require('electron')

// Shape of the stored record. Bump CURRENT_VERSION when the fields change, and add
// the matching step to MIGRATIONS, so an old trial.dat is upgraded rather than
// silently misread.
const TRIAL_FILE = 'trial.dat'
const INSTALL_FILE = 'install.id'
const CURRENT_VERSION = 1
// Trial length in whole calendar days. Day 0 is the install day; the trial is
// expired once this many calendar days have elapsed (install +7 = expiry date).
const TRIAL_DAYS = 7
const SIGNED_FIELDS = ['installDate', 'lastRunDate', 'machineId', 'version']
// Keys this module derives at load time. Never written to disk: `signature` is
// always recomputed on save, `tampered` / `missingTrialData` / `legacy` are
// verdicts about the state of the files, not stored state.
const DERIVED_FIELDS = ['signature', 'tampered', 'missingTrialData', 'legacy']
const defaultTrialData = () => ({
  installDate: null,
  lastRunDate: null,
  machineId: null,
  version: CURRENT_VERSION
})

// Integrity secret. NOT exported, and deliberately not read from a config file or
// an env var — it must be identical on every install for the signature to verify.
//
// Be clear-eyed about what this buys: it stops a shopkeeper hand-editing dates in
// Notepad, which is the actual threat. It does NOT stop a determined attacker —
// the secret ships inside the (unpacked, readable) asar, so anyone willing to
// open the bundle can recompute a valid signature. Real resistance would need the
// secret off the machine (server-side validation) or, failing that, encryption
// plus obfuscation. Treat this as tamper-EVIDENCE, not tamper-PROOF.
const APP_SECRET = 'gold-lab::trial-integrity::v1::c4f2a1e7d9b3'

// Resolved lazily, not at module load: app.getPath() throws before the Electron
// app is ready, and this module must stay side-effect-free to require.
function getTrialFilePath() {
  return path.join(app.getPath('userData'), TRIAL_FILE)
}

// ── install.id — the permanent installation identity ─────────────────────────
// Written ONCE, on the genuine first install, and never touched again. It lives
// beside trial.dat in userData, so it survives app updates and reinstalls (which
// replace the program files, not the user data). Its whole job is to outlive
// trial.dat: deleting trial.dat to win a fresh trial leaves install.id behind as
// evidence — see missingTrialData in loadTrialData().
//
// Unsigned by design at this step; it holds no secret and grants nothing.
function getInstallIdPath() {
  return path.join(app.getPath('userData'), INSTALL_FILE)
}

// The record, or null when the file is absent/unreadable/not an object. Never
// throws — a corrupt install.id must not be able to stop startup.
function loadInstallId() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getInstallIdPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return {
      machineId: parsed.machineId ?? null,
      installDate: parsed.installDate ?? null,
      installationVersion: parsed.installationVersion ?? CURRENT_VERSION
    }
  } catch {
    return null
  }
}

// Create install.id if and only if it is not already there. An existing file is
// returned untouched — its installDate is the permanent record of when this
// machine first ran the app and must never be rewritten. Atomic temp+rename, and
// best-effort: a failure returns null rather than throwing.
function ensureInstallId({ machineId, installDate }) {
  const existing = loadInstallId()
  if (existing) return existing // NEVER overwritten, NEVER re-dated

  const record = {
    machineId: machineId ?? null,
    installDate: installDate ?? null,
    installationVersion: CURRENT_VERSION
  }
  const file = getInstallIdPath()
  const tmp = file + '.tmp'
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return record
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
    console.warn('[trial] could not write install.id — continuing without it')
    return null
  }
}

// HMAC-SHA256 over the signed fields in a FIXED order, joined by a separator that
// cannot appear inside an ISO date or a GL- machine id — so no two distinct
// records can serialize to the same string. HMAC rather than a bare
// sha256(secret + data) because the latter is open to length-extension; both are
// SHA-256 underneath. null serializes as the literal "null", which is stable.
function signTrialData(data) {
  const payload = SIGNED_FIELDS.map((k) => String(data[k])).join('\u0000')
  return crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex')
}

// Constant-time compare so a caller can't time-probe the expected signature one
// character at a time. Lengths must match first — timingSafeEqual throws otherwise.
function signatureMatches(expected, actual) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'))
  } catch {
    return false
  }
}

// ── Version migration ────────────────────────────────────────────────────────
// One entry per UPGRADE step, keyed by the version it migrates FROM. Each step
// takes the whole record and returns the whole record at version N+1, spreading
// the input first so unknown//future fields ride along untouched. Steps chain, so
// a v1 file on a v3 app runs 1→2 then 2→3.
//
//   const MIGRATIONS = {
//     1: (d) => ({ ...d, version: 2, licenseKey: null }),   // v1 → v2: add field
//     2: (d) => ({ ...d, version: 3, installDate: toIso(d.installDate) })
//   }
//
// Rules: never downgrade, never drop data. A step may add or rewrite fields; it
// must not delete one it doesn't own.
const MIGRATIONS = {}

// Upgrade a raw parsed record to CURRENT_VERSION. Pure — no I/O, no logging of
// user data — and total: any input that isn't a plain object is returned as-is.
// At CURRENT_VERSION === 1 with no steps registered this is the identity function,
// which is exactly what this step calls for.
function migrateTrialData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  let out = { ...data }
  let v = Number(out.version)
  // A missing/garbage version is treated as the oldest format rather than
  // guessed at — v1 is the first format that ever existed.
  if (!Number.isFinite(v) || v < 1) {
    v = 1
    out.version = 1
  }
  // Written by a NEWER build than this one. Downgrading would destroy whatever
  // that build added, so hand the record back untouched and let the caller decide.
  if (v > CURRENT_VERSION) {
    console.warn(`[trial] trial.dat is version ${v}, newer than this app (${CURRENT_VERSION}) — left as-is`)
    return out
  }
  while (v < CURRENT_VERSION) {
    const step = MIGRATIONS[v]
    if (typeof step !== 'function') {
      console.warn(`[trial] no migration from version ${v} — leaving trial.dat unchanged`)
      break
    }
    out = step(out)
    const next = Number(out.version)
    // A step that fails to advance the version would spin forever.
    if (!Number.isFinite(next) || next <= v) {
      console.warn(`[trial] migration from version ${v} did not advance the version — stopping`)
      break
    }
    v = next
  }
  return out
}

// Missing file, unreadable file, malformed JSON, or a JSON value that isn't an
// object (null / array / number) all fall back to defaults — reading trial state
// must never be able to crash the app. Missing known keys take their default, so a
// partial record can't yield undefined; UNKNOWN keys are carried through untouched
// (a newer build's fields must survive a round-trip through this older one).
//
// Order is deliberate: verify the signature against the record AS STORED, then
// migrate. A migration that rewrites signed fields necessarily invalidates a
// signature computed over the old ones, so verifying afterwards would flag every
// upgraded file as tampered. The migrated record is re-signed on the next save.
//
// The returned record carries a `tampered` flag; it is DETECTION ONLY — nothing is
// repaired, nothing is blocked, no UI is shown. A file with no signature at all
// counts as tampered: otherwise deleting the field would be a trivial bypass.
//
// It also carries `missingTrialData`: true when trial.dat is gone but install.id
// remains, i.e. someone deleted the trial record to start over. Detection only —
// trial.dat is NOT recreated, nothing is repaired, startup is not blocked. On a
// genuine first install neither file exists, so the flag is false.
function loadTrialData() {
  const d = defaultTrialData()
  try {
    const raw = fs.readFileSync(getTrialFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...d, tampered: false, missingTrialData: false, legacy: false }
    }

    const stored = {
      installDate: parsed.installDate ?? d.installDate,
      lastRunDate: parsed.lastRunDate ?? d.lastRunDate,
      machineId: parsed.machineId ?? d.machineId,
      version: parsed.version ?? d.version
    }

    // LEGACY: a v1 record written before signatures existed. It has no `signature`
    // key at all — not an empty one, not a wrong one — so there is nothing to
    // verify and nothing to accuse. It is re-signed once, by initializeTrial().
    //
    // On its own, "missing signature ⇒ trust it" would undo step 6: strip the
    // signature after editing a date and the file launders itself into a valid
    // one. So the claim is CORROBORATED against install.id, which a genuine
    // legacy file predates and therefore cannot have:
    //   • no install.id            → genuinely old install, accept.
    //   • install.id agrees on installDate → accept (belt and braces).
    //   • install.id disagrees     → the dates were edited. Tampered.
    // An attacker who deletes BOTH files gets a fresh trial anyway (see the note
    // in the module header), so this closes the only edit-in-place path.
    const unsigned = !('signature' in parsed) && stored.version === 1
    let legacy = false
    let tampered = false

    if (unsigned) {
      const install = loadInstallId()
      legacy = !install || install.installDate === stored.installDate
      tampered = !legacy
      if (legacy) console.warn('[trial] legacy unsigned trial.dat — will be signed once')
      else console.warn('[trial] Trial data has been modified.')
    } else {
      tampered = !signatureMatches(signTrialData(stored), parsed.signature)
      if (tampered) console.warn('[trial] Trial data has been modified.')
    }

    // Unknown keys ride along; `signature` is dropped because it describes the
    // pre-migration record and is regenerated on save.
    const { signature, ...rest } = parsed
    // Migration still runs on a tampered record, but `tampered` is applied AFTER
    // it and is never fed in, so no migration step can observe or clear the flag.
    const migrated = migrateTrialData({ ...rest, ...stored })
    return { ...migrated, tampered, missingTrialData: false, legacy }
  } catch {
    // No trial.dat. Not tampering — there is nothing to verify. But if install.id
    // survives, this machine HAS run the app before and the record was removed.
    const missingTrialData = loadInstallId() !== null
    if (missingTrialData) console.warn('[trial] trial.dat is missing but install.id exists.')
    return { ...d, tampered: false, missingTrialData, legacy: false }
  }
}

// Write-through to disk, atomically: JSON goes to a temp file that is then
// renamed over trial.dat, so a crash mid-write can't leave a half-written record
// that loadTrialData() would discard. Returns true on success, false on failure —
// never throws, for the same never-crash-the-app reason as above.
//
// A FRESH signature is always computed here, over exactly the signed fields, so a
// record written by this app always verifies. Unknown keys the caller carried in
// (a newer build's fields, surfaced by loadTrialData) are written back rather than
// dropped; only DERIVED_FIELDS are stripped. Note the signature covers the signed
// fields, NOT those extra keys.
//
// REFUSES to write a record flagged tampered. This is what makes tampering stick:
// the file keeps its mismatched signature, so every later load re-detects it and
// `tampered` can never flip back to false on its own. Writing would re-sign the
// edited values and launder the evidence. Repair is a deliberate act — delete
// trial.dat, or clear the flag explicitly — never a side effect of a normal run.
function saveTrialData(data) {
  if (data && data.tampered === true) return false // no write, no signature, no repair
  const file = getTrialFilePath()
  const tmp = file + '.tmp'
  try {
    const record = { ...defaultTrialData(), ...(data || {}) }
    const clean = {}
    for (const k of Object.keys(record)) {
      if (!DERIVED_FIELDS.includes(k) && !SIGNED_FIELDS.includes(k)) clean[k] = record[k]
    }
    for (const k of SIGNED_FIELDS) clean[k] = record[k]
    clean.signature = signTrialData(clean)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
    return false
  }
}

// ── Machine ID ───────────────────────────────────────────────────────────────
// DETERMINISTIC, never random: the same machine must hash to the same ID on every
// run, or a reinstall/update would look like a new machine. Two sources, tried in
// order — whichever answers, its raw string is hashed, so the ID never leaks the
// underlying identifier.
//
// PRIMARY — Windows MachineGuid: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid.
// Written once at OS install, survives app updates/reinstalls and user changes.
// Read via reg.exe with the explicit /reg:64 view: Electron is a 32-bit-capable
// process and WOW64 redirection would otherwise send a 32-bit build to the
// Wow6432Node key, which yields a DIFFERENT GUID on the same machine.
function readMachineGuid() {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/)
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

// FALLBACK — stable hardware/OS traits, used only when MachineGuid is missing.
// Deliberately excludes anything that drifts: no hostname (renameable), no MAC
// (adapters come and go), no free memory, no uptime. CPU model + core count +
// arch + platform + total RAM stay put across restarts and app updates. Weaker
// than MachineGuid (two identical PCs can collide) but never random.
function fallbackFingerprint() {
  try {
    const cpus = os.cpus() || []
    const parts = [
      process.platform,
      process.arch,
      (cpus[0] && cpus[0].model ? cpus[0].model : 'unknown-cpu').trim(),
      String(cpus.length),
      String(os.totalmem())
    ]
    return parts.join('|')
  } catch {
    return null
  }
}

// "GL-" + the first 12 hex chars of the SHA-256 of the source string, uppercased
// → GL-8A7F91CD22EF. Short enough to read down a phone line, wide enough (48 bits)
// that accidental collisions aren't a concern.
function generateMachineId() {
  try {
    const source = readMachineGuid() || fallbackFingerprint()
    if (!source) return null
    const hash = crypto.createHash('sha256').update(String(source)).digest('hex')
    return 'GL-' + hash.slice(0, 12).toUpperCase()
  } catch {
    return null // caller stores null; a later run can try again
  }
}

// Milliseconds for a stored ISO string, or null when it is absent/unparseable —
// a corrupt timestamp must never become NaN and silently poison a comparison.
function parseIsoMs(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

// DETECT-ONLY date check against the stored lastRunDate. Returns the record to
// persist, or null when nothing should be written.
//   now  > lastRun → move lastRunDate forward.
//   now == lastRun → nothing to do (identical timestamps only; see below).
//   now  < lastRun → the system clock went backwards. LOG IT AND LEAVE THE FILE
//                    ALONE: lastRunDate only ever moves forward, so a user who
//                    winds the clock back cannot rewrite their own history. We
//                    do not repair, expire, block or warn the user — this step
//                    only establishes the signal a later step will act on.
// installDate is never touched by any branch.
// An absent/corrupt lastRunDate can't be compared, so it is set to now — that is
// a repair of a missing field, not a rollback, and installDate still stands.
function validateRunDate(data, nowIso) {
  const nowMs = Date.parse(nowIso)
  const lastMs = parseIsoMs(data.lastRunDate)

  if (lastMs === null) return { ...data, lastRunDate: nowIso }
  if (nowMs > lastMs) return { ...data, lastRunDate: nowIso }
  if (nowMs === lastMs) return null
  console.warn('[trial] System date rollback detected.')
  return null
}

// Stamp trial.dat. Runs once at startup, from main.cjs after app.whenReady().
//   1. No file → create it: install date, last-run date, machine ID.
//   2. File → backfill machineId if it is still null (an existing ID is NEVER
//      regenerated or overwritten, so it survives restarts, updates, reinstalls),
//      then run the forward-only lastRunDate check.
// installDate is written exactly once, at creation, and never modified after.
// A machine ID that can't be generated stays null so a later run can retry rather
// than baking in a bad value.
// This function enforces NOTHING — no expiry, no locking, no UI. Best-effort:
// every failure is logged and swallowed so startup always continues.
function initializeTrial() {
  try {
    const file = getTrialFilePath()
    const nowIso = new Date().toISOString()

    if (!fs.existsSync(file)) {
      if (loadInstallId()) {
        // The trial record was DELETED but this machine has run the app before.
        // Do NOT recreate it — that would hand a fresh trial to anyone who empties
        // userData, which is precisely what install.id exists to prevent. Detect,
        // log, continue. loadTrialData() reports the same via missingTrialData.
        console.warn('[trial] trial.dat is missing but install.id exists.')
        return
      }
      // Genuine first install: neither file exists. Write trial.dat FIRST, so a
      // crash between the two writes leaves a trial record rather than an orphan
      // install.id — the latter would look like a deletion and freeze out a
      // brand-new user.
      const machineId = generateMachineId()
      const ok = saveTrialData({
        installDate: nowIso,
        lastRunDate: nowIso,
        machineId,
        version: CURRENT_VERSION
      })
      if (!ok) console.warn('[trial] could not write trial.dat — continuing without it')
      else ensureInstallId({ machineId, installDate: nowIso })
      return
    }

    const data = loadTrialData()
    // A tampered record is frozen: no machine-id backfill, no lastRunDate bump, no
    // re-signing, and no install.id seeded from values we know to be edited.
    // loadTrialData() has already logged; startup continues either way.
    if (data.tampered) return

    // Backfill first, so a rollback (which writes nothing) can't strand a null id.
    const withId = data.machineId ? data : { ...data, machineId: generateMachineId() }
    const idPending = !data.machineId && !withId.machineId // couldn't generate; retry next run

    // Installs predating install.id get one now, seeded from the trial record so
    // the ORIGINAL install date carries over instead of today's. Seeded AFTER the
    // backfill above: install.id is written once and never corrected, so a null
    // machineId would otherwise be frozen into it forever.
    ensureInstallId({ machineId: withId.machineId, installDate: data.installDate })

    const next = validateRunDate(withId, nowIso)
    // Persist when the run date moved, when the machine id was backfilled, or when
    // this is a legacy record that still needs its first signature. The legacy case
    // must be explicit: a legacy file whose clock is rolled back (or whose
    // lastRunDate is exactly now) produces no date change, and would otherwise stay
    // unsigned forever — re-warning on every launch.
    const changed = next || (withId.machineId !== data.machineId && !idPending) || data.legacy
    if (!changed) return

    // `next || withId` still carries `legacy`/`tampered`; saveTrialData strips both
    // (DERIVED_FIELDS) and writes a fresh signature over the untouched fields, so
    // installDate / lastRunDate / machineId all survive the migration verbatim.
    if (!saveTrialData(next || withId)) {
      console.warn('[trial] could not update trial.dat — continuing without it')
    }
  } catch (e) {
    console.warn('[trial] initializeTrial failed:', (e && e.message) || e)
  }
}

// ── Trial countdown ──────────────────────────────────────────────────────────
// Midnight (local) of the calendar day containing `ms`. The countdown is in whole
// CALENDAR days, not 24-hour spans: installing at 23:55 must not burn a day at
// 00:05. Local, not UTC, because "what day is it" means the user's calendar — on
// a UTC+05:00 machine an installDate of 2026-07-09T19:30:00Z is 10 July locally,
// and the trial has to count from the day the shopkeeper actually installed.
function startOfLocalDay(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Whole calendar days from `fromMs` to `toMs`. Both are snapped to local midnight
// first, so the result is a pure day difference regardless of clock time. Rounded,
// not floored: a DST shift makes a "day" 23 or 25 hours long and would otherwise
// drop or add one.
function calendarDaysBetween(fromMs, toMs) {
  return Math.round((startOfLocalDay(toMs) - startOfLocalDay(fromMs)) / 86400000)
}

// Full trial state. Every consumer goes through here so the rules live in ONE
// place. Nothing calls this yet — no UI, no startup gate, no blocking.
//
// Three conditions force expiry outright, before any date arithmetic. All three
// mean the trial record can no longer be trusted, and the safe answer for an
// untrustworthy record is "expired" (fail closed, never fail open):
//   • tampered         — trial.dat was edited (step 6/8)
//   • missingTrialData — trial.dat deleted while install.id survives (step 9)
//   • rollback         — the system clock is behind the last recorded run (step 5)
//
// Otherwise: daysUsed = calendar days from installDate to today.
//   remaining = 7 - daysUsed, clamped to 0..7
//   expired   = daysUsed >= 7   ⟺   remaining === 0
// So an install on 09 July gives the user days 09..15 inclusive, and the trial is
// expired on 16 July — the date the spec calls "Expires".
function checkTrial() {
  const data = loadTrialData()
  const nowMs = Date.now()

  // Rollback is derived, not remembered: the clock is behind the last run we
  // recorded. initializeTrial() refuses to move lastRunDate backwards, so the
  // future timestamp stays on disk and this keeps reporting true for as long as
  // the clock is wound back. (Wind it forward again and lastRunDate is merely
  // stale, so this reads false — it detects a clock BEHIND our history, not the
  // fact that someone once moved it.)
  const lastRunMs = parseIsoMs(data.lastRunDate)
  const rollback = lastRunMs !== null && nowMs < lastRunMs

  const installMs = parseIsoMs(data.installDate)
  // No usable install date on an existing record: nothing to count from, so the
  // record is unusable. Fail closed rather than granting an unbounded trial.
  const unusable = installMs === null

  const blocked = data.tampered || data.missingTrialData || rollback || unusable

  let daysUsed = 0
  let remainingDays = 0
  if (!blocked) {
    daysUsed = calendarDaysBetween(installMs, nowMs)
    // A negative daysUsed means installDate is in the future — the clock moved
    // back past the install. Clamp so remaining can never exceed the trial length.
    remainingDays = Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - daysUsed))
  }

  // The machine id is what the user reads out to support, so it must be present
  // even when trial.dat is gone or unusable: fall back to install.id, then to
  // recomputing it from the hardware (deterministic — same value either way).
  const machineId = data.machineId || (loadInstallId() || {}).machineId || generateMachineId()

  return {
    expired: blocked || remainingDays === 0,
    remainingDays: blocked ? 0 : remainingDays,
    daysUsed,
    installDate: data.installDate,
    machineId,
    tampered: !!data.tampered,
    missingTrialData: !!data.missingTrialData,
    rollback
  }
}

// Days left before the trial expires: 7 down to 0, never negative, never > 7.
// 0 always means expired.
function getRemainingDays() {
  return checkTrial().remainingDays
}

// Whether the trial period has run out — including the three fail-closed cases
// (tampered / deleted record / clock rollback).
function isExpired() {
  return checkTrial().expired
}

module.exports = { initializeTrial, checkTrial, getRemainingDays, isExpired }
