import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

const CAT_LABEL = {
  gold_sell: 'سونا فروخت (نقد)',
  gold_buy: 'سونا خرید (نقد)',
  gold_give: 'سونا دیا (ادھار)',
  gold_take: 'سونا لیا (ادھار)',
  cash_give: 'کیش دیا',
  cash_take: 'کیش لیا',
  lab_job: 'لیب کام',
  kacha_gold_take: 'کچا سونا لیا'
}

const KIND_LABEL = { cash: 'نقد', udhar: 'ادھار', lab: 'لیب' }

// ── ONE source of truth for the table ────────────────────────────────────────
// Header, body and totals footer are ALL generated from this array; a real
// <table table-layout:fixed> + <colgroup> built from these widths guarantees
// the three sections share identical columns (no staircase, no drift).
// dir="rtl" on the table ⇒ first entry (وقت) is the RIGHTMOST column.
const COLUMNS = [
  { key: 'time', label: 'وقت', width: '90px', num: true },
  { key: 'receipt_no', label: 'رسید نمبر', width: '70px', num: true },
  { key: 'category', label: 'قسم', width: '120px' },
  { key: 'customer', label: 'گاہک', width: '1fr' },
  { key: 'sona_wazan', label: 'سونا وزن', width: '90px', num: true, total: 'wazan' },
  { key: 'point', label: 'پوائنٹ', width: '70px', num: true },
  { key: 'khalis_sona', label: 'خالص سونا', width: '90px', num: true, total: 'khalis' },
  { key: 'sona_diya', label: 'سونا دیا', width: '90px', num: true, total: 'sonaDiya' },
  { key: 'cash_diya', label: 'کیش دیا', width: '100px', num: true, total: 'cashDiya', money: true },
  { key: 'rate', label: 'ریٹ', width: '90px', num: true },
  { key: 'qeemat', label: 'قیمت', width: '110px', num: true, total: 'qeemat', money: true },
  { key: 'cash', label: 'کیش', width: '110px', num: true, total: 'cash', money: true }
]
// the میزان label spans every column before the first totalled one
const LABEL_SPAN = COLUMNS.findIndex((c) => c.total)

// 12-hour time (e.g. "12:56 pm") — always inside dir="ltr" so AM/PM never flips.
const time12 = (ts) => {
  const d = new Date(ts)
  return isNaN(d) ? '-' : d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
}

// Local today as yyyy-mm-dd (toISOString would shift the date across midnight UTC).
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// numeric run inside the RTL table — digits/decimals/minus never mirror
const Num = ({ children }) => <span dir="ltr" className="tabular-nums">{children}</span>

