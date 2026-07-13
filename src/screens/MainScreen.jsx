import React from 'react'
import FitScreen from '../components/FitScreen.jsx'
import TopBar from '../components/TopBar.jsx'
import CustomerEntry from '../components/CustomerEntry.jsx'
import CashUdharPanel from '../components/CashUdharPanel.jsx'
import { LeftReceipts, RightReceipts } from '../components/Receipts.jsx'
import StatusBar from '../components/StatusBar.jsx'

// Fixed-pixel desktop canvas. FitScreen CSS-transforms the whole thing to the
// window, so these are DESIGN pixels, not physical ones.
//
// The working area is a vertical stack of three bands, each a card (or a row of
// cards):
//
//   ┌──────────────────────────────────────────────────────────┐  TopBar
//   ├──────────────────────────────────────────────────────────┤
//   │  CustomerEntry — نام + Save/nav, ONE full-width card      │  auto
//   ├───────────────────────┬──────────────────────────────────┤
//   │  نیا سودا             │  نقد + ادھار tables               │  MID_H
//   ├───────────────────────┴──────────────────────────────────┤
//   │  ادھار کی رسید        │  نقد کی رسید      (equal width)   │  flex-1
//   ├──────────────────────────────────────────────────────────┤
//   │  StatusBar                                                │
//   └──────────────────────────────────────────────────────────┘
//
// This replaced a 2×2 grid whose LEFT column carried CustomerEntry over نیا سودا
// and whose RIGHT column carried the tables over BOTH receipts. That grid forced
// the receipts into half the width and left a dead band under CustomerEntry.
const CANVAS_W = 1460
// 950 (was 820). The stack is one band taller than the old 2×2 grid. This value is
// MEASURED, not guessed: the ادھار receipt is the tallest card on the screen (14
// label rows + the two balance blocks + its action bar) and needs ~400px to show
// everything. At 880 it came out 29px short and its action bar (Saved / Refresh /
// WhatsApp / print) was being clipped off the bottom of the card. 950 gives the
// receipts band ~436px, so the card holds its full content with headroom.
// FitScreen scales the canvas down to fit the window, so this costs a little
// scale — never content.
const CANVAS_H = 950
const TOPBAR_H = 40
const STATUS_H = 40
// The نقد/ادھار band. Sized by the tables on its right: two section headers, six
// entry rows and the ٹوٹل strip, all flex-1 — below this they start to crowd.
const MID_H = 292
// نیا سودا sits to the left of the tables. Its five short fields need far less
// width than the tables, so it takes a fixed slice and the tables take the rest.
const NAYA_W = 520

export default function MainScreen() {
  return (
    <FitScreen w={CANVAS_W} h={CANVAS_H}>
      <div
        dir="ltr"
        className="w-full h-full grid overflow-hidden bg-panel"
        style={{ gridTemplateRows: `${TOPBAR_H}px 1fr ${STATUS_H}px` }}
      >
        <TopBar />

        {/* Working area — three stacked bands, even gutters all round. */}
        <div className="min-h-0 flex flex-col gap-2 p-2 overflow-hidden">
          {/* Band 1 — customer entry: the نام row and the Save/nav row together
              in ONE full-width card (they are two rows of a single component). */}
          <CustomerEntry />

          {/* Band 2 — نیا سودا (left) beside the نقد / ادھار tables (right). */}
          <div className="flex gap-2 shrink-0" style={{ height: `${MID_H}px` }}>
            <div className="shrink-0" style={{ width: `${NAYA_W}px` }}>
              <LeftReceipts />
            </div>
            <div className="flex-1 min-w-0">
              <CashUdharPanel />
            </div>
          </div>

          {/* Band 3 — the two receipts, side by side, equal width, filling the
              rest of the height so both cards are exactly the same size. */}
          <div className="flex-1 min-h-0">
            <RightReceipts />
          </div>
        </div>

        <StatusBar />
      </div>
    </FitScreen>
  )
}
