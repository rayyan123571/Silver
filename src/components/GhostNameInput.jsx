import React, { useEffect, useRef, useState } from 'react'

// True when the first strong (alphabetic) character is Arabic/Urdu (RTL). Latin
// letters → false (LTR). Ghost text is only rendered for LTR input; for RTL we
// gracefully show nothing rather than a misaligned overlay.
const RTL_RANGE = /[֑-߿יִ-﷽ﹰ-ﻼ]/
export function isRtlText(s) {
  const str = s || ''
  for (const ch of str) {
    if (/[A-Za-z]/.test(ch)) return false
    if (RTL_RANGE.test(ch)) return true
  }
  return false
}

// Classes that turn a clone of the input into a pixel-perfect ghost mirror.
const OVERLAY = 'absolute inset-0 pointer-events-none select-none overflow-hidden whitespace-pre'

/**
 * GhostNameInput — Gmail-style inline autocomplete for a customer NAME field.
 *
 * The overlay technique: the mirror <div> and the real <input> share the SAME
 * `inputClassName`, so every box metric (font, size, weight, letter-spacing,
 * line-height, padding, border, radius, min-height — and any cascade overrides
 * like `.receipt-panel .inp-g`) matches automatically. The input is then forced
 * transparent via inline style (which always beats class specificity), so the
 * mirror's background and its light-grey completion show through, aligned exactly
 * after the typed text. Works for any input skin (white form field OR green inp-g).
 *
 * Behaviour (identical to the customer form's original):
 *  - Only completes on a case-insensitive PREFIX of a real saved name.
 *  - Tab / Right-Arrow accepts; any other key replaces; Backspace never completes.
 *  - Latin/LTR only; RTL input cleanly shows no ghost.
 *  - Lookups debounced ~150ms via window.api.findCustomers.
 *
 * `onChange` is called both for typing (real event) and for accept (a synthetic
 * `{ target: { value } }`), so parents keep their existing `e.target.value` handlers.
 */
export default function GhostNameInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputClassName = '',
  wrapperClassName = '',
  dir = 'auto',
  hasApi,
  inputRef,
  style,
  ...rest
}) {
  const [ghostFull, setGhostFullState] = useState('')
  const ghostRef = useRef('')
  const prevLenRef = useRef((value || '').length) // to tell typing-forward from deleting
  const lastEmittedRef = useRef(value || '') // last value we produced (typing/accept)
  const timerRef = useRef(null)
  const innerRef = useRef(null)
  const elRef = inputRef || innerRef

  const setGhostFull = (v) => { ghostRef.current = v; setGhostFullState(v) }

  // A value change that did NOT come from our own input/accept is a programmatic
  // load (New, pick-suggestion, grid select, navigation, seeding a form). Reset
  // the ghost + length tracking so a load never triggers or leaves a suggestion.
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value
      prevLenRef.current = (value || '').length
      setGhostFull('')
    }
  }, [value])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleChange = (e) => {
    const v = e.target.value
    const grew = v.length > prevLenRef.current
    prevLenRef.current = v.length
    lastEmittedRef.current = v
    onChange(e)
    // deletion / empty / RTL / no api → no ghost
    if (!hasApi || !grew || !v.trim() || isRtlText(v)) { setGhostFull(''); return }
    // drop a stale suggestion immediately if the typed text no longer prefixes it
    if (ghostRef.current && !ghostRef.current.toLowerCase().startsWith(v.toLowerCase())) {
      setGhostFull('')
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const res = await window.api.findCustomers(v)
      const lower = v.toLowerCase()
      const m = (res || []).find(
        (c) => c.name && c.name.length > v.length && c.name.toLowerCase().startsWith(lower)
      )
      setGhostFull(m ? m.name : '')
    }, 150)
  }

  const nameIsRtl = isRtlText(value)
  const ghostTail =
    ghostFull &&
    !nameIsRtl &&
    ghostFull.length > (value || '').length &&
    ghostFull.toLowerCase().startsWith((value || '').toLowerCase())
      ? ghostFull.slice((value || '').length)
      : ''

  const acceptGhost = () => {
    if (!ghostTail) return
    const full = ghostFull
    prevLenRef.current = full.length
    lastEmittedRef.current = full
    setGhostFull('')
    onChange({ target: { value: full } }) // synthetic — parents read e.target.value
    requestAnimationFrame(() => {
      const el = elRef.current
      if (el) { el.focus(); el.setSelectionRange(full.length, full.length) }
    })
  }

  const handleKeyDown = (e) => {
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && ghostTail) {
      e.preventDefault()
      acceptGhost()
      return
    }
    if (onKeyDown) onKeyDown(e)
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      {/* Mirror: same skin as the input, renders transparent typed text + grey tail */}
      <div aria-hidden="true" dir={nameIsRtl ? 'rtl' : 'ltr'} className={`${inputClassName} ${OVERLAY}`}>
        <span className="text-transparent">{value}</span>
        <span className="text-gray-400">{ghostTail}</span>
      </div>
      {/* Real input on top, forced transparent so the mirror shows through.
          `shadow-none` drops any inherited inset shadow (e.g. inp-g) WITHOUT
          killing focus rings (those live in a separate Tailwind box-shadow var);
          the transparent background is inline so it always beats bg utilities. */}
      <input
        ref={elRef}
        dir={dir}
        className={`${inputClassName} shadow-none relative z-10`}
        style={{ background: 'transparent', ...style }}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        {...rest}
      />
    </div>
  )
}
