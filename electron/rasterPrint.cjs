// ─── Direct thermal raster printing (ESC/POS) ────────────────────────────────
// Why this exists: printing receipts through the Windows driver (HTML → Chromium
// print → spooler → driver raster) leaves TWO things outside our control:
//   1. Geometry — the driver decides where the 72.1mm printable band sits on the
//      80mm roll, so oversized/misanchored content clips left on one machine and
//      right on another.
//   2. Sharpness — the driver anti-aliases + halftones 203dpi output, turning
//      crisp glyph edges into grey fuzz on a 1-bit thermal head.
// This module bypasses all of it: the receipt is rendered ONCE, at its FINAL
// size — exactly 576 device pixels wide (72.1mm × 8 dots/mm @ 203dpi) — in an
// offscreen window (scale factor 1, no DPI interference), hard-thresholded to
// pure 1-bit black/white (no dithering, no grey), packed as ESC/POS raster
// (GS v 0), and written RAW to the spooler (datatype RAW → the driver passes
// bytes straight through). Dot column 0 always lands on head dot 0, so left/
// right drift is structurally impossible, and every dot is either full black
// or nothing — the same technique the "sharp" competitor softwares use.
const { BrowserWindow, nativeImage, screen } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const DOTS = 576                     // printable width in dots: 72.1mm × 8
const BYTES_PER_ROW = DOTS / 8       // 72 bytes per raster row
const MAX_ROWS = 2376                // 297mm × 8 — printer's max receipt length
// Hard 1-bit threshold (0-255). Below = black dot. 185 (raised from 170) also
// catches the grey anti-aliased edge pixels that used to drop to white and thin
// the now-bolder/stroked glyphs (see buildReceiptHtml); light greys/yellows
// (screen-only shading) still drop to white.
const THRESHOLD = Math.min(250, Math.max(60, parseInt(process.env.SILVER_RASTER_THRESHOLD, 10) || 185))

// Print magnification: 1.0–1.35 in 0.05 steps (default 1.15 — the scale the final
// receipt design was approved at). Vertical-only stretch that never widens the
// frame past 576 dots (see renderBitmap); available in Defaults for fine-tuning.
const SCALE_MIN = 1.0
const SCALE_MAX = 1.35
function clampScale(v) {
  let s = Number(v)
  if (!Number.isFinite(s)) s = 1.15
  s = Math.round(s / 0.05) * 0.05
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s))
}

