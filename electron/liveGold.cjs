// ─── Live gold spot ticker (display-only reference) ─────────────────────────
// Fetches the XAUUSD spot as JSON in the MAIN process (renderer would hit CORS)
// from a fast quote feed, sanity-gates it, and pushes {bid, ask, ts, ok} to the
// window on every tick — near real-time like MT5's Market Watch.
// It touches NOTHING else — no rates, no settings, no receipts, no printing.
// Robustness rules (kept exactly): on ANY failure keep the last good value
// (ok:false so the UI greys it out); never let a bad number through
// (1000 < price < 20000); never block or delay startup (first poll fires after
// the window loaded); log a warning only once per outage.
const https = require('https')
const http = require('http')
const { URL } = require('url')

// Primary: Swissquote public BBO feed — JSON, no API key. Fallback: goldprice.org.
const PRIMARY_URL = process.env.GOLDLAB_GOLD_URL || 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD'
const FALLBACK_URL = process.env.GOLDLAB_GOLD_URL_FALLBACK || 'https://data-asg.goldprice.org/dbXRates/USD'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const FOCUSED_MS = 1000   // poll every 1s while the window is focused (MT5-like)
const BLURRED_MS = 60000  // back off to 60s when blurred/minimized
const TIMEOUT_MS = 6000

let win = null
let timer = null
let stopped = false
let warned = false
let last = { bid: null, ask: null, price: null, ts: null, ok: false }

// GET with browser-ish headers, 6s timeout, up to 3 redirects. Resolves the
// body string or null — it never rejects (failures are a normal state here).
function httpGet(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const mod = url.startsWith('http:') ? http : https
      const req = mod.get(url, {
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Accept: 'application/json,text/html,*/*' },
        timeout: TIMEOUT_MS
      }, (res) => {
        const sc = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location && redirectsLeft > 0) {
          res.resume()
          let next = null
          try { next = new URL(res.headers.location, url).toString() } catch {}
          if (!next) return done(null)
          httpGet(next, redirectsLeft - 1).then(done)
          return
        }
        if (sc !== 200) { res.resume(); return done(null) }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (d) => {
          body += d
          if (body.length > 3e6) { try { req.destroy() } catch {}; done(null) }
        })
        res.on('end', () => done(body))
        res.on('error', () => done(null))
      })
      req.on('timeout', () => { try { req.destroy() } catch {}; done(null) })
      req.on('error', () => done(null))
    } catch {
      done(null)
    }
  })
}

// A gold shop must never show parsed garbage — BOTH sources end at the same
// sanity gate (1000 < price < 20000).
const sane = (v) => (Number.isFinite(v) && v > 1000 && v < 20000 ? v : null)

// Swissquote: an array of platform objects, each with spreadProfilePrices[] of
// {spreadProfile, bid, ask}. Take the FIRST profile's bid/ask.
function parseSwissquote(body) {
  if (!body) return null
  let arr
  try { arr = JSON.parse(body) } catch { return null }
  if (!Array.isArray(arr)) return null
  for (const entry of arr) {
    const profs = entry && entry.spreadProfilePrices
    if (Array.isArray(profs) && profs.length) {
      const bid = sane(parseFloat(profs[0].bid))
      const ask = sane(parseFloat(profs[0].ask))
      if (bid != null && ask != null) return { bid, ask }
    }
  }
  return null
}

// goldprice.org: { items: [ { xauPrice } ] } — one spot number, used for both
// bid and ask when the primary is unavailable.
function parseGoldprice(body) {
  if (!body) return null
  let obj
  try { obj = JSON.parse(body) } catch { return null }
  const it = obj && Array.isArray(obj.items) && obj.items[0]
  const v = it ? sane(parseFloat(it.xauPrice)) : null
  return v != null ? { bid: v, ask: v } : null
}

async function fetchOnce() {
  let q = parseSwissquote(await httpGet(PRIMARY_URL))
  if (!q) q = parseGoldprice(await httpGet(FALLBACK_URL))
  if (q) {
    // price === bid for backward compatibility so nothing else breaks.
    last = { bid: q.bid, ask: q.ask, price: q.bid, ts: new Date().toISOString(), ok: true }
    warned = false
  } else {
    if (!warned) { console.warn('[live-gold] fetch/parse failed — keeping last good value'); warned = true }
    last = { ...last, ok: false }
  }
  return last
}

async function tick() {
  if (stopped) return
  const prevBid = last.bid
  const prevOk = last.ok
  await fetchOnce()
  // Safeguard: don't push a redundant frame when the bid is unchanged (ts/ok
  // are still updated internally). Always push on an ok-state change so the UI
  // can grey out / recover promptly even when the bid happens to be identical.
  const shouldSend = last.bid !== prevBid || last.ok !== prevOk
  try {
    if (shouldSend && win && !win.isDestroyed()) win.webContents.send('live-gold', last)
  } catch {}
  schedule()
}

function schedule(delay) {
  if (stopped) return
  if (timer) clearTimeout(timer)
  let focused = false
  try { focused = !!(win && !win.isDestroyed() && win.isFocused()) } catch {}
  timer = setTimeout(tick, delay != null ? delay : (focused ? FOCUSED_MS : BLURRED_MS))
}

// start AFTER the window content loaded — the first poll is async and can
// never block or delay startup.
function start(w) {
  win = w
  try { w.on('focus', () => schedule(300)) } catch {} // wake instantly on refocus
  schedule(800)
}

function stop() {
  stopped = true
  if (timer) clearTimeout(timer)
}

module.exports = { start, stop, fetchOnce, getLast: () => last, parseSwissquote, parseGoldprice }
