import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import DateField from './DateField.jsx'

// نیا سودا — deal entry form, tied to the CURRENT parchi (receipt number). Lives
// in the space the on-screen وصولی رسید panel used to occupy (LeftReceipts).
// Self-contained (own naya_soda + naya_soda_draft tables): never touches the
// transactions ledger, customer balances, totals, or any existing report.
//
// Per-receipt persistence: as the operator types, the in-progress form values are
// auto-saved (debounced) against the current receipt number, so nothing is lost
// even without pressing محفوظ کریں. Switching parchi (New / ◀ ▶ / opening an old
// receipt) loads THAT parchi's own نیا سودا values. محفوظ کریں commits a permanent
// entry (tagged with the receipt number) to the بھگتان list and clears the draft.

const pad2 = (n) => String(n).padStart(2, '0')
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Shared styling tokens — match the existing forms exactly. bg-mint = the same
// green highlight the وزن inputs use, so these boxes look consistent.
//
// Sizing: the green boxes used to be py-3 / 16px inside a panel laid out with
// justify-between + gap-4, which stretched five short fields down a ~456px panel
// and left each box looking like a big empty block. They are now py-1.5 / 15px —
// the same height as the نقد/ادھار inputs next to them — and the form packs from
// the top with the action row pinned to the bottom (see below). Fields, order,
// handlers and state are untouched; only the box metrics changed.
// LBL: one fixed width for EVERY label, so all five input boxes start on the same
// vertical line. INP_BASE: one fixed 32px height for every box (they used to be
// py-3/16px, which made them read as oversized empty blocks).
const LBL = 'urdu text-[14px] font-bold text-black w-[86px] shrink-0 text-right'
const INP_BASE = 'flex-1 min-w-0 w-full h-8 border border-gray-300 bg-mint text-[15px] font-bold px-2 rounded-md focus:outline-none focus:ring-1 focus:ring-accent'
// Numeric fields (ریٹ / وزن): left-aligned (start), LTR digits — same side as نام.
const INP = `${INP_BASE} text-left`
// نام: no forced direction/alignment — dir="auto" lets the browser pick RTL for
// Urdu and LTR for English, so the cursor always stays with the text (same as
// the app's own GhostNameInput name fields).
const NAME_INP = `${INP_BASE} urdu`