// ── Render HTML at its final size in an offscreen window ────────────────────
// Offscreen windows paint at deviceScaleFactor 1 regardless of the desktop's
// DPI scaling, so 1 CSS px == 1 captured px == 1 printer dot. The page should
// define `window.__ready` resolving to its content height in px (after fonts);
// otherwise scrollHeight is used.
async function renderBitmap(html, printScale) {
  // OSR frames come out at (window DIP size × desktop scale factor) physical
  // pixels — and the page rasters at that same physical resolution. To get a
  // frame of EXACTLY 576 physical px on any DPI setting, size the window to
  // 576/scale DIPs and zoom the page by 1/scale: layout still sees a ~576px
  // viewport, glyphs rasterize once at effective scale 1.0 (zoom × DPI = 1),
  // and the frame lands at 576(+rounding) px which we CROP — never resize —
  // to exactly 576.
  //
  // printScale (P) magnifies the slip to the preferred larger/longer look. The
  // hard constraint is width EXACTLY 576 physical dots (centering + complete
  // borders + no left/right clip — non-negotiable). A UNIFORM zoom (both axes ×P)
  // would widen the fixed-576 content past the head and clip the right edge —
  // verified with dry-run PNGs. So we hold the HORIZONTAL effective scale at 1.0
  // (zoom = 1/scale ⇒ 576 css → 576 dots, no overflow) and magnify VERTICALLY
  // only: a scaleY(P) transform on <body> makes the slip P× taller (bigger,
  // longer, more readable) with the width — and every border — untouched. This
  // reproduces the vertical "stretch" the shop preferred from the old driver.
  const P = clampScale(printScale)
  const scale = (screen.getPrimaryDisplay() && screen.getPrimaryDisplay().scaleFactor) || 1
  const dipW = Math.ceil(DOTS / scale)
  const w = new BrowserWindow({
    show: false,
    width: dipW,
    height: 600,
    frame: false,
    // useSharedTexture:false → frames arrive as plain software bitmaps in the
    // 'paint' event (the GPU shared-texture mode delivers no NativeImage).
    webPreferences: { offscreen: { useSharedTexture: false }, backgroundThrottling: false, sandbox: false }
  })
  try {
    w.webContents.setFrameRate(30)
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // DPI-compensation zoom only (horizontal + vertical effective scale = 1.0).
    // The vertical magnification is a separate scaleY transform below, so width
    // is never touched and can't overflow/clip.
    w.webContents.setZoomFactor(1 / scale)
    let h = 0
    try {
      h = await w.webContents.executeJavaScript(
        'Promise.resolve(window.__ready).then((v) => v || Math.ceil(document.documentElement.scrollHeight))', true)
    } catch {
      h = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)', true)
    }
    // Diagnostics (dry-run only): scrollWidth must stay ≤ innerWidth (no
    // horizontal overflow ⇒ nothing right-clipped by the 576 crop).
    if (process.env.SILVER_PRINT_PDF_DIR) {
      try {
        const d = await w.webContents.executeJavaScript(
          '({iw:window.innerWidth,sw:document.documentElement.scrollWidth,bw:document.body.scrollWidth})', true)
        console.log(`[raster] P=${P} scale=${scale} innerWidth=${d.iw} scrollWidth=${d.sw} bodyW=${d.bw} measuredH=${Math.ceil(h)}`)
      } catch {}
    }
    // Vertical-only magnification: scaleY(P) on <body> makes the slip P× taller
    // (bigger/longer) while the width stays exactly 576 — borders complete, no
    // left/right clip. Layout height (scrollHeight) is unchanged by a transform,
    // so we multiply the measured CSS height by P to size the frame.
    if (P !== 1) {
      try {
        await w.webContents.executeJavaScript(
          "(function(){var b=document.body;b.style.transformOrigin='top left';b.style.transform='scaleY(" + P + ")';})()", true)
      } catch {}
    }
    // Measured h is CSS px; the scaleY(P) makes the frame h×P physical rows tall.
    const wantRaw = Math.ceil((Math.ceil(h) || 8) * P)
    const rowsWanted = Math.min(Math.max(wantRaw, 8), MAX_ROWS) // device px == printer dots
    if (wantRaw > MAX_ROWS) {
      console.warn(`[raster] receipt height ${wantRaw} dots exceeds MAX_ROWS ${MAX_ROWS} at scale ${P} — clamped (bottom may be cut)`)
    }
    const dipH = Math.ceil(rowsWanted / scale) + 1
    // Offscreen windows don't support capturePage (empty image) — the
    // compositor delivers frames through 'paint' events instead. Tiles paint
    // PROGRESSIVELY: the first full-size frame can still have blank (not yet
    // rasterized) bottom tiles, so never take the first frame — keep the
    // LATEST full-size frame and resolve only after painting goes quiet.
    const frame = await new Promise((resolve, reject) => {
      let best = null      // latest full-coverage frame, copied out immediately
      let anySize = ''     // last seen frame size (diagnostics)
      let quietTimer = null
      const QUIET_MS = 500 // no new paints for this long → frame is final
      const onPaint = (_e, _dirty, image) => {
        const s = image.getSize()
        anySize = s.width + 'x' + s.height
        // snapshot NOW — the NativeImage's backing store may be reused after
        // the callback returns
        if (s.width >= DOTS && s.height >= rowsWanted) {
          best = { width: s.width, height: s.height, buf: image.toBitmap() }
        }
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(() => { if (best) { done(); resolve(best) } }, QUIET_MS)
      }
      const done = () => {
        try { w.webContents.removeListener('paint', onPaint) } catch {}
        clearTimeout(nudge1); clearTimeout(nudge2); clearTimeout(bail)
        if (quietTimer) clearTimeout(quietTimer)
      }
      // nudges force full repaints in case the compositor idles early
      const nudge1 = setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 400)
      const nudge2 = setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 1500)
      const bail = setTimeout(() => {
        done()
        if (best) resolve(best)
        else reject(new Error('no offscreen frame at ' + DOTS + 'px (got ' + (anySize || 'none') + ')'))
      }, 8000)
      w.webContents.on('paint', onPaint)
      w.setContentSize(dipW, dipH)
      setTimeout(() => { try { w.webContents.invalidate() } catch {} }, 30)
    })
    const rows = Math.min(rowsWanted, frame.height)
    if (frame.width === DOTS && frame.height === rows) return { buf: frame.buf, width: DOTS, height: rows }
    // Crop (top-left DOTS × rows) — pure byte copy, zero resampling.
    const buf = Buffer.alloc(DOTS * rows * 4)
    for (let y = 0; y < rows; y++) {
      frame.buf.copy(buf, y * DOTS * 4, y * frame.width * 4, y * frame.width * 4 + DOTS * 4)
    }
    return { buf, width: DOTS, height: rows }
  } finally {
    try { w.destroy() } catch {}
  }
}

