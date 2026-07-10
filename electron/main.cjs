const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const db = require('./db.cjs')
const backup = require('./backup.cjs')
const raster = require('./rasterPrint.cjs')
const liveGold = require('./liveGold.cjs')
const trial = require('./trial/trialManager.cjs')
const trialGate = require('./trial/gateWindow.cjs')
const license = require('./license/licenseManager.cjs')

const isDev = process.env.NODE_ENV === 'development'
let win = null

// ── WhatsApp share window ────────────────────────────────────────────────────
// The renderer copies the receipt-slip IMAGE to the clipboard and opens a
// wa.me link. We intercept that link, open WhatsApp Web in our own window, and
// AUTO-PASTE the image the moment a chat's compose box appears — whether the
// chat opened directly (customer number saved) or the operator picked a
// contact by hand. The operator then only presses Send. Everything is
// best-effort and guarded: if anything fails, the chat still opens normally
// and the image stays on the clipboard for a manual Ctrl+V.
let waWin = null

// WhatsApp Web rejects unknown browsers — present a clean Chrome UA (the real
// Chromium version Electron ships, minus the Electron/app tokens).
function chromeUA(wc) {
  try {
    return wc.getUserAgent()
      .replace(/\s?Electron\/[\d.]+/g, '')
      .replace(/\s?gold-lab\/[\d.]+/gi, '')
      .replace(/\s?chaudhry[^\s]*(\s?gold\S*)?(\s?lab\S*)?\/[\d.]+/gi, '')
  } catch {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  }
}

// Poll for a chat compose box (footer contenteditable). First sighting → focus
// it and paste ONCE. Polls for up to ~3 minutes so there is time to scan the
// QR code on first use or to pick a contact manually. Stops early if the
// clipboard no longer holds an image (nothing of ours to paste).
function armWaAutoPaste(w) {
  try { if (w.__waTimer) clearInterval(w.__waTimer) } catch {}
  let tries = 0
  w.__waTimer = setInterval(async () => {
    try {
      if (w.isDestroyed()) { clearInterval(w.__waTimer); return }
      if (++tries > 150 || clipboard.readImage().isEmpty()) { clearInterval(w.__waTimer); return }
      const found = await w.webContents.executeJavaScript(
        '(() => { const b = document.querySelector(\'footer div[contenteditable="true"], footer [contenteditable="true"]\'); if (!b) return false; b.focus(); return true })()',
        true
      ).catch(() => false)
      if (found) {
        clearInterval(w.__waTimer)
        // small settle delay: WhatsApp finishes wiring its composer, then paste
        setTimeout(() => { try { if (!w.isDestroyed()) { w.webContents.focus(); w.webContents.paste() } } catch {} }, 800)
      }
    } catch {}
  }, 1200)
}

// Normalize a stored mobile for WhatsApp: digits only, and a local Pakistani
// 03xx-xxxxxxx becomes 923xxxxxxxxx (WhatsApp needs the country code). Numbers
// already carrying a country code (or anything else) pass through unchanged.
function waNumber(mobile) {
  const digits = String(mobile || '').replace(/[^0-9]/g, '')
  if (/^0\d{10}$/.test(digits)) return '92' + digits.slice(1)
  return digits
}

// wa.me links show a "Continue to chat" interstitial in a browser — convert
// them to the direct WhatsApp Web chat URL so the embedded window lands
// straight in the conversation.
function toWebWhatsAppUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'wa.me' || u.hostname === 'api.whatsapp.com') {
      const num = (u.pathname.replace(/\//g, '') || u.searchParams.get('phone') || '').replace(/[^0-9]/g, '')
      const text = u.searchParams.get('text') || ''
      return num || text
        ? `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(text)}`
        : 'https://web.whatsapp.com/'
    }
  } catch {}
  return url
}

