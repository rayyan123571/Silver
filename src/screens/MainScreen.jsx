import React from 'react'
import FitScreen from '../components/FitScreen.jsx'
import TopBar from '../components/TopBar.jsx'
import CustomerEntry from '../components/CustomerEntry.jsx'
import CashUdharPanel from '../components/CashUdharPanel.jsx'
import NayaSoda from '../components/NayaSoda.jsx'
import { CreditReceipt, CashReceipt } from '../components/Receipts.jsx'
import StatusBar from '../components/StatusBar.jsx'
import { useApp } from '../state/store.jsx'

// Fixed-pixel desktop canvas. FitScreen CSS-transforms the whole thing to the
// window, so these are DESIGN pixels, not physical ones.
//
// TWO COLUMNS. Each column is a vertical stack of cards; the receipt at the foot
// of each column is flex-1, so both receipts run to the SAME bottom line.
//
//   ┌──────────────────────────────────────────────────────────┐  TopBar
//   ├─────────────────────┬────────────────────────────────────┤
//   │ نام + Save / nav    │  نقد + ادھار entry tables          │
//   ├─────────────────────┤                                    │
//   │ نیا سودا            ├────────────────────────────────────┤
//   ├─────────────────────┤                                    │
//   │ ادھار کی رسید       │  نقد کی رسید                       │
//   ├─────────────────────┴────────────────────────────────────┤
//   │ StatusBar                                                 │
//   └──────────────────────────────────────────────────────────┘
//
// The نقد/ادھار tables and نقد کی رسید are both plain width:100% children of the
// RIGHT column, so they are exactly the same width by construction — there is no
// second width to keep in sync.
//
// This replaced a three-band stack (full-width CustomerEntry / نیا سودا + tables /
// both receipts side by side), which spread the two receipts across the full width
// and left the header floating over the whole screen.
const CANVAS_W = 1460
const CANVAS_H = 950
const TOPBAR_H = 40
const STATUS_H = 40

// Column ratio. The RIGHT column carries the نقد/ادھار tables, which need the room
// (four numeric columns + a unit dropdown per row), so it takes the larger share.
// On the 1460px canvas this lands the right column at ~768px — near the ~718px the
// نقد رسید occupied in the old side-by-side band, so it reads at the same size.
// minmax(0, …) on both tracks: a bare `1fr` keeps an implicit min-width:auto, and a
// long value inside a table cell could then push its track wider and break the fit.
const COLS = 'minmax(0, 1fr) minmax(0, 1.15fr)'

// EQUAL-HEIGHT RECEIPTS. The grid already gives both columns the same height
// (align-items: stretch) and both receipts are flex-1, which is why their BOTTOM
// edges already line up. That alone cannot make them the same HEIGHT, though: a
// receipt's height is whatever its column has left over, and the two columns carried
// different loads above it — 414px on the left (header + نیا سودا + gaps) against
// 300px on the right (the tables + gap). Bottoms aligned, tops did not, so the cash
// receipt ran ~114px taller.
//
// So the TOP REGION of each column is pinned to ONE shared height. With equal columns
// and equal tops, the leftover is equal too: both receipts stretch to the same top AND
// the same bottom. 414 = the left column's existing top region, so نیا سودا keeps its
// size and NOTHING shrinks — the نقد/ادھار tables simply grow into the height the
// over-tall cash receipt used to occupy (their rows are all flex-1, so they just
// breathe; 292 was their crowding floor, not a ceiling).
const TOP_H = 414

// Inside the left column's top region the header is natural-height and نیا سودا takes
// the rest. Deliberately NOT a fixed height: CustomerEntry grows a row when it shows a
// save message, and نیا سودا absorbing that keeps the region — and so the receipt line
// below it — exactly where it is.

export default function MainScreen() {
  // The two receipts read the live composing state, exactly as the old
  // RightReceipts wrapper did — same ctx, same props, same components.
  const ctx = useApp()

  return (
    <FitScreen w={CANVAS_W} h={CANVAS_H}>
      <div
        dir="ltr"
        className="w-full h-full grid overflow-hidden bg-panel"
        style={{ gridTemplateRows: `${TOPBAR_H}px 1fr ${STATUS_H}px` }}
      >
        <TopBar />

        {/* Working area — two columns, even gutters all round. */}
        <div
          className="min-h-0 grid gap-2 p-2 overflow-hidden"
          style={{ gridTemplateColumns: COLS }}
        >
          {/* ── LEFT: نام/Save header → نیا سودا → ادھار کی رسید ── */}
          <div className="min-w-0 min-h-0 flex flex-col gap-2">
            <div className="shrink-0 flex flex-col gap-2" style={{ height: `${TOP_H}px` }}>
              <CustomerEntry />
              <div className="flex-1 min-h-0">
                <NayaSoda />
              </div>
            </div>

            {/* flex-1: fills what the top region leaves — the SAME leftover as the
                right column, so this receipt matches نقد کی رسید top and bottom. */}
            <div className="flex-1 min-h-0">
              <CreditReceipt ctx={ctx} />
            </div>
          </div>

          {/* ── RIGHT: نقد + ادھار entry tables → نقد کی رسید ── */}
          <div className="min-w-0 min-h-0 flex flex-col gap-2">
            <div className="shrink-0" style={{ height: `${TOP_H}px` }}>
              <CashUdharPanel />
            </div>

            <div className="flex-1 min-h-0">
              <CashReceipt ctx={ctx} />
            </div>
          </div>
        </div>

        <StatusBar />
      </div>
    </FitScreen>
  )
}
