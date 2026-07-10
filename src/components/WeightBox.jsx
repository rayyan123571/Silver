import React, { useRef } from 'react'
import { useApp } from '../state/store.jsx'
import { gramsToTMR, fmtNum } from '../logic/units.js'

// Top-left scale-entry box. Column order (left -> right):
//   <row label> | (گرام) | تولہ | ماشہ | رتی
// `inputRef` lets the parent target this row's input; `onEnter` (if given) runs
// after the value is normalized when Enter is pressed (used to jump focus from
// the gross row to the water row). Without onEnter, Enter just blurs.
function WeightRow({ label, grams, onGrams, inputRef, onEnter }) {
  const tmr = gramsToTMR(grams)
  // Normalize the typed weight to exactly 4 decimals on Enter / blur, e.g.
  // "50" -> "50.0000", "46" -> "46.0000", "11.664" -> "11.6640". Writing the
  // padded string back to state also re-triggers the live recompute of all 5
  // rows + both receipt panels. The numeric value stays full-precision.
  const normalize = (raw) => {
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) return
    onGrams(n.toFixed(4))
  }
  return (
    <div className="flex" dir="ltr">
      <div className="hdr urdu w-28 justify-end pr-1 text-[15px] font-bold">{label}</div>
      <input
        ref={inputRef}
        dir="ltr"
        className="inp text-center w-24 bg-mint font-bold text-[15px]"
        value={grams ?? ''}
        onChange={(e) => onGrams(e.target.value)}
        onBlur={(e) => normalize(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            normalize(e.target.value)
            if (onEnter) onEnter()
            else e.currentTarget.blur()
          }
        }}
        placeholder="0"
      />
      <div className="cell cell-c w-12 font-bold text-[15px]">{fmtNum(tmr.tola, 0)}</div>
      <div className="cell cell-c w-12 font-bold text-[15px]">{fmtNum(tmr.masha, 0)}</div>
      <div className="cell cell-c w-12 font-bold text-[15px]">{fmtNum(tmr.ratti, 2)}</div>
    </div>
  )
}

export default function WeightBox() {
  const { input, setWeight } = useApp()
  // Ref to the water-weight input so pressing Enter in the gross field can jump
  // focus straight to it (and select its contents for easy overwrite).
  const waterRef = useRef(null)
  return (
    <div dir="ltr" className="border border-line bg-white self-start">
      <div className="flex">
        <div className="hdr w-28"> </div>
        <div className="hdr urdu w-24 font-bold text-[14px]">(گرام)</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">تولہ</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">ماشہ</div>
        <div className="hdr urdu w-12 font-bold text-[14px]">رتی</div>
      </div>
      <WeightRow
        label="وزن کنڈے پر"
        grams={input.wazan}
        onGrams={(v) => setWeight('wazan', v)}
        onEnter={() => {
          const el = waterRef.current
          if (el) { el.focus(); el.select() }
        }}
      />
      <WeightRow
        label="وزن پانی میں"
        grams={input.malawat}
        onGrams={(v) => setWeight('malawat', v)}
        inputRef={waterRef}
      />
    </div>
  )
}