// WhatsApp DESKTOP route: after launching whatsapp://send we cannot reach into
// the native app's DOM, so a tiny hidden PowerShell watcher waits (up to ~30s)
// for a WhatsApp window to be in the foreground, gives the chat a moment to
// finish opening, then sends ONE Ctrl+V — the slip image (already on the
// clipboard) lands in the message box as an attachment preview. Best-effort:
// if it misses, the toast has already told the operator about Ctrl+V.
let waWatcherAt = 0
function startDesktopPasteWatcher() {
  try {
    const now = Date.now()
    if (now - waWatcherAt < 35000) return // one active watcher at a time
    waWatcherAt = now
    const script =
      "$sig='[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();[DllImport(\"user32.dll\")]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);';" +
      'Add-Type -MemberDefinition $sig -Name U -Namespace W;' +
      'Add-Type -AssemblyName System.Windows.Forms;' +
      'for($i=0;$i -lt 60;$i++){' +
      '$h=[W.U]::GetForegroundWindow();' +
      '$sb=New-Object System.Text.StringBuilder 512;' +
      '[W.U]::GetWindowText($h,$sb,512)|Out-Null;' +
      "if($sb.ToString() -like '*WhatsApp*'){Start-Sleep -Milliseconds 1800;[System.Windows.Forms.SendKeys]::SendWait('^v');break};" +
      'Start-Sleep -Milliseconds 500}'
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, detached: true, stdio: 'ignore'
    })
    p.unref()
  } catch (e) {
    console.error('WhatsApp paste watcher failed:', e)
  }
}

