import React from 'react'
import { useApp } from '../state/store.jsx'
import { fmtNum, fmtMoney } from '../logic/units.js'

// Column definitions in display order (left -> right). The پرچی checkbox is the
// last (right-most) column; checking a row selects it for the لیب رسید.
const COLS = [
  { key: 'label', label: '', field: 'label', kind: 'rowlabel' },
  // Column 1 now shows khalis grams; editing it back-solves this row's factor.
  { key: 'khalisSona', label: 'خالص سونا(گرام)', field: 'khalisSona', editable: true, dp: 4 },
  // Milawat fi gram is editable: typing it back-solves point = 1 - milawat/g.
  { key: 'malawatPerGram', label: 'ملاوٹ فی گرام', field: 'malawatPerGram', editable: true, dp: 4 },
  { key: 'tola', label: 'تولہ', field: 'tola', editable: true, dp: 0 },
  { key: 'masha', label: 'ماشہ', field: 'masha', editable: true, dp: 0 },
  { key: 'ratti', label: 'رتی', field: 'ratti', editable: true, dp: 2 },
  { key: 'rate', label: 'سوناریٹ', field: 'rate', editable: true, money: true },
  { key: 'totalRaqam', label: 'ٹوٹل رقم', field: 'totalRaqam', editable: true, money: true },
  { key: 'labCharges', label: 'لیب چارجز', field: 'labCharges', editable: true, money: true },
  { key: 'baqiRaqam', label: 'باقی رقم', field: 'baqiRaqam', editable: true, money: true },
  { key: 'parchi', label: 'پرچی', field: 'parchi', kind: 'check' }
]

const OVR_KEY = {
  khalisSona: 'khalisSona',
  malawatPerGram: 'milawatFiGram',
  tola: 'tola',
  masha: 'masha',
  ratti: 'ratti',
  rate: 'rate',
  totalRaqam: 'totalRaqam',
  labCharges: 'labCharges',
  baqiRaqam: 'baqiRaqam'
}

// ONE shared grid template for the header and every data row, so all columns
// line up perfectly. Using CSS grid (not flex) is what guarantees alignment —
// flex + <input> intrinsic widths is what caused the brick-wall misalignment.
// Column widths. تولہ/ماشہ are EDITABLE inputs, so they're widened (~0.66fr, close
// to رتی) so a typed 2–3 digit value shows fully with cursor room. The extra width
// is taken (fr sum unchanged, so total table width + alignment stay identical) from
// the generously-sized money columns (سونا ریٹ / ٹوٹل رقم / باقی رقم), which stay
// above the لیب چارجز money column's 1.0fr so large amounts (e.g. 430,000) still fit.
// Order:
// label | khalisSona | milawat/g | tola | masha | ratti | rate | total | labCharges | baqi | parchi
const GRID = '108px 1.4fr 1.0fr 0.66fr 0.66fr 0.7fr 1.05fr 1.07fr 1.0fr 1.07fr 30px'

