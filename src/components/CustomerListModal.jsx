import React, { useEffect, useMemo, useRef, useState } from 'react'

// Gold: fixed 3 decimals (e.g. 1618.130). Cash: up to 2 decimals, grouped.
const fmtGold = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmtCash = (n) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

// Round avatar: customer photo, else the first letter of the name.
function Avatar({ src, name }) {
  return (
    <span className="inline-flex w-9 h-9 rounded-full bg-slate-200 overflow-hidden items-center justify-center text-slate-600 font-bold text-[13px] shrink-0">
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        (name || '؟').trim().charAt(0).toUpperCase()
      )}
    </span>
  )
}

// Right-aligned, red-when-negative numeric cell. The CELL keeps its logical
// `text-end` so the value sits under its (RTL) header; only the NUMBER is wrapped
// in an LTR-isolated span so a leading minus stays on the visual LEFT ("-430,000")
// without shifting the cell's alignment.
function BalCell({ value, text, bold }) {
  const neg = Number(value || 0) < 0
  return (
    <td className={`px-3 py-2 text-end tabular-nums whitespace-nowrap ${bold ? 'font-bold' : ''} ${neg ? 'text-red-600 font-semibold' : 'text-gray-800'}`}>
      <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{text}</span>
    </td>
  )
}

// کسٹمر لسٹ — searchable grid of all customers with gold + cash balances.
// Opens from the ▼ / arrow in CustomerEntry. Selecting a row calls onSelect(row).
export default function CustomerListModal({ open, onClose, onSelect }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('') // immediate input value (controlled, stable)
  const [dq, setDq] = useState('') // debounced applied filter term
  const searchRef = useRef(null)

  // Load all customers + balances each time the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setQ('')
    setDq('')
    ;(async () => {
      const data = (window.api && (await window.api.listCustomersWithBalances())) || []
      if (!cancelled) {
        setRows(data)
        setLoading(false)
      }
    })()
    requestAnimationFrame(() => searchRef.current && searchRef.current.focus())
    return () => { cancelled = true }
  }, [open])

  // Debounce the applied filter term (~200ms) so filtering is "live" but not churny.
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200)
    return () => clearTimeout(t)
  }, [q])

  // Filter over the preloaded set: name (contains/prefix), mobile, or id.
  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => {
      const name = (r.name || '').toLowerCase()
      const mobile = (r.mobile || '').toLowerCase()
      const id = String(r.id)
      return name.includes(s) || mobile.includes(s) || id === s || id.includes(s)
    })
  }, [rows, dq])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="bg-white border border-gray-300 rounded-lg shadow-2xl w-[760px] max-w-[96vw] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar — fixed */}
        <div className="shrink-0 flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
          <h3 className="urdu font-bold text-[15px] text-gray-800">کسٹمر لسٹ</h3>
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Search — fixed */}
        <div className="shrink-0 p-3 border-b border-gray-200">
          <div className="relative">
            <span className="absolute inset-y-0 right-3 flex items-center text-gray-400 pointer-events-none">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={searchRef}
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="نام، موبائل یا آئی ڈی سے تلاش کریں"
              className="w-full bg-white border border-gray-300 rounded-md text-[14px] leading-relaxed px-3 py-2 pr-10 text-start focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Grid — the ONLY scrollable region, fixed to EXACTLY 3 rows tall.
            Height = 3 data rows (3 × 56px) + the sticky 36px column-heading row =
            204px, so the modal never grows: rows 4+ are reached by scrolling this
            window. max-h-[80vh] is only a small-screen safety ceiling. The single
            table keeps the sticky heading perfectly column-aligned with the rows. */}
        <div className="shrink-0 h-[204px] max-h-[80vh] overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="h-9 bg-slate-100 text-gray-600 border-b border-gray-300">
                <th className="urdu font-bold px-3 py-2 text-start w-[56px]">تصویر</th>
                <th className="urdu font-bold px-3 py-2 text-start">کسٹمر کا نام</th>
                <th className="urdu font-bold px-3 py-2 text-start w-[70px]">آئی ڈی</th>
                <th className="urdu font-bold px-3 py-2 text-start w-[130px]">موبائل</th>
                <th className="urdu font-bold px-3 py-2 text-end w-[120px]">سونا بیلنس</th>
                <th className="urdu font-bold px-3 py-2 text-end w-[120px]">نقد بیلنس</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 urdu text-[13px]">لوڈ ہو رہا ہے…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 urdu text-[13px]">کوئی کسٹمر موجود نہیں</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 urdu text-[13px]">کوئی ریکارڈ نہیں ملا</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onSelect(r)}
                    className="h-14 border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2"><Avatar src={r.image} name={r.name} /></td>
                    <td className="px-3 py-2 font-semibold text-gray-800 truncate max-w-[220px]">{r.name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                        {r.id}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 tabular-nums whitespace-nowrap" dir="ltr">{r.mobile || '—'}</td>
                    <BalCell value={r.balance_gold} text={fmtGold(r.balance_gold)} bold />
                    <BalCell value={r.balance_cash} text={fmtCash(r.balance_cash)} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count — fixed */}
        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-2 text-[12px] text-gray-500 flex items-center justify-between">
          <span className="urdu">کل: {rows.length}</span>
          {dq.trim() && <span className="urdu">دکھائے گئے: {filtered.length}</span>}
        </div>
      </div>
    </div>
  )
}
