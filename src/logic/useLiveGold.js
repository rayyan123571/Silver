import { useEffect, useState } from 'react'

// Live gold spot (display-only reference). Subscribes to the main process's
// poll pushes and keeps the previous bid so the UI can tick green/red.
// Exposes { bid, ask, prevBid, price, prevPrice, ok, ts } — price/prevPrice are
// aliases of bid/prevBid for backward compatibility. bid/ask stay at the LAST
// GOOD values when the feed drops (ok goes false); null until a first value
// ever arrives.
export default function useLiveGold() {
  const [st, setSt] = useState({ bid: null, ask: null, prevBid: null, price: null, prevPrice: null, ok: false, ts: null })

  useEffect(() => {
    if (!(window.api && window.api.onLiveGold)) return undefined
    let mounted = true
    const apply = (d) => {
      if (!mounted || !d) return
      setSt((old) => {
        // never lose the last good value; tolerate a price-only (legacy) frame
        const nb = d.bid != null ? d.bid : (d.price != null ? d.price : old.bid)
        const na = d.ask != null ? d.ask : (d.price != null ? d.price : old.ask)
        return {
          bid: nb,
          ask: na,
          prevBid: old.bid,
          price: nb, // alias
          prevPrice: old.bid, // alias
          ok: !!d.ok,
          ts: d.ts || old.ts
        }
      })
    }
    const off = window.api.onLiveGold(apply)
    // seed immediately (one fetch) instead of waiting for the next poll push
    if (window.api.getLiveGold) window.api.getLiveGold().then(apply).catch(() => {})
    return () => { mounted = false; if (typeof off === 'function') off() }
  }, [])

  return st
}
