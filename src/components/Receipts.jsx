import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { buildLabReceipt } from '../logic/purity.js'
import { fmtMoney, fmtNum, round, GRAMS_PER_TOLA, GRAMS_PER_RATTI, gramsToTMR } from '../logic/units.js'
import { useClock } from '../logic/useClock.js'
import LeftSidebar from './LeftSidebar.jsx'

// Slip-template cell builders (match electron/rasterPrint.cjs buildReceiptHtml):
// L = a bordered Urdu LABEL cell, V = a bordered value cell. Each receipt builds
// its rows with these and passes { title, showFee, tables } to ctx.printSlips so
// every printed receipt shares the ONE approved design. opts: { box, s (colspan),
// wrap (long names), u (Nastaliq value), b (keep this cell bold when the receipt
// sets selectiveBold) }.
// L's second argument is either a colspan (number) or an opts object, so the
// existing L('نام', 3) call sites keep working alongside L('گرام', { b: true }).
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
    <div className="flex justify-between items-center border-b border-dotted border-gray-300 px-1 py-[1px]">
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
      <span className={`urdu text-[10px] ${red ? 'text-red-600 font-bold' : 'rcpt-label font-bold text-gray-900'}`}>{label} :</span>
    </div>
  )
}

// Rate line showing per-tola (right, labelled) and per-gram (left) together.
function RateRow({ rates }) {
  return (
    <div className="flex justify-between items-center border-b border-dotted border-gray-300 px-1 py-[1px]">
      {/* rcpt-label: keep bold on screen; print CSS neutralizes it — do not
          revert during styling work. */}
      <span className="urdu text-[10px] rcpt-label font-bold text-gray-900">
        <b>{fmtNum(rates.rate_tezabi_gram, 0)}</b> ریٹ فی گرام
      </span>
      {/* rcpt-label: keep bold on screen; print CSS neutralizes it — do not
          revert during styling work. */}
      <span className="urdu text-[10px] rcpt-label font-bold text-gray-900">
        <b>{fmtMoney(rates.rate_tezabi_tola)}</b> : ریٹ فی تولہ
      </span>
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
      className={`${autoWidth ? 'inline-block max-w-full' : 'block w-full'} whitespace-nowrap overflow-hidden ${doFit ? '' : 'text-ellipsis'} ${alignCls} ${strong ? 'font-bold' : ''} ${red ? 'text-red-600' : ''}`}
    >
      {raw}
    </span>
  )
}

// One label:value field for the two-column receipt forms. Label sits on the
// right (RTL), the value / yellow box fills the space to its left and is
// right-aligned against the label. Values can never spill the panel border:
// min-w-0 lets the value box shrink, overflow-hidden clips, and FitValue keeps
// numbers readable (shrink-to-fit) and text tidy (ellipsis).
function Fld({ label, value, yellow, red, strong, fit, autoWidth, redBox }) {
  // autoWidth: the value box hugs its content (small value → small box) and sits at
  // the far LEFT via justify-between, label stays far RIGHT. Default: box fills the
  // space to the left of the label (flex-1). Only the box sizing differs.
  // redBox: SCREEN-ONLY alert styling on the VALUE BOX only (light red bg /
  // white text) via the redbox-value class — the label stays a normal label,
  // and both print pipelines override the box back to black-on-clear.
  const boxSize = autoWidth ? 'max-w-full min-w-0 overflow-hidden' : 'flex-1 min-w-0 overflow-hidden'
  return (
    <div className={`flex items-center gap-1 w-full min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px] ${autoWidth ? 'justify-between' : ''}`}>
      {/* rcpt-label: keep bold on screen; print CSS neutralizes it — do not
          revert during styling work. */}
      <span dir="rtl" className={`urdu shrink-0 whitespace-nowrap ${yellow ? 'text-[9px]' : 'text-[10px]'} ${red ? 'text-red-600 font-bold' : 'rcpt-label font-bold text-gray-900'}`}>
        {label} :
      </span>
      {yellow ? (
        <div className={`bg-yellowCell border border-line text-[9px] leading-tight px-2 py-[1px] box-border ${boxSize}${redBox ? ' redbox-value' : ''}`}>
          <FitValue value={value} align="right" fit={fit} autoWidth={autoWidth} />
        </div>
      ) : (
        <div className={`text-[10px] ${boxSize} ${red ? 'text-red-600' : ''}`}>
          <FitValue value={value} align="right" strong={strong} red={red} fit={fit} autoWidth={autoWidth} />
        </div>
      )}
    </div>
  )
}

// A form line carrying a right field and (optionally) a left field — mirrors the
// two-column label/value grid of the reference وصولی / لیب receipts.
function FLine({ right, left, mid }) {
  return (
    <div dir="rtl" className="flex items-stretch">
      <div className="flex-1 min-w-0">{right ? <Fld {...right} /> : null}</div>
      {mid ? <div className="flex-1 min-w-0"><Fld {...mid} /></div> : null}
      <div className="flex-1 min-w-0">{left ? <Fld {...left} /> : null}</div>
    </div>
  )
}

