import React, { useEffect, useRef, useState } from 'react'
import { fmtMoney } from '../logic/units.js'
import { useApp } from '../state/store.jsx'
import DateField from './DateField.jsx'

const hasApi = () => typeof window !== 'undefined' && window.api

// Date helpers — UI shows DD/MM/YYYY, value kept as ISO (yyyy-mm-dd).
const pad2 = (n) => String(n).padStart(2, '0')
const isoToDisp = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : '' }
const dispToIso = (s) => { const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null }
// Time (hh:mm AM/PM) from a full ISO timestamp.
const fmtTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(ts)
  if (isNaN(d)) return '-'
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${h}:${pad2(m)} ${ap}`
}

// ── REPORT COLUMN CONFIG — edit here to change columns per report. `total:true`
// marks the summed (bold کل رقم) column. Each entry is one row (no per-day sum).
const REPORTS = {
  akatha: {
    label: 'اکھٹا اخراجات',
    columns: [
      { label: 'رقم', get: (r) => fmtMoney(r.amount), num: true, total: true, raw: (r) => Number(r.amount) || 0 },
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'وقت', get: (r) => fmtTime(r.ts), num: true }
    ]
  },
  tafseeli: {
    label: 'تفصیلی اخراجات',
    columns: [
      { label: 'رقم', get: (r) => fmtMoney(r.amount), num: true, total: true, raw: (r) => Number(r.amount) || 0 },
      { label: 'تبصرہ', get: (r) => r.comment || '-' },
      { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
      { label: 'وقت', get: (r) => fmtTime(r.ts), num: true }
    ]
  }
}

const BTN = 'urdu text-[16px] font-bold text-black bg-gray-100 border border-gray-400 rounded-sm px-2 py-2.5 min-h-[58px] flex items-center justify-center text-center leading-snug break-words hover:bg-gray-200 active:bg-gray-300 transition-colors'

export default function AkhrajatForm({ open, onClose }) {
  const { rates } = useApp()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState('menu') // 'menu' | 'report'
  const [report, setReport] = useState(null)
  const [reportKey, setReportKey] = useState(null) // which report is open (for reloads)
  const [entryOpen, setEntryOpen] = useState(false)
  const [msg, setMsg] = useState(null)

  // WORKING date = the app's current settings date (rates.date), NOT the system
  // clock. Expenses are stamped with this so they belong to the day the operator
  // is working on, and so the bottom-bar کیش (which subtracts every expense with
  // date ≤ rates.date) includes an expense the instant it's added — even when the
  // settings date has been moved off the real today. Falls back to the system date
  // only if rates.date isn't ready yet.
  const now = new Date()
  const systemISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const todayISO = (rates && rates.date) || systemISO

  useEffect(() => {
    if (!open) return
    setFrom(todayISO); setTo(todayISO)
    setView('menu'); setReport(null); setEntryOpen(false); setMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const runReport = async (key) => {
    const rows = hasApi() ? (await window.api.getExpenses(from || undefined, to || undefined)) : []
    const cfg = REPORTS[key]
    const total = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
    setReport({ label: cfg.label, columns: cfg.columns, rows: rows || [], total, from, to })
    setReportKey(key)
    setView('report')
  }

  return (
    <div className="print-overlay fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-3 pt-[3vh]" onClick={onClose}>
      <div dir="rtl" className="print-root bg-gray-50 border border-gray-300 rounded-xl shadow-2xl w-[760px] max-w-[97vw] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="no-print shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-3">
          <h2 className="urdu font-bold text-[18px]">اخراجات</h2>
          <button type="button" onClick={onClose} title="بند کریں" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-200 hover:bg-white/20 transition-colors">✕</button>
        </div>

        {view === 'report' ? (
          <ReportView report={report} onBack={() => setView('menu')} onReload={() => reportKey && runReport(reportKey)} />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
            {/* Date filter */}
            <div className="w-[360px] flex flex-col gap-3 bg-white border border-gray-300 rounded-md p-3">
              <DateField label="From Date:" iso={from} setIso={setFrom} />
              <DateField label="To Date:" iso={to} setIso={setTo} />
            </div>

            {/* Three actions */}
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className={BTN} onClick={() => setEntryOpen(true)}>کھرچہ ڈالیں</button>
              <button type="button" className={BTN} onClick={() => runReport('akatha')}>اکھٹا اخراجات</button>
              <button type="button" className={BTN} onClick={() => runReport('tafseeli')}>تفصیلی اخراجات</button>
            </div>

            {msg && <div className="urdu text-[14px] font-bold text-gray-500 bg-white border border-gray-300 rounded px-3 py-2">{msg}</div>}
          </div>
        )}
      </div>

      {entryOpen && <EntryModal todayISO={todayISO} onClose={() => setEntryOpen(false)} />}
    </div>
  )
}

// ── Report view: per-entry rows + bold کل رقم total ──────────────────────────
function ReportView({ report, onBack, onReload }) {
  const { editExpense, removeExpense } = useApp()
  const [note, setNote] = useState('')
  const [editRow, setEditRow] = useState(null)
  if (!report) return null
  const { columns, rows, total, label, from, to } = report
  const totalIdx = columns.findIndex((c) => c.total)
  const rangeText = `تاریخ: ${isoToDisp(from) || 'ابتدا'} سے ${isoToDisp(to) || 'آج'} تک`

  // Column alignment: amount (the total column) right-aligned; date/time centred;
  // text (تبصرہ) right-aligned Urdu.
  const cellCls = (c) => c.total ? 'text-right tabular-nums' : c.num ? 'text-center tabular-nums' : 'text-right urdu'
  const dirOf = (c) => (c.num ? 'ltr' : 'rtl')

  // Reuses the shared Electron printToPDF export (Save dialog). @media print CSS
  // shows only .print-area, so only the header + table + total reach the PDF.
  const doPdf = async () => {
    if (!hasApi()) { setNote('PDF صرف ایپ میں دستیاب ہے'); setTimeout(() => setNote(''), 2500); return }
    const stamp = `${isoToDisp(from)}_${isoToDisp(to)}`.replace(/\//g, '-')
    const res = await window.api.exportPDF(`${String(label).replace(/\s+/g, '-')}_${stamp}.pdf`)
    if (res && res.ok) setNote('PDF محفوظ ہو گیا ✓')
    else if (!(res && res.canceled)) setNote('محفوظ نہیں ہو سکا')
    setTimeout(() => setNote(''), 2500)
  }

  // Edit / delete a single expense row. Both write to the DB (via the store, which
  // also refreshes the bottom-bar cash display) and then reload this report so the
  // table + total update on screen immediately.
  const onDelete = async (r) => {
    if (!window.confirm('کیا آپ واقعی یہ کھرچہ حذف کرنا چاہتے ہیں؟')) return
    await removeExpense(r.id)
    if (onReload) onReload()
  }
  const onSaveEdit = async (id, fields) => {
    await editExpense(id, fields)
    setEditRow(null)
    if (onReload) onReload()
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Action bar — NOT part of the PDF */}
      <div className="no-print shrink-0 flex items-center gap-2 bg-white border-b border-gray-200 px-4 py-2.5">
        <button type="button" onClick={onBack} className="urdu text-[13px] font-bold text-blue-700 border border-blue-200 rounded-md px-3 py-1.5 hover:bg-blue-50 transition-colors">← واپس</button>
        <div className="urdu text-[12px] font-bold text-gray-500 truncate">کل اندراج: {rows.length}</div>
        <div className="flex-1" />
        {note && <span className="urdu text-[12px] font-bold text-emerald-600">{note}</span>}
        <button type="button" onClick={doPdf} className="urdu text-[13px] font-bold text-white bg-rose-600 rounded-md px-3 py-1.5 hover:bg-rose-700 transition-colors">PDF ڈاؤن لوڈ</button>
      </div>

      {/* PRINTABLE report content — only this reaches the PDF */}
      <div className="print-area flex-1 min-h-0 overflow-auto bg-white p-6">
        <div className="mx-auto max-w-[820px]">
          {/* Header: report name + applied date range (bold) */}
          <div className="text-center">
            <h1 className="urdu font-bold text-[24px] text-black leading-snug">{label}</h1>
            <div className="urdu font-bold text-[15px] text-gray-800 mt-1" dir="rtl">{rangeText}</div>
          </div>
          <div className="border-b-2 border-gray-800 mt-3 mb-4" />

          {rows.length === 0 ? (
            <div className="urdu text-center text-gray-500 py-10 text-[14px] font-bold">اس عرصے میں کوئی اخراجات نہیں</div>
          ) : (
            <table className="w-full border-collapse text-[14px] border border-gray-800">
              <thead>
                <tr className="bg-gray-200">
                  {columns.map((c) => (
                    <th key={c.label} className={`border border-gray-600 px-3 py-2 font-bold urdu text-[15px] text-black ${c.total ? 'text-right' : c.num ? 'text-center' : 'text-right'}`}>{c.label}</th>
                  ))}
                  <th className="no-print border border-gray-600 px-2 py-2 font-bold urdu text-[13px] text-black w-[90px] text-center">ایکشن</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) => (
                      <td key={c.label} className={`border border-gray-400 px-3 py-1.5 font-semibold text-black ${cellCls(c)}`} dir={dirOf(c)}>{c.get(r)}</td>
                    ))}
                    <td className="no-print border border-gray-400 px-2 py-1 text-center whitespace-nowrap">
                      <button type="button" title="ترمیم" onClick={() => setEditRow(r)} className="w-7 h-7 rounded hover:bg-blue-100 text-blue-700 text-[15px]">✏️</button>
                      <button type="button" title="حذف" onClick={() => onDelete(r)} className="w-7 h-7 rounded hover:bg-red-100 text-red-600 text-[15px]">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* Bold, shaded total row with a heavy top border */}
                <tr className="bg-amber-100 font-bold text-[15px]">
                  {columns.map((c, i) => {
                    if (i === totalIdx) return <td key={c.label} className="border border-gray-800 border-t-2 px-3 py-2.5 text-right tabular-nums text-black" dir="ltr">{fmtMoney(total)}</td>
                    if (i === totalIdx + 1) return <td key={c.label} className="border border-gray-800 border-t-2 px-3 py-2.5 text-right urdu text-black">کل رقم :</td>
                    return <td key={c.label} className="border border-gray-800 border-t-2 px-3 py-2.5" />
                  })}
                  <td className="no-print border border-gray-800 border-t-2 px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {editRow && <ExpenseEditModal row={editRow} onSave={onSaveEdit} onClose={() => setEditRow(null)} />}
    </div>
  )
}

// ── کھرچہ میں ترمیم — edit an existing expense (amount + comment) ──────────────
function ExpenseEditModal({ row, onSave, onClose }) {
  const [amount, setAmount] = useState(String(row.amount ?? ''))
  const [comment, setComment] = useState(row.comment || '')
  const [err, setErr] = useState('')
  const amtRef = useRef(null)
  useEffect(() => { requestAnimationFrame(() => amtRef.current && amtRef.current.focus()) }, [])

  const onAmount = (e) => {
    const raw = e.target.value
    const cleaned = raw.replace(/[^\d.]/g, '')
    setAmount(cleaned)
    setErr(cleaned !== raw ? 'رقم میں صرف نمبر لکھیں' : '')
  }
  const save = () => {
    const amt = Number(amount) || 0
    if (!(amt > 0)) { setErr('رقم درج کریں'); amtRef.current && amtRef.current.focus(); return }
    if (!comment.trim()) { setErr('تبصرہ لکھیں'); return }
    onSave(row.id, { amount: amt, comment: comment.trim() })
  }
  const INP = 'w-full border border-gray-400 bg-white text-[16px] font-bold px-2 py-2 rounded-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" className="bg-white rounded-lg shadow-2xl w-[400px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-2.5">
          <h3 className="urdu font-bold text-[16px]">کھرچہ میں ترمیم</h3>
          <button onClick={onClose} className="w-7 h-7 rounded hover:bg-white/20">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="urdu text-[14px] font-bold text-black">رقم</span>
            <input ref={amtRef} dir="ltr" className={INP} value={amount} onChange={onAmount}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              inputMode="decimal" placeholder="0" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="urdu text-[14px] font-bold text-black">تبصرہ</span>
            <textarea dir="rtl" className={`${INP} h-20 resize-none`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="تبصرہ لکھیں (لازمی)" />
          </label>
          {err && <div className="urdu text-[13px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={save} className="urdu flex-1 rounded-md bg-blue-600 text-white text-[15px] font-bold py-2 hover:bg-blue-700">محفوظ کریں</button>
          <button onClick={onClose} className="urdu rounded-md border border-gray-300 bg-white text-gray-700 text-[14px] font-bold px-4 hover:bg-gray-100">بند</button>
        </div>
      </div>
    </div>
  )
}

// ── کھرچہ ڈالیں — entry form (amount + comment; date+time saved automatically) ──
function EntryModal({ todayISO, onClose }) {
  const { addExpense } = useApp()
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(null)
  const amtRef = useRef(null)
  const commentRef = useRef(null)

  // Auto-focus the amount field on open so the user can type immediately.
  useEffect(() => { requestAnimationFrame(() => amtRef.current && amtRef.current.focus()) }, [])
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  // Amount: NUMBERS ONLY. If letters/other chars are typed, strip them and show
  // an Urdu error so nothing non-numeric is accepted.
  const onAmount = (e) => {
    const raw = e.target.value
    const cleaned = raw.replace(/[^\d.]/g, '')
    setAmount(cleaned)
    setErr(cleaned !== raw ? 'رقم میں صرف نمبر لکھیں' : '')
  }

  const add = async () => {
    const amt = Number(amount) || 0
    if (!(amt > 0)) { setErr('رقم درج کریں'); amtRef.current && amtRef.current.focus(); return }
    if (!comment.trim()) { setErr('محفوظ کرنے سے پہلے تبصرہ لکھیں'); commentRef.current && commentRef.current.focus(); return }
    setErr('')
    // Route through the store so the bottom-bar cash DISPLAY re-derives (cash −
    // today's expenses). This writes the expense to the DB but touches no ledger.
    await addExpense({ amount: amt, comment: comment.trim(), date: todayISO })
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1000)
    // Clear fields, keep the form open, return focus to amount for the next entry.
    setAmount(''); setComment('')
    requestAnimationFrame(() => amtRef.current && amtRef.current.focus())
  }

  // Right-aligned + RTL so text/caret start from the RIGHT.
  const INP = 'w-full border border-gray-400 bg-white text-[16px] font-bold px-2 py-2 rounded-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" className="bg-white rounded-lg shadow-2xl w-[400px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-2.5">
          <h3 className="urdu font-bold text-[16px]">کھرچہ ڈالیں</h3>
          <div className="flex items-center gap-2">
            <span className={`urdu text-[12px] font-bold text-emerald-300 transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>محفوظ ہو گیا ✓</span>
            <button onClick={onClose} className="w-7 h-7 rounded hover:bg-white/20">✕</button>
          </div>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="urdu text-[14px] font-bold text-black">رقم</span>
            <input
              ref={amtRef}
              dir="ltr"
              className={INP}
              value={amount}
              onChange={onAmount}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commentRef.current && commentRef.current.focus() } }}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="urdu text-[14px] font-bold text-black">تبصرہ</span>
            <textarea
              ref={commentRef}
              dir="rtl"
              className={`${INP} h-20 resize-none`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="تبصرہ لکھیں (لازمی)"
            />
          </label>
          {err && <div className="urdu text-[13px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={add} className="urdu flex-1 rounded-md bg-emerald-600 text-white text-[15px] font-bold py-2 hover:bg-emerald-700">ایڈ کریں</button>
          <button onClick={onClose} className="urdu rounded-md border border-gray-300 bg-white text-gray-700 text-[14px] font-bold px-4 hover:bg-gray-100">بند</button>
        </div>
      </div>
    </div>
  )
}
