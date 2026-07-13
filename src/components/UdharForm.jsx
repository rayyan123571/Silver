import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum, gramsToTMR } from '../logic/units.js'
import { CreditReceipt, CashReceipt } from './Receipts.jsx'
import DateField from './DateField.jsx'
import NayaSodaReport from './NayaSodaReport.jsx'

// ─── Report buttons, three groups. flow 'in' = INTO shop (green), 'out' = OUT (red)
const GROUP1 = [
  { label: 'چاندی لینی ہے', flow: 'out', category: 'gold_give', kind: 'gold' },
  { label: 'چاندی دینی ہے', flow: 'in', category: 'gold_take', kind: 'gold' },
  { label: 'رقم لینی ہے', flow: 'out', category: 'cash_give', kind: 'cash' },
  { label: 'رقم دینی ہے', flow: 'in', category: 'cash_take', kind: 'cash' }
]
const GROUP2 = [
  { label: 'آج کی ادھار رقم دی', flow: 'out', category: 'cash_give', kind: 'cash' },
  { label: 'آج کی ادھار رقم آمد', flow: 'in', category: 'cash_take', kind: 'cash' },
  { label: 'آج کا چاندی ادھار دیا', flow: 'out', category: 'gold_give', kind: 'gold' },
  { label: 'آج کا چاندی ادھار لیا', flow: 'in', category: 'gold_take', kind: 'gold' }
]
// نقد reports — the main-screen نقد panel saves with its OWN categories
// (gold_sell / gold_buy); no other button/report uses them, so these two can
// never pull or affect the ادھار data.
const NAQAD = [
  { label: 'نقد فروخت', category: 'gold_sell' },
  { label: 'نقد خرید', category: 'gold_buy' }
]
const CATS = [
  { v: 'gold_take', label: 'چاندی لی' },
  { v: 'gold_give', label: 'چاندی دی' },
  { v: 'cash_take', label: 'رقم لی' },
  { v: 'cash_give', label: 'رقم دی' }
]
const isGoldCat = (c) => c === 'gold_take' || c === 'gold_give'

const goldVal = (r) => Number(r.total_khalis ?? r.khalis_sona) || 0
// وزن: prefer the aggregated group-1 sum (total_wazan) when present, else the
// single row's sona_wazan, else fall back to the khalis figure. For ادھار gold
// entries point is always 100, so wazan == khalis and this matches the old display.
const wazanVal = (r) => Number(r.total_wazan ?? r.sona_wazan) || goldVal(r)
const cashVal = (r) => Number(r.total_cash ?? r.cash_amount) || 0

// ═══ REPORT COLUMN CONFIG — edit here to change columns per report. ═══
const goldColumns = ({ parchi = false, date = false } = {}) => {
  const c = []
  if (parchi) c.push({ label: 'پرچی نمبر', get: (r) => r.receipt_no, num: true })
  if (date) c.push({ label: 'تاریخ', get: (r) => r.date, num: true })
  c.push({ label: 'نام', get: (r) => r.customer_name || '-' })
  c.push({ label: 'تولہ', get: (r) => gramsToTMR(goldVal(r)).tola, num: true })
  c.push({ label: 'ماشہ', get: (r) => gramsToTMR(goldVal(r)).masha, num: true })
  c.push({ label: 'رتی', get: (r) => fmtNum(gramsToTMR(goldVal(r)).ratti, 2), num: true })
  c.push({ label: 'گرام', get: (r) => fmtNum(wazanVal(r)), num: true })
  c.push({ label: 'خالص چاندی', get: (r) => fmtNum(goldVal(r)), num: true, total: true, raw: (r) => goldVal(r) })
  return c
}
const cashColumns = ({ parchi = false, date = false } = {}) => {
  const c = []
  if (parchi) c.push({ label: 'پرچی نمبر', get: (r) => r.receipt_no, num: true })
  if (date) c.push({ label: 'تاریخ', get: (r) => r.date, num: true })
  c.push({ label: 'نام', get: (r) => r.customer_name || '-' })
  c.push({ label: 'نوٹ', get: (r) => r.note || '-' })
  c.push({ label: 'رقم', get: (r) => fmtMoney(cashVal(r)), num: true, total: true, raw: (r) => cashVal(r) })
  return c
}
// Columns for ONLY the "چاندی لینی ہے" / "چاندی دینی ہے" balance reports (g1).
// Like goldColumns but WITHOUT رتی and خالص چاندی, WITH a تاریخ column showing when
// the row's wazan was LAST UPDATED (updated_at, DD/MM/YYYY via isoToDisp; falls
// back to the entry date for rows not edited since updated_at was added). The
// total row is kept on گرام (for aggregate rows wazanVal === the khalis grams, so
// the total matches the old خالص total). goldColumns() is left untouched for the
// other gold reports (آج کا چاندی ادھار …).
const goldBalanceColumns = () => [
  { label: 'نام', get: (r) => r.customer_name || '-' },
  { label: 'تولہ', get: (r) => gramsToTMR(goldVal(r)).tola, num: true },
  { label: 'ماشہ', get: (r) => gramsToTMR(goldVal(r)).masha, num: true },
  { label: 'گرام', get: (r) => fmtNum(wazanVal(r)), num: true, total: true, raw: (r) => wazanVal(r) },
  { label: 'تاریخ', get: (r) => isoToDisp(r.updated_at || r.date), num: true }
]
// Columns for ONLY the نقد فروخت / نقد خرید reports — one row per saved naqad
// entry. Both خالص چاندی and قیمت carry totals; their fmtTotal marks them for the
// multi-total footer path in TableReport (reports without fmtTotal — all the
// existing ones — keep the old single-total footer unchanged).
const naqadColumns = () => [
  { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
  { label: 'نام', get: (r) => r.customer_name || '-' },
  { label: 'وزن', get: (r) => fmtNum(r.sona_wazan), num: true },
  { label: 'خالص چاندی', get: (r) => fmtNum(r.khalis_sona), num: true, total: true, raw: (r) => Number(r.khalis_sona) || 0, fmtTotal: (t) => `${fmtNum(t)} گرام` },
  { label: 'ریٹ', get: (r) => fmtMoney(r.rate), num: true },
  { label: 'قیمت', get: (r) => fmtMoney(r.qeemat), num: true, total: true, raw: (r) => Number(r.qeemat) || 0, fmtTotal: (t) => fmtMoney(t) }
]

// اندراج رپورٹ columns — تاریخ | قسم | رقم | چاندی (گرام). A row is a gold
// adjustment when it carries khalis_sona (> 0), else a cash one; قسم is derived
// from that + direction. رقم / چاندی each carry a fmtTotal so TableReport's
// multi-total footer shows the NET (لی − دی) via signed `raw`.
const adjIsGold = (r) => Number(r.khalis_sona) > 0
const adjKind = (r) => {
  const inn = r.direction === 'in'
  return adjIsGold(r) ? (inn ? 'چاندی لی' : 'چاندی دی') : (inn ? 'رقم لی' : 'رقم دی')
}
const adjustmentColumns = () => [
  { label: 'تاریخ', get: (r) => isoToDisp(r.date), num: true },
  { label: 'قسم', get: (r) => adjKind(r) },
  {
    label: 'رقم',
    num: true,
    get: (r) => (adjIsGold(r) ? '-' : fmtMoney(r.cash_amount)),
    total: true,
    raw: (r) => (adjIsGold(r) ? 0 : (r.direction === 'in' ? 1 : -1) * (Number(r.cash_amount) || 0)),
    fmtTotal: (t) => fmtMoney(t)
  },
  {
    label: 'چاندی (گرام)',
    num: true,
    get: (r) => (adjIsGold(r) ? fmtNum(r.khalis_sona, 3) : '-'),
    total: true,
    raw: (r) => (adjIsGold(r) ? (r.direction === 'in' ? 1 : -1) * (Number(r.khalis_sona) || 0) : 0),
    fmtTotal: (t) => `${fmtNum(t, 3)} گرام`
  }
]

const INP = 'w-full bg-white border border-gray-300 rounded-md text-[13px] px-2 py-1.5 text-start tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500'
const hasApiFn = () => typeof window !== 'undefined' && window.api

// Date helpers — the app stores/queries ISO (yyyy-mm-dd); the UI shows DD/MM/YYYY.
const pad2 = (n) => String(n).padStart(2, '0')
// Today's LOCAL date as ISO (yyyy-mm-dd) — the From/To filters default to this.
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const isoToDisp = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : '' }
const dispToIso = (s) => { const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null }

