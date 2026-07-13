import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, round, GRAMS_PER_TOLA, GRAMS_PER_RATTI, gramsToTMR } from '../logic/units.js'
import { useClock } from '../logic/useClock.js'
import NayaSoda from './NayaSoda.jsx'

// Slip-template cell builders (match electron/rasterPrint.cjs buildReceiptHtml):
// L = a bordered Urdu LABEL cell, V = a bordered value cell. Each receipt builds
// its rows with these and passes { title, tables } to ctx.printSlips so every
// printed receipt shares the ONE approved design. opts: { box, s (colspan),
// wrap (long names), u (Nastaliq value) }.
// L's second argument is either a colspan (number) or an opts object, so the
// existing L('نام', 3) call sites keep working alongside L('گرام', { ... }).
const L = (l, o) => Object.assign({ l }, typeof o === 'number' ? { s: o } : (o || {}))
const V = (v, o) => Object.assign({ v: v == null || v === '' ? '-' : String(v) }, o || {})

// AM/PM time string from a live Date (passed in so the component re-renders).
const fmtTime = (d) => {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

const dispDate = (iso) => {
  const p = String(iso || '').split('-')
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0].slice(2)}` : iso
}

// yyyy-mm-dd for a live Date, so it can flow through dispDate().
const isoFrom = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Date shown on receipts: the user-entered receipt date if set, else live today.
const showDate = (rates, now) => (rates.date ? dispDate(rates.date) : dispDate(isoFrom(now)))

function Row({ label, value, strong, red, yellow }) {
  return (
    <div className="flex justify-between items-center border-b border-dotted border-slate-200 px-1 py-[1px]">
      {yellow ? (
        <span className="bg-yellowCell border border-line text-[10px] text-center min-w-[70px] px-1 leading-tight">
          {value ?? '-'}
        </span>
      ) : (
        <span className={`urdu text-[10px] ${strong ? 'font-bold' : ''} ${red ? 'text-red-600' : ''}`}>
          {value ?? '-'}
        </span>
      )}
      {/* rcpt-label: keep bold on screen; print CSS neutralizes it — do not
          revert during styling work. */}
      <span className={`urdu text-[10px] ${red ? 'text-red-600 font-bold' : 'rcpt-label font-bold text-black'}`}>{label} :</span>
    </div>
  )
}

// Value renderer that NEVER overflows its box. Numbers (and dates) shrink their
// font-size to fit — so digits are never lost — while plain text (names) is
// truncated with an ellipsis. The element fills its parent (`w-full`, one line),
// and we shrink until scrollWidth ≤ clientWidth. Because the design canvas is a
// fixed size that FitScreen only CSS-transforms, these measurements are stable
// regardless of window size, so a single layout pass on value change suffices.
function FitValue({ value, align = 'right', strong, red, min = 6, fit = false, autoWidth = false }) {
  const ref = useRef(null)
  const raw = value === null || value === undefined || value === '' ? '-' : String(value)
  // Digits plus number/date punctuation only → treat as numeric (shrink, keep all
  // digits). Anything with letters (names) → text (ellipsis is acceptable there).
  // `fit` forces shrink-to-fit even when letters are present (e.g. a date that
  // carries an AM/PM time), so nothing is ever ellipsised away.
  const numeric = /\d/.test(raw) && /^[\d.,:\-−()%/\s]+$/.test(raw)
  const doFit = fit || numeric

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = '' // reset to the inherited size before measuring
    if (!doFit || !el.clientWidth) return
    let size = parseFloat(getComputedStyle(el).fontSize) || 10
    let guard = 0
    while (el.scrollWidth > el.clientWidth && size > min && guard < 40) {
      size -= 0.5
      el.style.fontSize = `${size}px`
      guard++
    }
  }, [raw, doFit, min])

  const alignCls = align === 'center' ? 'text-center' : align === 'left' ? 'text-left' : 'text-right'
  return (
    <span
      ref={ref}
      dir="ltr"
      // autoWidth: shrink-wrap to the number (inline-block, capped at the box) so a
      // small value gets a small box; default: fill the box (block w-full).
      className={`${autoWidth ? 'inline-block max-w-full' : 'block w-full'} whitespace-nowrap overflow-hidden ${doFit ? '' : 'text-ellipsis'} ${alignCls} ${strong ? 'font-bold' : 'font-semibold'} ${red ? 'text-red-600' : ''}`}
    >
      {raw}
    </span>
  )
}

// One label:value field for the two-column receipt forms. The row is RTL, so the
// label pins to the RIGHT edge and its value box to the LEFT edge, with the empty
// space between them — the value reads ACROSS FROM its label rather than crammed
// up beside it.
//
// That spacing is why the value box hugs its content (max-w-full) instead of
// filling the row (flex-1): a flex-1 box eats all the free space, leaving
// justify-between nothing to distribute, and a right-aligned value inside it
// lands back against the label. Every row used to render that way; only the
// balance rows opted out of it.
//
// Values can never spill the panel border: min-w-0 lets the box shrink,
// overflow-hidden clips, and FitValue keeps numbers readable (shrink-to-fit) and
// text tidy (ellipsis).
//
// redBox: SCREEN-ONLY alert styling on the VALUE BOX only (light red bg / white
// text) via the redbox-value class — the label stays a normal label, and both
// print pipelines override the box back to black-on-clear.
// `tight` opts a row OUT of that: the box goes back to filling the row (flex-1)
// with the value right-aligned inside it, so the value sits immediately beside
// its label. رسید نمبر uses it — a receipt number reads as part of its label,
// not as a figure to be scanned down a column.
function Fld({ label, value, yellow, red, strong, fit, redBox, tight }) {
  const boxSize = tight ? 'flex-1 min-w-0 overflow-hidden' : 'max-w-full min-w-0 overflow-hidden'
  return (
    <div className={`flex items-center gap-1 w-full min-w-0 px-2 border-b border-dotted border-slate-200 min-h-[19px] ${tight ? '' : 'justify-between'}`}>
      {/* rcpt-label: keep bold on screen; print CSS neutralizes it — do not
          revert during styling work. */}
      <span dir="rtl" className={`urdu shrink-0 whitespace-nowrap ${yellow ? 'text-[9px]' : 'text-[10px]'} ${red ? 'text-red-600 font-bold' : 'rcpt-label font-bold text-black'}`}>
        {label} :
      </span>
      {yellow ? (
        <div className={`bg-yellowCell border border-line text-[9px] leading-tight px-2 py-[1px] box-border ${boxSize}${redBox ? ' redbox-value' : ''}`}>
          <FitValue value={value} align="right" fit={fit} autoWidth={!tight} />
        </div>
      ) : (
        <div className={`text-[10px] ${boxSize} ${red ? 'text-red-600' : ''}`}>
          <FitValue value={value} align="right" strong={strong} red={red} fit={fit} autoWidth={!tight} />
        </div>
      )}
    </div>
  )
}

// A form line carrying a right field and (optionally) a left field — the
// two-column label/value grid the نقد / ادھار receipts are built from.
function FLine({ right, left, mid }) {
  return (
    <div dir="rtl" className="flex items-stretch">
      <div className="flex-1 min-w-0">{right ? <Fld {...right} /> : null}</div>
      {mid ? <div className="flex-1 min-w-0"><Fld {...mid} /></div> : null}
      <div className="flex-1 min-w-0">{left ? <Fld {...left} /> : null}</div>
    </div>
  )
}

// Reusable raised action button — consistent look/size across the receipts.
// variant: undefined (grey) | 'green' (WhatsApp) | 'red' (X).
function Btn({ children, onClick, variant, title, className = '' }) {
  const v = variant === 'green' ? 'abtn-green' : variant === 'red' ? 'abtn-red' : ''
  return (
    <button type="button" title={title} onClick={onClick} className={`abtn ${v} ${className}`}>
      {children}
    </button>
  )
}

// "Saved" confirmation tick under a receipt — auto-checks after a successful DB
// save of that section (driven by the store's savedFlags; read-only for the user).
function SavedChk({ on }) {
  return (
    <label className="flex items-center gap-1 text-[10px] urdu cursor-default">
      <input type="checkbox" checked={!!on} readOnly className={on ? 'accent-emerald-600' : ''} />
      {on ? 'محفوظ ✓' : 'Saved'}
    </label>
  )
}

function ActionBar({ children, onWa, onPrint }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-1 mt-1 px-1 pb-1">
      {children}
      <div className="flex-1 min-w-0" />
      <Btn variant="green" onClick={onWa}>WhatsApp</Btn>
      <Btn title="پرنٹ" onClick={onPrint}>🖨</Btn>
    </div>
  )
}

const waOpen = (mobile, text) => {
  const num = String(mobile || '').replace(/[^0-9]/g, '')
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`
  if (typeof window !== 'undefined') window.open(url, '_blank')
}

