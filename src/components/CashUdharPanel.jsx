import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, GRAMS_PER_TOLA, round } from '../logic/units.js'

// qeemat (PKR) from grams using the per-tola rate.
const qeemat = (grams, rateTola) =>
  round((Number(grams) || 0) / GRAMS_PER_TOLA * (Number(rateTola) || 0), 0)

const blankGold = () => ({ wazan: '', point: '100', rate: '' })

// ── Column model: FOUR EQUAL COLUMNS (25% each) ──────────────────────────────
// The label column used to be 1fr against three fixed pixel columns
// (140/140/150), which on the wide panel left the label column ~2× the width of
// any numeric column: نقد/ادھار sprawled while چاندی وزن / ریٹ / قیمت were cramped.
//
// These tables are CSS grid, not <table>, so the grid equivalent of
// `table-layout: fixed` is minmax(0, 1fr): a BARE `1fr` still carries an implicit
// `min-width: auto`, so a long value could push its track wider and knock the
// columns out of alignment. minmax(0, …) removes that floor, so all four tracks
// stay exactly 25% no matter what a cell contains.
//
// ONE constant, used by the نقد header+rows, the ادھار header+rows AND the ٹوٹل
// strip — so both tables are identical and every column lines up vertically
// through the whole panel, totals included.
const GRID_4 = 'repeat(4, minmax(0, 1fr))'

const gridStyle = { gridTemplateColumns: GRID_4 }

// The ٹوٹل strip carries FIVE pieces of content (ٹوٹل, and two label+box pairs) but
// must sit on the SAME four columns as the rows above. Each balance keeps its label
// and its box together inside one cell, which lands چاندی لین دین under the ریٹ
// column and کیش لین دین under the قیمت column — i.e. under the numeric columns,
// aligned with the grid above.
const totalsGridStyle = { gridTemplateColumns: GRID_4 }

// A metal row counts as "active" only when its چاندی وزن (wazan) holds a non-zero
// number.
const hasData = (st) => String(st.wazan).trim() !== '' && Number(st.wazan) > 0