function FlowIcon({ flow }) {
  return flow === 'in' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
}
function ActionButton({ a, onClick }) {
  const inFlow = a.flow === 'in'
  return (
    <button type="button" onClick={onClick}
      className={`urdu flex items-center gap-2 rounded-xl px-3 py-3 text-[12.5px] font-semibold text-white shadow-sm ring-1 transition-all active:scale-[0.98] active:shadow-inner ${
        inFlow ? 'bg-emerald-600 ring-emerald-700/30 hover:bg-emerald-500 hover:shadow-md' : 'bg-rose-600 ring-rose-700/30 hover:bg-rose-500 hover:shadow-md'}`}>
      <span className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${inFlow ? 'bg-emerald-700/40' : 'bg-rose-700/40'}`}><FlowIcon flow={a.flow} /></span>
      <span className="text-right leading-tight">{a.label}</span>
    </button>
  )
}

export default function UdharForm({ open, onClose }) {
  const { getReport, getReportGroup1, getAdjustmentsReport, editTransaction, removeTransaction, resetData, hasApi, rates } = useApp()

  const [custCode, setCustCode] = useState('')
  const [custName, setCustName] = useState('')
  const [nameHits, setNameHits] = useState([])
  const nameTimer = useRef(null)
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [msg, setMsg] = useState(null)
  const [report, setReport] = useState(null)
  const [desc, setDesc] = useState(null)   // how to rebuild the current report
  const [view, setView] = useState('menu')
  const [editRow, setEditRow] = useState(null)
  const [customers, setCustomers] = useState([])
  // نیا سودا report modal — 'bhugtan' | 'bakaya' | null (closed). Reads only the
  // standalone naya_soda table; completely separate from the ledger reports.
  const [sodaStatus, setSodaStatus] = useState(null)

  // Live system date (LOCAL), NOT the app's setting date — both fields default to
  // the actual today (e.g. 02/07/2026). Computed fresh each render from new Date().
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  // Load the customer list for the code/name dropdowns when the form opens.
  useEffect(() => {
    if (!open || !hasApi) return
    window.api.listCustomersWithBalances().then((list) => setCustomers(list || []))
  }, [open, hasApi])

  useEffect(() => {
    if (!open) return
    setCustCode(''); setCustName(''); setNameHits([]); setMsg(null)
    setReport(null); setDesc(null); setView('menu'); setEditRow(null); setSodaStatus(null)
    setFrom(todayStr()); setTo(todayStr()) // default From/To to today; clearing From = all dates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reportTotal = useMemo(() => {
    if (!report || report.group === 3) return 0
    const col = (report.columns || []).find((c) => c.total)
    return col ? (report.rows || []).reduce((s, r) => s + (col.raw ? col.raw(r) : 0), 0) : 0
  }, [report])

  if (!open) return null

  const customerFilter = () => ({
    customerId: custCode.trim() ? Number(custCode.trim()) : undefined,
    name: custCode.trim() ? undefined : (custName.trim() || undefined)
  })
  const customerLabel = () => (custCode.trim() ? `کوڈ ${custCode}` : (custName.trim() || 'تمام کسٹمر'))

  const onNameSearch = (v) => {
    setCustName(v); setCustCode('')
    if (nameTimer.current) clearTimeout(nameTimer.current)
    if (!hasApi || !v.trim()) { setNameHits([]); return }
    nameTimer.current = setTimeout(async () => { setNameHits((await window.api.findCustomers(v)) || []) }, 200)
  }
  const pickCustomer = (c) => { setCustCode(String(c.id)); setCustName(c.name || ''); setNameHits([]) }

  // Build (or rebuild) a report from a descriptor. `silent` skips validation
  // messages (used when reloading after an edit/delete).
  const loadReport = async (d, silent = false) => {
    if (d.type === 'g1') {
      const a = d.a
      // NET balance per customer: give netted against take with the
      // getCustomerLedger sign (لینا = customer owes, دینا = shop owes).
      // The old per-category reportGroup1 stays available for other callers.
      const side = (a.category === 'gold_give' || a.category === 'cash_give') ? 'lena' : 'dena'
      const fn = a.kind === 'gold'
        ? (window.api && window.api.reportGoldBalanceNet)
        : (window.api && window.api.reportCashBalanceNet)
      const res = (hasApi && fn)
        ? await fn(side, { ...customerFilter() })
        : await getReportGroup1({ category: a.category, ...customerFilter() })
      setReport({ group: 1, kind: a.kind, gold: a.kind === 'gold', rows: res.rows || [], columns: a.kind === 'gold' ? goldBalanceColumns() : cashColumns({}), title: a.label, meta: { customer: customerLabel(), dateNote: 'تمام تواریخ (بیلنس)' } })
    } else if (d.type === 'g2') {
      const a = d.a
      // Date-RANGE report via the shared From/To fields. Blank dates keep the
      // old آج کی/آج کا habit (today only); only-from → from..today; only-to →
      // beginning..to; both → validated from..to (same rule/error as g3).
      if (from && to && from > to) { if (!silent) setMsg({ ok: false, text: 'فرام ڈیٹ ٹو ڈیٹ سے بڑی نہیں ہو سکتی' }); return }
      let f, t, dateNote
      if (!from && !to) {
        f = todayISO; t = todayISO; dateNote = todayISO
      } else if (from && !to) {
        f = from; t = todayISO
        dateNote = f === t ? f : `${isoToDisp(f)} تا ${isoToDisp(t)}`
      } else if (!from && to) {
        f = undefined; t = to; dateNote = `ابتدا تا ${isoToDisp(to)}`
      } else {
        f = from; t = to
        dateNote = f === t ? f : `${isoToDisp(f)} تا ${isoToDisp(t)}`
      }
      const res = await getReport({ category: a.category, from: f, to: t, ...customerFilter() })
      // noActions: the four daily GROUP2 reports never show the ایکشن column
      // (thermal on OR off) — view-only lists.
      setReport({ group: 2, kind: a.kind, gold: a.kind === 'gold', noActions: true, rows: res.rows || [], columns: a.kind === 'gold' ? goldColumns({ parchi: true, date: true }) : cashColumns({ parchi: true, date: true }), title: a.label, meta: { customer: customerLabel(), dateNote } })
    } else if (d.type === 'g3') {
      if (!(custCode.trim() || custName.trim())) { if (!silent) setMsg({ ok: false, text: 'پہلے کسٹمر منتخب کریں / نام درج کریں' }); return }
      if (from && to && from > to) { if (!silent) setMsg({ ok: false, text: 'فرام ڈیٹ ٹو ڈیٹ سے بڑی نہیں ہو سکتی' }); return }
      const res = await getReport({ ...customerFilter(), from: from || undefined, to: to || undefined })
      const rows = res.rows || []
      // Fetch each parchi's saved snapshot ONCE, so a receipt can be classified as
      // نقد / ادھار and rebuilt (getReport rows carry kind/category; the rate
      // context the parchi was saved under lives in the receipt payload).
      const rnos = [...new Set(rows.map((r) => r.receipt_no).filter((n) => n != null))]
      const snapshots = {}
      if (hasApi && rnos.length) {
        const fetched = await Promise.all(rnos.map((n) => window.api.getReceiptByNo(n).catch(() => null)))
        rnos.forEach((n, i) => { snapshots[n] = fetched[i] })
      }
      const parchis = groupParchis(rows, snapshots, rates, hasApi)
      setReport({ group: 3, rows, parchis, meta: { customer: customerLabel(), from: from || 'ابتدا', to: to || 'آج تک' } })
    } else if (d.type === 'naqad') {
      // نقد فروخت / نقد خرید — filtered by that naqad category ONLY (gold_sell /
      // gold_buy), so no other report's rows can appear here. From/To behaves
      // like the other ranged reports: blank = all dates, else the set range.
      if (from && to && from > to) { if (!silent) setMsg({ ok: false, text: 'فرام ڈیٹ ٹو ڈیٹ سے بڑی نہیں ہو سکتی' }); return }
      const res = await getReport({ category: d.a.category, from: from || undefined, to: to || undefined, ...customerFilter() })
      setReport({
        group: 'naqad',
        rows: res.rows || [],
        columns: naqadColumns(),
        title: d.a.label,
        meta: { customer: customerLabel(), dateNote: `${from || 'ابتدا'} تا ${to || 'آج تک'}` }
      })
    } else if (d.type === 'adjustment') {
      // اندراج رپورٹ — ALL manual adjustments (the one dedicated place they show).
      // No customer filter (adjustments have none). Date range like the naqad
      // report: blank = all dates, else the set range. noActions → view-only
      // (corrected by an opposite اندراج entry, never edited/deleted here).
      if (from && to && from > to) { if (!silent) setMsg({ ok: false, text: 'فرام ڈیٹ ٹو ڈیٹ سے بڑی نہیں ہو سکتی' }); return }
      const res = await getAdjustmentsReport({ from: from || undefined, to: to || undefined })
      setReport({
        group: 'adjustment',
        noActions: true,
        rows: res.rows || [],
        columns: adjustmentColumns(),
        title: 'اندراج رپورٹ',
        meta: { customer: '—', dateNote: `${from || 'ابتدا'} تا ${to || 'آج تک'}` }
      })
    }
    setMsg(null); setDesc(d); setView('report')
  }
  const reload = () => { if (desc) loadReport(desc, true) }

  const onDeleteRow = async (row) => {
    if (!row || row.id == null) return
    if (!window.confirm('کیا آپ واقعی یہ لین دین حذف کرنا چاہتے ہیں؟')) return
    await removeTransaction(row.id)
    reload()
  }
  const saveEdit = async (id, fields) => { await editTransaction(id, fields); setEditRow(null); reload() }

  // Code + name dropdowns are kept in sync by the customer id.
  const onPickCustomer = (e) => {
    const id = e.target.value
    const c = customers.find((x) => String(x.id) === id)
    setCustCode(id)
    setCustName(c ? c.name : '')
  }

  // ── The ORIGINAL 8 buttons in a 2×4 grid (DOM order = RTL right col then left).
  // Buttons 1–4 = GROUP1 (no-date balance reports), 5–8 = GROUP2 (same-day). Their
  // array order already yields the requested rows:
  //   چاندی لینی ہے | چاندی دینی ہے
  //   رقم لینی ہے    | رقم دینی ہے
  //   آج کی ادھار رقم دی | آج کی ادھار رقم آمد
  //   آج کا چاندی ادھار دیا | آج کا چاندی ادھار لیا
  const gridButtons = [
    ...GROUP1.map((a) => ({ label: a.label, run: () => loadReport({ type: 'g1', a }) })),
    ...GROUP2.map((a) => ({ label: a.label, run: () => loadReport({ type: 'g2', a }) })),
    // Buttons 9–10: نقد فروخت | نقد خرید — same grid style, own report type.
    ...NAQAD.map((a) => ({ label: a.label, run: () => loadReport({ type: 'naqad', a }) }))
  ]

  return (
    <div className="print-overlay fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-3 pt-[3vh]" onClick={onClose}>
      <div dir="rtl" className="print-root bg-gray-50 border border-gray-300 rounded-xl shadow-2xl w-[1040px] max-w-[97vw] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="no-print shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-700 to-slate-800 text-white px-4 py-3">
          <h2 className="urdu font-bold text-[18px]">ادھار — لین دین اور کسٹمر ریکارڈ</h2>
          <button type="button" onClick={onClose} title="بند کریں" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-200 hover:bg-white/20 transition-colors">✕</button>
        </div>

        {view === 'report' ? (
          <ReportView report={report} total={reportTotal} onBack={() => setView('menu')} onEdit={setEditRow} onDelete={onDeleteRow} />
        ) : (
          <div className="no-print flex-1 min-h-0 overflow-auto p-4">
            <div className="flex gap-5 items-start">
              {/* RIGHT (first child in RTL) — 2×5 classic button grid */}
              <div className="flex-1 grid grid-cols-2 gap-2 content-start">
                {gridButtons.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={b.run}
                    className="urdu text-[16px] font-bold text-black bg-gray-100 border border-gray-400 rounded-sm px-2 py-2.5 min-h-[58px] flex items-center justify-center text-center leading-snug break-words hover:bg-blue-50 hover:border-blue-500 hover:ring-2 hover:ring-blue-300 hover:shadow-md active:bg-gray-300 transition-colors"
                  >
                    {b.label}
                  </button>
                ))}
                {/* اندراج رپورٹ — manual adjustments; neutral amber, distinct from
                    the gray in/out report buttons (matches the اندراج feature). */}
                <button
                  type="button"
                  onClick={() => loadReport({ type: 'adjustment' })}
                  className="col-span-2 urdu text-[16px] font-bold text-amber-900 bg-amber-100 border border-amber-400 rounded-sm px-2 py-2.5 min-h-[58px] flex items-center justify-center text-center leading-snug break-words hover:bg-amber-200 active:bg-amber-300 transition-colors"
                >
                  اندراج رپورٹ
                </button>
              </div>

              {/* LEFT — filters */}
              <div className="w-[340px] shrink-0 flex flex-col gap-3 bg-white border border-gray-300 rounded-md p-3">
                <DateField label="From Date:" iso={from} setIso={setFrom} />
                <DateField label="To Date:" iso={to} setIso={setTo} />
                <label className="flex items-center gap-2">
                  <span className="urdu text-[14px] font-bold text-black w-[120px] shrink-0">کسٹمر کا کوڈ :</span>
                  <select className="flex-1 min-w-0 border border-gray-400 bg-white text-[15px] font-bold px-2 py-1.5 rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500" value={custCode} onChange={onPickCustomer}>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="urdu text-[14px] font-bold text-black w-[120px] shrink-0">کسٹمر کا نام :</span>
                  <select className="flex-1 min-w-0 border border-gray-400 bg-white text-[15px] font-bold px-2 py-1.5 rounded-sm focus:outline-none focus:ring-1 focus:ring-blue-500" value={custCode} onChange={onPickCustomer}>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => loadReport({ type: 'g3' })}
                  className="urdu mt-1 w-full border border-gray-400 bg-gray-100 text-black text-[17px] font-bold py-2.5 rounded-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
                >
                  کسٹمر کی تفصیلی رسید
                </button>
                {/* نیا سودا — بھگتان / بقایا lists from the standalone naya_soda
                    table (never the ledger). Full-width, matching the تفصیلی رسید
                    button above; fills the empty space in the filter panel. */}
                <button
                  type="button"
                  onClick={() => setSodaStatus('bhugtan')}
                  className="urdu w-full border border-gray-400 bg-gray-100 text-black text-[17px] font-bold py-2.5 rounded-sm hover:bg-blue-50 hover:border-blue-500 hover:ring-2 hover:ring-blue-300 hover:shadow-md active:bg-gray-300 transition-colors"
                >
                  بھگتان سودا
                </button>
                <button
                  type="button"
                  onClick={() => setSodaStatus('bakaya')}
                  className="urdu w-full border border-gray-400 bg-gray-100 text-black text-[17px] font-bold py-2.5 rounded-sm hover:bg-blue-50 hover:border-blue-500 hover:ring-2 hover:ring-blue-300 hover:shadow-md active:bg-gray-300 transition-colors"
                >
                  بقایا سودا
                </button>
                {msg && <div className={`urdu text-[14px] font-bold px-2 py-1.5 rounded ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {editRow && <EditModal row={editRow} onSave={saveEdit} onClose={() => setEditRow(null)} />}
      {/* بھگتان / بقایا سودا: NO date filter — always show ALL entries (null from/to). */}
      {sodaStatus && <NayaSodaReport status={sodaStatus} from={null} to={null} onClose={() => setSodaStatus(null)} />}
    </div>
  )
}