export default function Daybook() {
  const { setScreen, rates, hasApi } = useApp()
  const [date, setDate] = useState(rates.date || todayISO())
  const [data, setData] = useState({ txns: [], totals: { gold_in: 0, gold_out: 0, cash_in: 0, cash_out: 0 } })
  const [dates, setDates] = useState([]) // DESC (newest first) from listDates()
  const [fCat, setFCat] = useState('all')
  const [fKind, setFKind] = useState('all')
  const [fCust, setFCust] = useState('')

  useEffect(() => {
    if (!hasApi) return
    window.api.listDates().then((d) => setDates(d.map((x) => x.date)))
  }, [hasApi, data])

  useEffect(() => {
    if (!hasApi) return
    window.api.getDaybook(date).then(setData)
  }, [date, hasApi])

  // قبل/اگلا jump between dates that actually HAVE transactions (ISO compares lexically)
  const olderDate = useMemo(() => dates.find((d) => d < date) || null, [dates, date])
  const newerDate = useMemo(() => [...dates].reverse().find((d) => d > date) || null, [dates, date])

  // client-side filters (AND) over the loaded day
  const filtered = useMemo(() => {
    const q = fCust.trim()
    return data.txns.filter((x) =>
      (fCat === 'all' || x.category === fCat) &&
      (fKind === 'all' || x.kind === fKind) &&
      (q === '' || (x.customer_name || '').includes(q))
    )
  }, [data.txns, fCat, fKind, fCust])

  // tfoot totals over the CURRENTLY FILTERED rows (cards keep full-day backend totals)
  const ft = useMemo(() => {
    const s = { wazan: 0, khalis: 0, sonaDiya: 0, cashDiya: 0, qeemat: 0, cash: 0 }
    for (const x of filtered) {
      s.wazan += x.sona_wazan || 0
      s.khalis += x.khalis_sona || 0
      s.sonaDiya += x.sona_diya || 0
      s.cashDiya += x.cash_diya || 0
      s.qeemat += x.qeemat || 0
      s.cash += x.cash_amount || 0
    }
    return s
  }, [filtered])

  const t = data.totals

  // one body cell, rendered from its COLUMNS entry
  const cellContent = (col, x) => {
    switch (col.key) {
      case 'time': return <Num>{time12(x.ts)}</Num>
      case 'receipt_no': return <Num>{x.receipt_no || '-'}</Num>
      case 'category': {
        const tone = x.direction === 'in'
          ? 'text-green-700 border-green-300 bg-green-50'
          : x.direction === 'out'
            ? 'text-rose-700 border-rose-300 bg-rose-50'
            : 'text-gray-700 border-gray-300 bg-gray-50'
        return (
          <span className={`urdu inline-block text-[13px] font-bold leading-tight border rounded px-1.5 py-[1px] ${tone}`}>
            {CAT_LABEL[x.category] || x.category}
          </span>
        )
      }
      case 'customer': return <span className="urdu">{x.customer_name || '-'}</span>
      case 'sona_wazan': return <Num>{x.sona_wazan ? fmtNum(x.sona_wazan) : '-'}</Num>
      case 'point': return <Num>{x.point ? fmtNum(x.point, 0) : '-'}</Num>
      case 'khalis_sona': return <Num>{x.khalis_sona ? fmtNum(x.khalis_sona) : '-'}</Num>
      case 'sona_diya': return <Num>{x.sona_diya ? fmtNum(x.sona_diya) : '-'}</Num>
      case 'cash_diya': return <Num>{x.cash_diya ? fmtMoney(x.cash_diya) : '-'}</Num>
      case 'rate': return <Num>{x.rate ? fmtMoney(x.rate) : '-'}</Num>
      case 'qeemat': return <Num>{x.qeemat ? fmtMoney(x.qeemat) : '-'}</Num>
      case 'cash': return <Num>{x.cash_amount ? fmtMoney(x.cash_amount) : '-'}</Num>
      default: return '-'
    }
  }

  const totalContent = (col) => {
    if (!col.total) return ''
    const v = ft[col.total]
    if (!v) return '-'
    return <Num>{col.money ? fmtMoney(v) : fmtNum(v)}</Num>
  }

  const doPrint = async () => {
    // wide 12-column table → landscape page; dialog print, NOT the silent thermal path
    const st = document.createElement('style')
    st.id = 'daybook-page-style'
    st.textContent = '@page { size: A4 landscape; margin: 8mm; }'
    document.head.appendChild(st)
    try {
      if (hasApi && window.api.printPage) await window.api.printPage({ silent: false })
      else window.print()
    } finally {
      st.remove()
    }
  }

  // CSV of the VISIBLE (filtered) rows, Urdu headers, UTF-8 BOM for Excel.
  const doCsv = () => {
    const heads = ['وقت', 'رسید نمبر', 'قسم', 'نقد/ادھار/لیب', 'گاہک', 'سونا وزن', 'پوائنٹ', 'خالص سونا', 'سونا دیا', 'کیش دیا', 'ریٹ', 'قیمت', 'کیش']
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [heads.join(',')]
    for (const x of filtered) {
      lines.push([
        time12(x.ts), x.receipt_no ?? '', CAT_LABEL[x.category] || x.category || '',
        KIND_LABEL[x.kind] || x.kind || '', x.customer_name || '',
        x.sona_wazan || 0, x.point || 0, x.khalis_sona || 0,
        x.sona_diya || 0, x.cash_diya || 0,
        x.rate || 0, x.qeemat || 0, x.cash_amount || 0
      ].map(esc).join(','))
    }
    const blob = new Blob([String.fromCharCode(0xfeff) + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `daybook-${date}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const btn = 'btn urdu text-[14px] px-3 py-1.5'

  return (
    <div dir="rtl" className="flex flex-col h-full w-full overflow-hidden bg-panel">
      {/* header bar: واپس (rightmost in RTL) · title · date nav · پرنٹ/CSV */}
      <div className="no-print flex items-center gap-2 bg-panel border-b border-line px-2 py-2 flex-wrap">
        <button className="tab tab-active urdu text-[14px] px-3 py-1.5" onClick={() => setScreen('main')}>واپس ←</button>
        <h1 className="urdu text-xl font-bold">روزنامچہ</h1>
        <div className="flex items-center gap-1 mr-2">
          <button className={`${btn} disabled:opacity-40`} title="پچھلی تاریخ جس میں اندراج ہیں"
            disabled={!olderDate} onClick={() => olderDate && setDate(olderDate)}>قبل ›</button>
          <input dir="ltr" className="inp w-40 text-center text-[14px] h-[34px]" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className={`${btn} disabled:opacity-40`} title="اگلی تاریخ جس میں اندراج ہیں"
            disabled={!newerDate} onClick={() => newerDate && setDate(newerDate)}>‹ اگلا</button>
          <button className={btn} onClick={() => setDate(todayISO())}>آج</button>
        </div>
        <div className="flex-1" />
        <button className={btn} onClick={doPrint}>پرنٹ 🖨</button>
        <button className="btn text-[14px] px-3 py-1.5" onClick={doCsv}>CSV ⬇</button>
      </div>

      {/* full-day summary cards (backend totals) — RTL: سونا آمد rightmost */}
      <div className="no-print grid grid-cols-4 gap-2 p-2">
        <Card title="سونا آمد" value={t.gold_in ? fmtNum(t.gold_in) : '0'} unit="گرام" in1 />
        <Card title="سونا برآمد" value={t.gold_out ? fmtNum(t.gold_out) : '0'} unit="گرام" />
        <Card title="کیش آمد" value={t.cash_in ? fmtMoney(t.cash_in) : '0'} unit="روپے" in1 />
        <Card title="کیش برآمد" value={t.cash_out ? fmtMoney(t.cash_out) : '0'} unit="روپے" />
      </div>

      {/* filter bar — client-side, AND-combined, live count */}
      <div className="no-print flex items-center gap-2 px-2 pb-1 flex-wrap">
        <span className="urdu text-[14px] font-bold">قسم:</span>
        <select className="inp w-48 text-[14px] h-[34px]" value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="all">سب</option>
          {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="urdu text-[14px] font-bold">نقد/ادھار/لیب:</span>
        <select className="inp w-32 text-[14px] h-[34px]" value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="all">سب</option>
          <option value="cash">نقد</option>
          <option value="udhar">ادھار</option>
          <option value="lab">لیب</option>
        </select>
        <span className="urdu text-[14px] font-bold">گاہک:</span>
        <input className="inp w-48 urdu text-[14px] h-[34px]" value={fCust} onChange={(e) => setFCust(e.target.value)} placeholder="نام سے تلاش" />
        <span className="urdu text-[14px] font-bold text-gray-700 mr-auto">{filtered.length} اندراجات</span>
      </div>

      {/* table region = the ONLY printable area (plus its print-only heading) */}
      <div className="print-area flex-1 overflow-auto px-2 pb-2">
        <div className="hidden print:block urdu text-center font-bold text-[16px] pb-1">
          روزنامچہ — {date}
          <span className="text-[13px] font-normal mr-3">
            (سونا آمد {fmtNum(t.gold_in) || 0} · سونا برآمد {fmtNum(t.gold_out) || 0} · کیش آمد {fmtMoney(t.cash_in) || 0} · کیش برآمد {fmtMoney(t.cash_out) || 0})
          </span>
        </div>

        {/* real table, fixed layout + colgroup: header/body/footer share EXACTLY
            the same columns. No flex/grid inside cells' display — plain cells. */}
        <table dir="rtl" className="w-full bg-white border border-line" style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={c.width === '1fr' ? undefined : { width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}
                  className="urdu sticky top-0 z-10 bg-gray-100 text-[15px] font-bold text-center px-1 py-1.5 border-b-2 border-line border-l border-l-gray-300 whitespace-nowrap overflow-hidden">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="text-center urdu py-5 text-[14px] text-gray-500">
                  {data.txns.length === 0 ? 'اس دن کوئی لین دین نہیں' : 'اس فلٹر پر کوئی اندراج نہیں'}
                </td>
              </tr>
            )}
            {filtered.map((x) => (
              <tr key={x.id} className="odd:bg-white even:bg-gray-50 hover:bg-amber-50">
                {COLUMNS.map((c) => (
                  <td key={c.key}
                    className={`text-center align-middle px-1 py-1.5 text-[14px] border-b border-gray-200 border-l border-l-gray-100 overflow-hidden text-ellipsis whitespace-nowrap ${c.num ? 'font-semibold' : ''}`}>
                    {cellContent(c, x)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {/* totals footer: mapped from the SAME COLUMNS; label spans the columns
              before the first totalled one (count derived, not hardcoded) */}
          <tfoot>
            <tr>
              <td colSpan={LABEL_SPAN}
                className="urdu sticky bottom-0 z-10 bg-gray-100 text-[15px] font-bold text-left pl-3 px-1 py-1.5 border-t-2 border-line">
                میزان (فلٹر شدہ {filtered.length} اندراجات)
              </td>
              {COLUMNS.slice(LABEL_SPAN).map((c) => (
                <td key={c.key}
                  className="sticky bottom-0 z-10 bg-gray-100 text-[15px] font-bold text-center px-1 py-1.5 border-t-2 border-line border-l border-l-gray-300 whitespace-nowrap overflow-hidden">
                  {totalContent(c)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function Card({ title, value, unit, in1 }) {
  return (
    <div className={`border border-line bg-white p-2 text-center border-r-4 ${in1 ? 'border-r-green-600' : 'border-r-rose-600'} min-h-[64px] flex flex-col justify-center`}>
      <div className={`urdu text-[14px] font-bold ${in1 ? 'text-green-700' : 'text-rose-700'}`}>{title}</div>
      <div dir="ltr" className="text-[24px] font-bold tabular-nums leading-tight">
        {value} <span className="urdu text-[13px] font-normal text-gray-600">{unit}</span>
      </div>
    </div>
  )
}