// One metal line: label (right) + چاندی وزن | ریٹ | قیمت.
// `disabled` locks/greys the inputs (used for نقد mutual exclusion).
//
// SILVER IS TRADED BY PURE WEIGHT: there is no پوائنٹ (fineness) input and no
// خالص چاندی cell any more, so khalis === wazan and قیمت is priced straight off
// the entered weight. `st.point` still exists in the entry state and is still
// written to transactions.point — it simply stays at its '100' default, which is
// the no-op value in the khalis formula (store.jsx goldFigures: a point of 100
// yields a zero deduction). Keeping the field means the DB schema, the saved
// records and every balance that reads khalis_sona are all untouched.
function GoldRow({ label, st, set, rateTola, disabled = false }) {
  // Enter-to-advance focus flow (per-row ref, so wazan → this row's own rate):
  // wazan → (Enter) → rate → (Enter) → blur.
  const rateRef = useRef(null)
  const onEnterFocusRate = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (rateRef.current) rateRef.current.focus() } }
  const onEnterBlur = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }
  const wazan = Number(st.wazan) || 0
  const rate = st.rate === '' ? rateTola : Number(st.rate)
  const q = qeemat(wazan, rate)
  const lock = disabled ? ' opacity-50 cursor-not-allowed bg-gray-100' : ''
  return (
    // cu-row: carries the zebra stripe + hover tint (see index.css). Layout class
    // list is otherwise unchanged.
    <div className="cu-row grid flex-1 min-h-0" style={gridStyle}>
      {/* Label column — right-aligned and kept on ONE line (whitespace-nowrap);
          min-w-0 lets the fixed 25% track hold regardless of the label's length.
          bg-white removed so the row's zebra tint shows through. */}
      <div className="cell justify-end pr-2 urdu text-[15px] font-bold text-right leading-tight whitespace-nowrap min-w-0">
        {label}
      </div>
      <input dir="ltr" className={`inp-g text-center text-[15px] font-bold${lock}`} value={st.wazan} disabled={disabled}
        onChange={(e) => set({ ...st, wazan: e.target.value })} onKeyDown={onEnterFocusRate} placeholder="-" />
      <input ref={rateRef} dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`} value={st.rate} disabled={disabled}
        onChange={(e) => set({ ...st, rate: e.target.value })} onKeyDown={onEnterBlur} placeholder={fmtMoney(rateTola)} />
      <div className="cell cell-c text-[15px] font-bold">{q ? fmtMoney(q) : '-'}</div>
    </div>
  )
}

// One cash line: label (right) + ONE merged blank cell across the two middle
// columns + a single green amount box in the far-left قیمت column.
function CashRow({ label, st, set }) {
  return (
    // cu-row: same zebra stripe + hover tint as GoldRow, so نقد and ادھار stripe
    // identically. Layout class list is otherwise unchanged.
    <div className="cu-row grid flex-1 min-h-0" style={gridStyle}>
      {/* Label column — right-aligned and kept on ONE line (whitespace-nowrap);
          min-w-0 lets the fixed 25% track hold regardless of the label's length.
          bg-white removed so the row's zebra tint shows through. */}
      <div className="cell justify-end pr-2 urdu text-[15px] font-bold text-right leading-tight whitespace-nowrap min-w-0">
        {label}
      </div>
      {/* merged empty cell spanning چاندی وزن + ریٹ */}
      <div className="cell" style={{ gridColumn: 'span 2' }}>&nbsp;</div>
      <input dir="ltr" className="inp-g text-center text-[15px] font-bold" value={st}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        placeholder="-" />
    </div>
  )
}

// Header row: a solid DARK steel band (headStrip) with BOLD white text, so the
// table's structure is immediately clear — it used to be a pale strip that barely
// separated from the white rows beneath it. The section title fills the right-hand
// label column; the three data columns carry their names. ONE HDR class list, used
// by BOTH tables, so نقد and ادھار headers are identical.
// The `!` prefixes beat .cash-udhar's own colour rules further down index.css.
const HDR = 'hdr urdu !bg-headStrip !text-headText !border-headBorder font-bold'
function Header({ title }) {
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className={`${HDR} text-[15px]`}>{title}</div>
      <div className={`${HDR} text-[14px]`}>چاندی وزن</div>
      <div className={`${HDR} text-[14px]`}>ریٹ</div>
      <div className={`${HDR} text-[14px]`}>قیمت</div>
    </div>
  )
}

export default function CashUdharPanel() {
  const {
    rates, customer, bump, hasApi,
    cashSell, setCashSell, cashBuy, setCashBuy,
    udharGive, setUdharGive, udharTake, setUdharTake,
    udharCashGive, setUdharCashGive, udharCashTake, setUdharCashTake
  } = useApp()
  const rateTola = Number(rates.rate_tezabi_tola) || 0

  const [ledger, setLedger] = useState({ balance_gold: 0, balance_cash: 0 })

  useEffect(() => {
    if (hasApi && customer.id) {
      window.api.getCustomerLedger(customer.id).then(setLedger)
    } else {
      setLedger({ balance_gold: 0, balance_cash: 0 })
    }
  }, [customer.id, bump, hasApi])

  // نقد mutual exclusion: filling فروخت (sell) or خرید (buy) locks the other.
  // The ادھار rows (give/take) are independent and never locked.
  return (
    <div
      dir="rtl"
      className="cash-udhar flex flex-col h-full gap-2"
    >
      {/* نقد (Cash) — its own card */}
      <div className="card flex-[3]">
        <Header title="نقد" />
        <GoldRow label="فروخت" st={cashSell} set={setCashSell} rateTola={rateTola} disabled={hasData(cashBuy)} />
        <GoldRow label="نقد خریدا" st={cashBuy} set={setCashBuy} rateTola={rateTola} disabled={hasData(cashSell)} />
      </div>

      {/* ادھار (Credit) — its own card, with the ٹوٹل totals pinned to the bottom
          in a tinted strip (.card-total). */}
      <div className="card flex-[6]">
        <Header title="ادھار" />
        <GoldRow label="تیزابی دیا" st={udharGive} set={setUdharGive} rateTola={rateTola} />
        <GoldRow label="تیزابی لیا" st={udharTake} set={setUdharTake} rateTola={rateTola} />
        <CashRow label="ادھار کیش دیا" st={udharCashGive} set={setUdharCashGive} />
        <CashRow label="ادھار کیش لیا" st={udharCashTake} set={setUdharCashTake} />

        {/* Bottom band, on the SAME four columns as the rows above:
              col1 (نقد/ادھار)  → ٹوٹل :
              col2 (چاندی وزن)  → empty
              col3 (ریٹ)        → چاندی لین دین : + its box
              col4 (قیمت)       → کیش لین دین :  + its box
            Each balance keeps its label and box together in one cell, so the two
            totals sit under the numeric columns and the strip lines up with the
            grid above it. Same two readOnly inputs, same two values as before. */}
        <div className="card-total grid flex-1 min-h-0" style={totalsGridStyle}>
          {/* col1 (right): ٹوٹل */}
          <div className="cell justify-end pr-1 urdu text-[13px] text-right font-bold border-0 bg-transparent">
            ٹوٹل :
          </div>
          {/* col2: empty, under چاندی وزن */}
          <div className="cell border-0 bg-transparent" />
          {/* col3 (under ریٹ): metal-ledger balance — only for a selected customer */}
          <div className="cell gap-1 border-0 bg-transparent min-w-0">
            <span className="urdu text-[11px] font-bold whitespace-nowrap shrink-0">چاندی لین دین :</span>
            <input dir="ltr" className="inp-y flex-1 min-w-0 text-center text-[13px] font-bold rounded-md" value={customer.id ? fmtNum(ledger.balance_gold) : '-'} readOnly />
          </div>
          {/* col4 (under قیمت): cash-ledger balance — only for a selected customer */}
          <div className="cell gap-1 border-0 bg-transparent min-w-0">
            <span className="urdu text-[11px] font-bold whitespace-nowrap shrink-0">کیش لین دین :</span>
            <input dir="ltr" className="inp-y flex-1 min-w-0 text-center text-[13px] font-bold rounded-md" value={customer.id ? fmtMoney(ledger.balance_cash) : '-'} readOnly />
          </div>
        </div>
      </div>
    </div>
  )
}
