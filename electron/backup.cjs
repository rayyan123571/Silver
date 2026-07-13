/*
 * Automatic backup & restore for the Silver SQLite database. ADD-ONLY module:
 * it never touches the schema, the DB path, or any business logic — it only
 * copies the on-disk silver.sqlite file.
 *
 * Backup folder resolution (remembered in userData/backup-config.json):
 *   1. saved folder from config, if still writable
 *   2. D:\Silver Backup (created if missing) — saved to config once it works
 *   3. ask ONCE per session with a folder picker (only when interactive)
 *   4. otherwise: skip the backup, never block the app
 *
 * The folder and the snapshot filenames are SILVER-SPECIFIC on purpose: the Gold
 * app may be installed on the same PC and backs up to D:\GoldLab Backup as
 * AutoBackup.sqlite. Sharing either would let one app's snapshot overwrite the
 * other's — and worse, let restoreIfMissing() seed Silver with Gold's database.
 *
 * Backup layout (exactly two files, atomic writes):
 *   SilverAutoBackup.sqlite       — latest snapshot (tmp-file + rename, never half-written)
 *   SilverAutoBackup_prev.sqlite  — a ~1-day-old snapshot (rotated at most once per 24h,
 *                                   BEFORE the latest is replaced, so it preserves a
 *                                   pre-corruption state for a full day)
 *
 * Restore runs ONLY when the main DB file is missing (fresh machine / reinstall):
 * an existing silver.sqlite is NEVER overwritten by any code path in here.
 *
 * Every operation is try/catch'd: failures are console-logged for developers and
 * the app continues normally — no dialogs, no crashes, no blocking (the only two
 * allowed dialogs are the one-time folder picker and the restore question).
 */
const { dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const LATEST = 'SilverAutoBackup.sqlite'
const PREV = 'SilverAutoBackup_prev.sqlite'
const TMP = 'SilverAutoBackup.sqlite.tmp'
const CONFIG = 'backup-config.json'
const DAY_MS = 24 * 60 * 60 * 1000

// Env overrides exist ONLY so the automated tests can exercise the real code
// paths (fake "D:", short timer). Unset in production → real defaults.
const DEFAULT_DIR = process.env.SILVER_BACKUP_DEFAULT || 'D:\\Silver Backup'
const INTERVAL_MS = Number(process.env.SILVER_BACKUP_INTERVAL_MS) || 10 * 60 * 1000
const INITIAL_MS = Number(process.env.SILVER_BACKUP_INITIAL_MS) || 90 * 1000

let userDataDir = null
let dbPath = null
let flushFn = null
let askedThisSession = false // the folder picker shows at most once per app run
let backupRunning = false
let timers = []

const log = (...a) => console.log('[backup]', ...a)
const logErr = (msg, e) => console.error('[backup]', msg, e && e.message ? e.message : e)

/* ---------- config ---------- */

function configPath() {
  return path.join(userDataDir, CONFIG)
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const cfg = JSON.parse(raw)
    return cfg && typeof cfg === 'object' ? cfg : {}
  } catch {
    return {} // missing/corrupt config = no saved folder; never an error
  }
}

function saveConfig(patch) {
  try {
    const cfg = { ...readConfig(), ...patch }
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
  } catch (e) {
    logErr('Could not save backup config:', e)
  }
}

/* ---------- folder resolution ---------- */

// A folder is usable only if we can actually create it and write inside it.
function ensureWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.silver-write-test')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

// Resolve the backup folder per the order documented at the top. Returns the
// folder path, or null when no folder is available (backup is then skipped).
// `interactive` gates the one-time folder picker (quit-time backups never ask).
function resolveBackupFolder(interactive) {
  try {
    // 1. remembered choice
    const saved = readConfig().folder
    if (saved && ensureWritableDir(saved)) return saved
    if (saved) log('Saved backup folder unavailable:', saved)

    // 2. default D:\Silver Backup
    if (ensureWritableDir(DEFAULT_DIR)) {
      if (saved !== DEFAULT_DIR) {
        saveConfig({ folder: DEFAULT_DIR })
        log('Backup folder chosen:', DEFAULT_DIR)
      }
      return DEFAULT_DIR
    }

    // 3. ask once per session (only on interactive paths)
    if (interactive && !askedThisSession) {
      askedThisSession = true
      const picked = dialog.showOpenDialogSync({
        title: 'D drive was not found. Please select a backup location.',
        message: 'D drive was not found. Please select a backup location.',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      })
      const folder = picked && picked[0]
      if (folder && ensureWritableDir(folder)) {
        saveConfig({ folder })
        log('Backup folder chosen:', folder)
        return folder
      }
      log('Backup skipped (no folder selected).')
      return null
    }

    log('Backup skipped (drive unavailable).')
    return null
  } catch (e) {
    logErr('Backup folder resolution failed:', e)
    return null
  }
}

/* ---------- backup ---------- */