// WhatsApp a receipt AS THE PRINTED SLIP IMAGE: the store's shareSlipWhatsApp
// copies the slip picture to the clipboard and opens the chat (operator pastes
// with Ctrl+V). Falls back to the old text-only link when the share helper is
// unavailable (e.g. embedded statement ctx) — the button can never break.
const waSlip = (ctx, e, mobile, text) => {
  const panel = e && e.currentTarget ? e.currentTarget.closest('.receipt-panel') : null
  if (ctx && typeof ctx.shareSlipWhatsApp === 'function' && panel) ctx.shareSlipWhatsApp(panel, mobile, text)
  else waOpen(mobile, text)
}

// ── Receipt label text — the SINGLE source of truth ─────────────────────────
// Each receipt is rendered TWICE from the same computed values: once as JSX (the
// on-screen panel) and once as `slipData` (the printed slip, rendered by
// electron/rasterPrint.cjs buildReceiptHtml). The VALUES already come from the
// same variables, so they cannot disagree — but the LABELS used to be typed out
// separately in each place, and they had already drifted (print said "کیش دیا"
// where the screen said "کیش۔ دیا").
//
// Both renderers now read their label text from here, so screen and slip can
// never say different things again. Change a label once and it changes in both.
const UDHAR_L = {
  receiptNo: 'رسید نمبر',
  date: 'تاریخ',
  name: 'نام',
  give: 'تیزابی دیا',
  take: 'تیزابی لیا',
  note: 'نوٹ',
  baqi: 'باقی',
  prevGold: 'سابقہ چاندی بیلنس',
  goldDena: 'باقی تیزابی دینا ہے',
  goldLena: 'باقی تیزابی لینا ہے',
  cashGive: 'کیش۔ دیا',
  cashTake: 'کیش۔ لیا',
  prevCash: 'سابقہ کیش بیلنس',
  cashDena: 'باقی کیش دینا ہے',
  cashLena: 'باقی کیش لینا ہے'
}
const NAQAD_L = {
  receiptNo: 'رسید نمبر',
  date: 'تاریخ',
  name: 'نام',
  ratePerTola: 'ریٹ فی تولہ',
  ratePerGram: 'ریٹ فی گرام',
  ratti: 'رتی',
  masha: 'ماشہ',
  tola: 'تولہ',
  wazanCol: 'وزن',
  wazan: 'چاندی وزن',
  total: 'کل قیمت',
  paid: 'رقم دی'
}
// The نقد panel's sub-heading (under the title bar) — printed as the slip's first
// row so the slip carries the same خرید/فروخت wording the screen shows.
const naqadSubtitle = (kind) => `رسید چاندی ${kind}`

