import React from 'react'
import FitScreen from '../components/FitScreen.jsx'
import TopBar from '../components/TopBar.jsx'
import WeightBox from '../components/WeightBox.jsx'
import CustomerEntry from '../components/CustomerEntry.jsx'
import PurityTable from '../components/PurityTable.jsx'
import CashUdharPanel from '../components/CashUdharPanel.jsx'
import { LeftReceipts, RightReceipts } from '../components/Receipts.jsx'
import StatusBar from '../components/StatusBar.jsx'

// Fixed-pixel desktop canvas. The whole screen is a CSS grid so panels never
// stretch, move, or resize — they sit at exact pixel positions like the legacy
// VB app. The center column border splits the screen into two equal halves and
// the receipts row is shared, so the four receipts always align on one baseline.
const CANVAS_W = 1460
const CANVAS_H = 820
const TOPBAR_H = 40
const STATUS_H = 40
// The center divider is shifted right of center so the LEFT section (purity
// table + وصولی/لیب receipts) gets extra room for very large amounts (e.g.
// 10,360,752) without truncation; the RIGHT section (نقد/ادھار) is the rest.
const LEFT_W = 790
const RIGHT_W = CANVAS_W - LEFT_W // 670
// Height of the data-entry band (both halves). Sized to fit the full purity
// table (header + all 5 rows: Local, Copper, Standard, Silver, Pure Silver)
// beneath the customer/receipt entry block — including the taller, padded Save
// button row — so the last row is never clipped by this band's overflow-hidden.
const UPPER_H = 280

export default function MainScreen() {
  return (
    <FitScreen w={CANVAS_W} h={CANVAS_H}>
      <div
        dir="ltr"
        className="w-full h-full grid overflow-hidden bg-panel"
        style={{ gridTemplateRows: `${TOPBAR_H}px 1fr ${STATUS_H}px` }}
      >
        <TopBar />

        {/* Working area: 2 columns × 2 rows. Row 1 = data-entry band (fixed),
            row 2 = receipts band (fills remaining height). */}
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: `${LEFT_W}px ${RIGHT_W}px`,
            gridTemplateRows: `${UPPER_H}px 1fr`
          }}
        >
          {/* r1c1 — left data entry */}
          <div className="overflow-hidden p-1">
            <div className="flex gap-1 items-start">
              <WeightBox />
              <div className="flex-1 min-w-0">
                <CustomerEntry />
              </div>
            </div>
            <div className="mt-1">
              <PurityTable />
            </div>
          </div>

          {/* r1c2 — right data entry (نقد / ادھار) */}
          <div className="overflow-hidden p-1 border-l-2 border-line">
            <CashUdharPanel />
          </div>

          {/* r2c1 — left receipts */}
          <div className="overflow-hidden p-1 pt-0">
            <LeftReceipts />
          </div>

          {/* r2c2 — right receipts */}
          <div className="overflow-hidden p-1 pt-0 border-l-2 border-line">
            <RightReceipts />
          </div>
        </div>

        <StatusBar />
      </div>
    </FitScreen>
  )
}