// Reusable raised action button — consistent look/size across all four receipts.
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

/* 1) وصولی رسید — Recovery Receipt */
export function RecoveryReceipt({ row, lab, ctx, embed }) {
  const { customer, receiptNo, rates, ujratKaSona, cashDiya, sonaDiya } = ctx
  const now = useClock()
  // اجرت کا سونا checkbox: convert the labour charge (PKR) into its gold weight
  // at the per-tola rate (grams = money / ratePerTola * GRAMS_PER_TOLA). When on,
  // the cash اجرت کی رقم field zeroes out and the gold weight shows instead.
  const ujratGold = lab?.ratePerTola
    ? (Number(row?.labCharges) || 0) / lab.ratePerTola * GRAMS_PER_TOLA
    : 0
  // کیش کا سونا = the sidebar's کیش دیا converted to grams at the per-tola rate.
  // Display-only conversion, fully guarded: missing/zero rate or empty cash → 0
  // (renders '-'), never NaN.
  const cashKaSona = (lab?.ratePerTola && Number(cashDiya))
    ? Number(cashDiya) * GRAMS_PER_TOLA / lab.ratePerTola
    : 0
  // Each row grows (flex-1) so rows never bunch at the top, but is capped at a
  // comfortable height so they never over-stretch in a tall panel — giving even,
  // moderate line spacing (not too much, not too little).
  const R = ({ children, top }) => (
    <div className={`flex-1 flex flex-col justify-center ${top ? 'border-t border-line' : ''}`}>
      {children}
    </div>
  )
  // Printed وصولی رسید (shared approved template). Same values the form shows.
  const slipData = {
    title: 'وصولی رسید',
    showFee: false,
    tables: [
      [[L('رسید نمبر'), V(receiptNo), L('تاریخ'), V(`${fmtTime(now)}  ${showDate(rates, now)}`)]],
      [
        [L('نام'), V(customer.id ? (customer.name || '-') : '-', { wrap: true, s: 3 })],
        [L('ریٹ فی تولہ'), V(fmtMoney(lab?.ratePerTola)), L('پرچون وزن'), V(ctx.parchunLiya === undefined ? fmtNum(row?.malawat) : (ctx.parchunLiya ? fmtNum(ctx.input?.wazan) : '-'))],
        [L('خالص وزن'), V(fmtNum(row?.khalisSona), { s: 3 })],
        [L('اجرت کی رقم'), V(ujratKaSona ? '-' : fmtMoney(row?.labCharges)), L('اجرت کا سونا'), V(ujratKaSona ? fmtNum(ujratGold) : '-')],
        [L('سونا دینا ہے'), V(lab?.ratePerTola ? fmtNum(ujratKaSona ? ((Number(row?.khalisSona) || 0) - ujratGold) : (Number(row?.khalisSona) || 0)) : '-', { s: 3 })],
        [L('کیش دیا'), V(Number(cashDiya) ? fmtMoney(Number(cashDiya)) : '-'), L('کیش کا سونا'), V(cashKaSona ? fmtNum(cashKaSona) : '-')],
        [L('اجرت لینی ہے'), V(fmtMoney(row?.labCharges)), L('خالص سونا دیا'), V(Number(sonaDiya) ? fmtNum(Number(sonaDiya)) : '-')],
        [L('باقی'), V(fmtMoney(row?.baqiRaqam), { box: true, s: 3 })]
      ]
    ]
  }
  return (
    <div data-receipt="wasooli" className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu flex items-center justify-center relative">
        <span>وصولی رسید</span>
        <span className="absolute left-1 bg-header border border-line text-[10px] font-normal px-2">{fmtTime(now)}</span>
      </div>
      {/* Row-based two-column form; rows evenly distributed to fill the panel. */}
      <div className="flex-1 flex flex-col" dir="rtl">
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo, strong: true }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true, fit: true }}
          />
        </R>
        <R><Fld label="نام" value={customer.id ? (customer.name || '-') : '-'} /></R>

        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: fmtMoney(lab?.ratePerTola) }}
            left={{
              label: 'پرچون وزن',
              // Mirrors the sidebar's پرچوں لیا value exactly: the scale weight
              // when the checkbox is ticked, '-' when not. Embedded statement
              // ctx has no parchunLiya flag → keep its old malawat display.
              value: ctx.parchunLiya === undefined
                ? fmtNum(row?.malawat)
                : (ctx.parchunLiya ? fmtNum(ctx.input?.wazan) : '-')
            }}
          />
        </R>
        <R><FLine left={{ label: 'خالص وزن', value: fmtNum(row?.khalisSona) }} /></R>
        <R>
          <FLine
            right={{ label: 'اجرت کی رقم', value: ujratKaSona ? '-' : fmtMoney(row?.labCharges) }}
            left={{ label: 'اجرت کا سونا', value: ujratKaSona ? fmtNum(ujratGold) : '-' }}
          />
        </R>
        {/* سونا دینا ہے mirrors the sidebar's goldOwed (same formula, display
            only): ticked اجرت کا سونا deducts the ujrat gold from خالص سونا. */}
        <R><FLine left={{ label: 'سونا دینا ہے', value: lab?.ratePerTola ? fmtNum(ujratKaSona ? ((Number(row?.khalisSona) || 0) - ujratGold) : (Number(row?.khalisSona) || 0)) : '-' }} /></R>

        {/* Left-sidebar values mapped straight onto the receipt (display only):
            کیش دیا / its gold equivalent / سونا دیا / labour-as-cash. Every value
            is guarded so an empty input or missing rate shows '-'. */}
        <R top>
          <FLine
            right={{ label: 'کیش دیا', value: Number(cashDiya) ? fmtMoney(Number(cashDiya)) : '-', strong: true }}
            left={{ label: 'کیش کا سونا', value: cashKaSona ? fmtNum(cashKaSona) : '-', yellow: true }}
          />
        </R>
        <R>
          <FLine
            right={{ label: 'اجرت لینی ہے', value: fmtMoney(row?.labCharges), yellow: true }}
            left={{ label: 'خالص سونا دیا', value: Number(sonaDiya) ? fmtNum(Number(sonaDiya)) : '-', yellow: true }}
          />
        </R>

        {/* اجرت وصول and ڈسکاؤنٹ rows removed; باقی keeps its value and yellow
            box, and carries the section divider the removed row used to hold. */}
        <R top>
          <FLine
            left={{ label: 'باقی', value: fmtMoney(row?.baqiRaqam), yellow: true }}
          />
        </R>
      </div>
      {!embed && (
        <ActionBar
          onWa={(e) => waSlip(ctx, e, customer.mobile, `وصولی رسید نمبر ${receiptNo}\nخالص سونا: ${fmtNum(row?.khalisSona)}\nباقی: ${fmtMoney(row?.baqiRaqam)}`)}
          onPrint={(e) => ctx.printSlips(e.currentTarget.closest('.receipt-panel'), slipData)}
        >
          <SavedChk on={ctx.savedFlags?.wasooli} />
        </ActionBar>
      )}

    </div>
  )
}