function openWhatsAppWindow(url) {
  try {
    const target = process.env.GOLDLAB_WA_URL_OVERRIDE || toWebWhatsAppUrl(url) // override = test hook only
    if (waWin && !waWin.isDestroyed()) {
      waWin.focus()
      waWin.loadURL(target)
    } else {
      waWin = new BrowserWindow({
        width: 1100,
        height: 820,
        title: 'WhatsApp',
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      waWin.on('closed', () => { waWin = null })
      waWin.webContents.setUserAgent(chromeUA(waWin.webContents))
      waWin.loadURL(target)
    }
    armWaAutoPaste(waWin)
  } catch (e) {
    console.error('WhatsApp window failed:', e)
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 840,
    minWidth: 1200,
    minHeight: 720,
    title: 'چوہدری گولڈ لیبارٹری — Chaudhry Gold Laboratory',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    // Frameless TRUE full-screen: covers the whole screen (Windows taskbar hidden),
    // no title bar. show:false + ready-to-show avoids a white flash. The in-app red
    // "X" (window.api.quitApp) and Alt+F4 are the ways out; Esc exits full-screen so
    // the user is never trapped without a taskbar.
    fullscreen: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // DevTools would hand anyone Sources/Network access to the renderer bundle
      // and the IPC traffic — off in production, on in dev where it's needed.
      devTools: isDev
    }
  })

  win.once('ready-to-show', () => {
    win.setFullScreen(true) // ensure the taskbar is actually covered
    win.show()
  })

  // WhatsApp links (the receipts' WhatsApp buttons) open in OUR window so the
  // slip image can be auto-pasted into the chat. Everything else keeps the
  // default window.open behaviour.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(url)) {
      openWhatsAppWindow(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Escape hatches (a frameless full-screen window has no title bar, so these MUST
  // work): Alt+F4 quits, Esc drops out of full-screen so the taskbar is reachable.
  // We explicitly handle Alt+F4 because a frameless/full-screen window doesn't
  // always receive the default WM_CLOSE reliably.
  win.webContents.on('before-input-event', (evt, input) => {
    if (input.type !== 'keyDown') return
    if (input.alt && (input.key === 'F4' || input.code === 'F4')) {
      evt.preventDefault()
      app.quit()
    } else if (input.key === 'Escape' && win && win.isFullScreen()) {
      win.setFullScreen(false)
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // live gold ticker: starts its poll loop only AFTER the page has loaded —
  // a slow/failed fetch can never block or delay startup.
  win.webContents.once('did-finish-load', () => liveGold.start(win))
}

// Single IPC entry point: renderer calls window.api.invoke(channel, payload)
ipcMain.handle('db', async (_evt, { fn, args }) => {
  if (typeof db.api[fn] !== 'function') {
    throw new Error(`Unknown db function: ${fn}`)
  }
  return db.api[fn](...(args || []))
})

// Quit the whole app — wired to the in-app red "X" button (window.api.quitApp).
// db is flushed in before-quit / window-all-closed, so no data is lost.
ipcMain.handle('quit-app', () => { app.quit() })

// "–" button: fill the whole screen but KEEP THE TASKBAR VISIBLE. This leaves
// full-screen (which hides the taskbar) and maximizes to the work area, so the
// app occupies everything except the taskbar — on any screen size / any laptop.
ipcMain.handle('minimize-window', () => {
  if (!win) return
  if (win.isFullScreen()) win.setFullScreen(false)
  win.maximize()
})

// "□" button: occupy the ENTIRE screen with the taskbar HIDDEN (true full-screen)
// — the same state the app launches in, on any screen size.
ipcMain.handle('toggle-maximize', () => {
  if (!win) return
  win.setFullScreen(true)
})

// ── Printing (receipt-printer safe) ────────────────────────────────────────
// One print attempt. A watchdog timer (when given) resolves the promise even if
// Chromium never fires the print callback — a known Windows quirk — so the
// renderer's `await` can NEVER hang. timedOut distinguishes "no answer" from an
// explicit driver failure (only the latter is worth a dialog fallback; a timed-
// out job may still print later, and a fallback then would print twice).
function printOnce(opts, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok, reason, timedOut) => { if (!done) { done = true; resolve({ ok, reason, timedOut }) } }
    const timer = timeoutMs ? setTimeout(() => finish(false, 'timeout', true), timeoutMs) : null
    try {
      win.webContents.print(opts, (success, failureReason) => {
        if (timer) clearTimeout(timer)
        finish(success, failureReason || '')
      })
    } catch (e) {
      if (timer) clearTimeout(timer)
      finish(false, String(e && e.message ? e.message : e))
    }
  })
}

// Print via the MAIN process. Receipts print SILENTLY straight to the system
// default printer (the shop's 80mm thermal): webContents.print's system dialog
// frequently fails to spool on Windows thermal drivers (long-standing Electron
// issue), which is why dialog printing produced nothing. If the silent attempt
// reports an explicit failure, we fall back to the dialog once so the user still
// has a path (e.g. printing to a different printer). Callers may pass
// { silent: false } to force the dialog. Always resolves { ok, reason }.
// ── Direct thermal raster printing (see rasterPrint.cjs) ────────────────────
// Primary receipt path: render at exactly 576 dots (72.1mm @ 203dpi), hard
// 1-bit threshold, ESC/POS raster, RAW spool. The renderer falls back to the
// driver-based 'print-page' below when this returns ok:false.
// Read the two thermal-print settings from the DB (raw_print_mode, print_scale),
// with an env override for print_scale so dry-runs can sweep scales without
// touching the DB. Always safe — falls back to sane defaults on any error.
function printSettings() {
  let rawMode = 'auto'
  let printScale = 1.15
  try {
    const r = db.api.getRates() || {}
    if (r.raw_print_mode === 'force') rawMode = 'force'
    if (r.print_scale != null && Number.isFinite(Number(r.print_scale))) printScale = Number(r.print_scale)
  } catch (e) { console.warn('[print] settings read failed, using defaults:', e && e.message || e) }
  const envScale = parseFloat(process.env.GOLDLAB_PRINT_SCALE)
  if (Number.isFinite(envScale)) printScale = envScale
  return { rawMode, printScale }
}

ipcMain.handle('raster-print-slip', async (_evt, { html, data, copies } = {}) => {
  if (!win) return { ok: false, reason: 'no-window' }
  const { rawMode, printScale } = printSettings()
  // `data` (the lab receipt) → build HTML from the shared template here so the
  // real slip and the worst-case test page use ONE source of truth. `html` (the
  // other receipts) still comes pre-built from the renderer's clone path.
  try {
    const slipHtml = data ? raster.buildReceiptHtml(data) : html
    const res = await raster.printHtml({ html: slipHtml, copies, win, tag: 'slip', printScale, rawMode })
    // LOUD log (main process) when the raster path can't be used and the renderer
    // is about to fall back to the Windows driver (the driver stretches/blurs the
    // slip — this is the #1 cause of a wrong-length / faint print). Printer name +
    // reason are surfaced prominently so the routing problem is easy to spot.
    if (res && res.ok === false) {
      console.warn('\n' + '='.repeat(72))
      console.warn('[raster-print-slip] ⚠️  RAW THERMAL PATH FAILED → falling back to Windows driver')
      console.warn(`[raster-print-slip] printer = ${res.printer || 'unknown'}   rawMode = ${rawMode}   printScale = ${printScale}`)
      console.warn(`[raster-print-slip] reason  = ${res.reason}`)
      console.warn('[raster-print-slip] The driver path can print the WRONG LENGTH / faint. Fix: make the')
      console.warn('[raster-print-slip] default printer match a thermal name, or enable Defaults → براہِ راست (force).')
      console.warn('='.repeat(72) + '\n')
    }
    return res
  } catch (e) {
    console.warn('[raster-print-slip] threw → driver fallback:', e && e.message || e)
    return { ok: false, reason: String(e && e.message || e) }
  }
})

// Printer test pages (settings → پرنٹر ٹیسٹ): calibration sheet + worst-case
// receipt, straight through the raster pipeline to the DEFAULT printer.
ipcMain.handle('raster-test-print', async (_evt, { kind } = {}) => {
  if (!win) return { ok: false, reason: 'no-window' }
  const { printScale } = printSettings()
  try { return await raster.testPrint({ kind, win, printScale }) }
  catch (e) { return { ok: false, reason: String(e && e.message || e) } }
})

ipcMain.handle('print-page', async (_evt, opts = {}) => {
  if (!win) return { ok: false, reason: 'no-window' }
  // Debug/support hook: with GOLDLAB_PRINT_PDF_DIR set, capture the EXACT
  // print-media output (same @page rules the printer gets) to a PDF file
  // instead of spooling — printer-fit problems can be verified on any machine
  // without thermal hardware. Inert unless the env var is set.
  if (process.env.GOLDLAB_PRINT_PDF_DIR) {
    try {
      // Fixed 80mm-wide page (inches) so the PDF maps 1:1 onto the thermal
      // roll — `@page size: 80mm auto` is NOT honoured by printToPDF (the
      // auto height makes Chromium fall back to the default paper), and a
      // paper-exact capture is the whole point of this hook.
      const data = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: { width: 80 / 25.4, height: 297 / 25.4 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
      const file = path.join(process.env.GOLDLAB_PRINT_PDF_DIR, `print-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`)
      fs.writeFileSync(file, data)
      return { ok: true, reason: `pdf:${file}` }
    } catch (e) {
      return { ok: false, reason: `pdf-capture-failed: ${e.message || e}` }
    }
  }
  const wantSilent = opts.silent !== false
  const base = { printBackground: true, ...opts }
  if (wantSilent) {
    const first = await printOnce({ ...base, silent: true }, 30000)
    if (first.ok || first.timedOut) return first
    // Explicit driver refusal (e.g. no default printer) → offer the dialog once.
    // Dialog attempts get a LONG watchdog (the user may sit in the dialog a
    // while) so a dead callback still can't hang the renderer forever.
    return printOnce({ ...base, silent: false }, 180000)
  }
  return printOnce({ ...base, silent: false }, 180000)
})

// Open WhatsApp for a receipt share, smartest route first:
//   1. WhatsApp DESKTOP app (whatsapp://send) when installed — fastest, always
//      logged in — plus the paste-watcher so the slip image lands by itself.
//   2. Otherwise the embedded WhatsApp Web window (direct chat URL, in-window
//      auto-paste poller).
// GOLDLAB_WA_FORCE_MODE ('web' | 'desktop-watch-only') is a TEST hook only.
ipcMain.handle('open-whatsapp', (_evt, { mobile, text } = {}) => {
  try {
    const num = waNumber(mobile)
    const msg = encodeURIComponent(text || '')
    const force = process.env.GOLDLAB_WA_FORCE_MODE || ''
    const desktopApp = force === 'web' ? '' : app.getApplicationNameForProtocol('whatsapp://send')
    if (force === 'desktop-watch-only') { startDesktopPasteWatcher(); return { ok: true, mode: 'desktop', num } }
    if (desktopApp) {
      shell.openExternal(`whatsapp://send?phone=${num}&text=${msg}`)
      startDesktopPasteWatcher()
      return { ok: true, mode: 'desktop', num }
    }
    const url = num || msg
      ? `https://web.whatsapp.com/send?phone=${num}&text=${msg}`
      : 'https://web.whatsapp.com/'
    openWhatsAppWindow(url)
    return { ok: true, mode: 'web', num, url }
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) }
  }
})

// Capture a screen region of the app window and place it on the system
// clipboard as an IMAGE — used by the WhatsApp share: the renderer shows the
// slip (same header/receipt/footer as printing), we snapshot it here, and the
// user pastes it straight into the WhatsApp chat with Ctrl+V. Never throws.
ipcMain.handle('capture-to-clipboard', async (_evt, rect) => {
  try {
    if (!win) return { ok: false, reason: 'no-window' }
    const r = {
      x: Math.max(0, Math.round(rect?.x || 0)),
      y: Math.max(0, Math.round(rect?.y || 0)),
      width: Math.max(1, Math.round(rect?.width || 1)),
      height: Math.max(1, Math.round(rect?.height || 1))
    }
    const img = await win.webContents.capturePage(r)
    if (!img || img.isEmpty()) return { ok: false, reason: 'empty-capture' }
    clipboard.writeImage(img)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) }
  }
})

