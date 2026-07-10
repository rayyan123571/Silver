// ============================================================================
//  PURITY / ASSAY CALCULATION ENGINE   (THE ONE FILE TO REPLACE)
// ============================================================================
//
//  This is the single source of truth for the left-hand purity table:
//     Local | Copper | Standard | Silver | Pure Silver
//
//  Every number on the main screen is derived here. If your shop's real
//  method differs, you ONLY need to edit this file — the UI, receipts and
//  database stay exactly the same.
//
//  INPUTS the operator types (top-left box):
//     wazan   = وزن کنڈے پر (گرام)  -> gross weight on the scale, in grams
//                                       (this is your "wazanKanday")
//     malawat = وزن پانی میں (گرام)  -> weight in water, in grams
//                                       (this is your "wazanPani")
//
//  NOTE: the row math below uses ONLY the gross weight (wazanKanday) times a
//  fixed per-row purity factor — exactly like your screenshot. The water
//  weight (wazanPani) is shown for reference (its tola/masha/ratti breakdown
//  in the top box) but does NOT drive the 5 rows. If you ever want true
//  specific-gravity purity (purity ∝ mass / (mass − waterMass)) that is a
//  different formula and the rows WOULD move when water weight changes — tell
//  me and I will switch it.
//
//  Each table row has columns (RTL order in the UI, plain order here):
//     khalisSona (خالص سونا گرام)        pure-gold grams for this row
//     malawatPerGram (ملاوٹ فی گرام)     alloy fraction per gram (0..1)
//     tola / masha / ratti               khalis weight broken into TMR units
//     rate (سونا ریٹ)                     per-TOLA rate applied to this row
//     totalRaqam (ٹوٹل رقم)              gross amount = totalTola * rate
//     labCharges (لیب چارجز)             lab fee for this row
//     baqiRaqam (باقی رقم)               net = totalRaqam - labCharges
//     parchi (پرچی)                      checkbox -> generates the lab receipt
// ----------------------------------------------------------------------------

import { gramsToTMR, round, GRAMS_PER_TOLA } from './units.js'

export const ROW_KEYS = ['Local', 'Copper', 'Standard', 'Silver', 'PureSilver']

export const ROW_LABELS = {
  Local: 'Local',
  Copper: 'Copper',
  Standard: 'Standard',
  Silver: 'Silver',
  PureSilver: 'Pure Silver'
}

// ----------------------------------------------------------------------------
//  PHYSICS CONSTANTS — purity is derived by Archimedes' method using the
//  VOLUME-MIXING (reciprocal-density) model. This is NOT a linear SG blend.
//  Only these are hardcoded.
//
//    D     = gross / (gross - water)                       measured density
//    point = (1/D - 1/D_ALLOY[row]) / (1/D_GOLD - 1/D_ALLOY[row])   purity 0..1
//
//  Mixing happens by VOLUME, so the reciprocals (1/density) interpolate
//  linearly, not the densities themselves. D_GOLD is pure gold's density (same
//  for every row); D_ALLOY is the per-row base/alloy density. Change a row's
//  D_ALLOY if its assay standard differs — nothing else needs touching.
// ----------------------------------------------------------------------------
export const D_GOLD = 19.32 // density of pure gold (g/cm^3)

export const D_ALLOY = {
  Local:      8.73199,
  Copper:     8.93831,
  Standard:   9.10289,
  Silver:     10.17280,
  PureSilver: 10.27974
}

// Default per-TOLA gold rate if the settings row has none. Your settings table
// already stores this as `rate_tezabi_tola` (9000), so that wins when present.
export const DEFAULT_SONE_RATE = 9000

// Header-setting defaults used only if the settings row is missing a value.
export const DEFAULT_PARCHI_CHARGES = 100 // پرچی چارجز
export const DEFAULT_WAGE_PER_GRAM = 80   // فی گرام چار جز (labor per GROSS gram)

// Which rate column each row uses (kept for the receipt / future silver split).
export const ROW_MODEL = {
  Local:      { metal: 'gold',   label: 'Local' },
  Copper:     { metal: 'gold',   label: 'Copper' },
  Standard:   { metal: 'gold',   label: 'Standard' },
  Silver:     { metal: 'silver', label: 'Silver' },
  PureSilver: { metal: 'silver', label: 'Pure Silver' }
}

/**
 * Compute one purity row from the raw inputs + current rates + manual edits.
 *
 * @param {string} key       one of ROW_KEYS
 * @param {object} input     { wazan, malawat }  grams  (wazan = gross weight)
 * @param {object} rates     settings row from DB
 * @param {object} overrides per-cell manual edits for THIS row only, e.g.
 *                           { khalisSona, fineness, tola, masha, ratti, rate,
 *                             totalRaqam, labCharges, baqiRaqam, parchi }
 *
 * BACK-SOLVE RULES (only the edited row changes; top inputs re-drive all rows):
 *   - edit khalisSona  -> effective factor = khalisSona / wazan, rebuild row
 *   - edit tola/masha/ratti -> grams = TMR->grams, treat as khalisSona, rebuild
 *   - edit rate (soneRate) -> recompute totalRaqam + baqiRaqam
 *   - edit labCharges  -> recompute baqiRaqam
 *   - edit baqiRaqam   -> RATE STAYS FIXED, back-solve khalis (= total/ratePerGram)
 *                         then re-derive point/karat/milawat from the new khalis
 *   - edit totalRaqam  -> taken as-is (direct override)
 */