export default function NayaSoda() {
  const { receiptNo } = useApp() // current parchi number
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [wazan, setWazan] = useState('')
  const [type, setType] = useState('khareed') // 'khareed' | 'farokht'
  const [date, setDate] = useState(todayISO())
  const [msg, setMsg] = useState(null)
  const msgTimer = useRef(null)
  const draftTimer = useRef(null)
  const rateRef = useRef(null)   // Enter in نام → jump here
  const wazanRef = useRef(null)  // Enter in ریٹ → jump here
  // The receipt number the on-screen form currently reflects. The auto-persist
  // effect only writes once this matches receiptNo, so an in-flight LOAD (which
  // changes the fields) can never be written back onto the wrong parchi.
  const loadedFor = useRef(null)

  // Show a status message that auto-hides after 3 seconds (the ✓ never lingers).
  const showMsg = (m) => {
    setMsg(m)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), 3000)
  }

  // Load THIS parchi's saved-in-progress نیا سودا values whenever the receipt
  // number changes (New / navigation / opening an old receipt). No draft → blank.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let d = null
      if (window.api && window.api.getNayaSodaDraft && receiptNo != null) {
        d = await window.api.getNayaSodaDraft(receiptNo)
      }
      if (cancelled) return
      setName(d?.name || '')
      setRate(d?.rate != null ? String(d.rate) : '')
      setWazan(d?.wazan != null ? String(d.wazan) : '')
      setType(d?.type === 'farokht' ? 'farokht' : 'khareed')
      setDate(d?.date || todayISO())
      loadedFor.current = receiptNo
    })()
    return () => { cancelled = true }
  }, [receiptNo])

  // Auto-persist the in-progress form against the current parchi (debounced), so
  // unsaved values are never lost. An empty form clears the draft row.
  useEffect(() => {
    if (loadedFor.current !== receiptNo) return // a load is in flight — don't write
    if (!window.api || !window.api.saveNayaSodaDraft || receiptNo == null) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const empty = !name.trim() && !String(rate).trim() && !String(wazan).trim()
    draftTimer.current = setTimeout(() => {
      if (empty) window.api.clearNayaSodaDraft(receiptNo)
      else window.api.saveNayaSodaDraft(receiptNo, { name, rate, wazan, type, date })
    }, 400)
  }, [name, rate, wazan, type, date, receiptNo])

  const save = async () => {
    if (!name.trim()) { showMsg({ ok: false, text: 'نام درج کریں' }); return }
    if (!(Number(wazan) > 0)) { showMsg({ ok: false, text: 'وزن درج کریں' }); return }
    if (!window.api) { showMsg({ ok: false, text: 'ڈیٹابیس دستیاب نہیں' }); return }
    try {
      await window.api.addNayaSoda({
        name: name.trim(),
        rate: Number(rate) || 0,
        wazan: Number(wazan) || 0,
        type,
        date: date || todayISO(),
        receipt_no: receiptNo
      })
      // This parchi's in-progress draft is now committed — drop it, then blank the
      // form for the next entry (date resets to today, قسم to خرید).
      if (window.api.clearNayaSodaDraft && receiptNo != null) await window.api.clearNayaSodaDraft(receiptNo)
      setName(''); setRate(''); setWazan(''); setType('khareed'); setDate(todayISO())
      showMsg({ ok: true, text: 'محفوظ ہو گیا ✓' })
    } catch (e) {
      showMsg({ ok: false, text: 'محفوظ نہیں ہو سکا' })
    }
  }

  // Send the CURRENT (unsaved) form values to WhatsApp as text — same route the
  // نقد / لیب رسید receipts use — WITHOUT saving or clearing the form.
  const waSend = async () => {
    const hasData = name.trim() || String(rate).trim() || String(wazan).trim()
    if (!hasData) { showMsg({ ok: false, text: 'پہلے کچھ درج کریں' }); return }
    const p = String(date || '').split('-')
    const dispDate = (p.length === 3 && p[0]) ? `${p[2]}/${p[1]}/${p[0]}` : (date || '-')
    const qism = type === 'farokht' ? 'فروخت' : 'خرید'
    const text =
      `نیا سودا\n` +
      `نام: ${name || '-'}\n` +
      `ریٹ: ${rate || '-'}\n` +
      `وزن: ${wazan || '-'}\n` +
      `قسم: ${qism}\n` +
      `تاریخ: ${dispDate}`
    // Copy the text so the operator can paste it after picking any contact.
    try { await navigator.clipboard.writeText(text) } catch {}
    // Same WhatsApp route the receipts use (desktop app → embedded web), empty
    // mobile so the operator chooses the recipient; wa.me is the dev fallback.
    try {
      if (window.api && window.api.openWhatsApp) {
        const r = await window.api.openWhatsApp({ mobile: '', text })
        if (r && r.ok) { showMsg({ ok: true, text: 'واٹس ایپ کھل گیا — رابطہ منتخب کر کے پیسٹ کریں' }); return }
      }
    } catch {}
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    if (typeof window !== 'undefined') window.open(url, '_blank')
    showMsg({ ok: true, text: 'واٹس ایپ کھل گیا — رابطہ منتخب کر کے پیسٹ کریں' })
  }

  return (
    <div className="card h-full">
      <div className="card-head urdu">نیا سودا</div>
      {/* justify-start + a tight even gap: the fields sit together at the top at
          their natural height instead of being spread edge-to-edge down the panel.
          The action row below carries mt-auto, so it stays pinned to the bottom and
          the card still fills its full height — no dead band, no stretched boxes. */}
      <div dir="rtl" className="card-body flex flex-col justify-start gap-2 p-3">
        <label className="flex items-center gap-1.5">
          <span className={LBL}>نام</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rateRef.current && rateRef.current.focus() } }}
            dir="auto"
            className={NAME_INP}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className={LBL}>ریٹ</span>
          <input
            ref={rateRef}
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); wazanRef.current && wazanRef.current.focus() } }}
            dir="ltr"
            className={INP}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className={LBL}>وزن</span>
          <input
            ref={wazanRef}
            type="number"
            value={wazan}
            onChange={(e) => setWazan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
            dir="ltr"
            className={INP}
          />
        </label>
        {/* قسم — خرید / فروخت, mutually exclusive */}
        <div className="flex items-center gap-1.5">
          <span className={LBL}>قسم</span>
          <div className="flex-1 flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="naya-soda-type" checked={type === 'khareed'} onChange={() => setType('khareed')} className="w-4 h-4 accent-emerald-600" />
              <span className="urdu text-[14px] font-bold text-black">خرید</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="naya-soda-type" checked={type === 'farokht'} onChange={() => setType('farokht')} className="w-4 h-4 accent-emerald-600" />
              <span className="urdu text-[14px] font-bold text-black">فروخت</span>
            </label>
          </div>
        </div>
        <DateField label="تاریخ" iso={date} setIso={setDate} />
        {/* mt-auto pins the actions to the bottom of the panel */}
        <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-200">
          <button
            type="button"
            onClick={save}
            className="urdu border border-accent bg-accent text-white px-4 py-1 rounded-md text-[13px] font-bold cursor-pointer hover:bg-accentDark hover:border-accentDark active:translate-y-px transition-colors"
          >
            محفوظ کریں
          </button>
          <button type="button" onClick={waSend} className="abtn abtn-green" title="واٹس ایپ پر بھیجیں">WhatsApp</button>
          {msg && (
            <span className={`urdu text-[12px] font-bold ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</span>
          )}
        </div>
      </div>
    </div>
  )
}