// ═══ THERMAL RECEIPT (Udhar). Default 80mm roll — change PAPER to 58 for the
// small one. An "80mm" printer physically prints only a ~72mm band anchored
// differently per driver, so the CONTENT is kept at 64mm starting 6mm from the
// paper's left edge (the 6..70mm safe window — same as the main-screen slips);
// otherwise some printers clip the right edge, others the left.
const THERMAL_PAPER_MM = 80
const THERMAL_CONTENT_MM = 64
const THERMAL_LEFT_MM = 6

// Which date to show in the تاریخ column: the last time this row was touched.
// Group-1 rows carry a pre-computed last_updated (MAX over the customer's
// entries). Per-parchi rows carry updated_at (full ISO) → take its date part.
// Everything falls back to the transaction date for rows predating updated_at.
const rowDate = (r) => r.last_updated || (r.updated_at ? String(r.updated_at).slice(0, 10) : r.date)

// Compact columns for the narrow roll — essentials only so nothing runs off edge.
// Gold slip: نام | وزن | تاریخ. وزن carries the total (کل وزن) since خالص was
// dropped; for ادھار gold entries point is 100 so وزن == خالص anyway.
const thermalColumns = (report) => report.gold
  ? [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'وزن', get: (r) => fmtNum(wazanVal(r)), num: true, total: true, raw: (r) => wazanVal(r) },
      { label: 'تاریخ', get: (r) => isoToDisp(rowDate(r)), num: true }
    ]
  : [
      { label: 'نام', get: (r) => r.customer_name || '-' },
      { label: 'تاریخ', get: (r) => isoToDisp(rowDate(r)), num: true },
      { label: 'رقم', get: (r) => fmtMoney(cashVal(r)), num: true, total: true, raw: (r) => cashVal(r) }
    ]