export function computeRow(key, input, rates, overrides = {}) {
  const model = ROW_MODEL[key]
  const wazan = num(input.wazan) // gross weight (وزن کانٹے پر) in grams
  const water = num(input.malawat) // water weight (وزن پانی میں) in grams

  // --- Labor + rate first: both are independent of purity and the Baqi
  //     reverse-calc needs them to back-solve khalis. ------------------------
  //   wages = round(wagePerGram * gross),  labor = parchiCharge + wages
  const parchiCharge = has(rates.parchi_charges)
    ? num(rates.parchi_charges)
    : DEFAULT_PARCHI_CHARGES
  const wagePerGram = has(rates.fc_per_gram) ? num(rates.fc_per_gram) : DEFAULT_WAGE_PER_GRAM
  const wages = round(wagePerGram * wazan, 0)
  const labCharges = has(overrides.labCharges)
    ? round(num(overrides.labCharges), 0)
    : parchiCharge + wages

  // Rate is per TOLA (header value, or a per-row rate override). It is NEVER
  // changed by a Baqi edit — that's the whole point of the reverse-calc.
  const rate = has(overrides.rate)
    ? num(overrides.rate)
    : num(rates.rate_tezabi_tola) || DEFAULT_SONE_RATE // per tola (default 9000)
  const ratePerGram = rate / GRAMS_PER_TOLA // = rateTola / 11.664

  // --- 1) Work out this row's purity fraction "point" (with back-solve edits).
  // Priority: khalisSona > baqiRaqam(reverse) > tola/masha/ratti > fineness > SG.
  let factor // = point (0..1)

  if (has(overrides.khalisSona)) {
    // User typed khalis grams directly -> back-solve the point from it.
    factor = wazan ? num(overrides.khalisSona) / wazan : 0
  } else if (has(overrides.baqiRaqam)) {
    // BAQI REVERSE-CALC: rate stays FIXED, khalis is back-solved from Baqi.
    //   total  = newBaqi + labor
    //   khalis = total / ratePerGram      point = khalis / gross
    // point/karat/milawat below then all re-derive from this new khalis.
    const total = round(num(overrides.baqiRaqam), 0) + labCharges
    const khalis = ratePerGram > 0 ? total / ratePerGram : 0
    factor = wazan ? khalis / wazan : 0
  } else if (has(overrides.tola) || has(overrides.masha) || has(overrides.ratti)) {
    // IMPORTANT: the table's tola/masha/ratti columns are the breakdown of
    // MILAWAT FI GRAM on the ratti scale (96 ratti per tola), NOT of khalis
    // grams. So an edit here is read back as a milawat-fi-gram value:
    //   milawatFiGram = (tola*96 + masha*8 + ratti) / 96  ->  point = 1 - that
    const totalRatti =
      num(overrides.tola) * 96 + num(overrides.masha) * 8 + num(overrides.ratti)
    factor = 1 - totalRatti / 96
  } else if (has(overrides.fineness)) {
    factor = num(overrides.fineness)
  } else if (has(overrides.milawatFiGram)) {
    // MILAWAT-FI-GRAM edit: user typed the alloy-per-gram directly. Rate & gross
    // stay fixed; point is its complement and khalis/amounts re-derive below.
    //   point = 1 - milawatPerGram
    factor = 1 - num(overrides.milawatFiGram)
  } else {
    // ARCHIMEDES PURITY (volume-mixing / reciprocal-density model).
    //   D     = gross / (gross - water)
    //   point = (1/D - 1/D_ALLOY[row]) / (1/D_GOLD - 1/D_ALLOY[row])
    // NOTE: alloys mix by VOLUME, so 1/density interpolates linearly. A linear
    // (D - base)/(gold - base) blend would be wrong (off badly near water=46).
    const denom = wazan - water
    if (water > 0 && denom > 0) {
      const D = wazan / denom
      const dAlloy = D_ALLOY[key]
      factor = (1 / D - 1 / dAlloy) / (1 / D_GOLD - 1 / dAlloy)
    } else {
      // Water not entered yet (or invalid) -> show nothing rather than nonsense.
      factor = 0
    }
  }

  // Khalis (pure) grams = gross * point. Keep an UN-rounded copy for the money
  // math so totals never drift by a rupee from a rounded-then-multiplied value.
  const khalisExact = wazan * factor
  // Nudge by a tiny epsilon so borderline 4th-decimal values round the same
  // way the reference software does (e.g. 10.7037 instead of 10.7036).
  const khalisSona = round(khalisExact + 1e-12, 4)

  // --- 2) Milawat (alloy) grams + per-gram display values (re-derive from point).
  const malawatGrams = round(Math.max(0, wazan - khalisSona), 4)
  const khalisPerGram = round(factor, 4)             // خالص سونا فی گرام (0..1)
  const milawatFiGram = factor > 0 ? 1 - factor : 0  // = 1 - point (per spec, exact)
  const malawatPerGram = round(milawatFiGram, 4)     // ملاوٹ فی گرام (display)

  // --- 2b) Table tola/masha/ratti = MILAWAT FI GRAM on the ratti scale. ---
  //   totalRatti = milawatFiGram * 96   (96 ratti per tola)
  //   masha = floor(totalRatti / 8),  ratti = remainder.  tola is always 0 here
  //   (milawat-per-gram is always well under one tola), shown as "-".
  const milawatTotalRatti = milawatFiGram * 96
  const tmrMasha = Math.floor(milawatTotalRatti / 8)
  const tmrRatti = round(milawatTotalRatti - tmrMasha * 8, 2)
  const tmr = { tola: 0, masha: tmrMasha, ratti: tmrRatti }

  // --- 3) Money. total = round(khalis * ratePerGram). ----------------------
  let totalRaqam
  let baqiRaqam
  if (has(overrides.baqiRaqam)) {
    // Reverse-calc: Baqi is what the user typed; total = baqi + labor (rate &
    // khalis already consistent because khalis was derived from this baqi).
    baqiRaqam = round(num(overrides.baqiRaqam), 0)
    totalRaqam = baqiRaqam + labCharges
  } else if (has(overrides.totalRaqam)) {
    totalRaqam = round(num(overrides.totalRaqam), 0)
    baqiRaqam = round(totalRaqam - labCharges, 0)
  } else {
    totalRaqam = round(khalisExact * ratePerGram, 0)
    baqiRaqam = round(totalRaqam - labCharges, 0)
  }

  return {
    key,
    label: model.label,
    metal: model.metal,
    khalisPerGram,        // factor 0..1 (used for keerat on the receipt)
    malawatPerGram,
    khalisSona,           // pure grams (column 1)
    malawat: malawatGrams,
    tola: tmr.tola,       // milawat-fi-gram breakdown (NOT khalis grams)
    masha: tmr.masha,
    ratti: round(tmr.ratti, 2),
    milawatTotalRatti: round(milawatTotalRatti, 2), // un-split total (e.g. 8.54)
    rate,                 // per-tola sone rate
    totalRaqam,
    labCharges,
    baqiRaqam,
    parchi: !!overrides.parchi
  }
}