// ── Hard threshold to 1-bit + pack as ESC/POS raster bands ──────────────────
// One render → one threshold, at the SAME size. Returns the full byte stream
// for one receipt: init, raster bands, feed clear of the tear bar, cut.
function toEscPos({ buf, width, height }) {
  const bpr = width >> 3
  const bits = Buffer.alloc(bpr * height) // 1 = black dot
  for (let y = 0; y < height; y++) {
    const rowOff = y * bpr
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 // BGRA
      const lum = 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i]
      if (lum < THRESHOLD) bits[rowOff + (x >> 3)] |= (0x80 >> (x & 7))
    }
  }
  const chunks = [Buffer.from([0x1b, 0x40])] // ESC @ — reset
  const BAND = 512 // rows per GS v 0 block — small bands keep clone printers happy
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const bh = Math.min(BAND, height - y0)
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, bh & 0xff, (bh >> 8) & 0xff]))
    chunks.push(bits.subarray(y0 * bpr, (y0 + bh) * bpr))
  }
  chunks.push(Buffer.from([0x1b, 0x64, 0x05]))      // ESC d 5 — feed past the tear bar
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x14])) // GS V B 20 — partial cut (ignored without cutter)
  return { bytes: Buffer.concat(chunks), bits, bpr }
}

// ── RAW spool via winspool (PowerShell P/Invoke) ─────────────────────────────
// Datatype RAW hands our bytes to the printer untouched — no driver rendering.
const RAW_PS =
  "param([string]$PrinterName,[string]$File)\n" +
  "$ErrorActionPreference = 'Stop'\n" +
  "$sig = @'\n" +
  "using System; using System.Runtime.InteropServices;\n" +
  "public class RawPrn {\n" +
  "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]\n" +
  "  public struct DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }\n" +
  "  [DllImport(\"winspool.Drv\", EntryPoint=\"OpenPrinterA\", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr pd);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", EntryPoint=\"StartDocPrinterA\", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOA di);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);\n" +
  "  [DllImport(\"winspool.Drv\", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);\n" +
  "  public static void Send(string printer, byte[] bytes) {\n" +
  "    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception(\"OpenPrinter \" + Marshal.GetLastWin32Error());\n" +
  "    try {\n" +
  "      var di = new DOCINFOA { pDocName = \"Silver Receipt\", pDataType = \"RAW\" };\n" +
  "      if (!StartDocPrinter(h, 1, ref di)) throw new Exception(\"StartDocPrinter \" + Marshal.GetLastWin32Error());\n" +
  "      try {\n" +
  "        if (!StartPagePrinter(h)) throw new Exception(\"StartPagePrinter \" + Marshal.GetLastWin32Error());\n" +
  "        int w; if (!WritePrinter(h, bytes, bytes.Length, out w) || w != bytes.Length) throw new Exception(\"WritePrinter \" + Marshal.GetLastWin32Error());\n" +
  "        EndPagePrinter(h);\n" +
  "      } finally { EndDocPrinter(h); }\n" +
  "    } finally { ClosePrinter(h); }\n" +
  "  }\n" +
  "}\n" +
  "'@\n" +
  "Add-Type -TypeDefinition $sig\n" +
  "[RawPrn]::Send($PrinterName, [System.IO.File]::ReadAllBytes($File))\n" +
  "Write-Output 'RAW-OK'\n"