// Toggle thermal print mode: body class (monochrome + width via --thermal-w) plus
// an injected @page rule (size <w>mm auto → continuous narrow strip). Wrapped
// around window.print()/printToPDF, then cleared.
function applyThermal(on) {
  const body = document.body
  body.classList.toggle('thermal-print', on)
  body.style.setProperty('--thermal-w', `${THERMAL_CONTENT_MM}mm`)
  body.style.setProperty('--thermal-left', `${THERMAL_LEFT_MM}mm`)
  let style = document.getElementById('thermal-page-style')
  if (on) {
    if (!style) { style = document.createElement('style'); style.id = 'thermal-page-style'; document.head.appendChild(style) }
    // Side margins 0: the CSS keeps the content inside the 6..70mm safe window
    // measured from the TRUE paper edge, so the page must not add its own.
    style.textContent = `@page { size: ${THERMAL_PAPER_MM}mm auto; margin: 2mm 0; }`
  } else if (style) {
    style.remove()
  }
}

// The کسٹمر کی تفصیلی رسید statement prints as a WIDE A4 portrait page (NOT the
// 80mm thermal strip), so every Urdu label has room and nothing is clipped. Adds
// a `statement-print` body class (print CSS bumps font/padding) plus a scoped
// @page A4 rule injected only while printing this statement — never affecting the
// main-screen thermal receipts or other reports. Cleared afterwards.
function applyStatementA4(on) {
  document.body.classList.toggle('statement-print', on)
  let style = document.getElementById('statement-page-style')
  if (on) {
    if (!style) { style = document.createElement('style'); style.id = 'statement-page-style'; document.head.appendChild(style) }
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }'
  } else if (style) {
    style.remove()
  }
}