// Receipt card header. Keeps the `panel-title` class — the print pipeline's CSS
// targets `.print-area .receipt-panel .panel-title` and would otherwise lose the
// title's print sizing — but repaints it as the same muted slate strip the other
// cards use (bg-none kills panel-title's raised grey gradient) with a hairline
// divider beneath. Styling only: the title TEXT is unchanged.
const RCPT_HEAD =
  'panel-title urdu bg-none bg-headStrip text-headText font-bold text-[13px] border-0 border-b border-headBorder py-1.5'

// Two-column credit-receipt helpers: each side is a {label,value,yellow} field,
// a bare value {bare:true,value} (right-aligned, no label), or null (empty cell).
function CSide({ f }) {
  if (!f) return <div className="flex-1 min-w-0" />
  if (f.bare)
    return (
      <div className="flex-1 min-w-0 px-2 border-b border-dotted border-slate-200 min-h-[19px] flex items-center overflow-hidden text-[10px]">
        <FitValue value={f.value} align="right" fit={f.fit} />
      </div>
    )
  return <div className="flex-1 min-w-0"><Fld {...f} /></div>
}
function CRow({ right, left }) {
  return (
    <div dir="rtl" className="flex items-stretch">
      <CSide f={right} />
      <CSide f={left} />
    </div>
  )
}

