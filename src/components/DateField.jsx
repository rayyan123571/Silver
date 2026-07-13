import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Shared editable dd/mm/yyyy date field with EDIT-IN-PLACE masking (backspacing a
// digit edits in place — no scramble, no caret jump) plus a 📅 native picker.
// Used by every editable date input (Udhar filter, expenses, top-bar date).

const pad2 = (n) => String(n).padStart(2, '0')

// yyyy-mm-dd (ISO) → dd/mm/yyyy for display; empty ISO → ''.
export const isoToDisp = (iso) => {
  const p = String(iso || '').split('-')
  return p.length === 3 && p[0] ? `${p[2]}/${p[1]}/${p[0]}` : ''
}

// dd/mm/yyyy → ISO, ONLY for a real full date (day 1-31, month 1-12). A partial or
// out-of-range value returns null, so a mid-edit like "0/07/2026" is not treated as
// a date (no bogus ISO emitted, no reformat of the text the user is editing).
export const dispToIso = (s) => {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  return `${m[3]}-${pad2(mm)}-${pad2(dd)}`
}

// Edit-in-place mask: keep digits + '/', cap at 10 (dd/mm/yyyy). Auto-insert a slash
// ONLY while typing FORWARD past a just-completed segment (after dd, and after dd/mm).
// On deletion it NEVER re-groups/reformats — the slashes stay put so a single digit
// can be retyped. Returns the new text and the caret position to keep.
export function maskDateInput(prevText, el) {
  const prevLen = prevText.length
  let v = el.value.replace(/[^\d/]/g, '').slice(0, 10)
  let caret = el.selectionStart
  if (v.length > prevLen) {
    if (/^\d{2}$/.test(v)) { v = v + '/'; caret = v.length }
    else if (/^\d{2}\/\d{2}$/.test(v)) { v = v + '/'; caret = v.length }
  }
  return { text: v, caret }
}

// Hook that drives an edit-in-place dd/mm/yyyy input bound to an ISO value.
// Returns { text, textRef, onChange } to spread onto a text <input>.
export function useDateMask(iso, setIso) {
  const textRef = useRef(null)
  const caretRef = useRef(null)
  const lastEmit = useRef(iso) // the last ISO WE emitted — used to skip self-reformat
  const [text, setText] = useState(isoToDisp(iso))

  // Reformat the text to canonical dd/mm/yyyy ONLY on an EXTERNAL iso change (the 📅
  // picker or a parent reset) — never when our own typing set it, otherwise an
  // in-place edit would be rewritten and the caret would jump to the end.
  useEffect(() => {
    if (iso !== lastEmit.current) { setText(isoToDisp(iso)); lastEmit.current = iso }
  }, [iso])

  // Restore the caret after each controlled re-render caused by typing.
  useLayoutEffect(() => {
    if (caretRef.current != null && textRef.current) {
      textRef.current.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
    }
  })

  const onChange = (e) => {
    const { text: v, caret } = maskDateInput(text, e.target)
    caretRef.current = caret
    setText(v)
    const isoVal = dispToIso(v)
    if (isoVal) { lastEmit.current = isoVal; setIso(isoVal) }
    else if (v === '') { lastEmit.current = ''; setIso('') }
  }

  return { text, textRef, onChange }
}

export default function DateField({ label, iso, setIso }) {
  const { text, textRef, onChange } = useDateMask(iso, setIso)
  const pickerRef = useRef(null)
  const openPicker = () => {
    const el = pickerRef.current
    if (!el) return
    if (el.showPicker) { try { el.showPicker() } catch { el.focus() } } else el.focus()
  }
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[14px] font-bold text-black w-[86px] shrink-0">{label}</span>
      <input
        ref={textRef}
        value={text}
        onChange={onChange}
        placeholder="dd/mm/yyyy"
        dir="ltr"
        className="flex-1 min-w-0 h-8 border border-gray-300 bg-white text-[15px] font-bold px-2 text-center tabular-nums rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button type="button" onClick={openPicker} title="کیلنڈر" className="h-8 shrink-0 border border-gray-300 bg-gray-100 px-2 rounded-md hover:bg-gray-200 text-[15px]">📅</button>
      <input ref={pickerRef} type="date" value={iso || ''} onChange={(e) => setIso(e.target.value)} tabIndex={-1} className="absolute w-0 h-0 opacity-0 pointer-events-none" />
    </label>
  )
}