function ThermalTable({ report, rows }) {
  const cols = thermalColumns(report)
  const totalCol = cols.find((c) => c.total)
  const total = rows.reduce((s, r) => s + (totalCol && totalCol.raw ? totalCol.raw(r) : 0), 0)
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr>{cols.map((c) => <th key={c.label} className={`border border-black px-1 py-0.5 font-bold urdu ${c.num ? 'text-center' : 'text-right'}`}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? `${r.customer_id}-${i}`}>
            {cols.map((c) => <td key={c.label} className={`border border-black px-1 py-0.5 ${c.num ? 'text-center tabular-nums' : 'text-right urdu'}`} dir={c.num ? 'ltr' : 'rtl'}>{c.get(r)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-bold">
          {/* Total column can sit anywhere now (وزن is in the middle), so render a
              cell per column: the total under its own column, the label in the
              first non-total column, blanks elsewhere — keeps them aligned. */}
          {(() => { const labelIdx = cols.findIndex((c) => !c.total); return cols.map((c, i) => (
            c.total
              ? <td key={c.label} className="border border-black px-1 py-0.5 text-center tabular-nums" dir="ltr">{report.gold ? fmtNum(total) : fmtMoney(total)}</td>
              : <td key={c.label} className="border border-black px-1 py-0.5 urdu text-right">{i === labelIdx ? (report.gold ? 'کل وزن' : 'کل رقم') : ''}</td>
          )) })()}
        </tr>
      </tfoot>
    </table>
  )
}

// Full thermal receipt: compact header + table (group 1/2) or statement (group 3).
function ThermalReceipt({ report }) {
  const isStatement = report.group === 3
  const title = isStatement ? 'کسٹمر کی تفصیلی رسید' : report.title
  const range = isStatement ? `${report.meta?.from} تا ${report.meta?.to}` : (report.meta?.dateNote || '')
  const cust = report.meta?.customer || ''
  const rows = report.rows || []
  return (
    <div className="thermal-receipt w-full bg-white text-black leading-tight">
      <div className="text-center border-b border-black pb-1 mb-1">
        <div className="urdu font-bold text-[13px] leading-tight">{title}</div>
        {range ? <div className="urdu font-bold text-[10px]" dir="rtl">{range}</div> : null}
        {cust ? <div className="urdu text-[10px]" dir="rtl">کسٹمر: {cust}</div> : null}
      </div>
      {rows.length === 0 ? (
        <div className="urdu text-center text-[10px] py-2">کوئی اندراج نہیں</div>
      ) : isStatement ? (
        <StatementView parchis={report.parchis || []} rows={rows} thermal />
      ) : (
        <ThermalTable report={report} rows={rows} />
      )}
    </div>
  )
}

// ─── Report view: group 1/2 table or group 3 statement, + print/PDF ───────────
function ReportView({ report, total, onBack, onEdit, onDelete }) {
  const [note, setNote] = useState('')
  const [thermal, setThermal] = useState(true) // default to the thermal roll layout
  if (!report) return null
  const isStatement = report.group === 3
  // نقد فروخت / نقد خرید — always the wide TableReport (no thermal layout), and no
  // row edit: the edit modal only offers the ادھار categories, so editing a naqad
  // row there would silently convert it into an ادھار entry.
  const isNaqad = report.group === 'naqad'
  // اندراج رپورٹ — like naqad: always the wide TableReport, never thermal, no edit.
  const isAdjust = report.group === 'adjustment'
  // The statement (کسٹمر کی تفصیلی رسید) is ALWAYS the wide A4 layout — never thermal.
  const useThermal = thermal && !isStatement && !isNaqad && !isAdjust
  const canRowEdit = !isNaqad && !isAdjust && !report.noActions && (report.rows || []).some((r) => r.id != null)

  // The statement forces the wide A4 page; other reports honour the thermal toggle.
  const applyPrintMode = (on) => {
    if (isStatement) applyStatementA4(on)
    else applyThermal(on && useThermal)
  }
  const clearPrintMode = () => { applyThermal(false); applyStatementA4(false) }
  const doPrint = async () => {
    applyPrintMode(true)
    try {
      // Silent print to the default printer via the main process — the system
      // dialog often fails to spool on Windows thermal drivers. Failures show a
      // note instead of vanishing silently. Browser dev falls back.
      if (hasApiFn() && window.api.printPage) {
        const res = await window.api.printPage({ silent: true })
        if (res && res.ok === false) {
          setNote(`پرنٹ نہیں ہو سکا${res.reason ? ` (${res.reason})` : ''} — پرنٹر چیک کریں`)
          setTimeout(() => setNote(''), 4000)
        }
      } else {
        window.print()
      }
    } finally {
      clearPrintMode()
    }
  }
  const doPdf = async () => {
    if (!hasApiFn()) { setNote('PDF صرف ایپ میں دستیاب ہے'); setTimeout(() => setNote(''), 2500); return }
    applyPrintMode(true)
    try {
      const base = isStatement ? 'customer-statement' : (report.title || 'report')
      const res = await window.api.exportPDF(`${String(base).replace(/\s+/g, '-')}.pdf`, useThermal ? { cssPageSize: true } : undefined)
      if (res?.ok) setNote('PDF محفوظ ہو گیا ✓')
      else if (!res?.canceled) setNote('PDF محفوظ نہیں ہو سکا')
    } finally { clearPrintMode() }
    setTimeout(() => setNote(''), 2500)
  }

  return (
    <div className="print-area flex flex-col min-h-0 flex-1">
      <div className="no-print shrink-0 flex items-center gap-2 bg-white border-b border-gray-200 px-4 py-2.5">
        <button type="button" onClick={onBack} className="urdu text-[12px] font-semibold text-blue-700 border border-blue-200 rounded-md px-3 py-1.5 hover:bg-blue-50 transition-colors">← واپس</button>
        {!isStatement && !isNaqad && !isAdjust && (
          <button
            type="button"
            onClick={() => setThermal((v) => !v)}
            title={`تھرمل رول ${THERMAL_PAPER_MM}mm`}
            className={`urdu text-[12px] font-semibold border rounded-md px-3 py-1.5 transition-colors ${thermal ? 'bg-slate-700 text-white border-slate-700' : 'text-gray-700 border-gray-300 hover:bg-gray-100'}`}
          >
            تھرمل ({THERMAL_PAPER_MM}mm)
          </button>
        )}
        <div className="flex-1" />
        {note && <span className="urdu text-[11px] text-emerald-600">{note}</span>}
        <button type="button" onClick={doPrint} className="urdu text-[12px] font-semibold text-gray-700 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-100 transition-colors">پرنٹ 🖨</button>
        <button type="button" onClick={doPdf} className="urdu text-[12px] font-semibold text-white bg-rose-600 rounded-md px-3 py-1.5 hover:bg-rose-700 transition-colors">PDF</button>
      </div>

      {(thermal && !isStatement && !isNaqad && !isAdjust) ? (
        // Thermal preview — the white strip is the PAPER (80mm). The content is
        // CENTERED on the strip for DISPLAY only (mx-auto), so no report looks
        // glued to one edge; the `print:` classes reinstate the exact print
        // offset (left 6mm / right 0 — THERMAL_LEFT_MM) so the PRINTED output
        // stays byte-identical to before. Print geometry itself is driven by
        // applyThermal()/--thermal-* and is untouched.
        // (The statement is excluded — it always uses the wide A4 layout below.)
        <div className="flex-1 min-h-0 overflow-auto bg-gray-200 p-4">
          <div className="mx-auto bg-white border border-gray-400 shadow-md" style={{ width: `${THERMAL_PAPER_MM}mm` }}>
            <div className="my-[2mm] mx-auto print:mx-0 print:ml-[6mm]" style={{ width: `${THERMAL_CONTENT_MM}mm` }}><ThermalReceipt report={report} /></div>
          </div>
        </div>
      ) : (
        <>
          {/* Printable heading (wide layout) */}
          <div className="px-4 pt-3">
            <div className="urdu font-bold text-[15px] text-gray-800">{isStatement ? 'کسٹمر کی تفصیلی رسید' : `تفصیلی رپورٹ — ${report.title}`}</div>
            <div className="urdu text-[11px] text-gray-500">کسٹمر: {report.meta?.customer} — {isStatement ? `عرصہ: ${report.meta?.from} تا ${report.meta?.to}` : report.meta?.dateNote} — کل اندراج: {report.rows.length}</div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {report.rows.length === 0 ? (
              <div className="urdu text-center text-gray-400 py-12 text-[13px]">اس فلٹر پر کوئی لین دین نہیں ملا</div>
            ) : isStatement ? (
              <StatementView parchis={report.parchis} rows={report.rows} />
            ) : (
              <TableReport columns={report.columns} rows={report.rows} total={total} gold={report.gold} canRowEdit={canRowEdit} onEdit={onEdit} onDelete={onDelete} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RowActions({ r, onEdit, onDelete }) {
  if (!r || r.id == null) return <span className="text-gray-300">—</span>
  return (
    <span className="no-print inline-flex gap-1 justify-center">
      <button type="button" title="ترمیم" onClick={() => onEdit(r)} className="w-6 h-6 rounded hover:bg-blue-100 text-blue-700">✏️</button>
      <button type="button" title="حذف" onClick={() => onDelete(r)} className="w-6 h-6 rounded hover:bg-red-100 text-red-600">🗑</button>
    </span>
  )
}

function TableReport({ columns, rows, total, gold, canRowEdit, onEdit, onDelete }) {
  const totalIdx = columns.findIndex((c) => c.total)
  const totalText = gold ? `${fmtNum(total)} گرام` : fmtMoney(total)
  const totalLabel = gold ? 'کل خالص چاندی' : 'کل رقم'
  // Multi-total mode (نقد reports): any column carrying its own fmtTotal renders
  // its OWN summed footer cell, with a plain کل label in the first column. Reports
  // without fmtTotal (all the pre-existing ones) never enter this path.
  const multiTotal = columns.some((c) => c.total && c.fmtTotal)
  const colSum = (c) => (rows || []).reduce((s, r) => s + (c.raw ? c.raw(r) : 0), 0)
  const span = columns.length + (canRowEdit ? 1 : 0)
  return (
    <table className="w-full border-collapse text-[12.5px] bg-white border border-gray-300 shadow-sm">
      <thead className="sticky top-0">
        <tr className="bg-slate-100 text-gray-700 border-b-2 border-slate-300 urdu">
          {columns.map((c) => <th key={c.label} className={`px-3 py-2 border-l border-gray-200 ${c.num ? 'text-center' : 'text-right'}`}>{c.label}</th>)}
          {canRowEdit && <th className="no-print px-3 py-2 text-center w-[80px]">ایکشن</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? `${r.customer_id}-${i}`} className="border-b border-gray-100 hover:bg-blue-50/40">
            {columns.map((c) => (
              <td key={c.label} className={`px-3 py-1.5 border-l border-gray-100 ${c.num ? 'text-center tabular-nums' : 'text-right urdu'}`} dir={c.num ? 'ltr' : 'rtl'}>{c.get(r)}</td>
            ))}
            {canRowEdit && <td className="no-print px-3 py-1.5 text-center"><RowActions r={r} onEdit={onEdit} onDelete={onDelete} /></td>}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-amber-50 border-t-2 border-amber-300 font-bold urdu text-[13px]">
          {columns.map((c, i) => {
            if (multiTotal) {
              if (c.total && c.fmtTotal) return <td key={c.label} className="px-3 py-2.5 text-center tabular-nums text-amber-800" dir="ltr">{c.fmtTotal(colSum(c))}</td>
              if (i === 0) return <td key={c.label} className="px-3 py-2.5 text-right text-amber-800">کل :</td>
              return <td key={c.label} className="px-3 py-2.5" />
            }
            if (i === totalIdx) return <td key={c.label} className="px-3 py-2.5 text-center tabular-nums text-amber-800" dir="ltr">{totalText}</td>
            if (i === totalIdx - 1) return <td key={c.label} className="px-3 py-2.5 text-left text-amber-800">{totalLabel} :</td>
            return <td key={c.label} className="px-3 py-2.5" />
          })}
          {canRowEdit && <td className="no-print" />}
        </tr>
      </tfoot>
    </table>
  )
}

// ═══ STATEMENT GROUPING — one block PER PARCHI (receipt_no), each carrying the
// full receipt(s) that parchi holds: نقد (cash) / ادھار (credit). A parchi can be
// both at once, so every applicable sub-receipt is rendered. Ledger money/metal
// (subtotals + grand total) come from the transaction rows so the grand total
// STILL equals getReport's totals; the saved payload is used only to classify the
// type and to recover the rate context the parchi was saved under. ═══

const UDHAR_CATS = ['gold_give', 'gold_take', 'cash_give', 'cash_take']
const NAQAD_CATS = ['gold_sell', 'gold_buy']

// Sign convention IDENTICAL to getReport / getCustomerLedger: out = +1 (customer
// owes us), in = −1. Used for both the per-parchi subtotal and the grand total.
const statementTotals = (rows) => {
  const t = { goldGive: 0, goldTake: 0, cashGive: 0, cashTake: 0, netGold: 0, netCash: 0, hasGold: false, hasCash: false }
  for (const r of rows || []) {
    const sign = r.direction === 'out' ? 1 : -1
    if (r.category === 'gold_give') t.goldGive += Number(r.khalis_sona) || 0
    if (r.category === 'gold_take') t.goldTake += Number(r.khalis_sona) || 0
    if (r.category === 'cash_give') t.cashGive += Number(r.cash_amount) || 0
    if (r.category === 'cash_take') t.cashTake += Number(r.cash_amount) || 0
    if (r.category === 'gold_give' || r.category === 'gold_take') { t.netGold += sign * (Number(r.khalis_sona) || 0); t.hasGold = true }
    if (r.category === 'cash_give' || r.category === 'cash_take') { t.netCash += sign * (Number(r.cash_amount) || 0); t.hasCash = true }
  }
  return t
}

const entryHasValue = (e) => e && String(e.wazan ?? '').trim() !== '' && Number(e.wazan) > 0

// Reconstruct the exact `ctx` the main-screen receipt panels consume, from a
// saved parchi's snapshot (payload + its transaction rows). This is the SAME
// reconstruction store.jsx loadReceipt does — نقد/ادھار entries are rebuilt from
// the transaction ROWS (source of truth) under the rate context the parchi was
// saved with — but assembled into a plain object instead of React state, so the
// real <CashReceipt/> <CreditReceipt/> render the parchi EXACTLY as it looks on
// the main page. No formula is touched.
const blankGold = () => ({ wazan: '', point: '100', rate: '' })
function buildParchiCtx({ payload, snapRows, receiptNo, baseRates, hasApi, ledger }) {
  const rates = { ...(baseRates || {}), ...(payload.rates || {}) }

  let cashSell = blankGold(), cashBuy = blankGold(), udharGive = blankGold(), udharTake = blankGold()
  let udharCashGive = '', udharCashTake = ''
  const asGold = (r) => ({
    wazan: r.sona_wazan != null ? String(r.sona_wazan) : '',
    point: r.point != null ? String(r.point) : '100',
    rate: r.rate ? String(r.rate) : ''
  })
  const rws = Array.isArray(snapRows) ? snapRows : []
  if (rws.length) {
    for (const r of rws) {
      if (r.category === 'gold_sell') cashSell = asGold(r)
      else if (r.category === 'gold_buy') cashBuy = asGold(r)
      else if (r.category === 'gold_give') udharGive = asGold(r)
      else if (r.category === 'gold_take') udharTake = asGold(r)
      else if (r.category === 'cash_give') udharCashGive = r.cash_amount != null ? String(r.cash_amount) : ''
      else if (r.category === 'cash_take') udharCashTake = r.cash_amount != null ? String(r.cash_amount) : ''
    }
  } else if (payload.entries) {
    const e = payload.entries
    cashSell = e.cashSell ?? blankGold(); cashBuy = e.cashBuy ?? blankGold()
    udharGive = e.udharGive ?? blankGold(); udharTake = e.udharTake ?? blankGold()
    udharCashGive = e.udharCashGive ?? ''; udharCashTake = e.udharCashTake ?? ''
  }

  const pc = payload.customer || {}
  const customer = { id: pc.id ?? null, name: pc.name ?? '', mobile: pc.mobile ?? '' }
  return {
    customer, receiptNo, rates,
    cashSell, cashBuy, udharGive, udharTake, udharCashGive, udharCashTake,
    udharComment: payload.comment ?? '',
    savedFlags: { naqad: true, udhar: true },
    // A saved (not brand-new) parchi: openReceiptNo === receiptNo makes
    // CreditReceipt read the ledger balance instead of re-adding live entries —
    // identical to reopening the parchi on the main screen.
    openReceiptNo: receiptNo,
    // This parchi's OWN running (cumulative) ledger balance — so the ادھار receipt
    // shows this parchi's باقی دینا/لینا, not the customer's grand total.
    ledger,
    hasApi, bump: 0, refresh: () => {}, printSlips: () => {}
  }
}

// Group the flat transaction rows by receipt_no (rows arrive ordered by date,
// receipt_no, id — first-seen order is preserved). `snapshots[rno]` is the
// getReceiptByNo result for that parchi (may be null for a very old row).
function groupParchis(rows, snapshots = {}, baseRates = {}, hasApi = false) {
  const order = []
  const map = new Map()
  for (const r of rows || []) {
    const key = r.receipt_no
    if (key == null) continue
    if (!map.has(key)) { map.set(key, []); order.push(key) }
    map.get(key).push(r)
  }
  // Running (cumulative) ledger balance PER CUSTOMER, accumulated in chronological
  // order (rows arrive date/receipt-ordered). Each parchi is given the balance
  // THROUGH itself — same sign convention as getCustomerLedger — so its ادھار
  // receipt shows that parchi's own باقی دینا/لینا instead of the grand total.
  const acc = new Map() // customer_id -> { gold, cash }
  return order.map((rno) => {
    const prows = map.get(rno)
    const snap = snapshots[rno] || null
    const payload = (snap && snap.payload) || {}
    const snapRows = (snap && snap.rows) || prows
    const entries = payload.entries || {}
    const first = prows[0]
    const pnet = statementTotals(prows)
    const cid = first.customer_id
    const a = acc.get(cid) || { gold: 0, cash: 0 }
    a.gold += pnet.netGold
    a.cash += pnet.netCash
    acc.set(cid, a)
    const ledger = { balance_gold: a.gold, balance_cash: a.cash }
    const naqadRows = prows.filter((r) => NAQAD_CATS.includes(r.category))
    const udharRows = prows.filter((r) => UDHAR_CATS.includes(r.category))
    const types = {
      naqad: naqadRows.length > 0 || entryHasValue(entries.cashSell) || entryHasValue(entries.cashBuy),
      udhar: udharRows.length > 0 ||
        entryHasValue(entries.udharGive) || entryHasValue(entries.udharTake) ||
        String(entries.udharCashGive ?? '').trim() !== '' || String(entries.udharCashTake ?? '').trim() !== ''
    }
    const ctx = buildParchiCtx({ payload, snapRows, receiptNo: rno, baseRates, hasApi, ledger })
    return {
      receipt_no: rno,
      date: first.date,
      customer_name: first.customer_name,
      rows: prows,
      naqadRows,
      udharRows,
      types,
      ctx
    }
  })
}

const TYPE_BADGES = [
  { key: 'naqad', label: 'نقد کی رسید', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  { key: 'udhar', label: 'ادھار کی رسید', cls: 'bg-blue-100 text-blue-800 border-blue-300' }
]
function TypeBadges({ types, small }) {
  return (
    <span className="flex flex-wrap gap-1">
      {TYPE_BADGES.filter((b) => types[b.key]).map((b) => (
        <span key={b.key} className={`urdu font-bold border rounded ${small ? 'text-[8px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5'} ${b.cls}`}>{b.label}</span>
      ))}
    </span>
  )
}

function StatementView({ parchis = [], rows = [], thermal = false }) {
  const t = statementTotals(rows)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {parchis.map((p) => <ParchiBlock key={p.receipt_no} p={p} thermal={thermal} />)}
      </div>
      <div className="mt-2 border-2 border-slate-300 rounded-lg bg-white overflow-hidden">
        <div className="urdu font-bold text-[13px] bg-slate-100 px-3 py-2 border-b border-slate-200 text-gray-800">کل حساب (اس عرصے کا)</div>
        <div className={`grid ${thermal ? 'grid-cols-1' : 'grid-cols-2'} gap-x-6 gap-y-1 px-4 py-3 text-[12.5px] urdu`}>
          <StRow k="کل چاندی دی" v={`${fmtNum(t.goldGive)} گرام`} />
          <StRow k="کل چاندی لی" v={`${fmtNum(t.goldTake)} گرام`} />
          <StRow k="کل رقم دی" v={fmtMoney(t.cashGive)} />
          <StRow k="کل رقم لی" v={fmtMoney(t.cashTake)} />
          <StRow k="خالص چاندی بیلنس" v={`${fmtNum(t.netGold)} گرام`} bold />
          <StRow k="خالص رقم بیلنس" v={fmtMoney(t.netCash)} bold />
        </div>
      </div>
    </div>
  )
}
function StRow({ k, v, bold }) {
  return (
    <div className={`flex items-center justify-between border-b border-dashed border-gray-200 py-1 ${bold ? 'font-bold text-amber-800' : 'text-gray-700'}`}>
      <span>{k} :</span><span className="tabular-nums" dir="ltr">{v}</span>
    </div>
  )
}

// The parchi's ACTUAL receipt panels — the SAME components the main page renders
// (نقد کی رسید / ادھار کی رسید), fed the parchi's own reconstructed ctx so every
// figure matches. Each receipt panel is fixed-size (its internal flex rows fill
// the tile height, exactly like the main screen). A parchi that is both types
// shows both receipts. Wide view tiles them; the 80mm thermal roll stacks them
// full-width. Each panel is built for a fixed DESIGN width (the same ~341px it has
// on the main screen) so its internal grids never reflow/merge; we render at that
// width and SCALE the panel down to the tile width. Same "render at design size,
// transform-scale to fit" trick FitScreen uses for the main screen.
const RECEIPT_DESIGN_W = 341 // = the main-screen receipt panel design width
const THERMAL_TILE_PX = Math.round(THERMAL_CONTENT_MM * 96 / 25.4) // 64mm ≈ 242px — must fit the thermal print-area's CONTENT width
const WIDE_TILE_PX = Math.round(RECEIPT_DESIGN_W * 0.75) // ~256px — shrink so several fit the row

function ParchiReceipts({ p, thermal }) {
  const ctx = p.ctx
  // Always render each panel at its full DESIGN width (341px) so its internal
  // grids never collapse, then SCALE the whole thing DOWN to a smaller tile so
  // the receipts fit the statement space easily.
  const outerW = thermal ? THERMAL_TILE_PX : WIDE_TILE_PX
  const scale = outerW / RECEIPT_DESIGN_W
  // Render the panel at DESIGN width/height, then scale the whole thing to the tile.
  // flexShrink:0 so the tile never shrinks below the design width in a flex row.
  const Tile = ({ h, children }) => (
    <div style={{ width: outerW, height: h * scale, overflow: 'hidden', breakInside: 'avoid', flexShrink: 0 }}>
      <div style={{ width: RECEIPT_DESIGN_W, height: h, transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
  // Design height = the receipts-band height each panel has on the main screen
  // (~456px); anything shorter clips the panel's bottom rows.
  const DH = 456
  return (
    <div className={`flex ${thermal ? 'flex-col' : 'flex-row flex-wrap'} gap-2 justify-start`} dir="ltr">
      {p.types.naqad && <Tile h={DH}><CashReceipt ctx={ctx} embed /></Tile>}
      {p.types.udhar && <Tile h={DH}><CreditReceipt ctx={ctx} embed /></Tile>}
    </div>
  )
}

// One PARCHI = one receipt_no. Header (number + type badges + date), then the
// real receipt panel(s) this parchi carries, then this parchi's own subtotal.
function ParchiBlock({ p, thermal }) {
  const sub = statementTotals(p.rows)
  return (
    <div className="border-2 border-slate-300 rounded-lg bg-white overflow-hidden text-[12px]">
      <div className="flex items-center justify-between gap-2 bg-slate-100 border-b border-slate-200 px-3 py-2" dir="rtl">
        <span className="urdu font-bold text-gray-800 whitespace-nowrap">پرچی نمبر {p.receipt_no}</span>
        <TypeBadges types={p.types} small={thermal} />
        <span className="tabular-nums text-gray-500 whitespace-nowrap" dir="ltr">{isoToDisp(p.date)}</span>
      </div>
      <div className="px-3 py-2 flex flex-col gap-2">
        <div className="flex justify-between text-[11.5px]" dir="rtl"><span className="urdu text-gray-500">نام</span><span className="urdu font-semibold">{p.customer_name || '-'}</span></div>

        <ParchiReceipts p={p} thermal={thermal} />

        {/* Per-parchi subtotal — same sign logic as the grand total, scoped to
            this parchi's ledger rows. */}
        <div className="mt-1 border-t border-dashed border-slate-300 pt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] urdu font-semibold justify-start text-amber-800" dir="rtl">
          <span className="text-gray-500">اس پرچی کا حساب :</span>
          {sub.hasGold && <span>خالص چاندی <b className="tabular-nums" dir="ltr">{fmtNum(sub.netGold)}</b> گرام</span>}
          {sub.hasCash && <span>خالص رقم <b className="tabular-nums" dir="ltr">{fmtMoney(sub.netCash)}</b></span>}
          {!sub.hasGold && !sub.hasCash && <span className="text-gray-400">—</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Edit modal (Part 1) ──────────────────────────────────────────────────────
function EditModal({ row, onSave, onClose }) {
  const startGold = isGoldCat(row.category)
  const [category, setCategory] = useState(row.category)
  const [direction, setDirection] = useState(row.direction || (row.category?.includes('take') ? 'in' : 'out'))
  const [amount, setAmount] = useState(String(startGold ? (row.khalis_sona || '') : (row.cash_amount || '')))
  const [date, setDate] = useState(row.date || '')
  const [note, setNote] = useState(row.note || '')
  const gold = isGoldCat(category)

  const submit = () => {
    const amt = Number(amount) || 0
    const fields = { category, direction, date, note }
    if (gold) { fields.khalis_sona = amt; fields.sona_wazan = amt; fields.point = 100; fields.cash_amount = 0 }
    else { fields.cash_amount = amt; fields.khalis_sona = 0; fields.sona_wazan = 0 }
    onSave(row.id, fields)
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div dir="rtl" className="bg-white rounded-lg shadow-2xl w-[380px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-slate-100 border-b border-gray-200 px-4 py-2.5"><h3 className="urdu font-bold text-[14px]">لین دین میں ترمیم (پرچی {row.receipt_no})</h3><button onClick={onClose} className="w-7 h-7 rounded hover:bg-red-500 hover:text-white">✕</button></div>
        <div className="p-4 flex flex-col gap-3">
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">قسم
            <select className={INP} value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">سمت
            <select className={INP} value={direction} onChange={(e) => setDirection(e.target.value)}><option value="in">لیا (in — شاپ کو موصول)</option><option value="out">دیا (out — شاپ نے دیا)</option></select></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">{gold ? 'خالص چاندی (گرام)' : 'رقم (روپے)'}
            <input dir="ltr" className={INP} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" /></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">تاریخ<input dir="ltr" type="date" className={INP} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="urdu text-[11px] text-gray-600 flex flex-col gap-1">نوٹ<input className={INP} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={submit} className="urdu flex-1 rounded-md bg-blue-600 text-white text-[13px] font-semibold py-2 hover:bg-blue-700">محفوظ کریں</button>
          <button onClick={onClose} className="urdu rounded-md border border-gray-300 bg-white text-gray-700 text-[13px] font-semibold px-4 hover:bg-gray-100">منسوخ</button>
        </div>
      </div>
    </div>
  )
}
