import React, { useEffect, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'
import useLiveSilver from '../logic/useLiveSilver.js'
import DefaultsForm from './DefaultsForm.jsx'
import IndrajForm from './IndrajForm.jsx'

// Live SILVER spot box (display-only reference — no rates/receipts involvement).
// Fed by electron/liveSilver.cjs, which polls XAG/USD (Swissquote, falling back
// to goldprice.org then netdania). MT5 Market-Watch style: bid (bold, larger) / ask
// (smaller, muted) side by side, digits flash green/red on tick up/down and the
// whole box gets a subtle tint, both fading over ~600ms so rapid 1s ticks stay
// visible. Grey stale state with a tiny آف لائن hint when the feed drops; "--"
// before the first value.
function SilverTicker() {
  const { bid, ask, prevBid, ok } = useLiveSilver()
  const [flash, setFlash] = useState(null) // 'up' | 'down' | null

  useEffect(() => {
    if (bid == null || prevBid == null || bid === prevBid) return undefined
    setFlash(bid > prevBid ? 'up' : 'down')
    const t = setTimeout(() => setFlash(null), 600) // short fade — rapid ticks visible
    return () => clearTimeout(t)
  }, [bid, prevBid])

  // stale grey ALWAYS wins — a dead feed must never keep flashing green/red
  const bidColor = !ok ? '#9ca3af' : flash === 'up' ? '#16a34a' : flash === 'down' ? '#dc2626' : '#000000'
  const askColor = !ok ? '#9ca3af' : '#6b7280'
  // subtle per-tick background tint like MT5 rows; no tint while stale (grey wins)
  const bg = !ok ? '#ffffff' : flash === 'up' ? 'rgba(22,163,74,0.12)' : flash === 'down' ? 'rgba(220,38,38,0.12)' : '#ffffff'
  return (
    <div
      className="self-center flex items-center gap-1.5 h-[30px] px-2 min-w-[180px] flex-shrink-0 overflow-hidden rounded-md border border-gray-300"
      style={{ backgroundColor: bg, transition: 'background-color 600ms ease-out' }}
      title="Live silver spot XAG/USD (bid / ask) — صرف حوالہ، ریٹ/حساب سے الگ"
      data-silver-ticker
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-400'}`} />
      <span className="text-[14px] font-bold leading-none">Silver</span>
      <span dir="ltr" className="flex items-baseline gap-1 whitespace-nowrap leading-none">
        <span className="text-[19px] font-extrabold tabular-nums" style={{ color: bidColor }}>
          {bid != null ? bid.toFixed(2) : '--'}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: askColor }}>/</span>
        <span className="text-[14px] font-semibold tabular-nums" style={{ color: askColor }}>
          {ask != null ? ask.toFixed(2) : '--'}
        </span>
      </span>
      {!ok && bid != null && <span className="urdu text-[9px] text-gray-400 whitespace-nowrap leading-none">آف لائن</span>}
    </div>
  )
}

// The four inventory counters that sit after کیش / تیزابی in the bottom bar.
// `key` is the field read off the store's `totals` — see the TODO in store.jsx:
// return a field of the SAME NAME from getShopTotals() and it lands here.
//
// TODO(silver-inventory): PLACEHOLDERS. No calculation is implemented for any of
// these — each renders "-" until `totals[key]` holds a real number. Put the
// per-counter calculation in getShopTotals() (electron/db.cjs), NOT here: this
// component only formats whatever the store hands it.
const INVENTORY_BOXES = [
  { key: 'piece', label: 'پیس' },            // TODO(silver-inventory): calculation goes here (via totals.piece)
  { key: 'bar1Tola', label: '1 تولہ بار' },  // TODO(silver-inventory): calculation goes here (via totals.bar1Tola)
  { key: 'bar5Tola', label: '5 تولہ بار' },  // TODO(silver-inventory): calculation goes here (via totals.bar5Tola)
  { key: 'bar10Tola', label: '10 تولہ بار' } // TODO(silver-inventory): calculation goes here (via totals.bar10Tola)
]

