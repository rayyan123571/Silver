import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, round } from '../logic/units.js'

const INPUT =
  'w-full bg-white border border-gray-300 rounded-md text-[14px] px-3 py-2 text-start ' +
  'tabular-nums cursor-text outline-none transition-colors ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

// Four manual adjustments. target = which bottom-bar total; direction = add/subtract.
//   رقم لی → کیش +   |   رقم دی → کیش −   |   تیزابی لیا → تیزابی +   |   تیزابی دیا → تیزابی −
const ROWS = [
  { key: 'cashIn', label: 'رقم لی', target: 'cash', direction: 'in', metric: 'cash' },
  { key: 'cashOut', label: 'رقم دی', target: 'cash', direction: 'out', metric: 'cash' },
  { key: 'goldIn', label: 'تیزابی لیا', target: 'gold', direction: 'in', metric: 'gold' },
  { key: 'goldOut', label: 'تیزابی دیا', target: 'gold', direction: 'out', metric: 'gold' }
]

// اندراج — manual balance adjustment modal. Each اپلائی inserts a ONE-SHOT
// 'adjustment' transaction (see store.addAdjustment → db.addAdjustment) that nudges
// the bottom-bar کیش / تیزابی total once; inputs always start and return to empty
// (stored values are never loaded back), so it can never re-apply.
export default function IndrajForm({ open, onClose }) {
  const { addAdjustment } = useApp()
  const [vals, setVals] = useState({ cashIn: '', cashOut: '', goldIn: '', goldOut: '' })
  const [msgs, setMsgs] = useState({})
  const [busy, setBusy] = useState('')
  const timers = useRef({})

  // Clear any pending message timers on unmount.
  useEffect(() => () => { Object.values(timers.current).forEach((t) => clearTimeout(t)) }, [])

  if (!open) return null

  const setMsg = (key, m) => {
    setMsgs((s) => ({ ...s, [key]: m }))
    if (timers.current[key]) clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => setMsgs((s) => ({ ...s, [key]: null })), 4500)
  }

  // Accept digits and a single decimal point only.
  const onNum = (key) => (e) => {
    const v = e.target.value.replace(/[^\d.]/g, '')
    setVals((s) => ({ ...s, [key]: v }))
  }

  const apply = async (row) => {
    if (busy) return
    const raw = String(vals[row.key] ?? '').trim()
    const num = Number(raw)
    if (!raw || !Number.isFinite(num) || num <= 0) { setMsg(row.key, { err: 'صحیح رقم لکھیں' }); return }
    const amount = row.target === 'gold' ? round(num, 3) : num
    setBusy(row.key)
    try {
      const res = await addAdjustment({ target: row.target, direction: row.direction, amount, note: `دستی اندراج: ${row.label}` })
      if (res && res.ok) {
        const total = row.metric === 'cash'
          ? `نیا کیش: ${fmtMoney(res.newCash)}`
          : `نیا تیزابی: ${fmtNum(res.newTezabi, 3)} گرام`
        setMsg(row.key, { ok: `ہو گیا ✓ ${total}` })
        setVals((s) => ({ ...s, [row.key]: '' })) // always return to empty
      } else {
        setMsg(row.key, { err: 'ناکام — دوبارہ کوشش کریں' })
      }
    } catch {
      setMsg(row.key, { err: 'ناکام — دوبارہ کوشش کریں' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative bg-gray-50 border border-gray-300 rounded-lg shadow-2xl w-[440px] max-w-[95vw] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
          <h2 className="urdu font-bold text-[16px] text-gray-800">اندراج</h2>
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3.5">
          <p className="urdu text-[12px] text-gray-500 -mt-1">دستی طور پر کیش یا تیزابی ٹوٹل کم / زیادہ کریں</p>
          {ROWS.map((row) => (
            <div key={row.key} className="grid grid-cols-[92px_1fr_auto] gap-2 items-center">
              <label className="urdu font-bold text-[14px] text-gray-700 text-right">{row.label}</label>
              <input
                dir="ltr"
                className={INPUT}
                value={vals[row.key]}
                onChange={onNum(row.key)}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(row) }}
                inputMode="decimal"
                placeholder={row.target === 'gold' ? '0.000' : '0'}
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => apply(row)}
                className="urdu shrink-0 text-[13px] font-bold text-white bg-emerald-600 rounded-md px-3 py-2 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
              >
                اپلائی
              </button>
              {msgs[row.key] && (
                <div className={`col-span-3 urdu text-[12px] text-right -mt-1 ${msgs[row.key].err ? 'text-red-600' : 'text-emerald-600'}`}>
                  {msgs[row.key].err || msgs[row.key].ok}
                </div>
              )}
            </div>
          ))}

          <div className="pt-2 border-t border-gray-200 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="urdu text-[13px] font-bold text-gray-700 bg-white border border-gray-300 rounded-md px-5 py-2 hover:bg-gray-100 transition-colors"
            >
              بند کریں
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
