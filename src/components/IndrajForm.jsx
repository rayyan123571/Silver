import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, round } from '../logic/units.js'
import UnitSelect, { UNITS, DEFAULT_UNIT, unitOf } from './UnitSelect.jsx'

const INPUT =
  'w-full bg-white border border-gray-300 rounded-md text-[14px] px-3 py-2 text-start ' +
  'tabular-nums cursor-text outline-none transition-colors ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

// Size the shared UnitSelect to match INPUT exactly — same text size, same py, so
// the picker and the amount field are the same height and read as siblings. pl-7
// is the room the chevron needs on the left.
const SELECT_SIZE = 'text-[14px] pr-3 pl-7 py-2'

// ONE grid for all four rows, so the inputs line up down the column:
//   [130px]  identity — cash label, or the unit dropdown (filling the column)
//   [18px]   direction hint (لی / دی) — چاندی rows only, empty on cash rows
//   [1fr]    the amount input — same width in EVERY row
//   [auto]   اپلائی
// 130px is sized off the dropdown's longest option (10 تولہ بار): minus the
// select's own pr-3 + pl-7 padding it leaves ~90px of text room, so nothing wraps
// or truncates.
const ROW_GRID = 'grid-cols-[130px_18px_1fr_auto]'

// UNITS / DEFAULT_UNIT / unitOf now live in UnitSelect.jsx (shared with the
// نقد/ادھار panel). Here a unit's `v` doubles as the addAdjustment target, and
// `count: true` means the number typed is a COUNT of physical items: it lands on
// its own bottom-bar counter and adds NO grams to the چاندی total — grams and
// counts are separate ledgers (see addAdjustment / getShopTotals in db.cjs).
// UNITS[0] is the default: plain grams, the original behaviour.

// Four manual adjustments. direction = add/subtract; metric = which family.
//   رقم لی → کیش +   |   رقم دی → کیش −   |   چاندی لی → چاندی +   |   چاندی دی → چاندی −
// The two چاندی rows carry `unit: true`: their target is whatever unit the row's
// dropdown holds (grams by default, else a piece/bar counter), NOT a fixed 'gold'.
// The two cash rows have no dropdown — their target is always 'cash'.
//
// `label` is the on-screen label; `noteLabel` (چاندی rows only) is what goes into
// the SAVED note. The چاندی rows show a bare لی / دی because the dropdown beside
// them already names the metal — but the note is read later, on its own, in the
// اندراج report, where "دستی اندراج: لی" would say nothing. So the note keeps the
// full wording and only the UI is shortened.
const ROWS = [
  { key: 'cashIn', label: 'رقم لی', target: 'cash', direction: 'in', metric: 'cash' },
  { key: 'cashOut', label: 'رقم دی', target: 'cash', direction: 'out', metric: 'cash' },
  { key: 'goldIn', label: 'لی', noteLabel: 'چاندی لی', direction: 'in', metric: 'gold', unit: true },
  { key: 'goldOut', label: 'دی', noteLabel: 'چاندی دی', direction: 'out', metric: 'gold', unit: true }
]

