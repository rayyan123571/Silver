// ─── Trial gate window ───────────────────────────────────────────────────────
// Shown INSTEAD of the main application window when checkTrial() reports expired.
// Deliberately self-contained: plain Electron + an inline HTML data URL, no React,
// no app renderer, no database, no backup, no printing. It reads one object
// (the checkTrial() result) and offers two actions — copy the machine id, exit.
//
// Nothing here can let the user through: there is no "continue" path, and closing
// the window quits the app. Activation is a later step.
const { BrowserWindow, ipcMain, clipboard, app } = require('electron')
const path = require('path')
const license = require('../license/licenseManager.cjs')

// Why the trial is refused, most specific cause first. A tampered record is the
// strongest statement we can make (someone edited the file), so it outranks a
// deleted record, which outranks a wound-back clock, which outranks the ordinary
// case of simply running out of days.
function expiryReason(state) {
  if (state.tampered) return 'Tampered'
  if (state.missingTrialData) return 'Missing Trial Data'
  if (state.rollback) return 'Rollback'
  return 'Trial Expired'
}

// Text is injected into HTML, so escape it. The machine id and reason are ours,
// not user input, but a stray character must never be able to break the markup.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

function gateHtml({ machineId, remainingDays, reason }) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">' +
    '<title>Silver</title><style>' +
    'html,body{margin:0;padding:0;height:100%;font:14px "Segoe UI",Tahoma,sans-serif;background:#f5f5f5;color:#1a1a1a}' +
    '.wrap{box-sizing:border-box;height:100%;padding:24px 30px;display:flex;flex-direction:column}' +
    'h1{margin:0 0 16px;font-size:21px;color:#8a1414}' +
    '.row{margin-bottom:12px}' +
    '.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-bottom:4px}' +
    '.val{font-size:15px;font-weight:600}' +
    '.mid{font-family:Consolas,monospace;font-size:19px;letter-spacing:1px;background:#fff;border:1px solid #ccc;padding:8px 12px;display:inline-block}' +
    '.midrow{display:flex;align-items:center;gap:10px}' +
    '.meta{display:flex;gap:34px}' +
    'hr{border:0;border-top:1px solid #ddd;margin:16px 0}' +
    'textarea{box-sizing:border-box;width:100%;font:12px Consolas,monospace;padding:8px 10px;border:1px solid #ccc;border-radius:3px;background:#fff;resize:none}' +
    'textarea:focus{outline:none;border-color:#8a8a8a}' +
    'button:disabled{opacity:.55;cursor:default}' +
    '#msg.ok{color:#1a6b2a}' +
    '.btns{margin-top:auto;display:flex;gap:10px;justify-content:flex-end;align-items:center}' +
    'button{font:14px "Segoe UI",Tahoma,sans-serif;padding:9px 18px;border:1px solid #b0b0b0;background:#fff;cursor:pointer;border-radius:3px}' +
    'button:hover{background:#ececec}' +
    '#copy{padding:7px 14px;font-size:13px}' +
    '#activate{background:#1a4f8a;border-color:#1a4f8a;color:#fff}#activate:hover{background:#153f6f}' +
    '#exit{background:#8a1414;border-color:#8a1414;color:#fff}#exit:hover{background:#6f1010}' +
    '#copied{color:#1a6b2a;font-size:13px;visibility:hidden}' +
    '#msg{min-height:18px;font-size:13px;color:#8a1414;margin-top:8px}' +
    '</style></head><body><div class="wrap">' +
    '<h1>Silver Trial Expired</h1>' +
    '<div class="row"><div class="lbl">Machine ID</div>' +
    '<div class="midrow"><span class="mid" id="mid">' + esc(machineId) + '</span>' +
    '<button id="copy">Copy Machine ID</button><span id="copied">Copied</span></div></div>' +
    '<div class="row meta">' +
    '<div><div class="lbl">Remaining Days</div><div class="val">' + esc(remainingDays) + '</div></div>' +
    '<div><div class="lbl">Reason</div><div class="val">' + esc(reason) + '</div></div>' +
    '</div><hr>' +
    '<div class="row"><div class="lbl">License Key</div>' +
    '<textarea id="key" spellcheck="false" autocomplete="off" rows="6" ' +
    'placeholder="Paste the license JSON supplied with your purchase"></textarea></div>' +
    '<div id="msg"></div>' +
    '<div class="btns"><button id="activate">Activate</button><button id="exit">Exit</button></div>' +
    '</div><script>' +
    'var msg=document.getElementById("msg");' +
    'document.getElementById("copy").addEventListener("click",async()=>{' +
    'await window.gate.copyMachineId();var c=document.getElementById("copied");' +
    'c.style.visibility="visible";setTimeout(()=>{c.style.visibility="hidden"},1500)});' +
    // Activation happens ENTIRELY in the main process: the renderer only forwards
    // the pasted text and paints the answer. It cannot decide it is licensed.
    'var btn=document.getElementById("activate");' +
    'btn.addEventListener("click",async()=>{' +
    'btn.disabled=true;msg.className="";msg.textContent="Checking\\u2026";' +
    'var r=await window.gate.activate(document.getElementById("key").value);' +
    'msg.textContent=r.message;msg.className=r.ok?"ok":"";' +
    // On success main closes this window and starts the app; leave the button
    // disabled so a second click cannot race that.
    'if(!r.ok)btn.disabled=false});' +
    'document.getElementById("exit").addEventListener("click",()=>window.gate.exit());' +
    '</scr' + 'ipt></body></html>'
}

