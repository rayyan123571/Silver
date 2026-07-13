import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { GRAMS_PER_TOLA, GRAMS_PER_RATTI, round } from '../logic/units.js'

// Pure (khalis) weight + qeemat from a {wazan, point, rate} metal entry — the
// SAME ratti-scale formula the نقد/ادھار panel's GoldRow uses, so a saved
// transaction matches exactly what the operator saw on screen.
function goldFigures(st, rateTola) {
  const wazan = Number(st?.wazan) || 0
  if (wazan <= 0) return null
  const point = Number(st?.point) || 0
  const deduction = ((point - 100) / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
  const khalis = round(wazan - deduction, 3)
  const rate = st.rate === '' || st.rate == null ? (Number(rateTola) || 0) : Number(st.rate)
  const qeemat = round((khalis / GRAMS_PER_TOLA) * rate, 0)
  return { wazan, point, khalis, rate, qeemat }
}

const NO_SAVED = { naqad: false, udhar: false }

// ── Unsaved-parchi DRAFT helpers ──────────────────────────────────────────────
// The blank composing state a fresh parchi starts from — one source of truth for
// resetting the workbench (New / return-to-workbench when no draft exists).
const BLANK_GOLD = () => ({ wazan: '', point: '100', rate: '' })
const BLANK_CUSTOMER = () => ({ id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null })

// A gold {wazan,point,rate} entry counts as "filled" if a weight or rate is typed.
const goldFilled = (st) =>
  !!st && (String(st.wazan ?? '').trim() !== '' || String(st.rate ?? '').trim() !== '')

// True when the composing form holds ANY real, save-worthy data. Mirrors the
// spirit of saveParchi's empty-guard (a bare پرچی row-tick is NOT data). Used
// ONLY by the debounced auto-persist, so a fresh blank the user is still ON
// doesn't become a row while idle. It does NOT gate parking or navigation:
// EMPTY parchis are legitimate — leaving one (نئی پرچی or any ◀/▶/⏮/⏭ move)
// parks it unconditionally, and a parked empty keeps its slot + number in the
// nav timeline forever (never deleted, pruned, or skipped).
const draftHasData = (s) =>
  (s.customer && ((s.customer.name || '').trim() !== '' || s.customer.id != null)) ||
  goldFilled(s.cashSell) || goldFilled(s.cashBuy) ||
  goldFilled(s.udharGive) || goldFilled(s.udharTake) ||
  String(s.udharCashGive ?? '').trim() !== '' || String(s.udharCashTake ?? '').trim() !== '' ||
  String(s.udharComment ?? '').trim() !== ''

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Today's date (LOCAL) as YYYY-MM-DD — the app's date fields default to this,
// never a hardcoded string, so they always show the real current day.
const todayISO = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Each receipt component builds its own slip DATA (title + tables) from its
// already-computed values and passes it to printSlips, which forwards it to the
// shared electron template (buildReceiptHtml). One design, four receipts.

// Fallback rates if the DB bridge isn't ready (e.g. running renderer in a
// plain browser without Electron). Keeps the UI alive for development.
const FALLBACK_RATES = {
  date: todayISO(),
  rate_tezabi_tola: 9000,
  parchi_charges: 100,
  fc_per_gram: 80,
  rate_tezabi_gram: 772,
  point: 100,
  slip_count: 1
}

const hasApi = typeof window !== 'undefined' && window.api

// Transient bottom-center toast for print failures — surfaces the reason instead
// of failing silently (a failed print used to look like "nothing happened").
function showPrintError(reason) {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu no-print'
  el.style.cssText =
    'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#b91c1c;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;' +
    'font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.35);max-width:80vw;text-align:center'
  el.textContent = `پرنٹ نہیں ہو سکا${reason ? ` (${reason})` : ''} — پرنٹر آن اور کنیکٹڈ چیک کریں`
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

// Generic transient toast (green = success, red = problem) — same style as the
// print-error toast; used by the WhatsApp share to tell the operator the image
// is on the clipboard. Display-only; never throws.
function showToast(text, ok) {
  if (typeof document === 'undefined') return
  try {
    const el = document.createElement('div')
    el.dir = 'rtl'
    el.className = 'urdu no-print'
    el.style.cssText =
      'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:9999;' +
      `background:${ok ? '#047857' : '#b91c1c'};color:#fff;padding:10px 18px;border-radius:8px;` +
      'font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.35);max-width:80vw;text-align:center'
    el.textContent = text
    document.body.appendChild(el)
    setTimeout(() => { try { el.remove() } catch {} }, 6000)
  } catch {}
}

// ── Thermal slip header/footer — STATIC shop-identity text printed above/below
// the cloned receipt panel. Display-only markup: never touches any value.
// Classic bordered header block (reference-receipt style): one clean outer
// rectangle, internal horizontal rules separating name / tagline / phones /
// address. Sizes are DESIGN px — the raster path scales them ×~1.63 onto the
// 576-dot canvas (name ≈ 42px printed, the largest text on the slip).
function buildSlipHeader() {
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu slip-header'
  el.style.cssText = 'text-align:center;color:#000;border:2px solid #000;padding:3px 4px 0;margin-bottom:5px'
  // Reference-receipt decorations: a sharp ZIGZAG rule under the tagline and a
  // ☎ before each phone number. The zigzag is inline SVG (rasterizes crisply to
  // 1-bit; non-scaling stroke keeps an even line width under the ×1.63 clone
  // scale); ☎ (U+260E) is a monochrome glyph that thresholds cleanly on thermal.
  let zz = 'M0 5'
  for (let x = 0; x <= 240; x += 6) zz += ' L' + (x + 3) + ' 1 L' + (x + 6) + ' 5'
  const wave = '<svg width="100%" height="6" viewBox="0 0 240 6" preserveAspectRatio="none" style="display:block;margin:3px 2px">' +
    '<path d="' + zz + '" fill="none" stroke="#000" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>'
  const tel = '☎' // ☎
  el.innerHTML =
    '<div style="font-size:26px;font-weight:800;line-height:1.5">چوہدری سلور</div>' +
    '<div style="font-size:12.5px;font-weight:500;line-height:1.7">خالص چاندی کی لین دین ۔ ہول سیل جیولری کا مرکز  (جیولری چوڑی میکر)</div>' +
    // sharp zigzag decorative rule (as in the reference receipt)
    wave +
    '<div style="font-size:13.5px;font-weight:600;line-height:1.8">چوہدری ایم رمضان آرائیں&nbsp;&nbsp;<span dir="ltr">' + tel + '&nbsp;0300-7301839</span></div>' +
    '<div style="font-size:14px;font-weight:600;line-height:1.7"><span dir="ltr">' + tel + '&nbsp;0302-7330000</span>&nbsp;&nbsp;&nbsp;<span dir="ltr">' + tel + '&nbsp;0302-3334440</span></div>' +
    // address in its own ruled strip at the bottom of the box
    '<div style="border-top:1.5px solid #000;margin-top:3px;padding:2px 0 4px;font-size:12.5px;font-weight:500;line-height:1.8">نزد موسیٰ پاک دربار صرافہ بازار ملتان</div>'
  return el
}

// Footer: the software line (with Rayyan 0307-6965231) prints on every slip.
function buildSlipFooter() {
  const el = document.createElement('div')
  el.dir = 'rtl'
  el.className = 'urdu'
  el.style.cssText = 'color:#000;margin-top:5px'
  el.innerHTML =
    '<div style="font-size:12.5px;font-weight:500;line-height:1.9;text-align:center;border-top:2px solid #000;padding-top:4px">' +
    'لیبارٹری، کاسٹنگ سنٹر، ہول سیل شاپ، جیولری شاپ، چوڑی کڑے اور کارخانے کے سوفٹ ویئر دستیاب ہیں۔' +
    '<div dir="ltr" style="font-size:14px;font-weight:800;margin-top:2px">Rayyan&nbsp;&nbsp;0307-6965231</div>' +
    '</div>'
  return el
}

// Build the standalone HTML document the DIRECT thermal raster path renders:
// exactly 576px wide (72.1mm × 8 dots @ 203dpi — the printer's full printable
// band), with a 10px inner safe padding per side so ink never touches the
// physical edge. The receipt keeps its EXACT on-screen layout: the panel is
// cloned at its 341px design width and vector-scaled once to the 556px content
// box — Chromium rasterizes glyphs at the FINAL size (no bitmap resize), and
// the main process hard-thresholds that single render to 1-bit.
function buildRasterSlipHtml(panelEl) {
  try {
    const clone = panelEl.cloneNode(true)
    // cloneNode copies attributes, NOT live input state — and outerHTML only
    // serializes ATTRIBUTES, so live values must be written back as attributes.
    const src = panelEl.querySelectorAll('input, textarea, select')
    const dst = clone.querySelectorAll('input, textarea, select')
    dst.forEach((f, i) => {
      const s = src[i]
      if (!s) return
      if (f.type === 'checkbox' || f.type === 'radio') {
        if (s.checked) f.setAttribute('checked', '')
        else f.removeAttribute('checked')
      } else if (f.tagName === 'TEXTAREA') {
        f.textContent = s.value
      } else if (f.tagName === 'SELECT') {
        Array.from(f.options).forEach((o, j) => {
          if (j === s.selectedIndex) o.setAttribute('selected', '')
          else o.removeAttribute('selected')
        })
      } else {
        f.setAttribute('value', s.value)
      }
    })
    // Rows are flex-1 inside a fixed panel height, so give the clone extra room
    // over the on-screen height so the larger print typography gets matching row
    // space. 1.15× keeps the rows tidy (not airy) and lands a normal slip near
    // the ~7in (≈1422-dot) target at printScale 1.0 — width/geometry untouched.
    clone.style.height = `${Math.round((panelEl.offsetHeight || 456) * 1.15)}px`
    // The offscreen page needs the app's real stylesheet (tailwind utilities,
    // receipt-panel rules). Serialize every reachable rule; same-origin in dev
    // (vite) and prod (file://) alike.
    let css = ''
    try {
      css = Array.from(document.styleSheets)
        .map((ss) => { try { return Array.from(ss.cssRules).map((r) => r.cssText).join('\n') } catch { return '' } })
        .join('\n')
    } catch {}
    // Packaged builds may refuse CSSOM access on file:// stylesheets — leave a
    // marker and the main process injects the built stylesheet from disk.
    if (!css || css.length < 500) css = '/*__APP_CSS__*/'
    const DOTS = 576, PAD = 10, DESIGN_W = 341
    const scale = (DOTS - 2 * PAD) / DESIGN_W
    const header = buildSlipHeader().outerHTML
    const footer = buildSlipFooter().outerHTML
    return '<!doctype html><html dir="ltr"><head><meta charset="utf-8"><style>' + css +
      '\nhtml,body{margin:0!important;padding:0!important;background:#fff!important}' +
      // ── Print typography (203dpi thermal): BIGGER regular/medium text, not
      // bold — small bold Nastaliq bleeds on a 1-bit head; size carries the
      // readability. Design px here land ×1.63 on the 576-dot canvas:
      // values 17px → ≈28 dots, Urdu labels 16px → ≈26 dots. The only bold
      // that remains is the final boxed بقایا رقم amount.
      '\n.print-area *{color:#000!important}' +
      '\n.print-area .receipt-panel,.print-area .receipt-panel *{border-color:#000!important;font-weight:500!important}' +
      '\n.print-area .receipt-panel .cell,.print-area .receipt-panel .lbl,.print-area .receipt-panel .inp,' +
      '.print-area .receipt-panel .inp-g,.print-area .receipt-panel .inp-y,.print-area .receipt-panel [class*="text-["]{font-size:17px!important;line-height:1.35!important}' +
      '\n.print-area .receipt-panel .urdu{font-size:16px!important;line-height:1.55!important}' +
      '\n.print-area .receipt-panel .panel-title{font-size:18px!important;font-weight:600!important;padding:3px 0!important}' +
      '\n.print-area .receipt-panel .laib-baqaya-row .num,.print-area .receipt-panel .laib-baqaya-row .bg-yellowCell *{font-weight:700!important}' +
      // بقایا رقم gets the reference's boxed treatment: a heavy ~3-dot border
      // (2px design × ~1.63 scale) around the amount, weight 700 (above).
      '\n.print-area .receipt-panel .laib-baqaya-row .bg-yellowCell{border-width:2px!important}' +
      // ── Solid printable rules: 1px design lines raster to <2 dots and print
      // broken on thermal heads. Outer panel border ≈3 dots, inner separators
      // ≈2.4 dots. Dotted field underlines keep their style, just heavier.
      '\n.print-area .receipt-panel{border-width:2px!important}' +
      '\n.print-area .receipt-panel [class~="border-b"]{border-bottom-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-t"]{border-top-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-l"]{border-left-width:1.5px!important}' +
      '\n.print-area .receipt-panel [class~="border-r"]{border-right-width:1.5px!important}' +
      '\n.print-area .receipt-panel .panel-title{border-bottom-width:1.5px!important}' +
      // The red دینا ہے value-box alerts (تیزابی + کیش) are SCREEN-only: this
      // offscreen page renders screen media, and the red would hard-threshold
      // to a SOLID BLACK BLOCK swallowing its (forced-black) text — strip it
      // back to plain black-on-clear like every other printed field.
      '\n.print-area .redbox-value,.print-area .redbox-value *{background:transparent!important;color:#000!important;-webkit-text-fill-color:#000!important;opacity:1!important}' +
      // rcpt-label = SCREEN-only bold/dark labels; pin the raster path's usual
      // forcing (500 / pure black) so the printed slip never changes with
      // screen styling.
      '\n.print-area .rcpt-label{font-weight:500!important;color:#000!important}' +
      // the offscreen page renders SCREEN media, so the @media print rule that
      // hides action bars (WhatsApp/print buttons, Saved tick) never fires —
      // hide them here explicitly
      '\n.no-print{display:none!important}' +
      '</style></head><body>' +
      // dir="ltr" wrapper for the same reason the print overlay uses it: the
      // clone must keep its on-screen anchoring/column order; the header,
      // footer and the receipts' internal RTL blocks set dir="rtl" themselves.
      // NO overflow:hidden here — transform:scale does not grow the wrapper's
      // LAYOUT box, so clipping to it would chop the slip at its unscaled
      // height (bottom rows lost). The ready script pins explicit heights to
      // the VISUAL (scaled) extent instead.
      '<div class="print-area" dir="ltr" style="width:' + DOTS + 'px;box-sizing:border-box;padding:6px ' + PAD + 'px 0;background:#fff">' +
      '<div data-measure style="width:' + DESIGN_W + 'px;transform:scale(' + scale + ');transform-origin:top left">' +
      header + clone.outerHTML + footer +
      '</div></div>' +
      // In-page passes after fonts load, before measuring:
      // 1) FIT PASS — FitValue spans were fitted at SCREEN sizes; at the larger
      //    print typography a long value (e.g. "4:27 PM 05-07-26") can overflow
      //    its box and get clipped. Re-run the same shrink-until-fits loop at
      //    print sizes so every digit always survives.
      // 2) HEIGHT — report the VISUAL (scaled) bottom so the canvas covers the
      //    whole slip.
      '<script>window.__ready=(async()=>{try{if(document.fonts&&document.fonts.ready){await document.fonts.ready}}catch(e){}' +
      'await new Promise(r=>setTimeout(r,80));' +
      'document.querySelectorAll(".receipt-panel span[dir=ltr]").forEach(function(s){' +
      'if(!/whitespace-nowrap/.test(s.className))return;' +
      'var sz=parseFloat(getComputedStyle(s).fontSize)||17,g=0;' +
      'while(s.scrollWidth>s.clientWidth&&sz>10&&g<40){sz-=0.5;s.style.setProperty("font-size",sz+"px","important");g++}' +
      '});' +
      'var el=document.querySelector("[data-measure]")||document.body;' +
      'var h=Math.ceil(el.getBoundingClientRect().bottom)+8;' +
      'var pa=document.querySelector(".print-area");if(pa){pa.style.height=h+"px"}' +
      'document.body.style.height=h+"px";return h})()</scr' + 'ipt>' +
      '</body></html>'
  } catch {
    return null
  }
}

// Flip to true to trace the parchi save/load path in the devtools console
// (Save button → saveParchi → replaceReceipt, and loadReceipt reconstruction).
const DEBUG_SAVE = false

export function AppProvider({ children }) {
  const [screen, setScreen] = useState('main') // 'main' | 'daybook' | 'udhar'
  const [rates, setRates] = useState(FALLBACK_RATES)
  const [receiptNo, setReceiptNo] = useState(1)
  // The receipt_no of the SAVED parchi currently open on screen (null while
  // composing a new, unsaved parchi). Drives First/Last/Next/Prev navigation.
  const [openReceiptNo, setOpenReceiptNo] = useState(null)
  const [udharOpen, setUdharOpen] = useState(false) // ادھار form/report modal
  const [akhrajatOpen, setAkhrajatOpen] = useState(false) // اخراجات (expenses) modal
  // Extended customer shape. mobile2/telephone/address/imagePath are new; their
  // persistence needs an upsertCustomer backend extension (see note), but the
  // form and live state work with them today.
  const [customer, setCustomer] = useState({
    id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null
  })
  // Bottom-bar shop totals. `cash` / `tezabi_sona` are live (getShopTotals).
  //
  // TODO(silver-inventory): `piece`, `bar1Tola`, `bar5Tola` and `bar10Tola` are
  // PLACEHOLDERS — no calculation exists for them yet, so they start as null and
  // the StatusBar renders "-". To wire them up, return fields of the SAME NAMES
  // from getShopTotals() in electron/db.cjs; setTotals() below replaces this
  // object wholesale with that result, so they will flow through to the bottom
  // bar with no further change here or in StatusBar.jsx.
  const [totals, setTotals] = useState({
    cash: 0,
    tezabi_sona: 0,
    parchun: 0,
    piece: null,     // TODO(silver-inventory): piece count — calculation TBD
    bar1Tola: null,  // TODO(silver-inventory): 1 tola bar count — calculation TBD
    bar5Tola: null,  // TODO(silver-inventory): 5 tola bar count — calculation TBD
    bar10Tola: null  // TODO(silver-inventory): 10 tola bar count — calculation TBD
  })
  const [bump, setBump] = useState(0)

  // Bottom-bar "کیش" is DISPLAY-ONLY reduced by ALL expenses up to & including the
  // current settings date: shown cash = totals.cash − (sum of every کھرچہ with
  // date ≤ rates.date). Expenses live in their own table and never touch cash
  // transactions / ledger, so this is purely a display subtraction. It is cumulative
  // (NOT per-day) so an expense stays subtracted after the date rolls forward.
  const [expensesUpToDate, setExpensesUpToDate] = useState(0)

  // نقد (cash) sell/buy entries — lifted here so the نقد کی رسید (a sibling of
  // the نقد panel) can read them and update live.
  const [cashSell, setCashSell] = useState({ wazan: '', point: '100', rate: '' })
  const [cashBuy, setCashBuy] = useState({ wazan: '', point: '100', rate: '' })

  // ادھار (credit) entries — gold give/take + cash give/take, lifted so the
  // ادھار کی رسید can read them and update live (gold & cash both allowed).
  const [udharGive, setUdharGive] = useState({ wazan: '', point: '100', rate: '' })
  const [udharTake, setUdharTake] = useState({ wazan: '', point: '100', rate: '' })
  const [udharCashGive, setUdharCashGive] = useState('')
  const [udharCashTake, setUdharCashTake] = useState('')
  // Free-text note saved with the parchi — typically the NAME of whoever came to
  // collect on the account holder's behalf. Shown only in the ادھار receipt
  // (next to پوائنٹ). Persisted in the receipt payload (no DB column).
  const [udharComment, setUdharComment] = useState('')

  // "Saved" confirmation ticks under each of the four receipts. Auto-set true
  // after a successful DB save of that section; cleared on New / reset.
  const [savedFlags, setSavedFlags] = useState(NO_SAVED)

  // ── UNSAVED-PARCHI DRAFTS ─────────────────────────────────────────────────────
  // The operator may keep several in-progress (unsaved) parchis open at once: New
  // parks the current one and opens a fresh blank, and ◀/▶ step through them. Each
  // is auto-persisted to the `drafts` table (separate from the ledger, so totals/
  // reports never see them). `currentDraftSeq` = the seq of the on-screen unsaved
  // parchi, or null for a brand-new blank not yet persisted. `draftSeqs` (the seqs
  // of all stored drafts) drives the nav-boundary flags. Refs mirror them for the
  // []-dep callbacks; caches avoid re-querying on every nav.
  const [currentDraftSeq, setCurrentDraftSeq] = useState(null)
  const [draftSeqs, setDraftSeqs] = useState([])
  const draftReadyRef = useRef(false)      // startup restore finished → auto-save may run
  const draftSeqRef = useRef(null)         // synchronous mirror of currentDraftSeq
  const draftsCacheRef = useRef([])        // [{ seq, data }] parsed, ascending by seq
  const draftTimerRef = useRef(null)       // auto-save debounce handle
  const formSnapshotRef = useRef(null)     // { hasData, snap } latest composing form
  const persistInflightRef = useRef(Promise.resolve()) // serialize draft writes

  const refresh = useCallback(() => setBump((b) => b + 1), [])

  // Modal tabs (ادھار / اخراجات) open over the main workflow. Only one at a time.
  const openUdhar = useCallback(() => { setScreen('main'); setAkhrajatOpen(false); setUdharOpen(true) }, [])
  const closeUdhar = useCallback(() => setUdharOpen(false), [])
  const openAkhrajat = useCallback(() => { setScreen('main'); setUdharOpen(false); setAkhrajatOpen(true) }, [])
  const closeAkhrajat = useCallback(() => setAkhrajatOpen(false), [])

  // Initial load
  useEffect(() => {
    if (!hasApi) return
    ;(async () => {
      const r = await window.api.getRates()
      // Always start on TODAY'S date (override any old stored default like
      // 2026-05-15); the user can still change it during the session.
      if (r) setRates({ ...r, date: todayISO() })
      const n = await window.api.nextReceiptNo()
      if (n) setReceiptNo(n)
      // Restore any UNSAVED parchis left behind last session. Corrupt rows are
      // skipped silently (refreshDraftsCache parses each in try/catch) — startup
      // never breaks. Show the NEWEST one — EMPTY OR NOT: a parked empty parchi
      // is a legitimate slot that keeps its number across restarts (never pruned
      // or skipped). Older ones are reachable via ◀. If none exist, stay on a
      // fresh blank workbench.
      try {
        await refreshDraftsCache()
        await dedupeDraftNumbers() // heal any duplicate/colliding draft numbers (old bug)
        const cache = draftsCacheRef.current
        if (cache.length) {
          const newest = cache[cache.length - 1]
          applyDraft(newest.data)
          setDraftSeq(newest.seq)
        }
      } catch { /* any failure → start clean */ }
      draftReadyRef.current = true // startup restore done — auto-save may now run
    })()
  }, [])

  // Totals refresh on every write
  useEffect(() => {
    if (!hasApi) return
    window.api.getShopTotals().then(setTotals)
  }, [bump])

  // Parchi nav boundary flags — whether an older/newer item exists relative to the
  // one open, walking the SAME merged timeline (saved receipts + unsaved drafts,
  // ONE order by parchi number — see buildTimeline below) that gotoNextReceipt/
  // gotoPrevReceipt step through, so the arrows never promise a step the handlers
  // won't take. Recomputes when the open item changes or the saved/draft sets do.
  // buildTimeline/currentTimelineIndex are defined further down (both are stable
  // — their own deps never change identity — so, like the startup-restore effect
  // above, they're referenced via closure and intentionally left out of the dep
  // array; only the values that actually drive a re-run are listed).
  const [receiptBounds, setReceiptBounds] = useState({ hasPrev: false, hasNext: false })
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!hasApi) { setReceiptBounds({ hasPrev: false, hasNext: false }); return }
      const timeline = await buildTimeline()
      let idx = currentTimelineIndex(timeline)
      if (idx === -1) idx = timeline.length
      if (!alive) return
      // idx > 0: something sits before this position. idx < length - 1: another
      // real entry (saved/draft) exists after this one; on the newest entry
      // there's nothing further — ▶ is disabled and never creates a new parchi.
      setReceiptBounds({ hasPrev: idx > 0, hasNext: idx < timeline.length - 1 })
    })()
    return () => { alive = false }
  }, [openReceiptNo, bump, currentDraftSeq, draftSeqs])

  // Cumulative expenses total (read-only) — sum of ALL expenses with date ≤ the
  // current settings date. Recomputed on every write (bump, e.g. after adding an
  // expense) and on a date change. Reduces ONLY the cash DISPLAY, so an expense
  // stays subtracted even after the settings date moves past its entry day.
  useEffect(() => {
    if (!hasApi) return
    window.api.getExpensesTotalUpTo(rates.date).then((s) => setExpensesUpToDate(Number(s) || 0))
  }, [rates.date, bump])

  // Bottom-bar cash DISPLAY = live cash figure − ALL expenses up to & including the
  // current settings date (display-only; the DB cash balance/ledger is never
  // reduced by expenses).
  const cashDisplay = (Number(totals.cash) || 0) - expensesUpToDate

  // ---- actions ----
  const saveRates = useCallback(async (patch) => {
    const next = { ...rates, ...patch }
    setRates(next)
    if (hasApi) await window.api.saveRates(next)
  }, [rates])

  // Print the current view once per configured slip copy (سلپ پرنٹ). 1 → one
  // print, 2 → two, etc. Each call opens the print dialog for that copy.
  const printSlips = useCallback(async (panelEl, slipData) => {
    const n = Math.max(1, parseInt(rates.slip_count, 10) || 1)
    // ── PRIMARY: direct 1-bit thermal raster (ESC/POS, RAW spool). The slip is
    // rendered ONCE at exactly 576 dots = the full 72.1mm printable band, hard-
    // thresholded to pure black/white and written straight to the printer — no
    // driver scaling, no left/right drift, no anti-alias blur. If the printer
    // isn't reachable this way (non-ESC/POS device, no default printer), fall
    // through to the driver-based path below unchanged.
    if (panelEl && hasApi && window.api.rasterPrintSlip) {
      // slipData (from the receipt component) → the shared table template
      // (buildReceiptHtml, one source of truth with the worst-case test page).
      // No slipData → fall back to the older clone-based HTML path.
      let payload = null
      if (slipData) {
        payload = { data: slipData, copies: n }
      } else {
        const rasterHtml = buildRasterSlipHtml(panelEl)
        if (rasterHtml) payload = { html: rasterHtml, copies: n }
      }
      if (payload) {
        try {
          const res = await window.api.rasterPrintSlip(payload)
          if (res && res.ok) return
          console.warn('raster print unavailable, using driver path:', res && res.reason)
        } catch (e) {
          console.warn('raster print failed, using driver path:', e)
        }
      }
    }
    // ── FALLBACK: Windows-driver print (silent → dialog), safe-window geometry.
    // The global @media print CSS shows ONLY `.print-area` content — and the main
    // screen has none, so receipt prints came out BLANK. Fix: clone the clicked
    // receipt panel into a temporary body-level .print-area (the same overlay
    // structure the report prints use). The clone lives OUTSIDE the FitScreen
    // scale transform, so it prints at natural size; `slip-print` on <body> hides
    // #root entirely in print so the clone starts on page 1. Cleaned up after.
    let overlay = null
    let pageStyle = null
    if (panelEl && typeof document !== 'undefined') {
      overlay = document.createElement('div')
      overlay.className = 'print-overlay'
      // <html dir="rtl">: on screen the receipt panels sit inside a dir="ltr"
      // wrapper (LeftReceipts/RightReceipts), but this overlay hangs off <body>,
      // so without its own LTR the clone inherits RTL — the receipt grids mirror
      // their columns AND the 341px inner block right-aligns in the 74mm area,
      // hanging ~61px off the LEFT edge (transform-origin:left keeps that
      // overhang), which clipped the label column and the leading digits on the
      // printed slip. dir="ltr" restores the exact on-screen column order;
      // the header/footer and the receipts' internal RTL blocks set dir="rtl"
      // explicitly themselves, so they are unaffected.
      overlay.dir = 'ltr'
      // invisible + out of flow on screen; print CSS re-shows the .print-area
      overlay.style.cssText = 'visibility:hidden;position:fixed;left:0;top:0;pointer-events:none'
      const root = document.createElement('div')
      root.className = 'print-root'
      const area = document.createElement('div')
      area.className = 'print-area'
      // Print the receipt EXACTLY as designed: render the clone at the panel's
      // fixed DESIGN width and transform-scale it down to the roll, the same
      // render-at-design-size-then-scale trick the statement view uses.
      // Squeezing the clone directly to the roll width broke the internal
      // fixed-px grids (لیب رسید columns) — scaling preserves them.
      //
      // Printable-safety geometry: an "80mm" thermal printer physically prints
      // only a ~72mm band (576 dots @ 203dpi) and every driver anchors that
      // band differently — one shop printer swallowed the LEFT ~3mm (leading
      // digits of گرام/فی تولہ lost), another clipped everything past ~72mm on
      // the RIGHT (Urdu labels lost). The old 74mm-wide slip at 2mm could not
      // survive either. Keep the WHOLE slip inside the 6mm..70mm window of the
      // page so both failure modes hit blank margin, never text.
      const PAPER_MM = 80 // physical roll width (@page size)
      const CONTENT_MM = 64 // slip width — inside every common printable band
      const LEFT_MM = 6 // slip's left edge, measured from the paper edge
      const DESIGN_W = 341 // the receipt panels' on-screen design width (px)
      const targetPx = (CONTENT_MM * 96) / 25.4 // 64mm in CSS px ≈ 242
      const scale = targetPx / DESIGN_W
      const designH = panelEl.offsetHeight || 456 // layout (unscaled) height
      area.style.cssText = `width:${CONTENT_MM}mm;margin-left:${LEFT_MM}mm;overflow:hidden`
      const inner = document.createElement('div')
      inner.style.cssText = `width:${DESIGN_W}px;transform:scale(${scale});transform-origin:top left`
      const clone = panelEl.cloneNode(true)
      // Fix the clone at its on-screen height so the flex rows keep the same
      // even spacing they have on screen (h-full has no parent height here).
      clone.style.height = `${designH}px`
      // cloneNode copies attributes, NOT live input/checkbox state — sync every
      // field into the clone so no value can go missing from the printout.
      const srcFields = panelEl.querySelectorAll('input, textarea, select')
      const dstFields = clone.querySelectorAll('input, textarea, select')
      dstFields.forEach((f, i) => {
        const s = srcFields[i]
        if (!s) return
        f.value = s.value
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = s.checked
      })
      // Slip = [SHOP HEADER] → [receipt body, exactly as on screen] → [FOOTER].
      inner.appendChild(buildSlipHeader())
      inner.appendChild(clone)
      inner.appendChild(buildSlipFooter())
      area.appendChild(inner)
      root.appendChild(area)
      overlay.appendChild(root)
      document.body.appendChild(overlay)
      document.body.classList.add('slip-print')
      // The scaled inner keeps its unscaled layout height — clamp the printable
      // area to the VISUAL (scaled) height so no blank feed follows the slip.
      area.style.height = `${Math.ceil((inner.offsetHeight || designH) * scale)}px`
      // 80mm continuous-roll page (same technique as the thermal reports): the
      // last @page rule wins over the global `@page { margin: 10mm }`. Side
      // margins are 0 so LEFT_MM above is measured from the TRUE paper edge —
      // the safe-window math must not shift with the page margin.
      pageStyle = document.createElement('style')
      pageStyle.id = 'slip-page-style'
      pageStyle.textContent = `@page { size: ${PAPER_MM}mm auto; margin: 2mm 0; }`
      document.head.appendChild(pageStyle)
    }
    try {
      // SILENT print straight to the default (thermal) printer — the system
      // print dialog often fails to spool on Windows thermal drivers, which is
      // why dialog printing produced nothing. Failures now surface as a toast.
      for (let i = 0; i < n; i++) {
        if (hasApi && window.api.printPage) {
          const res = await window.api.printPage({ silent: true })
          if (res && res.ok === false) {
            showPrintError(res.reason)
            break // don't fire remaining copies into a failing printer
          }
        } else {
          window.print() // plain-browser dev fallback
        }
      }
    } finally {
      if (overlay) { overlay.remove(); document.body.classList.remove('slip-print') }
      if (pageStyle) pageStyle.remove()
    }
  }, [rates.slip_count])

  // WhatsApp share: build the SAME slip the printer gets (shop header → the
  // clicked receipt exactly as on screen → footer), show it briefly as a
  // centered card, snapshot that card to the system CLIPBOARD as an image via
  // the main process, then open the WhatsApp chat — the operator just presses
  // Ctrl+V and Send. Every step is guarded; on ANY failure it falls back to the
  // old text-only WhatsApp link, so the button can never break or crash.
  const shareSlipWhatsApp = useCallback(async (panelEl, mobile, text) => {
    // Main process picks the best route: WhatsApp DESKTOP app when installed
    // (auto-paste watcher), else the embedded web window (in-window auto-paste).
    // Plain wa.me window.open remains the last-resort fallback (browser dev).
    const openWa = async () => {
      if (hasApi && window.api.openWhatsApp) {
        try {
          const r = await window.api.openWhatsApp({ mobile, text: text || '' })
          if (r && r.ok) return
        } catch {}
      }
      const num = String(mobile || '').replace(/[^0-9]/g, '')
      const url = `https://wa.me/${num}?text=${encodeURIComponent(text || '')}`
      if (typeof window !== 'undefined') window.open(url, '_blank')
    }
    if (!panelEl || typeof document === 'undefined' || !hasApi || !window.api.captureToClipboard) {
      openWa()
      return
    }
    let overlay = null
    try {
      const DESIGN_W = 341 // same design width the thermal print path uses
      const designH = panelEl.offsetHeight || 456
      overlay = document.createElement('div')
      overlay.dir = 'ltr' // html is rtl; keep the slip's internal grids unmirrored
      overlay.className = 'no-print'
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.45);' +
        'display:flex;align-items:flex-start;justify-content:center;padding-top:12px'
      const card = document.createElement('div')
      card.style.cssText = 'background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.4)'
      const inner = document.createElement('div')
      inner.style.cssText = `width:${DESIGN_W}px;transform-origin:top left;background:#fff;padding:4px`
      const clone = panelEl.cloneNode(true)
      clone.style.height = `${designH}px`
      // cloneNode copies attributes, NOT live input state — sync every field.
      const srcFields = panelEl.querySelectorAll('input, textarea, select')
      const dstFields = clone.querySelectorAll('input, textarea, select')
      dstFields.forEach((f, i) => {
        const s = srcFields[i]
        if (!s) return
        f.value = s.value
        if (f.type === 'checkbox' || f.type === 'radio') f.checked = s.checked
      })
      // The print path hides .no-print (action bar / Saved / buttons) via CSS at
      // print time; this is a SCREEN capture, so drop them from the clone — the
      // shared picture matches the printed slip exactly. (Field sync above runs
      // first, on the identical index order of panel vs clone.)
      clone.querySelectorAll('.no-print').forEach((n) => { try { n.remove() } catch {} })
      inner.appendChild(buildSlipHeader())
      inner.appendChild(clone)
      inner.appendChild(buildSlipFooter())
      card.appendChild(inner)
      overlay.appendChild(card)
      document.body.appendChild(overlay)
      // Two-phase: measure at natural size, then scale UP as far as the window
      // allows (max 2x) so the WhatsApp image is crisp but never clipped.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const naturalH = inner.offsetHeight || designH
      const scale = Math.max(0.5, Math.min(2,
        (window.innerHeight - 34) / naturalH,
        (window.innerWidth - 34) / DESIGN_W))
      inner.style.transform = `scale(${scale})`
      card.style.width = `${Math.floor(DESIGN_W * scale)}px`
      card.style.height = `${Math.floor(naturalH * scale)}px`
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 80)) // let paint settle before capture
      const b = card.getBoundingClientRect()
      const res = await window.api.captureToClipboard({ x: b.x, y: b.y, width: b.width, height: b.height })
      overlay.remove()
      overlay = null
      if (res && res.ok) {
        showToast('رسید کی تصویر تیار ہے — چیٹ کھلتے ہی خود لگ جائے گی، صرف Send دبائیں (نہ لگے تو Ctrl+V)', true)
      } else {
        showToast('تصویر کاپی نہیں ہو سکی — صرف تحریری پیغام بھیجا جائے گا', false)
      }
    } catch (e) {
      console.error('WhatsApp slip share failed:', e)
      if (overlay) { try { overlay.remove() } catch {} }
    }
    openWa()
  }, [])

  const newCustomer = useCallback(() => {
    setCustomer({ id: null, name: '', mobile: '', mobile2: '', telephone: '', address: '', imagePath: null })
  }, [])

  // ── DRAFTS: auto-persist EACH in-progress unsaved parchi; navigate with ◀/▶ ────
  const composingHasData = useMemo(() => draftHasData({
    customer, cashSell, cashBuy, udharGive, udharTake,
    udharCashGive, udharCashTake, udharComment
  }), [customer, cashSell, cashBuy, udharGive, udharTake,
    udharCashGive, udharCashTake, udharComment])

  const setDraftSeq = useCallback((v) => { draftSeqRef.current = v; setCurrentDraftSeq(v) }, [])

  // Load a draft snapshot into the composing form. Sets ONLY the openReceiptNo ==
  // null (unsaved) state — never a saved receipt. Drafts written by older builds
  // may still carry assay keys (input/overrides/sidebar); they are simply ignored.
  const applyDraft = useCallback((d) => {
    if (!d || typeof d !== 'object') return
    setCustomer({ ...BLANK_CUSTOMER(), ...(d.customer || {}) })
    setCashSell(d.cashSell || BLANK_GOLD())
    setCashBuy(d.cashBuy || BLANK_GOLD())
    setUdharGive(d.udharGive || BLANK_GOLD())
    setUdharTake(d.udharTake || BLANK_GOLD())
    setUdharCashGive(d.udharCashGive ?? '')
    setUdharCashTake(d.udharCashTake ?? '')
    setUdharComment(d.udharComment ?? '')
    if (d.receiptNo != null) setReceiptNo(d.receiptNo)
  }, [])

  // Re-read every stored draft into the cache (parsed; corrupt rows skipped) and
  // publish the seq list that drives the nav bounds.
  const refreshDraftsCache = useCallback(async () => {
    if (!hasApi) return
    const rows = (await window.api.listDrafts()) || []
    const parsed = []
    for (const r of rows) {
      try { const d = JSON.parse(r.payload); if (d && typeof d === 'object') parsed.push({ seq: r.seq, data: d }) }
      catch { /* skip a corrupt row */ }
    }
    draftsCacheRef.current = parsed
    setDraftSeqs(parsed.map((p) => p.seq))
  }, [])

  // The number a brand-new unsaved parchi should get: the lowest positive integer
  // NOT used by a saved receipt AND NOT already shown on any OTHER open unsaved
  // parchi (draft). This guarantees every parchi — saved or not — carries a unique
  // receipt number, so New always shows the next one (9 → 10 → 11 …).
  // BUG FIX: the increment loop used to check ONLY the draft-number set, so once
  // it stepped past its nextReceiptNo() starting point (skipping numbers already
  // claimed by drafts) it could land on a number that was SEPARATELY already a
  // SAVED receipt — e.g. saved {1-12,15} + drafts {13,14}: nextReceiptNo() starts
  // at 13 (lowest free ignoring drafts), the draft-only check steps 13→14→15 and
  // stops at 15 WITHOUT noticing #15 is a saved receipt — handing a "new" blank
  // the number of an existing parchi (a save there would have silently overwritten
  // it). Now also re-checks receiptNoExists at every step, matching the same
  // pattern dedupeDraftNumbers already uses correctly.
  const computeNextParchiNo = useCallback(async () => {
    // New always ADVANCES past the highest existing parchi number (saved receipts
    // AND open drafts) — it never reuses a freed/gap number. On a fresh DB this
    // yields 1; otherwise (max existing) + 1.
    let maxNo = 0
    if (hasApi) {
      const last = await window.api.getLastReceiptNo()
      const ln = Number(last)
      if (Number.isFinite(ln)) maxNo = Math.max(maxNo, ln)
    }
    for (const p of draftsCacheRef.current) {
      const dn = Number(p.data?.receiptNo)
      if (Number.isFinite(dn)) maxNo = Math.max(maxNo, dn)
    }
    let n = maxNo + 1
    // Safety: never land on a number that is somehow already saved.
    if (hasApi) { while (await window.api.receiptNoExists(n)) n++ }
    return n
  }, [])

  // Self-heal: give every stored draft a UNIQUE receipt number. Older builds could
  // save two drafts with the SAME number (e.g. both #9); this walks the drafts in
  // seq order and reassigns any whose number is missing, duplicated, or already a
  // saved receipt — keeping the earliest at its number and bumping the rest (9, 10,
  // 11 …). Idempotent (no collisions → no writes) and touches ONLY the drafts table.
  const dedupeDraftNumbers = useCallback(async () => {
    if (!hasApi) return
    const cache = draftsCacheRef.current // ascending by seq
    if (!cache.length) return
    let base = 1
    const r = await window.api.nextReceiptNo(); if (r) base = r
    const assigned = new Set()
    let changed = false
    for (const d of cache) {
      let n = Number(d.data?.receiptNo)
      const free = Number.isFinite(n) && !assigned.has(n) && !(await window.api.receiptNoExists(n))
      if (!free) {
        n = base
        while (assigned.has(n) || (await window.api.receiptNoExists(n))) n++
      }
      assigned.add(n)
      if (n !== Number(d.data?.receiptNo)) {
        await window.api.upsertDraft(d.seq, { ...d.data, receiptNo: n })
        changed = true
      }
    }
    if (changed) await refreshDraftsCache()
  }, [refreshDraftsCache])

  // Keep the latest composing form (and its hasData flag) in a ref, so the stable
  // persist/flush callbacks always write the CURRENT values without stale closures.
  useEffect(() => {
    formSnapshotRef.current = {
      hasData: composingHasData,
      snap: {
        customer, cashSell, cashBuy, udharGive, udharTake,
        udharCashGive, udharCashTake, udharComment, receiptNo
      }
    }
  }, [composingHasData, customer, cashSell, cashBuy, udharGive,
    udharTake, udharCashGive, udharCashTake, udharComment, receiptNo])

  // Persist the CURRENT unsaved parchi to its own draft row (INSERT if new, UPDATE
  // in place otherwise). NEVER deletes: a cleared parchi's row is simply updated
  // to the empty snapshot — empty parchis are legitimate and keep their slot +
  // number. The plain (debounced) call skips only a form with no data AND no row
  // yet, so a fresh blank the user is still ON doesn't become a row while idle.
  // `force: true` — used when the user LEAVES the parchi (نئی پرچی or ◀/▶/⏮/⏭) —
  // upserts UNCONDITIONALLY, parking even a completely empty parchi at its number
  // (the snapshot carries receiptNo). Writes are serialized so a rapid nav can't
  // double-insert.
  const persistCurrentDraft = useCallback((opts) => {
    const force = !!(opts && opts.force)
    const run = async () => {
      if (!hasApi) return
      const fs = formSnapshotRef.current
      if (!fs) return
      if (force || fs.hasData || draftSeqRef.current != null) {
        const res = await window.api.upsertDraft(draftSeqRef.current, fs.snap)
        if (res && res.seq != null) setDraftSeq(res.seq)
      }
      await refreshDraftsCache()
    }
    const p = persistInflightRef.current.then(run, run)
    persistInflightRef.current = p
    return p
  }, [refreshDraftsCache, setDraftSeq])

  // Auto-persist the current unsaved parchi (~800ms debounce). Runs ONLY while on an
  // unsaved parchi (openReceiptNo == null) and after the startup restore, so it can
  // never touch a saved receipt nor write before the drafts are loaded. Best-effort
  // + async → never blocks typing.
  useEffect(() => {
    if (!hasApi || !draftReadyRef.current) return
    if (openReceiptNo != null) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => { draftTimerRef.current = null; persistCurrentDraft() }, 800)
    return () => { if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null } }
  }, [openReceiptNo, composingHasData, customer, cashSell, cashBuy,
    udharGive, udharTake, udharCashGive, udharCashTake, udharComment,
    receiptNo, persistCurrentDraft])

  // Immediately flush the current unsaved parchi (cancel the pending debounce
  // first) — called before any navigation/New so nothing in-flight is lost. It
  // chains onto persistInflightRef (inside persistCurrentDraft), so awaiting it
  // also awaits any persist already running: rapid type → clear → New parks the
  // parchi exactly once. opts.force → park even a completely empty parchi.
  const flushDraft = useCallback(async (opts) => {
    if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
    await persistCurrentDraft(opts)
  }, [persistCurrentDraft])

  // Reset every composing field to blank (shared by New / after-save / blank workbench).
  const resetFormBlank = useCallback(() => {
    setCashSell(BLANK_GOLD()); setCashBuy(BLANK_GOLD())
    setUdharGive(BLANK_GOLD()); setUdharTake(BLANK_GOLD())
    setUdharCashGive(''); setUdharCashTake(''); setUdharComment('')
    setCustomer(BLANK_CUSTOMER())
  }, [])

  // Show a specific stored draft in the workbench.
  const loadDraftBySeq = useCallback((seq) => {
    const found = draftsCacheRef.current.find((p) => p.seq === seq)
    if (!found) return false
    applyDraft(found.data)
    setDraftSeq(seq)
    setOpenReceiptNo(null)
    return true
  }, [applyDraft, setDraftSeq])

  // Open a brand-new blank unsaved parchi (seq null; not persisted until typed).
  // Gets its OWN unique receipt number (next free, past all open drafts).
  const blankWorkbench = useCallback(async () => {
    resetFormBlank()
    setDraftSeq(null)
    setSavedFlags(NO_SAVED)
    setRates((r) => ({ ...r, date: todayISO() }))
    setOpenReceiptNo(null)
    const nn = await computeNextParchiNo()
    setReceiptNo(nn)
  }, [resetFormBlank, setDraftSeq, computeNextParchiNo])

  // ── Merged navigation timeline (saved + unsaved, ONE chronological order) ───
  // BUG 1 fix: ◀/▶/First/Last used to treat "all saved" then "all drafts" as two
  // separate blocks, so a draft numbered BEFORE the newest saved receipt was
  // unreachable until AFTER it (e.g. 1-12 saved, 13/14 drafted, 15 saved → ▶ from
  // 12 jumped to 15, not 13; ⏭ Last jumped straight to 15, skipping 13/14 entirely).
  // This walks ONE list ordered by PARCHI NUMBER regardless of saved/unsaved
  // status — INCLUDING parked EMPTY drafts, which hold their slot like any other
  // parchi: 12 → 13(draft) → 14(draft) → 15(saved) → blank. Used by ALL FOUR nav
  // functions (gotoFirstReceipt/gotoLastReceipt/gotoNextReceipt/gotoPrevReceipt)
  // and the receiptBounds arrow-enable effect, so every one of them agrees on the
  // same order. Always rebuilt from FRESH reads (saved numbers from the DB,
  // drafts via refreshDraftsCache) so a step never trusts stale state. A draft
  // with no numeric receiptNo (very old rows) sorts after every numbered entry,
  // by seq; the blank workbench is one PAST the end of this array, never an
  // entry in it. A saved/draft tie at the SAME number (a reused number) keeps
  // saved first — both are visited, never skipped, never looped.
  const buildTimeline = useCallback(async () => {
    const savedNos = (hasApi && window.api.listReceiptNos) ? (await window.api.listReceiptNos()) : []
    await refreshDraftsCache()
    const entries = savedNos.map((no) => ({ kind: 'saved', no: Number(no), seq: null }))
    for (const d of draftsCacheRef.current) {
      // EVERY stored draft is an entry — INCLUDING parked EMPTY parchis. An
      // empty parchi holds its slot + number like any other (never deleted,
      // pruned, or skipped); only saveParchi refuses to SAVE one as a receipt.
      const no = Number(d.data?.receiptNo)
      entries.push({ kind: 'draft', seq: d.seq, no: Number.isFinite(no) ? no : null })
    }
    entries.sort((a, b) => {
      if (a.no == null && b.no == null) return a.seq - b.seq
      if (a.no == null) return 1
      if (b.no == null) return -1
      if (a.no !== b.no) return a.no - b.no
      if (a.kind !== b.kind) return a.kind === 'saved' ? -1 : 1 // same number: saved before draft
      return (a.seq ?? 0) - (b.seq ?? 0)
    })
    return entries
  }, [refreshDraftsCache])

  // This app's CURRENT position in `timeline` — the index of the open saved
  // receipt or stored draft, or `timeline.length` (one PAST the end) for the
  // brand-new, never-persisted blank. -1 (not found) shouldn't happen since
  // openReceiptNo/draftSeqRef only ever point at real rows, but callers treat
  // it the same as the blank position, defensively.
  const currentTimelineIndex = useCallback((timeline) => {
    if (openReceiptNo != null) {
      return timeline.findIndex((e) => e.kind === 'saved' && e.no === openReceiptNo)
    }
    const seq = draftSeqRef.current
    if (seq != null) {
      return timeline.findIndex((e) => e.kind === 'draft' && e.seq === seq)
    }
    return timeline.length
  }, [openReceiptNo])

  // Save the given customer (e.g. the modal form's working copy) or, with no
  // argument, the current global customer (the inline Save button). The DB
  // assigns the id on insert and returns the full row, which we set back so the
  // form shows the real id.
  const saveCustomer = useCallback(async (override) => {
    const toSave = override || customer
    if (!hasApi) {
      setCustomer(toSave)
      return toSave
    }
    const saved = await window.api.upsertCustomer(toSave)
    setCustomer(saved)
    refresh()
    return saved
  }, [customer, refresh])

  // Load a saved receipt (as returned by window.api.getReceiptByNo) back into the
  // live entry: customer, receipt number, and the نقد/ادھار entries.
  // Tolerant of shape — the row may carry the fields at the top level or nested
  // under a `payload` (string or object), since saveReceipt stores payload JSON.
  const loadReceipt = useCallback((data) => {
    if (!data) return
    let payload = data.payload ?? data
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch { payload = {} }
    }
    const rcptNo = data.receipt_no ?? payload.receipt_no ?? payload.receiptNo
    if (DEBUG_SAVE) console.log('[loadReceipt] receipt_no', rcptNo, 'rows', data.rows)
    if (rcptNo != null) {
      setReceiptNo(rcptNo)
      setOpenReceiptNo(rcptNo)
      // Now VIEWING a saved receipt — detach from any draft we were composing,
      // so no later flush/park (e.g. نئی پرچی pressed from here) can write this
      // receipt's on-screen data over that parked draft's row.
      setDraftSeq(null)
    }

    const cust = payload.customer ?? data.customer
    if (cust) {
      setCustomer({
        id: cust.id ?? data.customer_id ?? null,
        name: cust.name ?? '',
        mobile: cust.mobile ?? ''
      })
    }

    // Restore the rate context the parchi was saved under, so the نقد/ادھار
    // figures recompute to EXACTLY the values that were saved (khalis/qeemat
    // depend on it).
    if (payload.rates) setRates((r) => ({ ...r, ...payload.rates }))

    // نقد / ادھار entries — reconstruct from the TRANSACTION ROWS: the SAME rows
    // Save writes and reports read. This single source of truth guarantees a
    // reopened parchi reflects exactly what was last saved (removed entries gone,
    // changed values updated) and never a divergent JSON snapshot. The payload's
    // `entries` is used only as a fallback for parchis with no rows.
    const blankGold = () => ({ wazan: '', point: '100', rate: '' })
    const rows = Array.isArray(data.rows) ? data.rows : []
    if (rows.length) {
      let cs = blankGold(), cb = blankGold(), ug = blankGold(), ut = blankGold(), cg = '', ct = ''
      const asGold = (r) => ({
        wazan: r.sona_wazan != null ? String(r.sona_wazan) : '',
        point: r.point != null ? String(r.point) : '100',
        rate: r.rate ? String(r.rate) : ''
      })
      for (const r of rows) {
        if (r.category === 'gold_sell') cs = asGold(r)
        else if (r.category === 'gold_buy') cb = asGold(r)
        else if (r.category === 'gold_give') ug = asGold(r)
        else if (r.category === 'gold_take') ut = asGold(r)
        else if (r.category === 'cash_give') cg = r.cash_amount != null ? String(r.cash_amount) : ''
        else if (r.category === 'cash_take') ct = r.cash_amount != null ? String(r.cash_amount) : ''
      }
      setCashSell(cs); setCashBuy(cb); setUdharGive(ug); setUdharTake(ut)
      setUdharCashGive(cg); setUdharCashTake(ct)
    } else if (payload.entries) {
      const e = payload.entries
      setCashSell(e.cashSell ?? blankGold())
      setCashBuy(e.cashBuy ?? blankGold())
      setUdharGive(e.udharGive ?? blankGold())
      setUdharTake(e.udharTake ?? blankGold())
      setUdharCashGive(e.udharCashGive ?? '')
      setUdharCashTake(e.udharCashTake ?? '')
    } else {
      setCashSell(blankGold()); setCashBuy(blankGold())
      setUdharGive(blankGold()); setUdharTake(blankGold())
      setUdharCashGive(''); setUdharCashTake('')
    }

    // ادھار comment (collector's name / note) — restore from the saved payload.
    setUdharComment(payload.comment ?? '')
  }, [setDraftSeq])

  // Fetch a saved parchi by receipt_no and load it via the shared loadReceipt
  // flow, so the FULL parchi (header + نقد/ادھار entries) is restored.
  // Returns { ok, receipt_no? , message? }.
  const loadReceiptNo = useCallback(async (n) => {
    if (n == null) return { ok: false }
    if (!hasApi) return { ok: false }
    const data = await window.api.getReceiptByNo(n)
    if (!data) return { ok: false, message: 'یہ رسید نمبر موجود نہیں' }
    loadReceipt(data)
    return { ok: true, receipt_no: n }
  }, [loadReceipt])

  // Bottom-bar رسید نمبر lookup. window.api.getReceiptByNo only sees SAVED
  // receipts, so a parchi that currently exists as an unsaved DRAFT (a parked
  // slot the ◀▶ arrows CAN reach) wrongly reported "یہ رسید نمبر موجود نہیں".
  // This walks the SAME merged saved+draft timeline the nav arrows do: it parks
  // the current parchi first (so in-flight typing is never lost), then jumps to
  // the matching entry — a SAVED receipt is preferred over a draft at the same
  // number. Returns { ok, receipt_no?, message? } like loadReceiptNo / goto*.
  const searchReceiptNo = useCallback(async (n) => {
    if (!hasApi) return { ok: false }
    const num = Number(n)
    if (!Number.isFinite(num)) return { ok: false, message: 'صرف نمبر لکھیں' }
    // A saved receipt has no draft to park (openReceiptNo != null); only park
    // when we're leaving an unsaved parchi.
    if (openReceiptNo == null) await flushDraft()
    const timeline = await buildTimeline()
    // saved sorts before draft at the same number (buildTimeline), so the FIRST
    // match wins the saved-over-draft tie automatically.
    const entry = timeline.find((e) => e.no === num)
    if (!entry) return { ok: false, message: 'یہ رسید نمبر موجود نہیں' }
    if (entry.kind === 'saved') return loadReceiptNo(entry.no)
    loadDraftBySeq(entry.seq)
    return { ok: true, receipt_no: num }
  }, [openReceiptNo, flushDraft, buildTimeline, loadReceiptNo, loadDraftBySeq])

  // ── Parchi navigation ───────────────────────────────────────────────────────
  // ALL FOUR (⏮ First / ◀ Prev / ▶ Next / ⏭ Last) now walk the SAME merged
  // saved+draft timeline (see buildTimeline) — First/Last jump straight to its
  // oldest/newest REAL entry (never the blank), Next/Prev step one at a time.
  // Nothing saved or drafted anywhere → gentle Urdu note. At an edge (Next past
  // newest / Prev before oldest) → no-op note, no wrap-around.
  const NONE = { ok: false, message: 'کوئی رسید محفوظ نہیں' }
  const gotoFirstReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    if (openReceiptNo == null) await flushDraft() // persist in-flight typing, same as ◀/▶
    const timeline = await buildTimeline()
    if (!timeline.length) return NONE
    // Leaving a never-parked blank workbench for another parchi → PARK it first
    // (even empty): it keeps its slot/number and stays reachable via ▶. (A typed
    // blank was already parked by the conditional flush above.)
    if (openReceiptNo == null && draftSeqRef.current == null) await flushDraft({ force: true })
    const entry = timeline[0]
    if (entry.kind === 'saved') return loadReceiptNo(entry.no)
    loadDraftBySeq(entry.seq)
    return { ok: true, receipt_no: null }
  }, [openReceiptNo, flushDraft, buildTimeline, loadReceiptNo, loadDraftBySeq])

  const gotoLastReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    if (openReceiptNo == null) await flushDraft()
    const timeline = await buildTimeline()
    if (!timeline.length) return NONE
    // Same park-on-leave as gotoFirst. The landing target is the newest REAL
    // entry as of BEFORE the park — the just-parked blank sits after it,
    // reachable via ▶.
    if (openReceiptNo == null && draftSeqRef.current == null) await flushDraft({ force: true })
    const entry = timeline[timeline.length - 1]
    if (entry.kind === 'saved') return loadReceiptNo(entry.no)
    loadDraftBySeq(entry.seq)
    return { ok: true, receipt_no: null }
  }, [openReceiptNo, flushDraft, buildTimeline, loadReceiptNo, loadDraftBySeq])

  // ▶ Next (NEWER). Walks the merged timeline (buildTimeline, above) one step
  // forward to another saved/draft entry. On the newest entry there is nothing
  // ahead → Urdu note; ▶ NEVER creates a new parchi (only نئی پرچی does).
  const gotoNextReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    // Leaving an unsaved parchi: flush FIRST (persists in-flight typing; a
    // cleared parchi's row updates to its empty snapshot) so the timeline is
    // accurate. No force-park is needed in ▶: a never-parked blank only ever
    // sits PAST the end of the timeline, where ▶ is a no-op (toast below — no
    // move, so nothing is left); a typed one was just parked by this flush.
    if (openReceiptNo == null) await flushDraft()
    const timeline = await buildTimeline()
    let idx = currentTimelineIndex(timeline)
    if (idx === -1) idx = timeline.length
    if (idx >= timeline.length) return { ok: false, message: 'یہ آخری (نئی) پرچی ہے' } // already the newest blank
    const targetIdx = idx + 1
    if (targetIdx >= timeline.length) return { ok: false, message: 'یہ آخری پرچی ہے' }
    const entry = timeline[targetIdx]
    if (entry.kind === 'saved') return loadReceiptNo(entry.no)
    loadDraftBySeq(entry.seq)
    return { ok: true, receipt_no: null }
  }, [openReceiptNo, flushDraft, buildTimeline, currentTimelineIndex, loadReceiptNo, loadDraftBySeq])

  // ◀ Prev (OLDER). Same merged timeline, one step back. Past the start → an
  // Urdu note ('پہلی رسید' if something exists at all, else NONE — nothing saved
  // or drafted anywhere).
  const gotoPrevReceipt = useCallback(async () => {
    if (!hasApi) return { ok: false }
    if (openReceiptNo == null) await flushDraft()
    const timeline = await buildTimeline()
    let idx = currentTimelineIndex(timeline)
    if (idx === -1) idx = timeline.length
    const targetIdx = idx - 1
    if (targetIdx < 0) return timeline.length ? { ok: false, message: 'پہلی رسید' } : NONE
    // Moving OFF a never-parked blank workbench → PARK it first (even empty):
    // it keeps its slot/number and ▶ can come back to it. (A typed blank was
    // already parked by the conditional flush above.) The landing target stays
    // the one computed from the pre-park timeline.
    if (openReceiptNo == null && draftSeqRef.current == null) await flushDraft({ force: true })
    const entry = timeline[targetIdx]
    if (entry.kind === 'saved') return loadReceiptNo(entry.no)
    loadDraftBySeq(entry.seq)
    return { ok: true, receipt_no: null }
  }, [openReceiptNo, flushDraft, buildTimeline, currentTimelineIndex, loadReceiptNo, loadDraftBySeq])

  const addTransaction = useCallback(async (t) => {
    const txn = {
      receipt_no: receiptNo,
      customer_id: customer.id,
      date: rates.date,
      ...t
    }
    if (hasApi) await window.api.addTransaction(txn)
    refresh()
    return txn
  }, [receiptNo, customer.id, rates.date, refresh])

  // A customer is mandatory for any cash/udhar (ledger) save. Returns the customer
  // with a REAL id, or null when none is selected. IMPORTANT: a typed name is NOT
  // auto-created any more — a receipt may only carry an ALREADY-SAVED customer. If
  // the operator typed a name without picking from the list, we try to resolve it
  // to an EXACT saved-customer match (findCustomers does a contains-search, so we
  // keep only exact, case-insensitive name matches). Exactly one match → adopt it;
  // unknown name or an ambiguous duplicate → null, so the caller blocks the save.
  // New customers must be added deliberately (the "+" customer form, or Save with
  // just a name and no entries).
  const ensureCustomer = useCallback(async () => {
    if (customer.id) return customer
    const name = (customer.name || '').trim()
    if (!name || !hasApi) return null
    const hits = (await window.api.findCustomers(name)) || []
    const exact = hits.filter((c) => (c.name || '').trim().toLowerCase() === name.toLowerCase())
    if (exact.length === 1) { setCustomer(exact[0]); return exact[0] }
    return null
  }, [customer])

  // Stage 2 — Save the current نقد + ادھار entries as transactions under the
  // current receipt_no, then auto-tick the matching "Saved" boxes and advance to
  // the next parchi number. Returns { ok, message?, receipt_no? }.
  const saveParchi = useCallback(async () => {
    const rateTola = Number(rates.rate_tezabi_tola) || 0
    const sell = goldFigures(cashSell, rateTola)
    const buy = goldFigures(cashBuy, rateTola)
    const give = goldFigures(udharGive, rateTola)
    const take = goldFigures(udharTake, rateTola)
    const cGive = Number(udharCashGive) || 0
    const cTake = Number(udharCashTake) || 0

    const txns = []
    // نقد (cash trade): sell = shop gives gold / gets cash (out), buy = gets gold / pays cash (in)
    if (sell) txns.push({ section: 'naqad', kind: 'cash', direction: 'out', category: 'gold_sell', sona_wazan: sell.wazan, point: sell.point, khalis_sona: sell.khalis, rate: sell.rate, qeemat: sell.qeemat, note: 'نقد فروخت' })
    if (buy) txns.push({ section: 'naqad', kind: 'cash', direction: 'in', category: 'gold_buy', sona_wazan: buy.wazan, point: buy.point, khalis_sona: buy.khalis, rate: buy.rate, qeemat: buy.qeemat, note: 'نقد خرید' })
    // ادھار (credit): give gold = out, take gold = in; cash give = out, cash take = in
    if (give) txns.push({ section: 'udhar', kind: 'udhar', direction: 'out', category: 'gold_give', sona_wazan: give.wazan, point: give.point, khalis_sona: give.khalis, rate: give.rate, qeemat: give.qeemat, note: 'تیزابی دیا' })
    if (take) txns.push({ section: 'udhar', kind: 'udhar', direction: 'in', category: 'gold_take', sona_wazan: take.wazan, point: take.point, khalis_sona: take.khalis, rate: take.rate, qeemat: take.qeemat, note: 'تیزابی لیا' })
    if (cGive) txns.push({ section: 'udhar', kind: 'udhar', direction: 'out', category: 'cash_give', cash_amount: cGive, note: 'ادھار کیش دیا' })
    if (cTake) txns.push({ section: 'udhar', kind: 'udhar', direction: 'in', category: 'cash_take', cash_amount: cTake, note: 'ادھار کیش لیا' })

    // Editing an already-open parchi (its number is currently loaded) vs a brand-
    // new one. Compute EARLY, because it changes the empty-guard below: an edit
    // that zeroed/removed all its entries is STILL a valid save (it must overwrite
    // the receipt so the emptied state persists), whereas a brand-new blank parchi
    // has nothing to save yet.
    const displayedNo = receiptNo
    const isEdit = openReceiptNo != null && Number(openReceiptNo) === Number(displayedNo)
    // Save under the number shown on screen — each unsaved parchi already carries its
    // OWN unique number (assigned at creation, past every other open draft). Guard:
    // if that number is somehow ALREADY a saved receipt, or is held by ANOTHER
    // parked draft (legacy/collided data — parked drafts OCCUPY their numbers just
    // like saved receipts, empty or not), claim a fresh unique one instead, so a
    // save can never overwrite another parchi nor steal a parked draft's slot.
    let rno = displayedNo
    if (!isEdit && hasApi) {
      const savedHolds = await window.api.receiptNoExists(displayedNo)
      const otherDraftHolds = draftsCacheRef.current.some(
        (d) => d.seq !== draftSeqRef.current && Number(d.data?.receiptNo) === Number(displayedNo)
      )
      if (savedHolds || otherDraftHolds) rno = await computeNextParchiNo()
    }

    // A parchi is worth saving only if it carries at least one نقد/ادھار entry —
    // those transactions ARE the parchi now. A brand-new parchi with nothing on it
    // has nothing to write.
    if (!isEdit && !txns.length) return { ok: false, message: 'کوئی اندراج نہیں — پہلے مقدار درج کریں' }

    // Two-step "parchi free" — ORDER ENFORCED. On an already-open receipt, the NAME
    // may only be removed AFTER the entries were emptied first (Step 1). So when the
    // name is empty on an edit:
    //   • entries also empty  → STEP 2: FREE the number (delete #rno entirely, leave
    //     it on screen with openReceiptNo=null so it can be reused by a new customer).
    //   • entries STILL exist → WRONG ORDER: block with an Urdu error and change
    //     nothing (don't free, don't overwrite — the saved data stays intact).
    // STEP 1 (name still present) never enters here; it saves an empty-but-named
    // parchi below.
    const nameEmpty = !customer.id && !(customer.name && customer.name.trim())
    const entriesEmpty = !txns.length
    if (isEdit && nameEmpty) {
      if (entriesEmpty) {
        if (hasApi) await window.api.freeReceipt(rno)
        setSavedFlags(NO_SAVED)
        setOpenReceiptNo(null)
        refresh()
        return { ok: true, receipt_no: rno, freed: true }
      }
      return { ok: false, message: 'پہلے تمام اندراج ختم کریں، پھر نام ہٹائیں' }
    }

    // Name mandatory for any parchi save (ledger + snapshot are keyed to a customer).
    // The customer must ALREADY be saved — ensureCustomer never creates one now.
    const cust = await ensureCustomer()
    if (!cust || !cust.id) {
      const typed = (customer.name || '').trim()
      return {
        ok: false,
        message: typed
          ? 'یہ کسٹمر محفوظ نہیں — فہرست سے منتخب کریں یا "+" سے نیا کسٹمر شامل کریں'
          : 'پہلے کسٹمر منتخب کریں'
      }
    }

    // Current line-items for this receipt (strip the UI-only `section` tag).
    const rows = txns.map(({ section, ...row }) => ({ customer_id: cust.id, date: rates.date, ...row }))

    // FULL snapshot payload so reopening restores every entry — symmetric with
    // loadReceipt, which reads exactly these fields back. `rates` MUST stay: the
    // نقد/ادھار receipts rebuild khalis/qeemat from the rate the parchi was saved
    // under.
    const payload = {
      receipt_no: rno,
      customer: { id: cust.id, name: cust.name, mobile: cust.mobile },
      rates,
      entries: { cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake },
      comment: udharComment
    }

    // UPSERT: atomically delete this receipt_no's prior rows then insert the
    // current ones. Editing replaces the parchi (removed entries stay removed,
    // changed values overwrite) — one receipt_no → exactly one current version.
    if (hasApi) {
      // Guard: if the app was updated but Electron wasn't fully restarted, the
      // preload bridge won't yet expose replaceReceipt. Surface a clear message
      // instead of a silent throw that looks like "save did nothing".
      if (typeof window.api.replaceReceipt !== 'function') {
        return { ok: false, message: 'ایپ کو دوبارہ شروع کریں (Restart) — سیو اپڈیٹ ہوا ہے' }
      }
      if (DEBUG_SAVE) console.log('[saveParchi] replaceReceipt', { rno, isEdit, rows })
      const res = await window.api.replaceReceipt({
        receipt: { receipt_no: rno, type: 'parchi', customer_id: cust.id, date: rates.date, payload },
        transactions: rows
      })
      if (DEBUG_SAVE) console.log('[saveParchi] replaceReceipt result', res)
      if (res && res.ok === false) return { ok: false, message: res.message || 'محفوظ نہیں ہو سکا' }
    }

    // Auto-tick the sections that were saved.
    setSavedFlags((f) => ({
      ...f,
      naqad: txns.some((t) => t.section === 'naqad') || f.naqad,
      udhar: txns.some((t) => t.section === 'udhar') || f.udhar
    }))
    refresh()

    if (!isEdit) {
      // The unsaved parchi is now in the ledger — remove ITS draft row (other
      // unsaved parchis stay). Cancel any pending auto-save first so the just-saved
      // form can't be re-inserted as a draft on the way out.
      if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
      const savedSeq = draftSeqRef.current
      setDraftSeq(null)
      // AWAITED (was fire-and-forget): this parchi now exists as a SAVED receipt
      // under this number, so its draft twin must be GONE before Save returns —
      // a fast ◀/New right after could otherwise show the SAME parchi twice in
      // the timeline (saved + not-yet-deleted draft), and quitting inside that
      // gap left a permanent ghost copy. UNIQUE-PARCHI RULE: one number, one
      // parchi. (This graduation is the ONE legitimate automatic draft delete.)
      if (hasApi && savedSeq != null) {
        try { await window.api.deleteDraft(savedSeq) } catch { /* startup dedupe heals */ }
      }
      await refreshDraftsCache()
      // STAY on the just-saved parchi (user rule 2026-07-07): the data lives at
      // ITS receipt number and the screen stays right here — entries visible,
      // number unchanged — exactly like an edited receipt. The number advances
      // ONLY when نئی پرچی is clicked (newParchi → blankWorkbench → next unused
      // number). This replaced the old CLEAR-and-advance behavior; its two
      // "doubling" worries are both covered now:
      //   • on-screen doubling — CreditReceipt computes سابقہ = ledger − this
      //     parchi's own net whenever openReceiptNo != null (the state we set
      //     here), so totals stay correct with the entries still on screen;
      //   • double-recording — a second Save from this state is isEdit and goes
      //     through replaceReceipt's UPSERT (replaces, never duplicates).
      // If the save-guard renumbered (rno != displayedNo), show the ACTUAL
      // saved number.
      setReceiptNo(rno)
      setOpenReceiptNo(rno)
    } else {
      // Editing an already-open parchi: keep it on screen (entries intact) so a
      // re-save overwrites the same receipt.
      setOpenReceiptNo(rno)
    }
    return { ok: true, receipt_no: rno, saved: rows.length, edited: isEdit }
  }, [rates, cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake, udharComment, receiptNo, openReceiptNo, customer, ensureCustomer, refresh, setDraftSeq, refreshDraftsCache, computeNextParchiNo])

  // Stage 3 — Save one udhar action-button transaction (kind/direction/category
  // supplied by the caller). `explicit` (optional) is the customer to record for
  // ({id} or {name}); when omitted we fall back to the global selected customer.
  // The ادھار form passes its OWN selected customer so it stays decoupled from the
  // main screen. Name mandatory. Returns { ok, message?, receipt_no? }.
  const saveUdharTxn = useCallback(async (t, explicit) => {
    let cust
    if (explicit && (explicit.id || (explicit.name && String(explicit.name).trim()))) {
      cust = explicit.id
        ? explicit
        : (hasApi ? await window.api.upsertCustomer({ name: String(explicit.name).trim() }) : { id: null, ...explicit })
    } else {
      cust = await ensureCustomer()
    }
    if (!cust || !cust.id) return { ok: false, message: 'پہلے کسٹمر کا نام منتخب کریں / درج کریں' }
    const rno = receiptNo
    if (hasApi) await window.api.addTransaction({ receipt_no: rno, customer_id: cust.id, date: rates.date, ...t })
    setSavedFlags((f) => ({ ...f, udhar: true }))
    refresh()
    if (hasApi) {
      // Draft-aware advance: parked drafts (empty or not) occupy their numbers,
      // so the next displayed number must skip them as well as saved receipts.
      const n = await computeNextParchiNo()
      if (n) setReceiptNo(n)
      // rno just became a SAVED receipt. If a parked draft is composing on
      // screen, its row still carries rno until the next debounce re-park —
      // move it to the advanced number NOW so one number never shows two
      // parchis (unique-parchi rule). Snapshot ref still holds the pre-advance
      // form state, so only receiptNo is overridden.
      if (n && draftSeqRef.current != null && formSnapshotRef.current) {
        try {
          await window.api.upsertDraft(draftSeqRef.current, { ...formSnapshotRef.current.snap, receiptNo: n })
          await refreshDraftsCache()
        } catch { /* the debounce re-parks with the new number anyway */ }
      }
    } else {
      setReceiptNo((r) => r + 1)
    }
    return { ok: true, receipt_no: rno, customer: cust }
  }, [ensureCustomer, receiptNo, rates.date, refresh, computeNextParchiNo, refreshDraftsCache])

  // Stage 6 — open a fresh, blank parchi at the next receipt number. ALWAYS opens
  // immediately (no confirm/prompt). Crucially it does NOT discard the parchi you
  // were on: the current unsaved parchi is first PARKED (flushed to its draft row,
  // reachable again via ◀), then a clean blank parchi opens. New never touches the
  // ledger — nothing is committed to the record until Save is pressed.
  const newParchi = useCallback(async () => {
    // Park the CURRENT parchi first — EMPTY OR NOT (force): an empty parchi is
    // legitimate, keeps its slot/number, and stays reachable via ◀ — never
    // deleted, never reused. Park ONLY while composing (openReceiptNo == null):
    // when VIEWING a saved receipt there is nothing to park (it already lives
    // in the DB), and draftSeqRef could still point at the LAST draft composed
    // — a blind flush here would overwrite that parked draft's row with this
    // saved receipt's on-screen data (loadReceipt also detaches, belt+braces).
    if (openReceiptNo == null) await flushDraft({ force: true })
    // Then a fresh blank at the next UNUSED number — computeNextParchiNo skips
    // numbers held by saved receipts AND by every parked draft (including the
    // one just parked), so نئی پرچی can NEVER open/reuse an existing parchi.
    await blankWorkbench()
    // blankWorkbench() itself sets draftSeq(null), so this fresh blank starts
    // fully detached from whatever row the parchi we just left ended up with.
  }, [openReceiptNo, flushDraft, blankWorkbench])

  // Stage 1 — one-time fresh start: clear all transactions/receipts, numbering → 1.
  const resetData = useCallback(async () => {
    if (hasApi) await window.api.resetTransactions()
    setReceiptNo(1)
    setSavedFlags(NO_SAVED)
    refresh()
  }, [refresh])

  // Add an expense (کھرچہ): writes to the expenses table (so it shows in reports)
  // and refresh()es so the bottom-bar cash DISPLAY re-derives (cash − today's
  // expenses). Does NOT touch any cash transaction / ledger balance.
  const addExpense = useCallback(async (e) => {
    if (hasApi) await window.api.addExpense(e)
    refresh()
    return { ok: true }
  }, [refresh])

  // Edit / delete a single expense (from the اخراجات reports). Both refresh() so
  // the bottom-bar cash DISPLAY re-derives immediately: if an expense dated today
  // is increased, today's cash shown drops by that much; delete restores it.
  const editExpense = useCallback(async (id, fields) => {
    if (hasApi) await window.api.updateExpense(id, fields)
    refresh()
    return { ok: true }
  }, [refresh])

  const removeExpense = useCallback(async (id) => {
    if (hasApi) await window.api.deleteExpense(id)
    refresh()
    return { ok: true }
  }, [refresh])

  // Delete ALL expenses (fresh start). Reports go empty; refresh() re-derives the
  // cash display (today's expenses → 0). Only the expenses table is cleared.
  const resetExpensesData = useCallback(async () => {
    if (!hasApi) return { ok: false }
    const res = await window.api.resetExpenses()
    refresh()
    return res || { ok: true }
  }, [refresh])

  // Manual bottom-bar balance adjustment (اندراج): inserts a ONE-SHOT 'adjustment'
  // transaction (never a persisted setting → never re-applies), refresh()es the
  // bottom bar, and returns the resulting bottom-bar totals so the modal can show
  // the new value. target 'cash' → کیش, 'gold' → تیزابی; direction 'in'/'out'.
  const addAdjustment = useCallback(async ({ target, direction, amount, note }) => {
    if (!hasApi) return { ok: false }
    const res = await window.api.addAdjustment({ target, direction, amount, note })
    refresh() // bottom bar re-derives from getShopTotals
    let fresh = null
    try { fresh = await window.api.getShopTotals() } catch {}
    return {
      ok: !!(res && res.ok),
      newCash: fresh ? (Number(fresh.cash) || 0) - expensesUpToDate : null, // matches bottom-bar کیش
      newTezabi: fresh ? (Number(fresh.tezabi_sona) || 0) : null
    }
  }, [refresh, expensesUpToDate])

  // Stage 4/5 — fetch a filtered customer report ({ rows, total_gold, total_cash }).
  const getReport = useCallback(async (opts) => {
    if (!hasApi) return { rows: [], total_gold: 0, total_cash: 0 }
    return await window.api.getReport(opts)
  }, [])

  // Group-1 balance report: one aggregated row per customer for a category.
  const getReportGroup1 = useCallback(async (opts) => {
    if (!hasApi) return { rows: [], total_gold: 0, total_cash: 0 }
    return await window.api.reportGroup1(opts)
  }, [])

  // اندراج رپورٹ: all manual adjustment transactions (the one place they show).
  const getAdjustmentsReport = useCallback(async (opts) => {
    if (!hasApi) return { rows: [] }
    return (await window.api.getAdjustmentsReport(opts)) || { rows: [] }
  }, [])

  // Part 1 — edit / delete a saved transaction. Both refresh() so balances +
  // any open report re-query immediately.
  const editTransaction = useCallback(async (id, fields) => {
    if (hasApi) await window.api.updateTransaction(id, fields)
    refresh()
    return { ok: true }
  }, [refresh])

  const removeTransaction = useCallback(async (id) => {
    if (hasApi) await window.api.deleteTransaction(id)
    refresh()
    return { ok: true }
  }, [refresh])

  // Part 2 — record a settlement / return. Creates a NEW opposite-direction
  // transaction (tagged meta.settle) for the customer; the original is untouched.
  // kind: 'gold' | 'cash'; direction: 'in' (we receive) | 'out' (we give).
  const recordSettle = useCallback(async ({ customer: cust, kind, direction, amount, note }) => {
    const amt = Number(amount) || 0
    if (!(amt > 0)) return { ok: false, message: 'رقم / مقدار درج کریں' }
    let c = cust
    if ((!c || !c.id) && c && c.name && String(c.name).trim() && hasApi) {
      c = await window.api.upsertCustomer({ name: String(c.name).trim() })
    }
    if (!c || !c.id) return { ok: false, message: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }
    const category = kind === 'gold'
      ? (direction === 'in' ? 'gold_take' : 'gold_give')
      : (direction === 'in' ? 'cash_take' : 'cash_give')
    const t = { kind: 'udhar', direction, category, note: note || 'قسط/واپسی', meta: { settle: true } }
    if (kind === 'gold') { t.sona_wazan = amt; t.point = 100; t.khalis_sona = amt } else t.cash_amount = amt
    const rno = receiptNo
    if (hasApi) await window.api.settleTransaction({ receipt_no: rno, customer_id: c.id, date: rates.date, ...t })
    refresh()
    // Draft-aware advance (parked drafts occupy their numbers; see saveUdharTxn).
    if (hasApi) {
      const n = await computeNextParchiNo()
      if (n) setReceiptNo(n)
      // Same unique-parchi guard as saveUdharTxn: rno is now SAVED — move any
      // composing parked draft off it immediately.
      if (n && draftSeqRef.current != null && formSnapshotRef.current) {
        try {
          await window.api.upsertDraft(draftSeqRef.current, { ...formSnapshotRef.current.snap, receiptNo: n })
          await refreshDraftsCache()
        } catch { /* the debounce re-parks with the new number anyway */ }
      }
    } else {
      setReceiptNo((r) => r + 1)
    }
    return { ok: true, receipt_no: rno }
  }, [receiptNo, rates.date, refresh, computeNextParchiNo, refreshDraftsCache])

  const value = {
    screen, setScreen,
    rates, saveRates,
    receiptNo, setReceiptNo,
    customer, setCustomer, newCustomer, saveCustomer,
    totals, refresh, bump,
    cashDisplay, addExpense, editExpense, removeExpense, resetExpensesData, addAdjustment,
    cashSell, setCashSell,
    cashBuy, setCashBuy,
    udharGive, setUdharGive,
    udharTake, setUdharTake,
    udharCashGive, setUdharCashGive,
    udharCashTake, setUdharCashTake,
    udharComment, setUdharComment,
    loadReceipt, loadReceiptNo, searchReceiptNo,
    openReceiptNo,
    hasPrevReceipt: receiptBounds.hasPrev,
    hasNextReceipt: receiptBounds.hasNext,
    gotoFirstReceipt, gotoLastReceipt, gotoNextReceipt, gotoPrevReceipt,
    addTransaction,
    saveParchi, saveUdharTxn, newParchi, resetData, getReport, getReportGroup1, getAdjustmentsReport,
    editTransaction, removeTransaction, recordSettle,
    savedFlags, setSavedFlags,
    udharOpen, openUdhar, closeUdhar,
    akhrajatOpen, openAkhrajat, closeAkhrajat,
    printSlips,
    shareSlipWhatsApp,
    hasApi
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