function rawSpool(printerName, bytes) {
  return new Promise((resolve, reject) => {
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silver-raw-'))
      const ps1 = path.join(dir, 'rawprint.ps1')
      const bin = path.join(dir, 'receipt.bin')
      fs.writeFileSync(ps1, RAW_PS)
      fs.writeFileSync(bin, bytes)
      const p = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-PrinterName', printerName, '-File', bin],
        { windowsHide: true })
      let out = '', err = ''
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { err += d })
      const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
      const timer = setTimeout(() => { try { p.kill() } catch {}; cleanup(); reject(new Error('spool timeout')) }, 30000)
      p.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e) })
      p.on('close', (code) => {
        clearTimeout(timer); cleanup()
        if (code === 0 && out.includes('RAW-OK')) resolve()
        else reject(new Error((err || out || ('exit ' + code)).trim().slice(0, 300)))
      })
    } catch (e) { reject(e) }
  })
}

// Default system printer. RAW ESC/POS on a non-thermal printer (office laser as
// default) would print pages of garbage — only auto-use the raw path when the
// default printer LOOKS like a thermal/receipt printer. Test prints (explicit
// user action from settings) skip the guard. SILVER_FORCE_RAW=1 also skips it.
// Conservative: match receipt/80mm-thermal makes & models, NEVER office lasers/
// inkjets (HP LaserJet, Canon, Epson L-series, Brother …). Additions for the
// common clones seen in the field — speedx / bt-600 (this shop's SpeedX BT-600M),
// munbyn, netum, hprt, gprinter, posiflex, sam4s — plus the existing set.
const THERMAL_RX = /(thermal|receipt|\bpos\b|pos-?\d|pos-?80|80\s?mm|58\s?mm|\btm[- ]?\w|xp[- ]?\d|rp[- ]?\d|zj[- ]?\d|gp[- ]?\d|bt[- ]?600|bt[- ]?\d{3}|speed\s?-?x|rongta|goojprt|hoin|sprt|munbyn|netum|hprt|gprinter|posiflex|sam4s|black\s?copper|bixolon|citizen\s?ct|star\s?tsp|panda|zebra\s?zd|epos|xprinter)/i
async function defaultPrinter(win) {
  const list = await win.webContents.getPrintersAsync()
  return list.find((p) => p.isDefault) || null
}
// rawMode 'force' → always treat as thermal (like the SILVER_FORCE_RAW=1 hook);
// 'auto' (default) → match the printer NAME against THERMAL_RX.
function looksThermal(p, rawMode) {
  if (rawMode === 'force' || process.env.SILVER_FORCE_RAW === '1') return true
  const hay = `${p.name} ${p.displayName || ''} ${p.description || ''}`
  return THERMAL_RX.test(hay)
}

