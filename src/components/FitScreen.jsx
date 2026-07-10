import React, { useEffect, useRef, useState } from 'react'

// Renders children inside a fixed design canvas (default 1460×820) and scales
// the whole thing to fill the current viewport. Guarantees the UI always fits
// one screen with no scrolling, independent of monitor size or Windows DPI
// scaling (which shrinks the CSS viewport).
//
// Scaling is NON-UNIFORM (independent X and Y) on purpose: the width scale fills
// the full viewport width — killing the empty left/right bars uniform scaling
// leaves on wide monitors — while the height scale keeps the exact same vertical
// fit. Content ends up slightly wider than its native aspect ratio, which is the
// intended trade-off (wider panels/receipts, full-width fill, still no scroll).
//
// The wrapper is pinned to the viewport with `position: fixed; inset: 0` rather
// than sized as a percentage of its parents. A percentage width (`w-full`) is
// measured against the parent chain, so any stray padding/margin/rounding up that
// chain would offset the top-left-origin canvas — pushing the right edge off
// screen while leaving a thin gap on the left. Pinning to the viewport removes
// every such offset: the canvas starts exactly at x=0 and spans exactly innerWidth.
export default function FitScreen({ w = 1460, h = 820, children }) {
  const [scale, setScale] = useState({ x: 1, y: 1 })
  const canvasRef = useRef(null)

  useEffect(() => {
    const fit = () => {
      const sx = window.innerWidth / w
      const sy = window.innerHeight / h
      setScale({ x: sx, y: sy })

      // TEMP measurement — confirm scaledWidth === innerWidth and left offset === 0.
      // (Remove once verified.)
      requestAnimationFrame(() => {
        const rect = canvasRef.current && canvasRef.current.getBoundingClientRect()
        // eslint-disable-next-line no-console
        console.log(
          '[FitScreen] innerWidth=', window.innerWidth,
          'scaledWidth=', Math.round(w * sx * 100) / 100,
          'canvasLeft=', rect ? Math.round(rect.left * 100) / 100 : null,
          'canvasRight=', rect ? Math.round(rect.right * 100) / 100 : null
        )
      })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [w, h])

  return (
    <div
      className="bg-panel"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        margin: 0,
        padding: 0,
        border: 0,
        overflow: 'hidden' // both axes — nothing ever scrolls
      }}
    >
      <div
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: w,
          height: h,
          transform: `scale(${scale.x}, ${scale.y})`,
          transformOrigin: 'top left'
        }}
      >
        {children}
      </div>
    </div>
  )
}
