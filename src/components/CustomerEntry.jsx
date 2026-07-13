import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store.jsx'
import CustomerForm from './CustomerForm.jsx'
import CustomerListModal from './CustomerListModal.jsx'
import GhostNameInput from './GhostNameInput.jsx'

// Editable combo box: a green text field with a ▼ dropdown button on the side.
// With `ghost`, the input gets the same inline autocomplete as the customer form;
// the overlay is confined to the input area and never overlaps the ▼ button.
function Combo({
  value,
  onChange,
  onArrow,
  onBlur,
  onKeyDown,
  placeholder,
  ghost,
  hasApi,
  inputRef,
  inputClassName = 'inp-g border-l-0',
  arrowClassName = 'w-4 text-[8px]'
}) {
  return (
    <div className="relative flex-1 min-w-0 flex">
      <button
        type="button"
        onClick={onArrow}
        className={`flex items-center justify-center border border-sunken bg-[#dcdcdc] leading-none hover:bg-[#cfcfcf] active:bg-[#c2c2c2] transition-colors ${arrowClassName}`}
        title="فہرست"
      >
        ▼
      </button>
      {ghost ? (
        <GhostNameInput
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          hasApi={hasApi}
          dir="auto"
          wrapperClassName="flex-1 min-w-0"
          inputClassName={inputClassName}
          placeholder={placeholder}
          inputRef={inputRef}
        />
      ) : (
        <input
          ref={inputRef}
          className={`${inputClassName} flex-1 min-w-0`}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

export default function CustomerEntry() {
  const {
    customer, setCustomer, newCustomer, saveCustomer, saveParchi, newParchi, receiptNo, hasApi, bump,
    gotoFirstReceipt, gotoLastReceipt, gotoNextReceipt, gotoPrevReceipt,
    hasPrevReceipt, hasNextReceipt
  } = useApp()
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1) // highlighted suggestion (keyboard)
  const [showForm, setShowForm] = useState(false)
  const [showList, setShowList] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null) // { ok, text }
  const nameTimer = useRef(null)

  // Strict autocomplete: the name box may ONLY hold a SAVED customer name. We keep
  // a cached list of saved customers (refreshed on every DB write via `bump`) so we
  // can prefix-match synchronously as the user types. `committedRef` is the exact
  // prefix the user has actually typed (the part before the auto-completed, selected
  // remainder). `nameInputRef` lets us set the caret/selection imperatively.
  const [savedCustomers, setSavedCustomers] = useState([])
  const committedRef = useRef('')
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (!hasApi) return
    // Cache EVERY saved customer (unbounded, ordered by name). The strict reject in
    // onNameChange only lets a keystroke through if it prefixes a name in THIS list,
    // so it must hold all names — otherwise the first letter of any customer past the
    // old 50-row cap (T=Talha, Z=Zubair…) could not be typed. listAllCustomers is
    // dedicated to this cache; findCustomers stays capped for the search dropdown.
    const load = window.api.listAllCustomers
      ? window.api.listAllCustomers()
      : window.api.findCustomers('') // fallback for an older preload
    load.then((list) => setSavedCustomers(list || []))
  }, [bump])

  // First saved customer whose name starts with `text` (case-insensitive, trimmed).
  const firstPrefix = (text) => {
    const t = (text || '').trim().toLowerCase()
    if (!t) return null
    return savedCustomers.find((c) => (c.name || '').trim().toLowerCase().startsWith(t)) || null
  }

  // Stage 2 — Save the current parchi (نقد + ادھار entries) to the DB. Name is
  // mandatory for a ledger save; with no entries at all, just save the customer.
  const onSave = async () => {
    const res = await saveParchi()
    if (res.ok && res.freed) {
      // STEP 2: the receipt number was freed and is now reusable for a new customer.
      setSaveMsg({ ok: true, text: `رسید ${res.receipt_no} فارغ ہو گئی — نئے کسٹمر کے لیے تیار` })
    } else if (res.ok) {
      setSaveMsg({ ok: true, text: `محفوظ ✓ — پرچی نمبر ${res.receipt_no}` })
    } else if (res.message && res.message.startsWith('کوئی اندراج')) {
      // No cash/udhar entries. Only an ALREADY-SAVED customer (has id) may be
      // (re)saved here — NEVER auto-create a customer from a typed name. A typed
      // but unsaved name is blocked with a prompt; new customers are added only
      // via the "+" form.
      if (customer.id) {
        await saveCustomer()
        setSaveMsg({ ok: true, text: 'کسٹمر محفوظ ✓' })
      } else if (customer.name && customer.name.trim()) {
        setSaveMsg({ ok: false, text: 'یہ کسٹمر محفوظ نہیں — فہرست سے منتخب کریں یا "+" سے نیا کسٹمر شامل کریں' })
      } else {
        setSaveMsg({ ok: false, text: 'پہلے کسٹمر منتخب کریں / نام درج کریں' })
      }
    } else {
      setSaveMsg({ ok: false, text: res.message })
    }
    setTimeout(() => setSaveMsg(null), 2500)
  }

  // Stage 6 — New: blank parchi with the next incremented number + fresh customer.
  const onNew = () => {
    // newParchi parks the current unsaved parchi and opens a fresh blank one
    // (it resets the customer itself, so no separate newCustomer() is needed).
    newParchi()
    setSaveMsg(null)
  }

  // Parchi navigation (⏮ First · ◀ Previous · ▶ Next · ⏭ Last). Each runs the
  // shared loadReceipt flow, so the full parchi (header + entries) is restored.
  // A failed/edge nav shows a brief Urdu note instead of erroring.
  const navigate = (fn) => async () => {
    const res = await fn()
    if (res && !res.ok && res.message) {
      setSaveMsg({ ok: false, text: res.message })
      setTimeout(() => setSaveMsg(null), 2000)
    }
  }

  // STRICT autocomplete. The box may only ever hold a SAVED customer name:
  //  • typing a prefix auto-fills the first matching saved name and selects the
  //    remainder (type "ta" → "taha" with "ha" highlighted);
  //  • a keystroke that leaves NO saved-name prefix is rejected (reverted);
  //  • an unknown name can never be typed in, so a receipt only ever carries a
  //    saved customer.
  const showMatches = (lower) => {
    setMatches(savedCustomers.filter((c) => (c.name || '').toLowerCase().startsWith(lower)))
    setActiveIndex(-1)
    setOpen(true)
  }

  // Ghost-text autocomplete. The box holds ONLY what the user has actually typed
  // (a prefix); GhostNameInput paints the completion in grey after it, and the
  // dropdown lists every saved name that starts with that prefix. The user types
  // freely (R → Ra → Ray) — nothing is force-filled or re-selected, so narrowing
  // "Rizwan" down to "Rayyan" just works. The id is locked only on an EXACT match
  // (typed-in exact name, or accepted via Enter/Tab/→). A keystroke that leaves a
  // string which prefixes NO saved name is rejected, so the box can never hold an
  // invented name — only a real customer's name or a prefix of one.
  const onNameChange = (e) => {
    const inputType = (e.nativeEvent && e.nativeEvent.inputType) || ''
    const deleting = inputType.indexOf('delete') === 0
    const value = e.target.value

    if (nameTimer.current) clearTimeout(nameTimer.current)

    // Empty → fully de-select the customer (id/name/mobile), so no stale ledger.
    if (!value.trim()) {
      committedRef.current = ''
      newCustomer()
      setOpen(false); setMatches([]); setActiveIndex(-1)
      return
    }

    const lower = value.toLowerCase()
    const exact = savedCustomers.find(
      (c) => (c.name || '').trim().toLowerCase() === value.trim().toLowerCase()
    )

    // Reject an INSERT that no longer prefixes any saved name (deletes always pass,
    // and an exact match always passes). Returning early leaves `customer.name`
    // unchanged, so React reverts the controlled input to the last valid text.
    if (!deleting && !exact && !firstPrefix(value)) return

    committedRef.current = value
    if (exact) setCustomer(exact)
    else setCustomer((c) => ({ ...c, id: null, name: value }))
    showMatches(lower)
  }

  // Pick a suggestion: FULL selection. findCustomers returns SELECT *, so `c`
  // already carries id/name/mobile/address/image — set it as the active customer
  // everywhere (same effect as picking from the customer list), then close.
  const pick = (c) => {
    setCustomer(c)
    committedRef.current = c.name || ''
    setOpen(false)
    setMatches([])
    setActiveIndex(-1)
  }

  // Keyboard: ↓/↑ highlight a dropdown row, Enter CONFIRMS (the arrow-highlighted
  // row if any, otherwise the currently auto-filled suggestion — locking in its id
  // and collapsing the highlighted completion), Esc closes.
  const onNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Arrowed into the dropdown → take that row.
      if (open && activeIndex >= 0 && activeIndex < matches.length) { pick(matches[activeIndex]); return }
      // Otherwise confirm the auto-filled suggestion (exact name shown, else its
      // first-prefix match, else the top of the list).
      const shown = customer.name || ''
      const chosen =
        savedCustomers.find((c) => (c.name || '').trim().toLowerCase() === shown.trim().toLowerCase()) ||
        firstPrefix(shown) ||
        (matches.length ? matches[0] : null)
      if (chosen) {
        pick(chosen)
        const n = (chosen.name || '').length
        // eslint-disable-next-line no-undef
        requestAnimationFrame(() => { const el = nameInputRef.current; if (el) { try { el.setSelectionRange(n, n) } catch (_) { /* noop */ } } })
      }
      return
    }
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  // Select from the grid: load the complete customer (incl. address/image) into
  // global state so the main page / receipts show them, then close the list.
  // Selecting must NOT open CustomerForm — same effect as picking a name suggestion.
  const openFromList = async (row) => {
    const full = (hasApi && (await window.api.getCustomer(row.id))) || row
    setCustomer(full)
    committedRef.current = full.name || ''
    setShowList(false)
  }

  return (
    // Width-capped and centred: full-bleed across the 1460px canvas left the نام
    // field and the Save bar stretched into long empty runs. The card is capped at
    // 680px and centred with auto side margins (mx-auto centres a flex item in the
    // column-flex working area). Nothing INSIDE changes — the نام Combo and the
    // Save bar are both flex-1, so they simply refill the narrower block and the
    // two rows stay together in this one card. Everything below (نیا سودا, the
    // tables, the receipts, the status bar) is unaffected and stays full width.
    <div dir="rtl" className="card shrink-0 relative p-3 gap-2 w-full max-w-[680px] mx-auto">

      {/* Name row — the primary customer selector. New (red) | نام | big combo | + .
          The ID and Mobile rows were removed from the main screen; that freed space
          goes to a larger, roomier name field + a prominent primary "+" action. */}
      <div className="flex items-stretch gap-2">
        <button className="link-red w-16 font-bold text-[16px]" onClick={onNew}>New</button>
        <div className="hdr urdu w-12 flex items-center justify-center rounded-md !bg-headStrip !text-headText !border-cardLine">نام</div>
        <Combo
          value={customer.name}
          onChange={onNameChange}
          onArrow={() => setShowList(true)}
          onBlur={() => setTimeout(() => { setOpen(false); setActiveIndex(-1) }, 150)}
          onKeyDown={onNameKeyDown}
          placeholder="نام"
          ghost
          hasApi={hasApi}
          inputRef={nameInputRef}
          inputClassName="inp-g border-l-0 px-3 h-9 text-[18px] font-bold rounded-md"
          arrowClassName="w-8 text-[12px]"
        />
        <button
          className="px-4 rounded-md bg-accent text-white text-[24px] font-bold leading-none flex items-center justify-center shadow-sm hover:bg-accentDark active:bg-accentDark transition-colors"
          title="نیا اندراج"
          onClick={() => { newCustomer(); setShowForm(true) }}
        >
          +
        </button>
      </div>
      {/* Receipt no | Save | nav arrows — same controls, matched to the row above:
          every control is h-9, so the two rows read as one aligned block. */}
      <div className="flex items-stretch gap-2 h-9">
        <div className="hdr urdu w-16 rounded-md !bg-headStrip !text-headText !border-cardLine">رسید نمبر</div>
        <input dir="ltr" className="inp w-16 text-center text-[15px] font-bold rounded-md" value={receiptNo} readOnly />
        {/* Save is THE primary action on this screen, so it carries the accent
            solid — one clear focal point instead of the old washed-out blue bar. */}
        <button
          className="flex-1 flex items-center justify-center font-bold text-[14px] px-2 rounded-md border border-accent bg-accent text-white shadow-sm hover:bg-accentDark hover:border-accentDark active:translate-y-px focus:outline-none focus:ring-2 focus:ring-accent/40 transition-colors"
          onClick={onSave}
        >
          Save
        </button>
        <button className="btn font-bold w-10 text-[18px] rounded-md flex items-center justify-center" title="پہلی رسید — First" onClick={navigate(gotoFirstReceipt)}>⏮</button>
        {/* ◀ Prev / ▶ Next are DISABLED (greyed, non-clickable) when there is no
            older / newer saved parchi in that direction. Nav behavior unchanged. */}
        <button
          className="btn text-redX font-bold w-10 text-[18px] rounded-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          title="پچھلی رسید — Previous"
          onClick={navigate(gotoPrevReceipt)}
          disabled={!hasPrevReceipt}
        >◀</button>
        <button
          className="btn text-redX font-bold w-10 text-[18px] rounded-md flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          title="اگلی رسید — Next"
          onClick={navigate(gotoNextReceipt)}
          disabled={!hasNextReceipt}
        >▶</button>
        <button className="btn font-bold w-10 text-[18px] rounded-md flex items-center justify-center" title="آخری رسید — Last" onClick={navigate(gotoLastReceipt)}>⏭</button>
      </div>

      {saveMsg && (
        <div className={`urdu text-[11px] px-2 py-1 rounded ${saveMsg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {saveMsg.text}
        </div>
      )}

      {open && matches.length > 0 && (
        <div className="absolute z-20 top-full right-0 left-0 bg-white border border-line max-h-40 overflow-auto shadow-lg">
          {matches.map((m, i) => (
            <div
              key={m.id}
              className={`px-2 py-1 cursor-pointer border-b border-gray-200 text-[11px] ${i === activeIndex ? 'bg-mint' : 'hover:bg-mint'}`}
              // onMouseDown (not onClick) + preventDefault: fires before the input's
              // blur and stops it, so the selection always registers — no blur race.
              onMouseDown={(e) => { e.preventDefault(); pick(m) }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {m.name} {m.mobile ? `— ${m.mobile}` : ''} {m.id != null ? `— ${m.id}` : ''}
            </div>
          ))}
        </div>
      )}

      <CustomerForm open={showForm} onClose={() => setShowForm(false)} />
      <CustomerListModal open={showList} onClose={() => setShowList(false)} onSelect={openFromList} />
    </div>
  )
}
