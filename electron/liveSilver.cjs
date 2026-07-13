// ─── Live SILVER spot ticker (display-only reference) ───────────────────────
// Fetches the XAGUSD spot as JSON in the MAIN process (renderer would hit CORS)
// from a fast quote feed, sanity-gates it, and pushes {bid, ask, ts, ok} to the
// window on every tick — near real-time like MT5's Market Watch.
// It touches NOTHING else — no rates, no settings, no receipts, no printing.
// Robustness rules (kept exactly): on ANY failure keep the last good value
// (ok:false so the UI greys it out); never let a bad number through (see the
// SANE gate); never block or delay startup (first poll fires after the window
// loaded); log a warning only once per outage.
const https = require('https')
const http = require('http')
const { URL } = require('url')

// Three sources, tried in order. All three are plain server-side GETs — nothing
// here needs a browser or an API key.
//
// 1. PRIMARY — Swissquote public BBO feed. The SAME endpoint shape the gold build
//    used, with the instrument switched XAU → XAG. Clean JSON, and the only one of
//    the three that gives a real bid AND ask. Verified live.
// 2. FALLBACK — goldprice.org. Its dbXRates payload carries xagPrice alongside
//    xauPrice, so the same response the gold build used works for silver.
// 3. LAST RESORT — netdania's mobile quote page. NOT a JSON API: netdania exposes
//    no public JSON endpoint for XAGUSDOZ (both plausible API paths 404), but the
//    mobile page turns out to be SERVER-RENDERED — the spot price is in the HTML,
//    not injected by JS — so it can be scraped from the main process. It is last
//    on purpose: scraping markup is inherently fragile (any redesign breaks it)
//    and it yields a single price, not a bid/ask. It exists only so the ticker has
//    one more chance before it goes stale.
const PRIMARY_URL = process.env.SILVER_SPOT_URL || 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAG/USD'
const FALLBACK_URL = process.env.SILVER_SPOT_URL_FALLBACK || 'https://data-asg.goldprice.org/dbXRates/USD'
const NETDANIA_URL = process.env.SILVER_SPOT_URL_NETDANIA || 'https://m.netdania.com/commodities/xagusdoz/idc'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const FOCUSED_MS = 1000   // poll every 1s while the window is focused (MT5-like)
const BLURRED_MS = 60000  // back off to 60s when blurred/minimized
const TIMEOUT_MS = 6000

let win = null
let timer = null
let stopped = false
let warned = false
let inFlight = false // a poll is mid-fetch — see tick()
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

// The shop must never show parsed garbage — BOTH sources end at the same sanity
// gate. RETUNED FOR SILVER: the gold build gated on 1000 < price < 20000, which
// would reject EVERY silver quote (spot silver is ~$60/oz, gold ~$4,000/oz) and
// leave the ticker permanently blank. 5..500 spans silver's whole plausible
// range (historic lows near $4, the 1980/2011 peaks near $50, today ~$60) while
// still catching a garbage parse or a stray gold price leaking through.
const sane = (v) => (Number.isFinite(v) && v > 5 && v < 500 ? v : null)

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

// goldprice.org: { items: [ { xauPrice, xagPrice } ] } — one spot number, used
// for both bid and ask when the primary is unavailable. We read xagPRICE (the
// gold build read xauPrice); if a response ever omits it, sane() rejects the
// NaN and we keep the last good value rather than falling back to the gold
// number sitting right next to it.
function parseGoldprice(body) {
  if (!body) return null
  let obj
  try { obj = JSON.parse(body) } catch { return null }
  const it = obj && Array.isArray(obj.items) && obj.items[0]
  const v = it ? sane(parseFloat(it.xagPrice)) : null
  return v != null ? { bid: v, ask: v } : null
}

// netdania mobile quote page (LAST RESORT — HTML, not JSON). The page is server-
// rendered, so the price is really in the body. We anchor on the "Silver, spot"
// heading and take the FIRST decimal number after it — that is the spot quote;
// the numbers that follow are the day range / open / prev close. sane() is the
// backstop: if the markup ever moves and we grab the wrong number, an out-of-band
// value is rejected and the ticker keeps its last good value rather than lying.
// One price only, so bid === ask.
function parseNetdania(body) {
  if (!body) return null
  const txt = String(body)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;/g, ' ')
  const at = txt.search(/Silver,\s*spot/i)
  if (at === -1) return null
  const m = txt.slice(at).match(/\b\d{1,4}\.\d{2,4}\b/)
  const v = m ? sane(parseFloat(m[0])) : null
  return v != null ? { bid: v, ask: v } : null
}

async function fetchOnce() {
  let q = parseSwissquote(await httpGet(PRIMARY_URL))
  if (!q) q = parseGoldprice(await httpGet(FALLBACK_URL))
  if (!q) q = parseNetdania(await httpGet(NETDANIA_URL))
  if (q) {
    // price === bid for backward compatibility so nothing else breaks.
    last = { bid: q.bid, ask: q.ask, price: q.bid, ts: new Date().toISOString(), ok: true }
    warned = false
  } else {
    if (!warned) { console.warn('[live-silver] fetch/parse failed — keeping last good value'); warned = true }
    last = { ...last, ok: false }
  }
  return last
}

async function tick() {
  // ONE poll in flight at a time. schedule() is also called on every window
  // `focus`, and a focus that lands while a fetch is still awaiting used to
  // start a SECOND tick chain — the in-flight one re-schedules itself when it
  // finishes, so the chains never merged back. Each refocus added another
  // chain, so an app that had been switched to and from a few times ended up
  // hammering the feed several times a second, which got the quote source to
  // start refusing us: ok:false, the box greys out and the rate sits frozen on
  // its last good value. Bailing here is safe — the running tick's finally
  // block re-schedules, so the loop always survives.
  if (stopped || inFlight) return
  inFlight = true
  const prevBid = last.bid
  const prevOk = last.ok
  try {
    await fetchOnce()
    // Safeguard: don't push a redundant frame when the bid is unchanged (ts/ok
    // are still updated internally). Always push on an ok-state change so the UI
    // can grey out / recover promptly even when the bid happens to be identical.
    const shouldSend = last.bid !== prevBid || last.ok !== prevOk
    if (shouldSend && win && !win.isDestroyed()) win.webContents.send('live-silver', last)
  } catch {}
  finally {
    inFlight = false
    schedule()
  }
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

module.exports = { start, stop, fetchOnce, getLast: () => last, parseSwissquote, parseGoldprice, parseNetdania }