// Dry-run support (SILVER_PRINT_PDF_DIR): write the ESC/POS bytes + a PNG of
// the EXACT 1-bit bitmap instead of spooling, so the whole pipeline (render →
// threshold → pack) can be verified on any machine without printing paper.
function dryRunDump({ bits, bpr, width, height, bytes, tag }) {
  const dir = process.env.SILVER_PRINT_PDF_DIR
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const bgra = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const black = (bits[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1
      const v = black ? 0 : 255
      const o = (y * width + x) * 4
      bgra[o] = v; bgra[o + 1] = v; bgra[o + 2] = v; bgra[o + 3] = 255
    }
  }
  const png = nativeImage.createFromBitmap(bgra, { width, height }).toPNG()
  const pngPath = path.join(dir, `raster-${tag}-${stamp}.png`)
  const binPath = path.join(dir, `raster-${tag}-${stamp}.bin`)
  fs.writeFileSync(pngPath, png)
  fs.writeFileSync(binPath, bytes)
  return { pngPath, binPath }
}

// ── Print an HTML document through the raster pipeline ──────────────────────
// Returns { ok:true, printer, widthDots, heightDots } or { ok:false, reason }.
// The caller decides what to do on failure (receipts fall back to the driver).
// The renderer serializes the app stylesheet itself when CSSOM allows it; in
// packaged builds (file://) that can be blocked, so it sends a marker and we
// splice the built stylesheet in from disk instead.
let appCssCache = null
function loadAppCss() {
  if (appCssCache != null) return appCssCache
  try {
    const assets = path.join(__dirname, '..', 'dist', 'assets')
    const cssFile = fs.readdirSync(assets).find((f) => f.endsWith('.css'))
    appCssCache = cssFile ? fs.readFileSync(path.join(assets, cssFile), 'utf8') : ''
  } catch { appCssCache = '' }
  return appCssCache
}

async function printHtml({ html, copies = 1, win, tag = 'slip', requireThermal = true, printScale, rawMode = 'auto' }) {
  if (!html) return { ok: false, reason: 'no-html' }
  if (html.includes('/*__APP_CSS__*/')) {
    const css = loadAppCss()
    if (!css) return { ok: false, reason: 'app-css-unavailable' }
    html = html.replace('/*__APP_CSS__*/', css)
  }
  let rendered
  try { rendered = await renderBitmap(html, printScale) } catch (e) { return { ok: false, reason: 'render: ' + (e.message || e) } }
  if (rendered.width !== DOTS) return { ok: false, reason: 'render-width-mismatch: ' + rendered.width + 'px (expected ' + DOTS + ')' }
  const { bytes, bits, bpr } = toEscPos(rendered)
  const n = Math.max(1, Math.min(5, parseInt(copies, 10) || 1))
  const payload = n === 1 ? bytes : Buffer.concat(Array.from({ length: n }, () => bytes))
  if (process.env.SILVER_PRINT_PDF_DIR) {
    try {
      const dump = dryRunDump({ bits, bpr, width: rendered.width, height: rendered.height, bytes: payload, tag })
      return { ok: true, reason: 'dry-run', widthDots: rendered.width, heightDots: rendered.height, ...dump }
    } catch (e) { return { ok: false, reason: 'dry-run: ' + (e.message || e) } }
  }
  let printer
  try { printer = await defaultPrinter(win) } catch (e) { return { ok: false, reason: 'printer-list: ' + (e.message || e) } }
  if (!printer) return { ok: false, reason: 'no-default-printer' }
  // printer name carried on failure returns too, so the main process can log it.
  if (requireThermal && !looksThermal(printer, rawMode)) {
    return { ok: false, printer: printer.name, reason: 'default-printer-not-thermal: ' + printer.name }
  }
  try {
    await rawSpool(printer.name, payload)
    return { ok: true, printer: printer.name, widthDots: rendered.width, heightDots: rendered.height }
  } catch (e) {
    return { ok: false, printer: printer.name, reason: 'spool: ' + (e.message || e) }
  }
}

