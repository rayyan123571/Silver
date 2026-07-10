import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import GhostNameInput from './GhostNameInput.jsx'

// Blank working copy — only the fields this form edits. The picture is held as a
// base64 data URL in `image` (same name as the DB column).
const EMPTY = { id: null, name: '', mobile: '', address: '', image: null }

// Shared input styling: crisp, readable, comfortable caret, clear focus ring.
// INPUT_BASE omits the background so it can be reused for the transparent Name
// input that layers over a ghost-text mirror.
const INPUT_BASE =
  'w-full border border-gray-300 rounded-md text-[14px] leading-relaxed ' +
  'px-3 py-2 cursor-text transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
const INPUT = `${INPUT_BASE} bg-white`



// Dark, obviously-clickable navigation button.
const NAV =
  'w-9 h-9 rounded-md bg-slate-700 text-white text-[15px] font-bold flex items-center ' +
  'justify-center border border-slate-800 shadow-sm transition-colors ' +
  'hover:bg-slate-600 active:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 ' +
  'disabled:bg-slate-300 disabled:border-slate-300 disabled:text-slate-100 disabled:cursor-not-allowed'

// IMPORTANT: `Row` lives at MODULE scope, not inside CustomerForm. If it were
// declared inside the component it would get a new function identity on every
// keystroke, causing React to unmount/remount the inputs and destroy focus after
// a single character. Keeping it stable here is what makes typing work.
function Row({ label, children, alignTop }) {
  return (
    <div className={`grid grid-cols-[120px_1fr] gap-3 ${alignTop ? 'items-start' : 'items-center'}`}>
      <label className={`urdu font-bold text-[13px] text-gray-700 text-left ${alignTop ? 'pt-2' : ''}`}>{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// Bold the matched slice of a name so live search results show why they matched.
function Highlight({ text, q }) {
  const t = text || ''
  const query = (q || '').trim()
  if (!query) return t
  const i = t.toLowerCase().indexOf(query.toLowerCase())
  if (i === -1) return t
  return (
    <>
      {t.slice(0, i)}
      <mark className="bg-yellow-200 text-inherit rounded px-0.5">{t.slice(i, i + query.length)}</mark>
      {t.slice(i + query.length)}
    </>
  )
}

// Normalise a DB row (or the global customer) into the form's working shape.
function toForm(row) {
  if (!row) return { ...EMPTY }
  return {
    id: row.id ?? null,
    name: row.name ?? '',
    mobile: row.mobile ?? '',
    address: row.address ?? '',
    image: row.image ?? row.imagePath ?? null
  }
}

// کسٹمر فارم — polished desktop record manager (add / find / navigate / edit).
export default function CustomerForm({ open, onClose }) {
  const { customer, setCustomer, saveCustomer, hasApi } = useApp()

  const [form, setForm] = useState(EMPTY)
  const [previewId, setPreviewId] = useState(null) // upcoming id for a new record

  // Find sub-panel
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [suggestions, setSuggestions] = useState([])

  const [busy, setBusy] = useState(false)

  // Navigation boundaries (ids of first/last saved customers).
  const [bounds, setBounds] = useState({ firstId: null, lastId: null })

  // Green "Record saved" toast (Add).
  const [toast, setToast] = useState(null) // { text } | null
  const [toastVisible, setToastVisible] = useState(false)

  // Subtle auto-save indicator: 'idle' | 'saving' | 'saved'.
  const [autoStatus, setAutoStatus] = useState('idle')

  // Image lightbox (view-only zoom of the uploaded picture).
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const fileRef = useRef(null)
  const nameRef = useRef(null)
  const mobileRef = useRef(null)
  const addressRef = useRef(null)
  const autoSaveTimer = useRef(null)
  const toastTimers = useRef([])
  const autoStatusTimer = useRef(null)

  const refreshBounds = async () => {
    if (!hasApi) return
    const [first, last] = await Promise.all([
      window.api.getFirstCustomer(),
      window.api.getLastCustomer()
    ])
    setBounds({ firstId: first ? first.id : null, lastId: last ? last.id : null })
  }

  // Seed from the selected customer only when the modal transitions open, refresh
  // nav bounds, and auto-focus Name for a fresh record so the user can type at once.
  useEffect(() => {
    if (!open) return
    const seeded = toForm(customer)
    setForm(seeded)
    setPreviewId(null)
    setSearchOpen(false)
    setSearchQ('')
    setSuggestions([])
    setAutoStatus('idle')
    refreshBounds()
    if (seeded.id == null) {
      // Wait a tick for the input to mount, then place the caret in Name.
      requestAnimationFrame(() => nameRef.current && nameRef.current.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Live ID preview: the moment Name is non-empty on a NEW record, ask the DB what
  // id the next insert will get. Clearing Name reverts to "Auto".
  useEffect(() => {
    if (!open || form.id != null || !hasApi) {
      setPreviewId(null)
      return
    }
    if (!form.name.trim()) {
      setPreviewId(null)
      return
    }
    let cancelled = false
    window.api.peekNextCustomerId().then((v) => {
      if (!cancelled) setPreviewId(v)
    })
    return () => { cancelled = true }
  }, [open, form.id, form.name, hasApi])

  // Live search suggestions — debounced ~200ms while the panel is open. Matches
  // name (contains/prefix), mobile, or id via findCustomers. Empty query shows a
  // hint instead of a full dump, so we clear results when nothing is typed.
  useEffect(() => {
    if (!searchOpen || !hasApi) return
    if (!searchQ.trim()) { setSuggestions([]); return }
    const t = setTimeout(async () => {
      const res = await window.api.findCustomers(searchQ)
      setSuggestions(res || [])
    }, 200)
    return () => clearTimeout(t)
  }, [searchQ, searchOpen, hasApi])

  // Clean up pending timers on unmount.
  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    if (autoStatusTimer.current) clearTimeout(autoStatusTimer.current)
    toastTimers.current.forEach(clearTimeout)
  }, [])

  if (!open) return null

  // ---- toast ----
  const showToast = (text) => {
    toastTimers.current.forEach(clearTimeout)
    setToast({ text })
    setToastVisible(false)
    requestAnimationFrame(() => setToastVisible(true)) // fade in
    const t1 = setTimeout(() => setToastVisible(false), 1000) // start fade out (~1s)
    const t2 = setTimeout(() => setToast(null), 1300) // unmount after fade
    toastTimers.current = [t1, t2]
  }

  // ---- edits + debounced auto-save (existing records only) ----
  const doAutoSave = async (data) => {
    if (!hasApi || data.id == null) return
    setAutoStatus('saving')
    const saved = await saveCustomer(data)
    setAutoStatus('saved')
    if (autoStatusTimer.current) clearTimeout(autoStatusTimer.current)
    autoStatusTimer.current = setTimeout(() => setAutoStatus('idle'), 1200)
    if (saved) setBounds((b) => ({ ...b })) // ids unchanged on update; keep bounds
  }

  // Apply a user edit. For an EXISTING record (has id), schedule a debounced
  // auto-save (~600ms). For a NEW record, never auto-save — Add Record creates it.
  const commit = (next) => {
    setForm(next)
    if (next.id != null) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(() => doAutoSave(next), 600)
    }
  }

  const setField = (field) => (e) => commit({ ...form, [field]: e.target.value })

  // Enter in a single-line field jumps to the next logical field.
  const enterTo = (ref) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ref.current && ref.current.focus()
    }
  }

  // Enter advances Name → Mobile. (GhostNameInput handles Tab/Right-Arrow accept
  // internally and forwards other keys here.)
  const onNameEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      mobileRef.current && mobileRef.current.focus()
    }
  }

  const onPickImage = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => commit({ ...form, image: reader.result })
    reader.readAsDataURL(file)
    e.target.value = '' // allow re-picking the same file
  }

  const removeImage = () => commit({ ...form, image: null })

  // Load a full record into the form and sync it as the app-wide selected customer.
  const loadRecord = (row) => {
    if (!row) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    const next = toForm(row)
    setForm(next)
    setAutoStatus('idle')
    setCustomer((prev) => ({
      ...prev,
      id: next.id,
      name: next.name,
      mobile: next.mobile,
      address: next.address,
      imagePath: next.image
    }))
  }

  // ---- actions ----
  const onAdd = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      const saved = await saveCustomer(form) // INSERT (new) or UPDATE (loaded)
      await refreshBounds()
      // Trust the DB's returned row for the real id.
      if (saved) {
        setForm(toForm(saved))
        showToast(saved.id ? `Record saved ✓  (ID ${saved.id})` : 'Record saved ✓')
      } else {
        showToast('Record saved ✓')
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleFind = () => {
    setSearchOpen((v) => !v)
    setSearchQ('')
    setSuggestions([])
  }

  const closeFind = () => {
    setSearchOpen(false)
    setSearchQ('')
    setSuggestions([])
  }

  const pickSuggestion = (c) => {
    loadRecord(c)
    setSearchOpen(false)
    setSearchQ('')
    setSuggestions([])
  }

  // Navigation — logical (by id), independent of RTL visual order.
  const nav = async (fn, arg) => {
    if (!hasApi) return
    const row = await window.api[fn](arg)
    if (row) loadRecord(row)
  }
  const onFirst = () => nav('getFirstCustomer')
  const onPrev = () => nav('getPrevCustomer', form.id)
  const onNext = () => nav('getNextCustomer', form.id)
  const onLast = () => nav('getLastCustomer')

  // Edge rules.
  const hasAny = bounds.firstId != null
  const atFirst = form.id != null && form.id === bounds.firstId
  const atLast = form.id != null && form.id === bounds.lastId
  const firstDisabled = !hasAny
  const lastDisabled = !hasAny
  const prevDisabled = !hasAny || atFirst
  const nextDisabled = !hasAny || atLast

  // ID field: real id > preview (new + name typed) > "Auto".
  const isExisting = form.id != null
  const showPreview = !isExisting && form.name.trim() && previewId != null
  const idValue = isExisting ? String(form.id) : showPreview ? String(previewId) : 'Auto'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="relative bg-gray-50 border border-gray-300 rounded-lg shadow-2xl w-[620px] max-w-[95vw] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="urdu font-bold text-[16px] text-gray-800">کسٹمر فارم</h2>
            {/* Subtle auto-save indicator */}
            {autoStatus !== 'idle' && (
              <span className={`flex items-center gap-1 text-[12px] font-medium ${autoStatus === 'saving' ? 'text-gray-500' : 'text-emerald-600'}`}>
                {autoStatus === 'saving' ? (
                  'Saving…'
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Saved
                  </>
                )}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="بند کریں"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-auto flex flex-col gap-4">
          <Row label="آئی ڈی">
            <input
              dir="ltr"
              className={`${INPUT} text-center font-bold bg-gray-100 cursor-default ${showPreview ? 'text-gray-400 italic' : 'text-gray-600'}`}
              value={idValue}
              readOnly
              tabIndex={-1}
              title={
                isExisting
                  ? `Customer ID ${form.id}`
                  : showPreview
                    ? `Preview — this record will be saved as ID ${previewId}`
                    : 'New — ID assigned on save'
              }
            />
          </Row>

          <Row label="کسٹمر کا نام">
            {/* Inline ghost-text autocomplete — shared GhostNameInput (same as the
                main-screen combo). White box comes from the INPUT skin on its mirror. */}
            <GhostNameInput
              value={form.name}
              onChange={setField('name')}
              onKeyDown={onNameEnter}
              inputRef={nameRef}
              hasApi={hasApi}
              dir="auto"
              inputClassName={`${INPUT} text-start`}
              placeholder="نام"
            />
          </Row>

          <Row label="موبائل نمبر">
            <input
              ref={mobileRef}
              dir="auto"
              className={`${INPUT} text-start`}
              value={form.mobile}
              onChange={setField('mobile')}
              onKeyDown={enterTo(addressRef)}
              placeholder="موبائل"
              inputMode="tel"
            />
          </Row>

          <Row label="ایڈریس" alignTop>
            <textarea
              ref={addressRef}
              dir="auto"
              className={`${INPUT} text-start h-20 resize-none`}
              value={form.address}
              onChange={setField('address')}
              placeholder="ایڈریس"
            />
          </Row>

          {/* Image — fixed-size cover-fit preview + upload / remove */}
          <Row label="تصویر" alignTop>
            <div className="flex items-start gap-4">
              {form.image ? (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  title="بڑی تصویر دیکھنے کے لیے کلک کریں"
                  className="group relative w-[140px] h-[140px] shrink-0 border border-gray-300 rounded-md bg-white overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <img src={form.image} alt="customer" className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
                  {/* "click to view" affordance */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-200">
                    <span className="flex items-center gap-1 text-white text-[11px] font-medium">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /><path d="M11 8v6M8 11h6" strokeLinecap="round" />
                      </svg>
                      دیکھیں
                    </span>
                  </div>
                </button>
              ) : (
                <div className="w-[140px] h-[140px] shrink-0 border border-gray-300 rounded-md bg-white overflow-hidden flex items-center justify-center">
                  <div className="flex flex-col items-center gap-1 text-gray-400">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
                    </svg>
                    <span className="text-[11px]">No image</span>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                <button
                  type="button"
                  onClick={() => fileRef.current && fileRef.current.click()}
                  className="px-4 py-2 rounded-md border border-gray-300 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  Upload Image
                </button>
                {form.image && (
                  <button
                    type="button"
                    onClick={removeImage}
                    className="px-4 py-2 rounded-md border border-gray-300 bg-white text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </Row>

        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 border-t border-gray-300 bg-gray-100 px-5 py-3">
          <button
            onClick={onAdd}
            disabled={busy}
            className="px-5 py-2 rounded-md bg-blue-600 text-white text-[13px] font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add Record
          </button>
          <button
            onClick={toggleFind}
            className={`px-5 py-2 rounded-md border text-[13px] font-semibold transition-colors ${
              searchOpen
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Find Record
          </button>

          <div className="flex-1" />

          {/* Navigation — dark, edge-disabled. Logic is by id, not RTL order. */}
          <div className="flex items-center gap-1.5">
            <button type="button" title="پہلا (First)" onClick={onFirst} disabled={firstDisabled} className={NAV}>⏮</button>
            <button type="button" title="پچھلا (Previous)" onClick={onPrev} disabled={prevDisabled} className={NAV}>◀</button>
            <button type="button" title="اگلا (Next)" onClick={onNext} disabled={nextDisabled} className={NAV}>▶</button>
            <button type="button" title="آخری (Last)" onClick={onLast} disabled={lastDisabled} className={NAV}>⏭</button>
          </div>
        </div>

        {/* Green success toast */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
            <div
              className={`flex items-center gap-2 rounded-full bg-emerald-600 text-white text-[13px] font-semibold px-4 py-2 shadow-lg transition-opacity duration-300 ${
                toastVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        {/* ---- Find Customer modal ---- */}
        {searchOpen && (
          <div
            className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[8vh]"
            onClick={closeFind}
          >
            <div
              dir="rtl"
              className="bg-white border border-gray-300 rounded-lg shadow-2xl w-[520px] max-w-[95vw] max-h-[80vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Title bar */}
              <div className="flex items-center justify-between bg-gradient-to-b from-slate-100 to-slate-200 border-b border-gray-300 px-4 py-2.5">
                <h3 className="urdu font-bold text-[15px] text-gray-800">کسٹمر تلاش کریں</h3>
                <button
                  type="button"
                  onClick={closeFind}
                  title="بند کریں"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:bg-red-500 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Search input + helper */}
              <div className="p-4 border-b border-gray-200">
                <p className="urdu text-[12px] text-gray-500 mb-2">آپ نام، موبائل نمبر یا آئی ڈی سے تلاش کر سکتے ہیں</p>
                <div className="relative">
                  <span className="absolute inset-y-0 right-3 flex items-center text-gray-400 pointer-events-none">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    autoFocus
                    dir="auto"
                    className={`${INPUT} text-start pr-10`}
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="نام، موبائل یا آئی ڈی لکھیں"
                  />
                </div>
              </div>

              {/* Results */}
              <div className="overflow-auto">
                {!searchQ.trim() ? (
                  <div className="px-4 py-10 text-center text-gray-400">
                    <svg className="mx-auto mb-2" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
                    </svg>
                    <p className="urdu text-[13px]">تلاش کرنے کے لیے لکھیں</p>
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-gray-400">
                    <p className="urdu text-[13px]">کوئی ریکارڈ نہیں ملا</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {suggestions.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => pickSuggestion(m)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-start hover:bg-blue-50 transition-colors"
                        >
                          {/* avatar / initial */}
                          <span className="shrink-0 w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center text-slate-600 font-bold text-[13px]">
                            {m.image ? (
                              <img src={m.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (m.name || '؟').trim().charAt(0).toUpperCase()
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-[14px] text-gray-800 truncate">
                              <Highlight text={m.name || '—'} q={searchQ} />
                            </span>
                            <span className="block text-[12px] text-gray-500 truncate">
                              {m.mobile ? m.mobile : 'موبائل نہیں'}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                            ID {m.id}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- Image lightbox (view-only zoom) ---- */}
        {lightboxOpen && form.image && (
          <div
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              title="بند کریں"
              className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-lg hover:bg-white/25 transition-colors"
            >
              ✕
            </button>
            <img
              src={form.image}
              alt="customer enlarged"
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