/* 2) لیب رسید — Lab Receipt */
export function LabReceipt({ row, lab, ctx, embed }) {
  const { customer, receiptNo, rates } = ctx
  const now = useClock()
  // ONE shared 6-col grid (left -> right): گرام | ملی گرام | تولہ | ماشہ | رتی | label.
  // Every row uses it (with column spans) so the whole receipt stays aligned.
  const LG = { gridTemplateColumns: '1fr 1.2fr 0.55fr 0.55fr 0.55fr 78px' }
  // ملی گرام column = the .xxxx fraction of the gram value, as a padded 4-digit
  // number (e.g. 11.6640 -> "6640", 1.0375 -> "0375", 10.6265 -> "6265").
  const mg = (grams) => {
    const frac = Math.round(((Number(grams) || 0) % 1) * 10000)
    return String(frac).padStart(4, '0')
  }
  // گرام column = the whole-gram part (11.664 -> 11).
  const gWhole = (grams) => Math.floor(Number(grams) || 0)
  const C = ({ children, cls = '', span }) => (
    <div className={`flex items-center justify-center min-w-0 text-[10px] ${cls}`} style={span ? { gridColumn: `span ${span}` } : undefined}>{children}</div>
  )
  const Lb = ({ children, cls = '', span }) => (
    <div className={`flex items-center justify-end pr-1 min-w-0 text-[9px] urdu ${cls}`} style={span ? { gridColumn: `span ${span}` } : undefined}>{children}</div>
  )
  // Each row grows (flex-1) to share the panel height evenly but is capped so it
  // never over-stretches — same moderate spacing as the وصولی رسید. The 6-col
  // grid (column widths) is untouched; only the row's vertical size changes.
  const Row = ({ children }) => (
    <div className="grid border-b border-gray-300 flex-1" style={LG}>{children}</div>
  )
  const div = 'border-l border-gray-400' // faint vertical divider after ملی گرام
  // Printed لیب رسید (shared approved template). Same values the grid above shows.
  // b:true marks the cells that stay bold under selectiveBold — the weights the
  // shop reads off the slip (آمد / خالص in grams+milligrams), the two rates, the
  // ملاوٹ فی تولہ label and the بقایا رقم line. Everything else prints lighter.
  const B = { b: true }
  const wRow = (label, grams, tmr, bold) => [
    L(label, bold ? B : undefined), V(fmtNum(tmr?.ratti, 2)), V(fmtNum(tmr?.masha, 0)), V(fmtNum(tmr?.tola, 0)),
    V(mg(grams), bold ? B : undefined), V(String(gWhole(grams)), bold ? B : undefined)
  ]
  // ریٹ فی گرام is DERIVED from the per-tola rate this same receipt prints, so the
  // two rows can never disagree. The settings' rate_tezabi_gram column is stale —
  // it defaults to 772, has no UI to edit it, and is never recomputed when the
  // per-tola rate changes — so reading it printed 772 next to a correct 425,000.
  const perTola = Number(lab?.ratePerTola) || Number(rates.rate_tezabi_tola) || 0
  const ratePerGram = perTola ? round(perTola / GRAMS_PER_TOLA, 0) : 0
  const slipData = {
    title: 'لیب رسید',
    showFee: true,
    selectiveBold: true,
    tables: [
      [[L('رسید نمبر'), V(receiptNo), L('ریٹ فی گرام'), V(ratePerGram ? fmtMoney(ratePerGram) : '-', B)]],
      [
        [L(''), L('رتی'), L('ماشہ'), L('تولہ'), L('ملی گرام', B), L('گرام', B)],
        wRow('آمد وزن', lab?.aamadWazan, lab?.grossTMR, true),
        wRow('ملاوٹ وزن', lab?.malawatWazan, lab?.malawatTMR),
        wRow('خالص وزن', lab?.khalisWazan, lab?.khalisTMR, true),
        [L('ملاوٹ فی تولہ', B), V(fmtNum(lab?.milawatFiTolaTMR?.ratti, 2)), V(fmtNum(lab?.milawatFiTolaTMR?.masha, 0)), V(fmtNum(lab?.milawatFiTolaTMR?.tola, 0)), V('فی گرام'), V(fmtNum(lab?.malawatPerGram, 4))]
      ],
      [
        [L('کیرٹ'), V(fmtNum(lab?.keerat, 2)), L('ریٹ فی تولہ'), V(fmtMoney(lab?.ratePerTola), B)],
        [L('ٹوٹل رقم'), V(fmtMoney(lab?.totalRaqam)), L('چارجز'), V(fmtMoney(lab?.charges))],
        [L('بقایا رقم', B), V(fmtMoney(lab?.baqi), { box: true, b: true }), L('پوائنٹ'), V(fmtNum(lab?.point, 4))],
        [L('نام'), V(customer.id ? (customer.name || '-') : '-', { wrap: true }), L('رتی'), V(fmtNum(lab?.milawatTotalRatti, 2), { u: true })],
        [L('تاریخ'), V(showDate(rates, now)), L('وقت'), V(fmtTime(now))]
      ]
    ]
  }
  return (
    <div data-receipt="lab" className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">لیب رسید</div>
      <div className="flex-1 px-1 pt-[2px] flex flex-col">
        {/* header */}
        <Row>
          <C cls="urdu">گرام</C>
          <C cls="urdu text-red-600">ملی گرام</C>
          <C cls={`urdu ${div}`}>تولہ</C>
          <C cls="urdu">ماشہ</C>
          <C cls="urdu text-red-600">رتی</C>
          <C> </C>
        </Row>
        {/* آمد / ملاوٹ / خالص وزن — each weight gets its OWN gram->tola/masha/ratti */}
        {[
          { label: 'آمدوزن', grams: lab?.aamadWazan || 0, tmr: lab?.grossTMR, red: true },
          { label: 'ملاوٹ وزن', grams: lab?.malawatWazan || 0, tmr: lab?.malawatTMR, red: true },
          { label: 'خالص وزن', grams: lab?.khalisWazan || 0, tmr: lab?.khalisTMR, strong: true }
        ].map((r, i) => (
          <Row key={i}>
            <C>{gWhole(r.grams)}</C>
            <C cls={r.strong ? 'font-bold' : ''}>{mg(r.grams)}</C>
            <C cls={div}>{fmtNum(r.tmr?.tola, 0)}</C>
            <C>{fmtNum(r.tmr?.masha, 0)}</C>
            <C>{fmtNum(r.tmr?.ratti, 2)}</C>
            <Lb cls={r.red ? 'text-red-600' : ''}>{r.label}</Lb>
          </Row>
        ))}
        {/* ملاوٹ فی تولہ — value (0.0889) + its masha/ratti breakdown */}
        <Row>
          <C>{fmtNum(lab?.malawatPerGram, 4)}</C>
          <C cls="urdu text-red-600">فی گرام</C>
          <C cls={div}>{fmtNum(lab?.milawatFiTolaTMR?.tola, 0)}</C>
          <C>{fmtNum(lab?.milawatFiTolaTMR?.masha, 0)}</C>
          <C>{fmtNum(lab?.milawatFiTolaTMR?.ratti, 2)}</C>
          <Lb cls="text-red-600">ملاوٹ فی تولہ</Lb>
        </Row>
        {/* کیرٹ | ریٹ فی تولہ */}
        <Row>
          <C>{fmtMoney(lab?.ratePerTola)}</C>
          <Lb span={2}>ریٹ فی تولہ</Lb>
          <C> </C>
          <C>{fmtNum(lab?.keerat, 2)}</C>
          <Lb>کیرٹ</Lb>
        </Row>
        {/* The cramped total/charges/baqaya line is split into TWO rows so the big
            money numbers each get room and never overlap. Each is a simple flex
            row (label on the right via row-reverse), charges as a single number.
            DOM order is [label, …numbers] so row-reverse puts the label rightmost. */}
        {/* Row 1 (RTL): ٹوٹل رقم · total · چارجز · charges. Each label is ONE clean
            .urdu text node with dir=rtl so the Nastaliq letters join correctly
            (no Lb flex-wrapper, no split). چارجز labels the charges number. */}
        <div className="laib-total-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">ٹوٹل رقم</span>
          <span className="num">{fmtMoney(lab?.totalRaqam)}</span>
          <span className="urdu" dir="rtl">چارجز</span>
          <span className="num">{fmtMoney(lab?.charges)}</span>
        </div>
        {/* Row 2 (RTL): بقایا رقم · baqaya value (highlighted box) */}
        <div className="laib-baqaya-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">بقایا رقم</span>
          <span className="num bg-yellowCell border border-line text-red-600">{fmtMoney(lab?.baqi)}</span>
        </div>
        {/* نام | پوائنٹ (khalis fraction 0.9111) */}
        <Row>
          <C>{fmtNum(lab?.point, 4)}</C>
          <Lb>پوائنٹ</Lb>
          <C span={3} cls="border-b border-gray-400">{customer.id ? (customer.name || ' ') : ' '}</C>
          <Lb>نام</Lb>
        </Row>
        {/* تاریخ row (RTL): تاریخ · date · وقت · time · رتی · ratti — spread evenly
            on one line via flex space-between. Same height as before (flex-1);
            this is a horizontal-spacing-only fix. Labels are clean .urdu spans. */}
        <div className="laib-date-row border-b border-gray-300 flex-1">
          <span className="urdu" dir="rtl">تاریخ</span>
          <span className="num">{showDate(rates, now)}</span>
          <span className="urdu" dir="rtl">وقت</span>
          <span className="num">{fmtTime(now)}</span>
          <span className="urdu" dir="rtl">رتی</span>
          <span className="num">{fmtNum(lab?.milawatTotalRatti, 2)}</span>
        </div>
      </div>
      {!embed && (
        <ActionBar
          onWa={(e) => waSlip(ctx, e, customer.mobile, `لیب رسید ${receiptNo}\nخالص وزن: ${fmtNum(lab?.khalisWazan)}\nٹوٹل رقم: ${fmtMoney(lab?.totalRaqam)}`)}
          onPrint={(e) => ctx.printSlips(e.currentTarget.closest('.receipt-panel'), slipData)}
        >
          <SavedChk on={ctx.savedFlags?.lab} />
          <span className="urdu text-[10px]">رسید</span>
        </ActionBar>
      )}
    </div>
  )
}

