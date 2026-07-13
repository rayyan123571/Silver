import React, { useEffect } from 'react'
import { useApp } from '../state/store.jsx'
import { useDateMask } from './DateField.jsx'

function RateField({ label, value, onChange, w = 'w-20', numeric }) {
  // Numeric rate fields display with thousand separators (9000 -> 9,000) while
  // storing the raw digits; the date field passes numeric={false}.
  const disp =
    numeric && value !== '' && value != null && !isNaN(Number(String(value).replace(/,/g, '')))
      ? Number(String(value).replace(/,/g, '')).toLocaleString('en-US')
      : value ?? ''
  return (
    <div className="flex items-stretch">
      <div className="hdr urdu px-2 whitespace-nowrap text-[15px] font-bold">{label}</div>
      <input
        dir="ltr"
        className={`inp text-center ${w} text-[17px] font-bold leading-none`}
        value={disp}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/,/g, '') : e.target.value)}
      />
    </div>
  )
}

export default function TopBar() {
  const { rates, saveRates, setScreen, openUdhar, closeUdhar, openAkhrajat, closeAkhrajat, screen, udharOpen, akhrajatOpen, udharComment, setUdharComment } = useApp()

  // Exactly one tab is active at a time. ادھار / اخراجات are modals, so an open
  // modal wins the highlight; otherwise روزنامچہ = 'daybook'. لیب is no longer a
  // tab — it IS the default main page (screen === 'main'), reachable by closing
  // any modal or via the روزنامچہ "← واپس" button, so no tab highlights on main.
  const anyModal = udharOpen || akhrajatOpen
  const active = {
    daybook: screen === 'daybook' && !anyModal,
    udhar: udharOpen,
    akhrajat: akhrajatOpen
  }
  // Active = green (tab-active). Inactive tabs get a subtle, lighter hover tint
  // (distinct from the active green) so they read as clickable.
  const tabCls = (isActive) => `tab urdu text-[16px] font-bold ${isActive ? 'tab-active' : 'hover:from-emerald-100 hover:to-emerald-200'}`
  const goDaybook = () => { closeUdhar(); closeAkhrajat(); setScreen('daybook') }

  // The تاریخ field stays an editable, persisted receipt date. Default it to
  // today's live date on mount only when it's empty, so a chosen date is kept.
  useEffect(() => {
    if (!rates.date) {
      const d = new Date()
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      saveRates({ date: iso })
    }
  }, [])

  const upd = (k) => (v) => saveRates({ [k]: v })

  // تاریخ — edit-in-place dd/mm/yyyy mask bound to the persisted receipt date.
  // Saves to rates.date only on a full valid date (or '' when cleared).
  const dateMask = useDateMask(rates.date, (v) => saveRates({ date: v }))

  return (
    <div dir="rtl" className="flex items-stretch gap-1 bg-panel border-b border-line px-1 py-1 h-[46px] relative">
      {/* tiny tola->gram constant printed at the very top in the screenshot */}
      <div className="absolute right-1/2 -top-[0px] text-[9px] text-gray-500">11.664</div>

      {/* Tabs (right-most in RTL) */}
      <div className="flex items-stretch">
        <button className={tabCls(active.daybook)} onClick={goDaybook}>
          روزنامچہ
        </button>
        <button className={tabCls(active.udhar)} onClick={openUdhar}>
          ادھار
        </button>
        <button className={tabCls(active.akhrajat)} onClick={openAkhrajat}>
          اخراجات
        </button>
      </div>

      {/* wide free name box — the parchi comment (e.g. name of who came to collect);
          shown next to پوائنٹ in the ادھار receipt and saved with the parchi. */}
      <input
        className="inp flex-1 min-w-[120px] text-[17px] font-bold"
        value={udharComment}
        onChange={(e) => setUdharComment(e.target.value)}
        placeholder="نام / تبصرہ"
      />

      <RateField label="ریٹ چاندی فی تولہ" value={rates.rate_tezabi_tola} onChange={upd('rate_tezabi_tola')} w="w-28" numeric />
      {/* تاریخ — edit-in-place date mask (same behavior as the Udhar/اخراجات dates). */}
      <div className="flex items-stretch">
        <div className="hdr urdu px-2 whitespace-nowrap text-[15px] font-bold">تاریخ</div>
        <input
          ref={dateMask.textRef}
          value={dateMask.text}
          onChange={dateMask.onChange}
          placeholder="dd/mm/yyyy"
          dir="ltr"
          className="inp text-center w-32 text-[17px] font-bold leading-none"
        />
      </div>

      <button
        type="button"
        title="ٹاسک بار کے ساتھ — Fill (taskbar visible)"
        onClick={() => window.api && window.api.minimizeApp && window.api.minimizeApp()}
        className="bg-gray-300 text-gray-800 font-bold w-7 flex items-center justify-center border border-line hover:brightness-105 active:brightness-95"
      >
        –
      </button>
      <button
        type="button"
        title="پوری اسکرین — Full screen (taskbar hidden)"
        onClick={() => window.api && window.api.maximizeApp && window.api.maximizeApp()}
        className="bg-gray-300 text-gray-800 font-bold w-7 flex items-center justify-center border border-line hover:brightness-105 active:brightness-95"
      >
        □
      </button>
      <button
        type="button"
        title="ایپ بند کریں — Quit"
        onClick={() => window.api && window.api.quitApp && window.api.quitApp()}
        className="bg-redX text-white font-bold w-7 flex items-center justify-center border border-line hover:brightness-110 active:brightness-90"
      >
        X
      </button>
    </div>
  )
}
