import React from 'react'

// The five units a چاندی line can be entered/labelled in. ONE list, shared by the
// اندراج modal (where the unit picks the bottom-bar counter the entry lands on)
// and the نقد/ادھار panel (where it is COSMETIC — it only rewords the row label).
// `count: true` means "the number is a COUNT of items, not grams" — that flag is
// only meaningful to the اندراج side; CashUdharPanel ignores it.
export const UNITS = [
  { v: 'gold', label: 'چاندی', count: false },
  { v: 'piece', label: 'پیس', count: true },
  { v: 'bar1Tola', label: '1 تولہ بار', count: true },
  { v: 'bar5Tola', label: '5 تولہ بار', count: true },
  { v: 'bar10Tola', label: '10 تولہ بار', count: true }
]
export const DEFAULT_UNIT = UNITS[0].v // 'gold' → چاندی
export const unitOf = (v) => UNITS.find((u) => u.v === v) || UNITS[0]

// STRUCTURAL styling only — box, focus ring, and the appearance-none that kills
// the native Windows combo chrome (Tailwind's utility emits the -webkit-/-moz-
// prefixes for us). SIZE (text size, padding, weight) is per-caller via
// `className`, because the modal's roomy field and the panel's compact row need
// different metrics while staying visibly the same control.
const BASE =
  'urdu w-full bg-white border border-gray-300 rounded-md text-start cursor-pointer ' +
  'outline-none transition-colors appearance-none ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

// The chevron is a real <svg> laid over the box rather than a background-image: a
// data-URI inside a Tailwind arbitrary value is fragile (spaces/quotes) and fails
// silently. pointer-events-none, so clicks fall through and this stays a plain,
// keyboard-accessible <select>. It sits on the LEFT — the far side in this RTL UI
// — so callers must reserve left padding for it (pl-6 / pl-7).
export default function UnitSelect({ value, onChange, className = '', title = 'یونٹ' }) {
  return (
    <div className="relative min-w-0">
      <select
        dir="rtl"
        title={title}
        value={value}
        onChange={onChange}
        className={`${BASE} ${className}`}
      >
        {UNITS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 8"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-2 text-gray-500"
      >
        <path
          d="M1 1.5 L6 6.5 L11 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