// Export the CURRENT report to PDF (Part 3). The renderer flips a body class so
// only the report (`.print-area`) is visible; @media print CSS drives both the
// print dialog and printToPDF, so the PDF contains only the filtered report +
// totals with Urdu/RTL intact. Returns { ok, path? , canceled? }.
ipcMain.handle('export-pdf', async (_evt, { defaultName, cssPageSize } = {}) => {
  if (!win) return { ok: false }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'رپورٹ کو PDF میں محفوظ کریں',
    defaultPath: defaultName || 'report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  // cssPageSize → honour the CSS @page rule (thermal: narrow width + continuous
  // height) the renderer injected. Otherwise export a normal A4 sheet.
  const opts = cssPageSize
    ? { printBackground: true, preferCSSPageSize: true }
    : { printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } }
  const data = await win.webContents.printToPDF(opts)
  fs.writeFileSync(filePath, data)
  return { ok: true, path: filePath }
})

// The original startup sequence, unchanged and unconditional once we get here.
// Extracted into a function so it can be reached from two places: directly, for a
// licensed or in-trial launch, and from the gate's onActivated callback after a
// licence is entered. Runs at most once — guarded, because a stray second call
// would re-init the DB and open a second window.
let appStarted = false
async function startApp(userDataDir, dbPath) {
  if (appStarted) return
  appStarted = true
  // Restore check runs BEFORE the DB is opened/created. It does something ONLY
  // when goldlab.sqlite is missing (fresh machine / reinstall) — an existing DB
  // is opened untouched, with no prompt. Fully try/catch'd inside; never blocks.
  backup.restoreIfMissing({ userDataDir, dbPath })
  await db.init(userDataDir)
  console.log('Database opened.')
  // Silent automatic backups: shortly after launch, then every ~10 minutes, and
  // once more on quit below. Best-effort only — cannot crash or block the app.
  backup.start({ userDataDir, dbPath, flush: db.flush })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData')
  const dbPath = path.join(userDataDir, 'goldlab.sqlite')
  // First-run only: stamp userData/trial.dat + install.id. Does nothing when they
  // already exist and swallows its own errors. MUST run before checkTrial(): on a
  // fresh machine there is no record to count from, and checkTrial() fails closed.
  trial.initializeTrial()

  const trialState = trial.checkTrial()

  // Licence FIRST. A machine with a valid, unexpired licence for this exact
  // machineId skips the gate entirely — the trial's verdict (expired, tampered,
  // clock rolled back) is irrelevant to a paying customer. Re-checked on every
  // launch, so an expired licence stops working with no grace period.
  if (license.isLicenseValid(trialState.machineId)) {
    await startApp(userDataDir, dbPath)
    return
  }

  // Trial gate. Expired (or tampered / rolled back / record deleted) → show the
  // standalone gate window and STOP: the database is never opened, backups never
  // start, the main window is never created. Entering a valid licence there calls
  // onActivated, which runs the very same startApp() below.
  if (trialState.expired) {
    console.warn(`[trial] expired (${trialGate.expiryReason(trialState)}) — main window not created`)
    trialGate.showTrialGate(trialState, { onActivated: () => startApp(userDataDir, dbPath) })
    return
  }

  // In trial, unlicensed: the original startup sequence, unchanged.
  await startApp(userDataDir, dbPath)
})

app.on('window-all-closed', () => {
  db.flush()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { db.flush(); backup.runOnQuit(); liveGold.stop() })

// On-demand fetch+parse of the live gold spot (also used by the renderer to
// seed its ticker box on mount). Display-only; never touches rates/receipts.
ipcMain.handle('get-live-gold', async () => {
  try { return await liveGold.fetchOnce() } catch { return liveGold.getLast() }
})