// Show the gate. Returns the window. The caller must NOT create the main window.
//
// opts.onActivated — called ONCE, after a licence has been verified and written to
// disk, to run the normal startup sequence the gate displaced. Without it the gate
// would have nothing to hand control to, so activation just closes the window.
function showTrialGate(state, opts = {}) {
  const machineId = state.machineId || 'UNKNOWN'
  const reason = expiryReason(state)
  let activated = false // set once, so `closed` does not quit an activating app

  // Registered here, not at module load, so requiring this file is side-effect
  // free. Guarded because a second call would throw on a duplicate handler.
  if (!ipcMain.listenerCount('trial-gate:exit')) {
    ipcMain.handle('trial-gate:copy', () => { clipboard.writeText(machineId); return true })
    // Activation runs in the MAIN process. The renderer supplies only the pasted
    // text; every decision — signature, machine binding, expiry, and whether to
    // write license.dat — is made here, where the renderer cannot reach it.
    ipcMain.handle('trial-gate:activate', (_evt, text) => {
      const result = license.activateLicense(text, state.machineId)
      if (!result.ok) return result

      activated = true
      console.log('[license] activated — starting the application')
      // Let the renderer paint "License activated." before the window goes away.
      setTimeout(async () => {
        // Hide, don't destroy: main.cjs quits the app on 'window-all-closed', so
        // destroying the gate before startApp() has created the main window would
        // leave zero windows open for a moment and kill the app mid-activation.
        // Start the app FIRST, close the gate once its window exists.
        try { if (!win.isDestroyed()) win.hide() } catch {}
        try {
          if (typeof opts.onActivated === 'function') await opts.onActivated()
        } catch (e) {
          console.error('[license] startup after activation failed:', e)
        }
        try { if (!win.isDestroyed()) win.destroy() } catch {}
      }, 700)
      return result
    })
    ipcMain.on('trial-gate:exit', () => app.exit(0))
  }

  const win = new BrowserWindow({
    width: 480,
    height: 470,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Silver',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'gatePreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenu(null)
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(gateHtml({ machineId, remainingDays: state.remainingDays, reason })))
  // Closing the gate quits — there is no way past it into the app. The one
  // exception is a successful activation, which closes the window on purpose.
  win.on('closed', () => { if (!activated) app.exit(0) })
  return win
}

module.exports = { showTrialGate, expiryReason }