function Cell({ col, row }) {
  const { overrides, setCell, clearCell, toggleParchi } = useApp()
  const ovrKey = OVR_KEY[col.field]
  const rowOvr = overrides[row.key] || {}
  const isOverridden = ovrKey && rowOvr[ovrKey] !== undefined && rowOvr[ovrKey] !== ''

  if (col.kind === 'rowlabel') {
    // Bigger, bold, horizontally centred with balanced padding (hdr already
    // vertically centres) so the label sits cleanly with no lopsided dead space.
    return <div className="hdr justify-center px-2 text-[14px] font-bold whitespace-nowrap min-w-0">{row.label}</div>
  }

  if (col.kind === 'check') {
    return (
      <div className="cell cell-c min-w-0">
        <input
          type="checkbox"
          checked={!!row.parchi}
          onChange={() => toggleParchi(row.key)}
        />
      </div>
    )
  }

  const display = col.money
    ? row[col.field] ? fmtMoney(row[col.field]) : '-'
    : fmtNum(row[col.field], col.dp ?? 3)

  if (!col.editable) {
    return <div className="cell cell-c min-w-0">{display}</div>
  }

  return (
    <input
      dir="ltr"
      className={`cell cell-c editable text-center min-w-0 w-full ${isOverridden ? 'overridden' : ''}`}
      value={isOverridden ? rowOvr[ovrKey] : ''}
      placeholder={display}
      title="کلک کر کے اپنی قیمت لکھیں — Edit to override the formula"
      onChange={(e) => {
        const v = e.target.value
        // Empty -> revert this cell to the formula.
        if (v === '') { clearCell(row.key, ovrKey); return }

        const isTMR = col.field === 'tola' || col.field === 'masha' || col.field === 'ratti'

        // khalisSona, ملاوٹ فی گرام, the tola/masha/ratti trio, fineness and a Baqi
        // edit are all "purity drivers" — each sets this row's khalis/point a
        // different way, so editing one must drop the others (last edit wins).
        if (col.field === 'khalisSona') {
          clearCell(row.key, 'tola'); clearCell(row.key, 'masha'); clearCell(row.key, 'ratti')
          clearCell(row.key, 'fineness'); clearCell(row.key, 'milawatFiGram'); clearCell(row.key, 'baqiRaqam')
        }
        // ملاوٹ فی گرام edit: rate stays at the header value, khalis re-derives from
        // point = 1 - milawat/g. Drop the other khalis-drivers and a stale total.
        if (col.field === 'malawatPerGram') {
          clearCell(row.key, 'khalisSona'); clearCell(row.key, 'fineness')
          clearCell(row.key, 'tola'); clearCell(row.key, 'masha'); clearCell(row.key, 'ratti')
          clearCell(row.key, 'baqiRaqam'); clearCell(row.key, 'totalRaqam')
        }
        if (isTMR) {
          clearCell(row.key, 'khalisSona'); clearCell(row.key, 'fineness')
          clearCell(row.key, 'milawatFiGram'); clearCell(row.key, 'baqiRaqam')
          // Seed the other two TMR cells from the current values so a single-cell
          // edit back-solves correctly (a blank sibling would read as 0).
          for (const k of ['tola', 'masha', 'ratti']) {
            if (k !== col.field && (rowOvr[k] === undefined || rowOvr[k] === '')) {
              setCell(row.key, k, String(row[k]))
            }
          }
        }
        // Baqi reverse-calc holds the rate FIXED and back-solves khalis — so it
        // must drop every other driver for this row (khalis/milawat/TMR/rate/total).
        if (col.field === 'baqiRaqam') {
          clearCell(row.key, 'khalisSona'); clearCell(row.key, 'fineness'); clearCell(row.key, 'milawatFiGram')
          clearCell(row.key, 'tola'); clearCell(row.key, 'masha'); clearCell(row.key, 'ratti')
          clearCell(row.key, 'rate'); clearCell(row.key, 'totalRaqam')
        }
        // Editing rate/total drops a stale Baqi override so they don't fight.
        if (col.field === 'rate' || col.field === 'totalRaqam') {
          clearCell(row.key, 'baqiRaqam')
        }
        setCell(row.key, ovrKey, v)
      }}
    />
  )
}

export default function PurityTable() {
  const { computedRows } = useApp()
  return (
    <div className="purity-table border border-line bg-white">
      {/* header — same grid template as the rows */}
      <div className="grid" style={{ gridTemplateColumns: GRID, height: 34 }}>
        <div className="hdr min-w-0"> </div>
        {COLS.slice(1).map((c) => (
          <div key={c.key} className="hdr urdu leading-[1.1] text-[10px] min-w-0">{c.label}</div>
        ))}
      </div>
      {/* rows */}
      {computedRows.map((row) => (
        <div key={row.key} className="grid" style={{ gridTemplateColumns: GRID, height: 26 }}>
          {COLS.map((c) => (
            <Cell key={c.key} col={c} row={row} />
          ))}
        </div>
      ))}
    </div>
  )
}