// اندراج — manual balance adjustment modal. Each اپلائی inserts a ONE-SHOT
// 'adjustment' transaction (see store.addAdjustment → db.addAdjustment) that nudges
// EXACTLY ONE bottom-bar counter once — کیش, چاندی (grams), or one of the four
// piece/bar inventory counts, whichever the row's unit says. Inputs always start
// and return to empty (stored values are never loaded back), so it can never
// re-apply.
export default function IndrajForm({ open, onClose }) {
  const { addAdjustment } = useApp()
  const [vals, setVals] = useState({ cashIn: '', cashOut: '', goldIn: '', goldOut: '' })
  // Per-چاندی-row unit. Like `vals`, it resets after a successful اپلائی, so the
  // form never sits on a stale unit from the last entry.
  const [units, setUnits] = useState({ goldIn: DEFAULT_UNIT, goldOut: DEFAULT_UNIT })
  const [msgs, setMsgs] = useState({})
  const [busy, setBusy] = useState('')
  const timers = useRef({})

  // The addAdjustment target for a row: the dropdown's unit on a چاندی row, the
  // row's fixed target ('cash') otherwise.
  const targetOf = (row) => (row.unit ? units[row.key] : row.target)

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
    const target = targetOf(row)
    const unit = unitOf(target)          // UNITS[0] (grams) for the cash rows — unused there
    // A unit row (پیس / bars) is now WEIGHED, exactly like the چاندی option: its box
    // accumulates grams, not a count. So there is no integer guard and no grams→count
    // conversion — every چاندی-row target takes the same decimal grams.
    const isUnit = !!row.unit && unit.count
    const raw = String(vals[row.key] ?? '').trim()
    const num = Number(raw)
    if (!raw || !Number.isFinite(num) || num <= 0) { setMsg(row.key, { err: 'صحیح رقم لکھیں' }); return }
    // Every چاندی-row target is grams (3dp); cash passes through as typed.
    const amount = row.unit ? round(num, 3) : num
    setBusy(row.key)
    try {
      // The note uses noteLabel (the FULL "چاندی لی"), not the short on-screen
      // label — see ROWS. Unit entries also name their unit, so the اندراج row is
      // readable ("دستی اندراج: چاندی لی (1 تولہ بار)") rather than an untagged number.
      const note = `دستی اندراج: ${row.noteLabel || row.label}${isUnit ? ` (${unit.label})` : ''}`
      const res = await addAdjustment({ target, direction: row.direction, amount, note })
      if (res && res.ok) {
        // Every box is grams now, so every metal message reads in گرام at 3dp.
        const total = row.metric === 'cash'
          ? `نیا کیش: ${fmtMoney(res.newCash)}`
          : isUnit
            ? `نیا ${unit.label}: ${fmtNum(Number(res.newUnitGrams) || 0, 3)} گرام`
            : `نئی چاندی: ${fmtNum(res.newTezabi, 3)} گرام`
        setMsg(row.key, { ok: `ہو گیا ✓ ${total}` })
        setVals((s) => ({ ...s, [row.key]: '' })) // always return to empty
        if (row.unit) setUnits((s) => ({ ...s, [row.key]: DEFAULT_UNIT })) // …and to grams
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
          <p className="urdu text-[12px] text-gray-500 -mt-1">دستی طور پر کیش، چاندی یا پیس / بار ٹوٹل کم / زیادہ کریں</p>
          {ROWS.map((row) => {
            const input = (
              <input
                dir="ltr"
                className={INPUT}
                value={vals[row.key]}
                onChange={onNum(row.key)}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(row) }}
                inputMode="decimal"
                // EVERY چاندی-row target is a weight in grams now (چاندی, پیس and
                // the bars alike), so they all take decimals. Only کیش is a plain
                // rupee amount.
                placeholder={row.unit ? '0.000' : '0'}
              />
            )
            return (
              <div key={row.key} className={`grid ${ROW_GRID} gap-2 items-center`}>
                {/* col 1 (rightmost, RTL) — the row's identity: a static label on a
                    cash row, the unit picker on a چاندی row. Same slot, same width,
                    so every row's input starts at the same x. */}
                {row.unit ? (
                  <UnitSelect
                    className={SELECT_SIZE}
                    value={units[row.key]}
                    onChange={(e) => setUnits((s) => ({ ...s, [row.key]: e.target.value }))}
                  />
                ) : (
                  <label className="urdu font-bold text-[14px] text-gray-700 text-right">{row.label}</label>
                )}

                {/* col 2 — direction hint. Empty on the cash rows (their label already
                    says لی / دی); on the چاندی rows it is the ONLY thing separating
                    "add" from "subtract", since both now show the same dropdown. */}
                <span className="urdu text-[11px] font-bold text-gray-400 text-center leading-none">
                  {row.unit ? row.label : ''}
                </span>

                {/* col 3 — the amount. 1fr in every row, so all four inputs are the
                    same width and line up down the column. */}
                {input}

                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => apply(row)}
                  className="urdu shrink-0 text-[13px] font-bold text-white bg-emerald-600 rounded-md px-3 py-2 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
                >
                  اپلائی
                </button>
                {msgs[row.key] && (
                  <div className={`col-span-4 urdu text-[12px] text-right -mt-1 ${msgs[row.key].err ? 'text-red-600' : 'text-emerald-600'}`}>
                    {msgs[row.key].err || msgs[row.key].ok}
                  </div>
                )}
              </div>
            )
          })}

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