// Two-column credit-receipt helpers: each side is a {label,value,yellow} field,
// a bare value {bare:true,value} (right-aligned, no label), or null (empty cell).
function CSide({ f }) {
  if (!f) return <div className="flex-1 min-w-0" />
  if (f.bare)
    return (
      <div className="flex-1 min-w-0 px-2 border-b border-dotted border-gray-300 min-h-[19px] flex items-center overflow-hidden text-[10px]">
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
  const { customer, receiptNo, rates, bump, hasApi, openReceiptNo,
    udharGive, udharTake, udharCashGive, udharCashTake, udharComment } = ctx
  const now = useClock()
  const [ledFetched, setLed] = useState({ balance_gold: 0, balance_cash: 0 })
  useEffect(() => {
    // ctx.ledger injected (e.g. the customer statement passes each parchi's OWN
    // running/cumulative balance) → use it as-is, never fetch the live grand total.
    if (ctx.ledger) return
    if (hasApi && customer.id)
      window.api.getCustomerLedger(customer.id).then((l) => setLed(l || { balance_gold: 0, balance_cash: 0 }))
    else setLed({ balance_gold: 0, balance_cash: 0 })
  }, [customer.id, bump, hasApi, ctx.ledger])
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
  const gGive = udharGive ? calcGold(udharGive) : null // gold given
  const gTake = udharTake ? calcGold(udharTake) : null // gold taken
  const cGive = Number(udharCashGive) || 0
  const cTake = Number(udharCashTake) || 0
  // One shared point for the gold block — from whichever entry has a weight.
  const activePoint = (Number(udharGive?.wazan) > 0) ? udharGive?.point
                    : (Number(udharTake?.wazan) > 0) ? udharTake?.point
                    : null
  // This transaction's net (give − take); previous ledger balance + net = new باقی.
  const netGold = (gGive?.khalis || 0) - (gTake?.khalis || 0)
  const netCash = cGive - cTake
  // Add the LIVE form entries on top of the ledger balance ONLY while composing a
  // brand-new, unsaved parchi (openReceiptNo == null). Once the parchi is saved —
  // or when an already-saved parchi is re-opened/navigated to — those same entries
  // are ALREADY part of the ledger balance, so adding them again is what made the
  // receipt value DOUBLE after Save. In that case the balance alone is the total.
  const composingNew = openReceiptNo == null
  // Previous balance = ledger balance MINUS this parchi's own net, but only when
  // this parchi is already in the ledger (saved / reopened / navigated to). While
  // composing a brand-new unsaved parchi the ledger does NOT include it yet, so
  // previous = ledger as-is. This parchi's exact ledger contribution == netGold /
  // netCash (same sign + rate-independent khalis/cash as getCustomerLedger).
  const prevGold = (led?.balance_gold || 0) - (composingNew ? 0 : netGold)
  const prevCash = (led?.balance_cash || 0) - (composingNew ? 0 : netCash)
  // Final = previous + this parchi's net. Same final numbers as before (no
  // doubling), but now سابقہ + باقی = final always reconciles.
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
    showFee: false,
    tables: [
      [[L('رسید نمبر'), V(receiptNo), L('تاریخ'), V(`${fmtTime(now)}  ${showDate(rates, now)}`)]],
      [
        [L('نام'), V(customer.id ? (customer.name || '-') : '-', { wrap: true, s: 3 })],
        [L('تیزابی دیا'), V(gGive ? fmtNum(gGive.wazan) : '-'), L('خالص وزن'), V(gGive ? fmtNum(gGive.khalis) : '-')],
        [L('تیزابی لیا'), V(gTake ? fmtNum(gTake.wazan) : '-'), L('خالص وزن'), V(gTake ? fmtNum(gTake.khalis) : '-')],
        [L('پوائنٹ'), V(activePoint != null ? fmtNum(Number(activePoint), 0) : '-'), V(udharComment || '-', { wrap: true, s: 2 })],
        [L('باقی'), V(netGold ? fmtNum(netGold) : '-', { s: 3 })],
        [L('سابقہ سونا بیلنس'), V(customer.id ? fmtNum(prevGold) : '-', { s: 3 })],
        [L('باقی تیزابی دینا ہے'), V(finalGold < 0 ? fmtNum(Math.abs(finalGold)) : '-', { box: finalGold < 0 }), L('باقی تیزابی لینا ہے'), V(finalGold > 0 ? fmtNum(finalGold) : '-', { box: finalGold > 0 })]
      ],
      [
        [L('کیش دیا'), V(cGive ? fmtMoney(cGive) : '-'), L('کیش لیا'), V(cTake ? fmtMoney(cTake) : '-')],
        [L('باقی'), V(netCash ? fmtMoney(netCash) : '-', { s: 3 })],
        [L('سابقہ کیش بیلنس'), V(customer.id ? fmtMoney(prevCash) : '-', { s: 3 })],
        [L('باقی کیش دینا ہے'), V(finalCash < 0 ? fmtMoney(Math.abs(finalCash)) : '-', { box: finalCash < 0 }), L('باقی کیش لینا ہے'), V(finalCash > 0 ? fmtMoney(finalCash) : '-', { box: finalCash > 0 })]
      ]
    ]
  }
  return (
    <div data-receipt="udhar" className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">ادھار کی رسید</div>
      <div className="flex-1 px-1 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ */}
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true, fit: true }}
          />
        </R>
        <R><Fld label="نام" value={customer.id ? (customer.name || '-') : '-'} /></R>

        {/* ---- Gold block ---- */}
        <R><CRow right={{ label: 'تیزابی دیا', value: gGive ? fmtNum(gGive.wazan) : '-' }} left={{ label: 'خالص وزن', value: gGive ? fmtNum(gGive.khalis) : '-' }} /></R>
        <R><CRow right={{ label: 'تیزابی لیا', value: gTake ? fmtNum(gTake.wazan) : '-' }} left={{ label: 'خالص وزن', value: gTake ? fmtNum(gTake.khalis) : '-' }} /></R>
        {/* پوائنٹ on its own line; the collector name / note (udharComment) fills
            the empty LEFT slot. Blank when there is no comment (no stray "-"). */}
        <R><CRow right={{ label: 'پوائنٹ', value: activePoint != null ? fmtNum(Number(activePoint), 0) : '-' }} left={udharComment ? { bare: true, value: udharComment, fit: true } : null} /></R>
        <R><Fld label="باقی" value={netGold ? fmtNum(netGold) : '-'} /></R>
        <R><Fld label="سابقہ سونا بیلنس" value={customer.id ? fmtNum(prevGold) : '-'} autoWidth /></R>
        <R><Fld label="باقی تیزابی دینا ہے" value={finalGold < 0 ? fmtNum(Math.abs(finalGold)) : '-'} yellow autoWidth redBox /></R>
        <R><Fld label="باقی تیزابی لینا ہے" value={finalGold > 0 ? fmtNum(finalGold) : '-'} yellow autoWidth /></R>

        <div className="border-t border-line my-[1px]" />

        {/* ---- Cash block ---- */}
        <R><CRow right={{ label: 'کیش۔ دیا', value: cGive ? fmtMoney(cGive) : '-' }} left={{ label: 'کیش۔ لیا', value: cTake ? fmtMoney(cTake) : '-' }} /></R>
        <R><Fld label="باقی" value={netCash ? fmtMoney(netCash) : '-'} /></R>
        <R><Fld label="سابقہ کیش بیلنس" value={customer.id ? fmtMoney(prevCash) : '-'} autoWidth /></R>
        <R><Fld label="باقی کیش دینا ہے" value={finalCash < 0 ? fmtMoney(Math.abs(finalCash)) : '-'} yellow autoWidth redBox /></R>
        <R><Fld label="باقی کیش لینا ہے" value={finalCash > 0 ? fmtMoney(finalCash) : '-'} yellow autoWidth /></R>
      </div>
      {!embed && (
        <ActionBar
          onWa={(e) => waSlip(ctx, e, customer.mobile, `ادھار رسید\nنام: ${customer.id ? customer.name : ''}\nباقی سونا: ${fmtNum(led?.balance_gold)}\nباقی کیش: ${fmtMoney(led?.balance_cash)}`)}
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

/* 4) نقد کی رسید — Cash Receipt (رسید سونا خرید) */
export function CashReceipt({ ctx, embed }) {
  const { customer, receiptNo, rates, cashSell, cashBuy } = ctx
  const now = useClock()
  // Active نقد entry = whichever of فروخت / خرید has a non-zero سونا وزن. Its
  // figures use the SAME ratti-scale formula as the نقد panel's GoldRow.
  const active = (Number(cashSell.wazan) > 0) ? { ...cashSell, kind: 'فروخت' }
               : (Number(cashBuy.wazan) > 0) ? { ...cashBuy, kind: 'خرید' }
               : null

  let v = null
  if (active) {
    const wazan = Number(active.wazan) || 0
    const point = Number(active.point) || 0
    const above = point - 100
    const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
    const khalis = round(wazan - deduction, 3)
    const rate = active.rate === '' ? (Number(rates.rate_tezabi_tola) || 0) : Number(active.rate)
    const qeemat = round(khalis / GRAMS_PER_TOLA * rate, 0)
    v = { wazan, point, khalis, rate, qeemat, kind: active.kind,
          grossTMR: gramsToTMR(wazan), khalisTMR: gramsToTMR(khalis) }
  }
  // Mini TMR band grid (RTL right->left): پوائنٹ | label | value | رتی | ماشہ | تولہ.
  // columnGap keeps adjacent cells (e.g. پوائنٹ and سونا وزن) from abutting so the
  // Urdu labels don't read as merged. Column widths are unchanged.
  // Order (RTL right->left): پوائنٹ | label | value | رتی | ماشہ | تولہ. value is
  // a fixed 64px (was 1fr, which stole space and spread the receipt), so the
  // label 1fr absorbs the slack; رتی widened to 34px so "5.76" no longer clips.
  const tmrGrid = { gridTemplateColumns: '30px 1fr 64px 34px 28px 28px', columnGap: 4 }
  // Each row grows (flex-1) so rows fill the panel evenly instead of bunching at
  // the top, but is capped at a comfortable height so they never over-stretch.
  const R = ({ children }) => (
    <div className="flex-1 flex flex-col justify-center">{children}</div>
  )
  // Printed نقد کی رسید (shared approved template). Same values the form shows.
  const slipData = {
    title: `نقد کی رسید — سونا ${v ? v.kind : 'خرید'}`,
    showFee: false,
    tables: [
      [[L('رسید نمبر'), V(receiptNo), L('تاریخ'), V(`${fmtTime(now)}  ${showDate(rates, now)}`)]],
      [
        [L('نام'), V(customer.id ? (customer.name || '-') : '-', { wrap: true, s: 3 })],
        [L('ریٹ فی تولہ'), V(v ? fmtMoney(v.rate) : (rates.rate_tezabi_tola ?? '-')), L('ریٹ فی گرام'), V(v ? fmtMoney(round(v.rate / GRAMS_PER_TOLA, 0)) : '-')]
      ],
      [
        [L(''), L('رتی'), L('ماشہ'), L('تولہ'), L('وزن')],
        [L('سونا وزن'), V(v ? fmtNum(v.grossTMR.ratti, 2) : '-'), V(v ? fmtNum(v.grossTMR.masha, 0) : '-'), V(v ? fmtNum(v.grossTMR.tola, 0) : '-'), V(v ? fmtNum(v.wazan) : '-')],
        [L('خالص وزن'), V(v ? fmtNum(v.khalisTMR.ratti, 2) : '-'), V(v ? fmtNum(v.khalisTMR.masha, 0) : '-'), V(v ? fmtNum(v.khalisTMR.tola, 0) : '-'), V(v ? fmtNum(v.khalis) : '-')],
        [L('پوائنٹ'), V(v ? fmtNum(v.point, 0) : '-', { s: 4 })]
      ],
      [
        [L('کل قیمت'), V(v ? fmtMoney(v.qeemat) : '-', { box: true, s: 3 })],
        [L('رقم دی'), V(v ? fmtMoney(v.qeemat) : '-', { s: 3 })]
      ]
    ]
  }
  return (
    <div data-receipt="naqad" className="receipt-panel border border-line bg-white flex flex-col h-full">
      <div className="panel-title urdu">نقد کی رسید</div>
      <div className="urdu text-center text-[12px] font-bold py-[2px]">{`رسید سونا ${v ? v.kind : 'خرید'}`}</div>
      <div className="flex-1 px-1 pt-1 flex flex-col" dir="rtl">
        {/* رسید نمبر + تاریخ on one row */}
        <R>
          <FLine
            right={{ label: 'رسید نمبر', value: receiptNo }}
            left={{ label: 'تاریخ', value: `${fmtTime(now)}  ${showDate(rates, now)}`, strong: true, fit: true }}
          />
        </R>
        {/* نام full width */}
        <R><Fld label="نام" value={customer.id ? (customer.name || '-') : '-'} /></R>
        {/* ریٹ فی تولہ + ریٹ فی گرام on one row */}
        <R>
          <FLine
            right={{ label: 'ریٹ فی تولہ', value: v ? fmtMoney(v.rate) : (rates.rate_tezabi_tola ?? '-') }}
            left={{ label: 'ریٹ فی گرام', value: v ? fmtMoney(round(v.rate / GRAMS_PER_TOLA, 0)) : '-' }}
          />
        </R>

        {/* TMR header: checkbox (right) + تولہ|ماشہ|رتی(red) */}
        <R>
          <div className="grid items-center mt-[1px]" style={tmrGrid}>
            <div className="flex"><input type="checkbox" className="scale-90" /></div>
            <div></div>
            <div></div>
            <div dir="rtl" className="urdu text-[9px] text-red-600 text-center">رتی</div>
            <div dir="rtl" className="urdu text-[9px] text-center">ماشہ</div>
            <div dir="rtl" className="urdu text-[9px] text-center">تولہ</div>
          </div>
        </R>
        {/* سونا وزن row — پوائنٹ label sits on the right */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div dir="rtl" className="urdu text-[10px] text-center border-b border-gray-400">پوائنٹ</div>
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">سونا وزن :</div>
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">{v ? fmtNum(v.wazan) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.ratti, 2) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.masha, 0) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.grossTMR.tola, 0) : '-'}</div>
          </div>
        </R>
        {/* خالص وزن row — پوائنٹ value (100) sits on the right */}
        <R>
          <div className="grid items-center" style={tmrGrid}>
            <div className="text-[10px] text-center font-bold" dir="ltr">{v ? fmtNum(v.point, 0) : '-'}</div>
            <div dir="rtl" className="urdu text-[10px] text-right whitespace-nowrap">خالص وزن :</div>
            <div className="text-[10px] text-center border-b border-gray-400" dir="ltr">{v ? fmtNum(v.khalis) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.ratti, 2) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.masha, 0) : '-'}</div>
            <div className="text-[10px] text-center whitespace-nowrap">{v ? fmtNum(v.khalisTMR.tola, 0) : '-'}</div>
          </div>
        </R>

        <div className="border-t border-line mt-1" />
        <R><Fld label="کل قیمت" value={v ? fmtMoney(v.qeemat) : '-'} /></R>
        <R><Fld label="رقم دی" value={v ? fmtMoney(v.qeemat) : '-'} /></R>
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

// LEFT half receipts: sidebar + وصولی رسید + لیب رسید
export function LeftReceipts() {
  const ctx = useApp()
  const selected = ctx.computedRows.find((r) => r.parchi) || ctx.computedRows[2] // default Standard
  const lab = selected ? buildLabReceipt(selected, ctx.input, ctx.rates) : null
  return (
    <div dir="ltr" className="flex gap-1 h-full">
      <LeftSidebar />
      <div className="flex-1 min-w-0"><RecoveryReceipt row={selected} lab={lab} ctx={ctx} /></div>
      <div className="flex-1 min-w-0"><LabReceipt row={selected} lab={lab} ctx={ctx} /></div>
    </div>
  )
}

// RIGHT half receipts: ادھار کی رسید + نقد کی رسید — split into two equal halves.
export function RightReceipts() {
  const ctx = useApp()
  return (
    <div dir="ltr" className="flex gap-1 h-full">
      <div className="flex-1 min-w-0"><CreditReceipt ctx={ctx} /></div>
      <div className="flex-1 min-w-0"><CashReceipt ctx={ctx} /></div>
    </div>
  )
}