export default function StatusBar() {
  const { totals, searchReceiptNo, cashDisplay } = useApp()
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [showDefaults, setShowDefaults] = useState(false)
  const [showIndraj, setShowIndraj] = useState(false) // اندراج (manual balance adjust) modal

  // A negative bottom-bar value turns the box BACKGROUND red (text stays the
  // class's white — best contrast, colorblind-safe); zero/positive falls back to
  // the .status-green class's green. Inline style beats the class regardless of
  // Tailwind layer order. Condition on the RAW number, never the formatted string.
  const negStyle = (v) => ({ backgroundColor: Number(v) < 0 ? '#dc2626' : undefined })

  // Look up a parchi by its number, triggered by pressing Enter in the رسید نمبر
  // field. Delegates to the store's searchReceiptNo, which walks the merged
  // saved+draft timeline (so unsaved DRAFT parchis are found too, not just
  // receipts already in the ledger). Empty → do nothing; non-numeric → Urdu
  // error; no match anywhere → "does not exist"; a match → parked-then-loaded.
  const doSearch = async () => {
    const raw = String(search).trim()
    if (!raw) { setSearchMsg(''); return } // empty — gentle no-op
    if (!/^\d+$/.test(raw)) { setSearchMsg('صرف نمبر لکھیں'); return }
    setSearchMsg('')
    try {
      // Walk the merged saved+draft timeline (nav arrows use the same one) so a
      // parchi that only exists as an unsaved DRAFT is still found, not just
      // receipts already written to the ledger.
      const res = await searchReceiptNo(Number(raw))
      setSearchMsg(res && res.ok ? '' : (res && res.message) || 'یہ رسید نمبر موجود نہیں')
    } catch (e) {
      console.warn('Receipt lookup failed:', e)
      setSearchMsg('یہ رسید نمبر موجود نہیں')
    }
  }

  return (
    <div dir="rtl" className="flex items-stretch gap-1 px-1 py-1 bg-panel border-t border-line h-[40px]">
      {/* live shop totals on the RIGHT — کیش | تیزابی | piece | 1/5/10 tola bar.
          The کیش and تیزابی boxes were narrowed (175→150, 130→110) to make room:
          the bar is a fixed 1460px canvas and six boxes plus the search, buttons
          and ticker have to share one 40px row. */}
      <div className="flex items-stretch gap-2">
        <div className="flex items-stretch gap-1.5">
          <div className="urdu flex items-center px-1 text-[15px] font-bold">کیش</div>
          {/* dir=ltr so a negative renders standard "-25,000" (minus on the LEFT). */}
          <div dir="ltr" style={negStyle(cashDisplay)} className="status-green flex items-center justify-center px-3 min-w-[150px] text-[18px] font-bold whitespace-nowrap">{fmtMoney(cashDisplay)}</div>
        </div>

        <div className="flex items-stretch gap-1.5">
          <div className="urdu flex items-center px-1 text-[15px] font-bold">تیزابی</div>
          <div dir="ltr" style={negStyle(totals.tezabi_sona)} className="status-green flex items-center justify-center px-3 min-w-[110px] text-[18px] font-bold whitespace-nowrap">{fmtNum(totals.tezabi_sona, 3)}</div>
        </div>

        {/* piece / 1 tola bar / 5 tola bar / 10 tola bar — same green-box style as
            the two above. PLACEHOLDERS: totals[key] is null/undefined until the
            calculation is added (see INVENTORY_BOXES + store.jsx), so each shows
            "-" rather than a made-up number. */}
        {INVENTORY_BOXES.map((b) => {
          const value = totals[b.key]
          const has = value != null && value !== ''
          return (
            <div key={b.key} className="flex items-stretch gap-1.5">
              {/* same urdu label treatment as کیش / تیزابی, one step down in size
                  so six labelled boxes still fit the fixed-width bar */}
              <div className="urdu flex items-center px-1 text-[14px] font-bold whitespace-nowrap">{b.label}</div>
              <div
                dir="ltr"
                style={has ? negStyle(value) : undefined}
                className="status-green flex items-center justify-center px-2 min-w-[58px] text-[18px] font-bold whitespace-nowrap"
              >
                {has ? fmtNum(value, 0) : '-'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex-1" />

      {/* receipt search on the LEFT (replaces the old 1..U buttons) */}
      <div className="flex items-center gap-1.5">
        <input
          className="self-center h-[26px] w-[120px] px-3 rounded-md border border-gray-300 bg-white text-[13px] font-semibold text-center outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          inputMode="numeric"
          dir="ltr"
          placeholder="رسید نمبر"
          title="رسید نمبر لکھ کر Enter دبائیں — type a receipt no. and press Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
        />
        {searchMsg && <span className="urdu text-[10px] text-red-600 whitespace-nowrap px-1">{searchMsg}</span>}
      </div>
      {/* اندراج — manual bottom-bar کیش / تیزابی balance adjustment */}
      <button
        type="button"
        title="دستی اندراج (کیش / تیزابی)"
        onClick={() => setShowIndraj(true)}
        className="self-center flex items-center px-4 h-[26px] rounded-md bg-amber-600 text-white text-[12px] font-bold urdu shadow-sm hover:bg-amber-700 active:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
      >
        اندراج
      </button>
      <button
        type="button"
        title="ڈیفالٹ سیٹنگز"
        onClick={() => setShowDefaults(true)}
        className="self-center flex items-center gap-1.5 px-3 h-[26px] rounded-md bg-blue-600 text-white text-[12px] font-bold shadow-sm hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
        Defaults
      </button>

      <SilverTicker />

      <DefaultsForm open={showDefaults} onClose={() => setShowDefaults(false)} />
      <IndrajForm open={showIndraj} onClose={() => setShowIndraj(false)} />
    </div>
  )
}