// ── Test pages (Phase-3 verification harness) ────────────────────────────────
const FONT_STACK = "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',Tahoma,sans-serif"
const READY_SCRIPT =
  '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
  'await new Promise(r=>setTimeout(r,80));' +
  'var el=document.querySelector("[data-measure]")||document.body;' +
  'var h=Math.ceil(el.getBoundingClientRect().height)+2;document.body.style.height=h+"px";return h})()</scr' + 'ipt>'

// Calibration receipt: full-576 border, a tick every 48px (6mm) labelled in mm,
// LEFT-EDGE / RIGHT-EDGE flush text, an 80×80px (10×10mm) reference square.
// On paper: both edge texts fully visible + complete border + square measuring
// exactly 10mm ⇒ 1:1 dot mapping, no scaling, no clipping.
function calibrationHtml() {
  let ticks = ''
  for (let px = 0; px <= DOTS; px += 48) {
    const x = px >= DOTS ? DOTS - 2 : px
    ticks += '<div style="position:absolute;left:' + x + 'px;top:0;width:2px;height:26px;background:#000"></div>'
    const mm = px / 8
    if (px > 0 && px < DOTS) {
      ticks += '<div style="position:absolute;left:' + (x - 15) + 'px;top:27px;width:32px;text-align:center;font:700 12px Arial">' + mm + '</div>'
    }
  }
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>' +
    '<div data-measure style="width:576px;box-sizing:border-box;border:3px solid #000;position:relative;padding:0 0 10px">' +
    '<div style="position:relative;height:46px;margin-top:4px">' + ticks + '</div>' +
    '<div style="display:flex;justify-content:space-between;font:700 20px Arial;padding:2px 0">' +
    '<span>&#9668;LEFT-EDGE</span><span>RIGHT-EDGE&#9658;</span></div>' +
    '<div style="height:8px;background:#000;margin:6px 0"></div>' +
    '<div style="display:flex;align-items:center;gap:14px;padding:8px 10px">' +
    '<div style="width:80px;height:80px;border:3px solid #000;box-sizing:border-box"></div>' +
    '<div style="font:700 18px Arial">10mm &times; 10mm<br>(80&times;80 dots)</div></div>' +
    '<div dir="rtl" style="font:700 26px ' + FONT_STACK.replace(/"/g, '&quot;') + ';text-align:center;padding:6px 8px">چوہدری گولڈ لیبارٹری — ملاوٹ فی تولہ</div>' +
    '<div dir="ltr" style="font:700 24px Arial;text-align:center;letter-spacing:1px">0123456789 , . 433,000 151,688</div>' +
    '<div style="font:14px Arial;text-align:center;padding-top:8px">Silver calibration &middot; 576 dots = 72.1mm @ 203dpi &middot; threshold ' + THRESHOLD + '</div>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}

// ── SINGLE SOURCE OF TRUTH for EVERY printed receipt (وصولی → removed; ادھار / نقد) ─
// buildReceiptHtml(d) renders the approved classic design (native 576px): bordered
// header (name / double rule / tagline / phones / address strip), section title
// bar (d.title), one or more bordered tables (d.tables), then the services line +
// Rayyan footer. It is table-DRIVEN: every receipt supplies its own rows in the
// SAME styling, so there is one template.
//   d = { title, tables: [ table, ... ] }
//   table = [ row, ... ]   row = [ cell, ... ]
//   cell = { l:'label', s?:span }           → Urdu LABEL cell (28px Nastaliq)
//        | { v:'value', box?, s?:span, wrap?, u? } → value cell (26px Arial; box =
//          the 3px-bordered bold treatment; wrap = allow wrapping (long names);
//          u = render the value in the Nastaliq font)
// Typography (per the layout spec): value cells 26px Arial, Urdu LABEL cells 28px
// Nastaliq (+3 over the approved 25 — verified to still fit the 556px box). Both
// at weight 700 plus a 0.4px black text-stroke, because thin Nastaliq strokes +
// the 1-bit threshold were printing faint on thermal paper.
// 3px outer / 2px inner table rules; the shop name (800/42px, un-stroked) and
// boxed amounts (700) keep their own explicit weight. `d` is DATA only.
function buildReceiptHtml(d) {
  const LBL_PX = 28 // Urdu label/header cells (+3 over the approved 25px)
  // Labels/values sit at 700 (weight 500 printed thin on thermal paper), plus the
  // uniform stroke add-on below. Kept as two separate constants (not one) so a
  // future overflow can drop VAL_WEIGHT alone without touching labels.
  const LBL_WEIGHT = 700
  const VAL_WEIGHT = 700
  // Uniform glyph-thickening add-on shared by label/value cells, the .u class, and
  // the header lines — EXCEPT the shop-name line (already 800/42px; thickening it
  // further bleeds the glyphs together), which explicitly zeroes it back out.
  const STROKE = '-webkit-text-stroke:0.4px #000;'
  const th = (c) => '<td ' + (c.s ? 'colspan="' + c.s + '" ' : '') + 'style="border:2px solid #000;padding:3px 5px;font:' + LBL_WEIGHT + ' ' + LBL_PX + 'px ' + FONT_STACK + ';text-align:center;white-space:nowrap;' + STROKE + '">' + (c.l == null ? '' : c.l) + '</td>'
  const td = (c) => {
    const val = (c.v == null || c.v === '') ? '-' : c.v
    const inner = c.box ? '<span style="border:3px solid #000;padding:2px 14px;display:inline-block;font-weight:700">' + val + '</span>' : val
    const extra = (c.wrap ? 'font-family:' + FONT_STACK + ';white-space:normal;' : '') + (c.u ? 'font-family:' + FONT_STACK + ';' : '')
    return '<td ' + (c.s ? 'colspan="' + c.s + '" ' : '') + 'style="border:2px solid #000;padding:4px 5px;font:' + VAL_WEIGHT + ' 26px Arial;text-align:center;white-space:nowrap;' + STROKE + extra + '">' + inner + '</td>'
  }
  // dir=rtl table: the FIRST cell of each row lands on the RIGHT, so a leading
  // label cell puts the label column rightmost like the reference receipt.
  const cell = (c) => (c && c.l !== undefined) ? th(c) : td(c || { v: '' })
  const table = (rows) => '<table style="margin-top:8px">' + (rows || []).map((r) => '<tr>' + (r || []).map(cell).join('') + '</tr>').join('') + '</table>'
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    'table{border-collapse:collapse;width:100%;border:3px solid #000}' +
    '.u{font-family:' + FONT_STACK + ';font-weight:500;' + STROKE + '}' +
    '</style></head><body>' +
    '<div data-measure dir="rtl" style="width:576px;box-sizing:border-box;padding:2px 10px 0">' +
    // ── bordered classic header: name / double rule / tagline / phones / address strip
    '<div class="u" style="border:3px solid #000;text-align:center;padding:5px 6px 0">' +
    // shop name (800/42px) already reads solid — the inherited .u stroke would
    // bleed it, so it's explicitly zeroed back out here.
    '<div style="font-size:42px;font-weight:800;line-height:1.55;-webkit-text-stroke:0">چوہدری سلور</div>' +
    '<div style="border-top:3px solid #000;border-bottom:2px solid #000;height:5px;margin:2px 10px 5px"></div>' +
    '<div style="font-size:20px;line-height:1.9">خالص چاندی کی لین دین ۔ ہول سیل جیولری کا مرکز (جیولری چوڑی میکر)</div>' +
    '<div style="font-size:22px;font-weight:600;line-height:1.8">چوہدری ایم رمضان آرائیں&nbsp;&nbsp;<span dir="ltr">0300-7301839</span></div>' +
    '<div style="font:600 23px Arial;line-height:1.6"><span dir="ltr">0302-7330000</span>&nbsp;&nbsp;&nbsp;&nbsp;<span dir="ltr">0302-3334440</span></div>' +
    '<div style="border-top:2px solid #000;margin-top:5px;padding:3px 0 6px;font-size:20px;line-height:1.8">نزد موسیٰ پاک دربار صرافہ بازار ملتان</div>' +
    '</div>' +
    // Section title bar — e.g. "ادھار کی رسید", "نقد کی رسید".
    // Was white-on-black knockout text: the 1-bit threshold floods the black
    // background and swallows the reverse glyphs, so the title printed as a solid
    // black bar with no title in it. Now bold BLACK on white inside the same solid
    // border — every glyph is real ink, so it can't be thresholded away.
    '<div class="u" style="font-size:28px;font-weight:800;text-align:center;border:3px solid #000;border-top:none;padding:3px 0">' + (d.title || 'رسید') + '</div>' +
    (d.tables || []).map(table).join('') +
    // footer: services line + Rayyan
    '<div class="u" style="font-size:20px;text-align:center;border-top:3px solid #000;margin-top:9px;padding-top:7px;line-height:1.9">لیبارٹری، کاسٹنگ سنٹر، ہول سیل شاپ، جیولری شاپ، چوڑی کڑے اور کارخانے کے سوفٹ ویئر دستیاب ہیں۔</div>' +
    '<div style="font:800 23px Arial;text-align:center;padding:2px 0 10px">Rayyan&nbsp;&nbsp;0307-6965231</div>' +
    '</div>' + READY_SCRIPT + '</body></html>'
}

// Max-length dummy data (the ادھار / نقد layouts) — proves the template survives
// full-width Urdu labels + 7-digit amounts without overflow. The test page IS the
// real template, exercised through the exact same buildReceiptHtml() path.
const L = (l, s) => (s ? { l, s } : { l })
const V = (v, o) => Object.assign({ v }, o || {})
const WORST_CASE_DATA = {
  title: 'رسید ورسٹ کیس ٹیسٹ',
  tables: [
    [[L('رسید نمبر'), V('99999'), L('تاریخ'), V('12:58 PM  05-07-26')]],
    [
      [L('نام'), V('محمد عبدالرحمٰن چوہدری اینڈ سنز', { wrap: true, s: 3 })],
      [L('ریٹ فی تولہ'), V('434,500'), L('ریٹ فی گرام'), V('99,999')],
      [L(''), L('رتی'), L('ماشہ'), L('تولہ'), L('وزن')],
      [L('چاندی وزن'), V('8.88'), V('11'), V('99'), V('9,999.999')]
    ],
    [
      [L('چاندی دی'), V('9,999.999', { s: 3 })],
      [L('چاندی لی'), V('9,999.999', { s: 3 })],
      [L('نوٹ'), V('محمد عبدالرحمٰن چوہدری اینڈ سنز', { wrap: true, s: 3 })],
      [L('سابقہ چاندی بیلنس'), V('9,151,688', { s: 3 })],
      [L('باقی چاندی دینی ہے'), V('9,151,126', { box: true }), L('باقی چاندی لینی ہے'), V('9,151,126', { box: true })]
    ],
    [
      [L('کل قیمت'), V('9,151,688', { box: true, s: 3 })],
      [L('رقم دی'), V('9,151,688', { s: 3 })]
    ]
  ]
}

function worstCaseHtml() {
  return buildReceiptHtml(WORST_CASE_DATA)
}

async function testPrint({ kind, win, printScale }) {
  const html = kind === 'worstcase' ? worstCaseHtml() : calibrationHtml()
  // explicit user action from settings — skip the thermal-name guard so the
  // operator can test whatever printer is set as default. printScale honours the
  // saved setting so the test page matches what real receipts will look like.
  return printHtml({ html, copies: 1, win, tag: kind || 'calibration', requireThermal: false, printScale })
}

module.exports = { printHtml, testPrint, DOTS, clampScale, buildReceiptHtml }
