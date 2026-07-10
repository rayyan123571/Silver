import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, GRAMS_PER_TOLA, GRAMS_PER_RATTI, round } from '../logic/units.js'

// qeemat (PKR) from pure-gold grams using the per-tola rate.
const qeemat = (khalisGrams, rateTola) =>
  round((Number(khalisGrams) || 0) / GRAMS_PER_TOLA * (Number(rateTola) || 0), 0)

const blankGold = () => ({ wazan: '', point: '100', rate: '' })

// The row-label column is flexible (1fr) so the table fills the whole panel
// width; the five data columns stay at fixed pixel widths like the reference.
const LABEL_W = '1fr'
const WAZAN_W = '84px'
const POINT_W = '78px'
const KHALIS_W = '90px'
const RATE_W = '92px'
const QEEMAT_W = '96px'

const gridStyle = {
  gridTemplateColumns: `${LABEL_W} ${WAZAN_W} ${POINT_W} ${KHALIS_W} ${RATE_W} ${QEEMAT_W}`
}

// A gold row counts as "active" only when its سونا وزن (wazan) holds a non-zero
// number — point defaults to '100', so it alone doesn't make a row active.
const hasData = (st) => String(st.wazan).trim() !== '' && Number(st.wazan) > 0

// One gold line: label (right) + سونا وزن | پوائنٹ | خالص سونا | ریٹ | قیمت.
// `disabled` locks/greys all three inputs (used for نقد mutual exclusion).
function GoldRow({ label, st, set, rateTola, disabled = false }) {
  // Enter-to-advance focus flow (per-row ref, so wazan → this row's own rate):
  // wazan → (Enter) → rate → (Enter) → blur. point is skipped in the flow —
  // Enter inside point just blurs. Purely focus movement; no data changes.
  const rateRef = useRef(null)
  const onEnterFocusRate = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (rateRef.current) rateRef.current.focus() } }
  const onEnterBlur = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }
  const wazan = Number(st.wazan) || 0
  const point = Number(st.point) || 0
  // "point" is a purity reading where 100 = maiyar/standard. It adjusts gold on
  // the ratti scale (96 ratti per tola): point>100 deducts, point<100 adds,
  // point=100 leaves wazan unchanged. Symmetric via (point - 100).
  const above = point - 100
  const deduction = (above / 100) * (wazan / GRAMS_PER_TOLA) * GRAMS_PER_RATTI
  const khalis = round(wazan - deduction, 3)
  const rate = st.rate === '' ? rateTola : Number(st.rate)
  const q = qeemat(khalis, rate)
  const lock = disabled ? ' opacity-50 cursor-not-allowed bg-gray-100' : ''
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="cell justify-end pr-1 urdu text-[15px] font-bold text-right leading-tight bg-white">
        {label}
      </div>
      <input dir="ltr" className={`inp-g text-center text-[15px] font-bold${lock}`} value={st.wazan} disabled={disabled}
        onChange={(e) => set({ ...st, wazan: e.target.value })} onKeyDown={onEnterFocusRate} placeholder="-" />
      <input dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`} value={st.point} disabled={disabled}
        onChange={(e) => set({ ...st, point: e.target.value })} onKeyDown={onEnterBlur} />
      <div className="cell cell-c text-[15px] font-bold">{khalis ? fmtNum(khalis) : '-'}</div>
      <input ref={rateRef} dir="ltr" className={`inp text-center text-[15px] font-bold${lock}`} value={st.rate} disabled={disabled}
        onChange={(e) => set({ ...st, rate: e.target.value })} onKeyDown={onEnterBlur} placeholder={fmtMoney(rateTola)} />
      <div className="cell cell-c text-[15px] font-bold">{q ? fmtMoney(q) : '-'}</div>
    </div>
  )
}

// One cash line: label (right) + ONE merged blank white cell across the four
// middle columns + a single green amount box in the far-left قیمت column.
function CashRow({ label, st, set }) {
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="cell justify-end pr-1 urdu text-[15px] font-bold text-right leading-tight bg-white">
        {label}
      </div>
      {/* merged empty cell spanning سونا وزن + پوائنٹ + خالص سونا + ریٹ */}
      <div className="cell bg-white" style={{ gridColumn: 'span 4' }}>&nbsp;</div>
      <input dir="ltr" className="inp-g text-center text-[15px] font-bold" value={st}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        placeholder="-" />
    </div>
  )
}

// Header row: dark section title fills the right-hand label column.
function Header({ title }) {
  return (
    <div className="grid flex-1 min-h-0" style={gridStyle}>
      <div className="hdr urdu bg-headerDark font-bold text-[15px]">{title}</div>
      <div className="hdr urdu font-bold text-[14px]">سونا وزن</div>
      <div className="hdr urdu font-bold text-[14px]">پوائنٹ</div>
      <div className="hdr urdu font-bold text-[14px]">خالص سونا</div>
      <div className="hdr urdu font-bold text-[14px]">ریٹ</div>
      <div className="hdr urdu font-bold text-[14px]">قیمت</div>
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
      className="cash-udhar flex flex-col h-full gap-y-1"
    >
      {/* نقد (Cash) */}
      <div className="flex flex-col border border-line bg-white overflow-hidden flex-[3]">
        <Header title="نقد" />
        <GoldRow label="فروخت" st={cashSell} set={setCashSell} rateTola={rateTola} disabled={hasData(cashBuy)} />
        <GoldRow label="نقد خریدا" st={cashBuy} set={setCashBuy} rateTola={rateTola} disabled={hasData(cashSell)} />
      </div>

      {/* ادھار (Credit) */}
      <div className="flex flex-col border border-line bg-white overflow-hidden flex-[6]">
        <Header title="ادھار" />
        <GoldRow label="تیزابی دیا" st={udharGive} set={setUdharGive} rateTola={rateTola} />
        <GoldRow label="تیزابی لیا" st={udharTake} set={setUdharTake} rateTola={rateTola} />
        <CashRow label="ادھار کیش دیا" st={udharCashGive} set={setUdharCashGive} />
        <CashRow label="ادھار کیش لیا" st={udharCashTake} set={setUdharCashTake} />

        {/* Bottom band: ٹوٹل | empty | سونا لین دین | yellow | کیش لین دین | yellow */}
        <div className="grid flex-1 min-h-0" style={gridStyle}>
          {/* col1 (right): ٹوٹل */}
          <div className="cell justify-end pr-1 urdu text-[13px] text-right bg-header font-bold">
            ٹوٹل :
          </div>
          {/* col2: khaali grey cell */}
          <div className="cell bg-header">&nbsp;</div>
          {/* col3: سونا لین دین label (right-aligned, allowed to overflow) */}
          <div className="cell justify-end pr-1 urdu text-[12px] font-bold whitespace-nowrap overflow-visible bg-header">
            سونا لین دین :
          </div>
          {/* col4: gold-ledger yellow box — only for a selected customer */}
          <input dir="ltr" className="inp-y text-center text-[14px] font-bold" value={customer.id ? fmtNum(ledger.balance_gold) : '-'} readOnly />
          {/* col5: کیش لین دین label */}
          <div className="cell justify-end pr-1 urdu text-[12px] font-bold whitespace-nowrap overflow-visible bg-header">
            کیش لین دین :
          </div>
          {/* col6 (left): cash-ledger yellow box — only for a selected customer */}
          <input dir="ltr" className="inp-y text-center text-[14px] font-bold" value={customer.id ? fmtMoney(ledger.balance_cash) : '-'} readOnly />
        </div>
      </div>
    </div>
  )
}