/* 3) ادھار کی رسید — Credit Receipt */
export function CreditReceipt({ ctx, embed }) {
  const { customer, receiptNo, rates, bump, hasApi,
    udharGive, udharTake, udharCashGive, udharCashTake, udharComment } = ctx
  const now = useClock()
  const [ledFetched, setLed] = useState({ balance_gold: 0, balance_cash: 0 })
  useEffect(() => {
    // ctx.ledger injected (e.g. the customer statement passes each parchi's OWN
    // running/cumulative balance) → use it as-is, never fetch the live grand total.
    if (ctx.ledger) return
    if (hasApi && customer.id)
      // Balance of the parchis numbered BEFORE this one — i.e. سابقہ itself, straight
      // from the DB (see the getCustomerLedger note in db.cjs). Keyed on the parchi's
      // own number, so it reads the same whether this parchi is a fresh unsaved one,
      // just saved, or navigated back to later.
      window.api.getCustomerLedger(customer.id, receiptNo)
        .then((l) => setLed(l || { balance_gold: 0, balance_cash: 0 }))
    else setLed({ balance_gold: 0, balance_cash: 0 })
  }, [customer.id, bump, hasApi, ctx.ledger, receiptNo])
  const led = ctx.ledger || ledFetched

  // Live ادھار transaction figures — same ratti-scale formula as the panel's
  // GoldRow. null when a gold row's wazan is empty so the field shows '-'.
  const calcGold = (st) => {
    if (!st) return null
    const wazan = Number(st.wazan) || 0
    if (wazan <= 0) return null
    const point = Number(st.point) || 0
    const above = point - 100
    const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
    const khalis = round(wazan - deduction, 3)
    const rate = st.rate === '' ? (Number(rates.rate_tezabi_tola) || 0) : Number(st.rate)
    const qeemat = round(khalis / GRAMS_PER_TOLA * rate, 0)
    return { wazan, khalis, rate, qeemat, tmr: gramsToTMR(khalis) }
  }
  const gGive = udharGive ? calcGold(udharGive) : null // metal given
  const gTake = udharTake ? calcGold(udharTake) : null // metal taken
  const cGive = Number(udharCashGive) || 0
  const cTake = Number(udharCashTake) || 0
  // This transaction's net (give − take); previous ledger balance + net = new باقی.
  const netGold = (gGive?.khalis || 0) - (gTake?.khalis || 0)
  const netCash = cGive - cTake
  // سابقہ = the ledger with THIS parchi left out, so it is already "what the customer
  // owed before this parchi" — no arithmetic, no assumption. It used to be derived as
  // (full balance − this parchi's live form net), which silently assumed the ledger
  // already contained exactly what the form shows. It doesn't the moment you type a
  // new entry onto an ALREADY-SAVED parchi: the ledger has no such row yet, so the
  // subtraction ran backwards and سابقہ went negative on a customer's first receipt
  // (تیزابی دیا 34 → سابقہ −34). The parchi is excluded server-side instead.
  const prevGold = led?.balance_gold || 0
  const prevCash = led?.balance_cash || 0
  // Final = previous + this parchi's net. Adding the live form net is now always
  // right (never double-counts) precisely because prev never contains this parchi.
  // Shop convention: net > 0 -> customer owes YOU -> "لینا"; net < 0 -> "دینا".
  const finalGold = prevGold + netGold
  const finalCash = prevCash + netCash
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  // Printed ادھار کی رسید (shared approved template). Same values the form shows.
  const slipData = {
    title: 'ادھار کی رسید',
    tables: [
      [[L(UDHAR_L.receiptNo), V(receiptNo), L(UDHAR_L.date), V(`${fmtTime(now)}  ${showDate(rates, now)}`)]],
      [
        [L(UDHAR_L.name), V(customer.id ? (customer.name || '-') : '-', { wrap: true, s: 3 })],
        [L(UDHAR_L.give), V(gGive ? fmtNum(gGive.wazan) : '-', { s: 3 })],
        [L(UDHAR_L.take), V(gTake ? fmtNum(gTake.wazan) : '-', { s: 3 })],
        // The collector's name / note kept its own line (it used to share the row
        // with پوائنٹ). Omitted entirely when blank — exactly like the screen — so
        // no empty row is printed.
        ...(udharComment ? [[L(UDHAR_L.note), V(udharComment, { wrap: true, s: 3 })]] : []),
        [L(UDHAR_L.baqi), V(netGold ? fmtNum(netGold) : '-', { s: 3 })],
        [L(UDHAR_L.prevGold), V(customer.id ? fmtNum(prevGold) : '-', { s: 3 })],
        [L(UDHAR_L.goldDena), V(finalGold < 0 ? fmtNum(Math.abs(finalGold)) : '-', { box: finalGold < 0 }), L(UDHAR_L.goldLena), V(finalGold > 0 ? fmtNum(finalGold) : '-', { box: finalGold > 0 })]
      ],
      [
        [L(UDHAR_L.cashGive), V(cGive ? fmtMoney(cGive) : '-'), L(UDHAR_L.cashTake), V(cTake ? fmtMoney(cTake) : '-')],
        [L(UDHAR_L.baqi), V(netCash ? fmtMoney(netCash) : '-', { s: 3 })],
        [L(UDHAR_L.prevCash), V(customer.id ? fmtMoney(prevCash) : '-', { s: 3 })],
        [L(UDHAR_L.cashDena), V(finalCash < 0 ? fmtMoney(Math.abs(finalCash)) : '-', { box: finalCash < 0 }), L(UDHAR_L.cashLena), V(finalCash > 0 ? fmtMoney(finalCash) : '-', { box: finalCash > 0 })]
      ]
    ]
  }
  return (
    // `receipt-panel` MUST stay on the root: the print pipeline's CSS is scoped to
    // it and waSlip/printSlips find the panel with closest('.receipt-panel').
    // `card` only adds the surface (white / hairline / rounded / column flex).
    <div data-receipt="udhar" className="receipt-panel card h-full">
      <div className={RCPT_HEAD}>ادھار کی رسید</div>
      {/* The card is half the screen wide, but a label:value receipt row reads badly
          stretched across that — the label ends up marooned from its value by a long
          dotted rule. Cap the CONTENT column and centre it; the CARD still fills its
          half, so both receipts stay equal width and aligned.
          min-h-0: without it a flex child keeps min-height:auto and refuses to shrink
          below its rows' natural height, so the column grew straight through the card
          and the last rows printed on top of the action bar beneath it. With it the
          rows compress (down to their own 19px floor) and stay inside the card. */}
      <div className="flex-1 min-h-0 w-full max-w-[470px] mx-auto px-2 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ */}
        <R>
          <FLine
            right={{ label: UDHAR_L.receiptNo, value: receiptNo, tight: true }}
            left={{ label: UDHAR_L.date, value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true, fit: true }}
          />
        </R>
        <R><Fld label={UDHAR_L.name} value={customer.id ? (customer.name || '-') : '-'} /></R>

        {/* ---- Metal block ---- خالص وزن and پوائنٹ removed: Silver is traded by
            pure weight, so خالص وزن always equalled تیزابی دیا/لیا and پوائنٹ was
            always 100. Each entry now takes the full row width; the R wrappers are
            flex-1, so the remaining rows expand to absorb the freed height and no
            gap is left behind. */}
        <R><Fld label={UDHAR_L.give} value={gGive ? fmtNum(gGive.wazan) : '-'} /></R>
        <R><Fld label={UDHAR_L.take} value={gTake ? fmtNum(gTake.wazan) : '-'} /></R>
        {/* Collector name / note — its own line now (it used to share the پوائنٹ
            row). Rendered only when present, so no empty row is left. */}
        {udharComment && <R><Fld label={UDHAR_L.note} value={udharComment} fit /></R>}
        <R><Fld label={UDHAR_L.baqi} value={netGold ? fmtNum(netGold) : '-'} /></R>
        {/* سابقہ = what this customer already owed BEFORE this parchi. On their very
            first parchi there is no history, so it must read '-', not a balance of
            zero. fmtNum already maps 0 → '-'; fmtMoney does NOT (it renders "0"), so
            the cash side needs the truthiness check its metal twin gets for free. */}
        <R><Fld label={UDHAR_L.prevGold} value={customer.id && prevGold ? fmtNum(prevGold) : '-'} /></R>
        {/* A باقی ... دینا/لینا ہے figure is a claim against a PERSON, so it needs one:
            with no customer picked there is no سابقہ balance to settle against, and
            these rows used to quietly report the entry's own amount as if it were owed.
            Gated on customer.id, the same way سابقہ چاندی/کیش بیلنس above already is. */}
        <R><Fld label={UDHAR_L.goldDena} value={customer.id && finalGold < 0 ? fmtNum(Math.abs(finalGold)) : '-'} yellow redBox /></R>
        <R><Fld label={UDHAR_L.goldLena} value={customer.id && finalGold > 0 ? fmtNum(finalGold) : '-'} yellow /></R>

        <div className="border-t border-slate-200 my-[1px]" />

        {/* ---- Cash block ---- کیش دیا / کیش لیا get a FULL row each, mirroring
            تیزابی دیا / تیزابی لیا above. They used to share one CRow line, which
            left each field only half the width: the amount was squeezed hard up
            against its label while the rest of the row sat empty. Full-width rows
            let the value spread away from the label, the way the نقد receipt reads.
            SCREEN ONLY — slipData (the printed slip) still emits them on one line. */}
        <R><Fld label={UDHAR_L.cashGive} value={cGive ? fmtMoney(cGive) : '-'} /></R>
        <R><Fld label={UDHAR_L.cashTake} value={cTake ? fmtMoney(cTake) : '-'} /></R>
        <R><Fld label={UDHAR_L.baqi} value={netCash ? fmtMoney(netCash) : '-'} /></R>
        <R><Fld label={UDHAR_L.prevCash} value={customer.id && prevCash ? fmtMoney(prevCash) : '-'} /></R>
        <R><Fld label={UDHAR_L.cashDena} value={customer.id && finalCash < 0 ? fmtMoney(Math.abs(finalCash)) : '-'} yellow redBox /></R>
        <R><Fld label={UDHAR_L.cashLena} value={customer.id && finalCash > 0 ? fmtMoney(finalCash) : '-'} yellow /></R>
      </div>
      {!embed && (
        <ActionBar
          onWa={(e) => waSlip(ctx, e, customer.mobile, `ادھار رسید\nنام: ${customer.id ? customer.name : ''}\nباقی چاندی: ${fmtNum(led?.balance_gold)}\nباقی کیش: ${fmtMoney(led?.balance_cash)}`)}
          onPrint={(e) => ctx.printSlips(e.currentTarget.closest('.receipt-panel'), slipData)}
        >
          <SavedChk on={ctx.savedFlags?.udhar} />
          {/* Full page reload — re-reads saved SQLite data from disk. Trade-off:
              discards any UNSAVED parchi being composed on screen (intended). */}
          <Btn onClick={() => window.location.reload()}>Refresh</Btn>
        </ActionBar>
      )}
    </div>
  )
}