// One backup pass: flush → copy to tmp → daily prev rotation → atomic rename.
// Silent and best-effort: any failure logs, cleans up the tmp file, and leaves
// the existing AutoBackup.sqlite / AutoBackup_prev.sqlite exactly as they were.
function runBackup(interactive) {
  if (backupRunning) return // re-entry guard (timer + quit overlapping)
  backupRunning = true
  let tmpFile = null
  try {
    if (!dbPath) return
    try { if (typeof flushFn === 'function') flushFn() } catch (e) { logErr('Flush before backup failed:', e) }
    if (!fs.existsSync(dbPath)) { log('Backup skipped (no database file yet).'); return }

    const folder = resolveBackupFolder(!!interactive)
    if (!folder) return // already logged inside resolveBackupFolder

    const latest = path.join(folder, LATEST)
    const prev = path.join(folder, PREV)
    tmpFile = path.join(folder, TMP)

    // 2. current DB → tmp (never touches the existing backup files)
    fs.copyFileSync(dbPath, tmpFile)

    // 3. daily prev rotation — freeze the OLD latest (yesterday's state) into
    //    prev, at most once per 24h, BEFORE the latest is replaced below.
    try {
      if (fs.existsSync(latest)) {
        let rotate = true
        if (fs.existsSync(prev)) {
          const age = Date.now() - fs.statSync(prev).mtimeMs
          rotate = age > DAY_MS
        }
        if (rotate) {
          fs.copyFileSync(latest, prev)
          log('Previous-day backup rotated.')
        }
      }
    } catch (e) {
      logErr('Prev rotation failed (latest backup continues):', e)
    }

    // 4. atomic swap: rename replaces the old latest in one step, so
    //    AutoBackup.sqlite is never observable half-written.
    fs.renameSync(tmpFile, latest)
    tmpFile = null
    log(`Automatic backup completed (${folder}).`)
  } catch (e) {
    logErr('Backup failed:', e)
  } finally {
    if (tmpFile) { try { fs.existsSync(tmpFile) && fs.unlinkSync(tmpFile) } catch {} }
    backupRunning = false
  }
}

/* ---------- restore (ONLY when the main DB is missing) ---------- */

// Runs BEFORE db.init. An existing silver.sqlite is opened untouched — no
// dialog, no copy, ever. Only when the DB file is absent (fresh machine or a
// Windows reinstall) is the backup offered, and even then the copy targets a
// path we just confirmed to be empty.
function restoreIfMissing(opts) {
  try {
    userDataDir = opts.userDataDir
    dbPath = opts.dbPath
    if (fs.existsSync(dbPath)) return { restored: false } // existing customers: untouched

    const folder = resolveBackupFolder(true)
    if (!folder) { log('No backup found.'); return { restored: false } }
    const latest = path.join(folder, LATEST)
    if (!fs.existsSync(latest)) { log('No backup found.'); return { restored: false } }

    const choice = dialog.showMessageBoxSync({
      type: 'question',
      title: 'Silver — Restore Backup',
      message: 'A previous backup was found. Would you like to restore your data?',
      detail: 'پچھلا بیک اپ ملا ہے۔ کیا آپ اپنا ڈیٹا بحال کرنا چاہتے ہیں؟',
      buttons: ['Restore', 'Skip'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (choice !== 0) { log('Restore skipped by user; creating a fresh database.'); return { restored: false } }

    try {
      if (fs.existsSync(dbPath)) return { restored: false } // paranoid re-check: never overwrite
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      fs.copyFileSync(latest, dbPath)
      log('Backup restored successfully.')
      return { restored: true }
    } catch (e) {
      logErr('Restore copy failed; starting with a fresh database:', e)
      try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath) } catch {} // no half-copied DB
      return { restored: false }
    }
  } catch (e) {
    logErr('Restore check failed; starting normally:', e)
    return { restored: false }
  }
}

/* ---------- scheduling ---------- */

// Start the silent schedule: one early backup shortly after launch (so short
// sessions are covered and a missing folder is asked about once, early), then
// every ~10 minutes. A crash / Task-Manager kill loses at most that window.
function start(opts) {
  try {
    userDataDir = opts.userDataDir
    dbPath = opts.dbPath
    flushFn = opts.flush
    timers.push(setTimeout(() => runBackup(true), INITIAL_MS))
    timers.push(setInterval(() => runBackup(true), INTERVAL_MS))
    log(`Automatic backup scheduled (every ${Math.round(INTERVAL_MS / 60000) || 1} min).`)
  } catch (e) {
    logErr('Backup scheduler failed to start:', e)
  }
}

// Quit-time backup: best-effort and NEVER interactive (a picker would block
// quitting). The copy itself is fast (single file on the same machine).
function runOnQuit() {
  try {
    for (const t of timers) { try { clearTimeout(t); clearInterval(t) } catch {} }
    timers = []
    runBackup(false)
  } catch (e) {
    logErr('Quit-time backup failed:', e)
  }
}

module.exports = { restoreIfMissing, start, runOnQuit, runBackup, resolveBackupFolder }