/**
 * Compute the whole table. Re-runs automatically (via the store's useMemo)
 * whenever wazan/malawat, rates, or any override changes.
 * @param {object} input      { wazan, malawat }
 * @param {object} rates      settings
 * @param {object} overrideMap { Local: {...}, Standard: {...}, ... }
 */
export function computeTable(input, rates, overrideMap = {}) {
  return ROW_KEYS.map((k) => computeRow(k, input, rates, overrideMap[k] || {}))
}

/** Build the lab receipt (لیب رسید) figures for the selected (parchi) row.
 *  The receipt breaks each WEIGHT (gross / milawat / khalis) into tola/masha/
 *  ratti from GRAMS directly (gramsToTMR) — a different conversion from the
 *  table's milawat-fi-gram columns. Both are produced here so the UI just
 *  reads ready values. */
export function buildLabReceipt(row, input, rates) {
  const gross = num(input.wazan)
  const parchiCharges = num(rates.parchi_charges) // 100
  return {
    aamadWazan: gross,                  // آمدوزن (gross grams)
    malawatWazan: row.malawat,          // ملاوٹ وزن
    khalisWazan: row.khalisSona,        // خالص وزن
    grossTMR: gramsToTMR(gross),        // 11.664 -> 1 / - / -
    malawatTMR: gramsToTMR(row.malawat),// 1.0375 -> - / 1 / 0.54
    khalisTMR: gramsToTMR(row.khalisSona), // 10.6265 -> - / 10 / 7.46
    malawatPerGram: row.malawatPerGram, // ملاوٹ فی گرام (0.0889)
    milawatFiTolaTMR: { tola: row.tola, masha: row.masha, ratti: row.ratti }, // - / 1 / 0.54
    milawatTotalRatti: row.milawatTotalRatti, // رتی total (8.54)
    keerat: row.khalisPerGram ? round(row.khalisPerGram * 24, 2) : 0, // کیرٹ (21.87)
    point: row.khalisPerGram,           // پوائنٹ = khalis fraction (0.9111)
    ratePerTola: row.rate,              // ریٹ فی تولہ (this row's sone rate)
    parchiCharges,                      // 100
    chargesRemainder: round(row.labCharges - parchiCharges, 0), // 933
    charges: row.labCharges,            // 1,033
    totalRaqam: row.totalRaqam,         // 8,199
    baqi: row.baqiRaqam                 // 7,166
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function has(v) {
  return v !== undefined && v !== null && v !== ''
}