/* 4) نقد کی رسید — Cash Receipt (رسید چاندی خرید) */
export function CashReceipt({ ctx, embed }) {
  const { customer, receiptNo, rates, cashSell, cashBuy } = ctx
  const now = useClock()
  // Active نقد entry = whichever of فروخت / خرید has a non-zero چاندی وزن. Its
  // figures use the SAME ratti-scale formula as the نقد panel's GoldRow.
  const active = (Number(cashSell.wazan) > 0) ? { ...cashSell, kind: 'فروخت' }
               : (Number(cashBuy.wazan) > 0) ? { ...cashBuy, kind: 'خرید' }
               : null

  let v = null
  if (active) {
    const wazan = Number(active.wazan) || 0
    // khalis is still derived from `point` — NOT dropped. Silver always carries
    // point = 100, so khalis === wazan and the two are interchangeable on screen;
    // but قیمت is priced off khalis in store.jsx's save path, so computing it the
    // same way here is what keeps the printed قیمت equal to the STORED qeemat.
    // Only the DISPLAY of پوائنٹ / خالص وزن is gone.
    const point = Number(active.point) || 0
    const above = point - 100
    const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
    const khalis = round(wazan - deduction, 3)
    const rate = active.rate === '' ? (Number(rates.rate_tezabi_tola) || 0) : Number(active.rate)
    const qeemat = round(khalis / GRAMS_PER_TOLA * rate, 0)
    v = { wazan, rate, qeemat, kind: active.kind, grossTMR: gramsToTMR(wazan) }
  }
  // Mini TMR band grid (RTL right->left): tick | label | value | رتی | ماشہ | تولہ.
  // The first 30px column used to hold پوائنٹ (label + value); with پوائنٹ gone it
  // now carries only the manual tick box in the header row, so the column width and
  // therefore the whole band's geometry are unchanged. columnGap keeps adjacent
  // cells from abutting so the Urdu labels don't read as merged. value is a fixed
  // 64px so the label 1fr absorbs the slack; رتی is 34px so "5.76" never clips.
  const tmrGrid = { gridTemplateColumns: '30px 1fr 64px 34px 28px 28px', columnGap: 4 }
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  // Printed نقد کی رسید (shared approved template). Same values the form shows.
  const slipData = {
    // Title bar = the panel title, exactly as on screen. The خرید/فروخت sub-heading
    // the panel shows beneath it is printed as the first row below, so the slip
    // carries the same two lines of wording rather than mashing them together.
    title: 'نقد کی رسید',
    tables: [
      [[V(naqadSubtitle(v ? v.kind : 'خرید'), { u: true, s: 4 })]],
      [[L(NAQAD_L.receiptNo), V(receiptNo), L(NAQAD_L.date), V(`${fmtTime(now)}  ${showDate(rates, now)}`)]],
      [
        [L(NAQAD_L.name), V(customer.id ? (customer.name || '-') : '-', { wrap: true, s: 3 })],
        [L(NAQAD_L.ratePerTola), V(v ? fmtMoney(v.rate) : (rates.rate_tezabi_tola ?? '-')), L(NAQAD_L.ratePerGram), V(v ? fmtMoney(round(v.rate / GRAMS_PER_TOLA, 0)) : '-')]
      ],
      // خالص وزن and پوائنٹ rows removed — خالص وزن always equalled چاندی وزن and
      // پوائنٹ was always 100. چاندی وزن keeps its tola/ماشہ/رتی breakdown.
      [
        [L(''), L(NAQAD_L.ratti), L(NAQAD_L.masha), L(NAQAD_L.tola), L(NAQAD_L.wazanCol)],
        [L(NAQAD_L.wazan), V(v ? fmtNum(v.grossTMR.ratti, 2) : '-'), V(v ? fmtNum(v.grossTMR.masha, 0) : '-'), V(v ? fmtNum(v.grossTMR.tola, 0) : '-'), V(v ? fmtNum(v.wazan) : '-')]
      ],
      [
        [L(NAQAD_L.total), V(v ? fmtMoney(v.qeemat) : '-', { box: true, s: 3 })],
        [L(NAQAD_L.paid), V(v ? fmtMoney(v.qeemat) : '-', { s: 3 })]
      ]
    ]
  }
  return (
    <div data-receipt="naqad" className="receipt-panel card h-full">
      <div className={RCPT_HEAD}>نقد کی رسید</div>
      <div className="urdu text-center text-[12px] font-bold py-[2px] text-black border-b border-dotted border-slate-300">{naqadSubtitle(v ? v.kind : 'خرید')}</div>
      {/* Same content-column cap as the ادھار receipt, so the two cards' rows line
          up with each other. */}
      <div className="flex-1 w-full max-w-[470px] mx-auto px-2 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ on one row */}
        <R>
          <FLine
            right={{ label: NAQAD_L.receiptNo, value: receiptNo, tight: true }}
            left={{ label: NAQAD_L.date, value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true, fit: true }}
          />
        </R>
        {/* نام full width */}
        <R><Fld label={NAQAD_L.name} value={customer.id ? (customer.name || '-') : '-'} /></R>
        {/* ریٹ فی تولہ + ریٹ فی گرام on one row */}
        <R>
          <FLine
            right={{ label: NAQAD_L.ratePerTola, value: v ? fmtMoney(v.rate) : (rates.rate_tezabi_tola ?? '-') }}
            left={{ label: NAQAD_L.ratePerGram, value: v ? fmtMoney(round(v.rate / GRAMS_PER_TOLA, 0)) : '-' }}
          />
        </R>

        {/* TMR header: checkbox (right) + تولہ|ماشہ|رتی(red) */}
        <R>
          <div className="grid items-center mt-[1px]" style={tmrGrid}>
            <div className="flex"><input type="checkbox" className="scale-90" /></div>
            <div></div>
            <div></div>
            <div dir="rtl" className="urdu text-[9px] text-red-600 text-center">{NAQAD_L.ratti}</div>
            <div dir="rtl" className="urdu text-[9px] text-center">{NAQAD_L.masha}</div>
            <div dir="rtl" className="urdu text-[9px] text-center">{NAQAD_L.tola}</div>
          </div>
        </R>
        {/* چاندی وزن row. The leading 30px cell (which carried the پوائنٹ label,
            and below it the پوائنٹ value on the now-deleted خالص وزن row) is left
            empty so the band keeps its exact column geometry under the tick box.
            The خالص وزن row is gone — it always repeated چاندی وزن. */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div />
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">{NAQAD_L.wazan} :</div>
            <div className="text-[10px] text-center border-b border-slate-300" dir="ltr">{v ? fmtNum(v.wazan) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.ratti, 2) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.masha, 0) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.tola, 0) : '-'}</div>
          </div>
        </R>

        {/* کل قیمت / رقم دی — the receipt's final figures, in a tinted highlight
            strip pinned under the rows above (mt-auto). Wrapper only: both rows are
            the same <Fld> with the same labels and the same values as before.
            shrink-0 + natural height, so the strip hugs its two rows instead of
            claiming a share of the panel's spare height. */}
        <div className="rcpt-total mt-auto shrink-0 py-1">
          <Fld label={NAQAD_L.total} value={v ? fmtMoney(v.qeemat) : '-'} />
          <Fld label={NAQAD_L.paid} value={v ? fmtMoney(v.qeemat) : '-'} />
        </div>
      </div>
      {!embed && (
        <div className="no-print flex flex-wrap items-center gap-1 px-1 pb-1">
          <SavedChk on={ctx.savedFlags?.naqad} />
          <div className="flex-1 min-w-0" />
          <Btn variant="green"
            onClick={(e) => waSlip(ctx, e, customer.mobile, `نقد رسید ${receiptNo}\nنام: ${customer.id ? customer.name : ''}`)}>WhatsApp</Btn>
          <Btn title="پرنٹ" onClick={(e) => ctx.printSlips(e.currentTarget.closest('.receipt-panel'), slipData)}>🖨</Btn>
        </div>
      )}
    </div>
  )
}

// نیا سودا — sits beside the نقد/ادھار tables in the middle band.
export function LeftReceipts() {
  return (
    <div dir="ltr" className="flex gap-2 h-full">
      <div className="flex-1 min-w-0"><NayaSoda /></div>
    </div>
  )
}

// The two receipts: ادھار کی رسید + نقد کی رسید. Both flex-1 and h-full, so the
// cards are exactly equal width and equal height and align with each other.
export function RightReceipts() {
  const ctx = useApp()
  return (
    <div dir="ltr" className="flex gap-2 h-full">
      <div className="flex-1 min-w-0"><CreditReceipt ctx={ctx} /></div>
      <div className="flex-1 min-w-0"><CashReceipt ctx={ctx} /></div>
    </div>
  )
}
