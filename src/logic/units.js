// Weight-unit helpers for the subcontinental jeweller system used in the app.
//
//   1 tola  = 11.664 grams   (the "11.664" printed at the top of the screen)
//   1 tola  = 12 masha
//   1 masha = 8 ratti
//   => 1 tola = 96 ratti
//
// These are the standard conversions; if your shop uses different masha/ratti
// subdivisions, change the constants below and every calculation follows.

export const GRAMS_PER_TOLA = 11.664
export const MASHA_PER_TOLA = 12
export const RATTI_PER_MASHA = 8
export const RATTI_PER_TOLA = MASHA_PER_TOLA * RATTI_PER_MASHA // 96
export const GRAMS_PER_MASHA = GRAMS_PER_TOLA / MASHA_PER_TOLA
export const GRAMS_PER_RATTI = GRAMS_PER_TOLA / RATTI_PER_TOLA

// Break a gram weight into { tola, masha, ratti } (ratti carries the fraction).
export function gramsToTMR(grams) {
  const g = Number(grams) || 0
  const totalRatti = g / GRAMS_PER_RATTI
  const tola = Math.floor(totalRatti / RATTI_PER_TOLA)
  let rem = totalRatti - tola * RATTI_PER_TOLA
  const masha = Math.floor(rem / RATTI_PER_MASHA)
  const ratti = rem - masha * RATTI_PER_MASHA
  return { tola, masha, ratti: round(ratti, 3) }
}

export function tmrToGrams({ tola = 0, masha = 0, ratti = 0 }) {
  return (
    tola * GRAMS_PER_TOLA + masha * GRAMS_PER_MASHA + ratti * GRAMS_PER_RATTI
  )
}

export function round(n, dp = 3) {
  const v = Number(n) || 0
  return Number(v.toFixed(dp))
}

// Format a number with thousands separators (en) — used for PKR amounts.
export function fmtMoney(n) {
  const v = Math.round(Number(n) || 0)
  return v.toLocaleString('en-US')
}

export function fmtNum(n, dp = 3) {
  if (n === null || n === undefined || n === '') return '-'
  const v = round(n, dp)
  if (v === 0) return '-'
  return v.toLocaleString('en-US', { maximumFractionDigits: dp })
}
