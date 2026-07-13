// ─── Offline licence manager (VERIFICATION ONLY) ─────────────────────────────
// NOTHING here is wired in yet: main.cjs does not require this module, the trial
// gate does not consult it, no startup path calls these functions, and license.dat
// is never created. Requiring the module has no side effects, so application
// behaviour is unchanged.
//
// Asymmetric by design. Licences are signed OFFLINE, on your machine, with an
// Ed25519 PRIVATE key that never ships and never exists inside this application.
// The app embeds only the matching PUBLIC key and can therefore do exactly one
// thing: check that a licence was signed by you. It cannot mint one. That is the
// whole point of the switch away from the HMAC used by trial.dat, where the same
// secret both signs and verifies — anyone who opens the asar can forge a trial
// signature, but nobody can forge a licence without the private key.
//
// Storage will be %APPDATA%\silver-app\license.dat — the same Electron userData
// folder that already holds silver.sqlite, trial.dat and install.id. That folder
// is derived from package.json "name", so the Gold app (%APPDATA%\gold-lab) has
// its own licence file and neither app can see the other's.
//
// main.cjs consults isLicenseValid() before the trial gate: a licensed machine
// skips the gate entirely, whatever the trial says.
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app } = require('electron')

const LICENSE_FILE = 'license.dat'

// The fields covered by the signature, in a FIXED order. Anything outside this
// list is not signed and must never be trusted.
const SIGNED_FIELDS = ['machineId', 'customerName', 'expiry']

// ── Embedded Ed25519 PUBLIC key ──────────────────────────────────────────────
// The PUBLIC half of the production licensing key pair. Safe to ship: it can only
// CHECK a signature, never produce one. The matching PRIVATE key lives offline,
// with tools/license-generator, and must never appear in this repository, on a
// build machine, or in the installer.
//
// If it ever leaks, anyone can mint licences: the only remedy is a new key pair,
// a new build carrying the new public key, and re-issuing every licence.
//
// Changing this value invalidates every licence signed by the old private key.
//
// If this were null — or not an Ed25519 key — verifyLicense() would return false
// for every input, and the module would fail CLOSED rather than accept anything.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfnxK8C1nS+DngMI2TEJRD9j5DW1qc1KkcYkQy7Gr3Hk=
-----END PUBLIC KEY-----`

// Parsed once and cached. A malformed PEM is treated as "no key configured"
// rather than throwing, so a bad paste can never crash startup later.
let publicKeyCache
function getPublicKey() {
  if (publicKeyCache !== undefined) return publicKeyCache
  publicKeyCache = null
  if (typeof LICENSE_PUBLIC_KEY === 'string' && LICENSE_PUBLIC_KEY.trim()) {
    try {
      const key = crypto.createPublicKey(LICENSE_PUBLIC_KEY)
      // Refuse anything that is not Ed25519 — an RSA or P-256 key would verify
      // with a different algorithm and silently weaken the scheme.
      publicKeyCache = key.asymmetricKeyType === 'ed25519' ? key : null
      if (!publicKeyCache) console.warn('[license] embedded public key is not Ed25519 — ignoring')
    } catch {
      console.warn('[license] embedded public key is not a valid PEM — ignoring')
    }
  }
  return publicKeyCache
}

// Resolved lazily, not at module load: app.getPath() throws before the Electron
// app is ready, and this module must stay safe to require from anywhere.
// Internal — the file path is an implementation detail, not part of the API.
function getLicenseFilePath() {
  return path.join(app.getPath('userData'), LICENSE_FILE)
}

// ── License format ───────────────────────────────────────────────────────────
//   {
//     "machineId":    "GL-8A7F91CD22EF",  // binds the licence to one machine
//     "customerName": "Chaudhry Gold Lab",
//     "expiry":       null,               // ISO date, or null = perpetual
//     "signature":    "<base64 Ed25519 over the canonical payload>"
//   }
//
// The signature covers SIGNED_FIELDS only, serialized deterministically: the
// values are JSON-encoded in the fixed order above and joined by a NUL, which
// cannot occur inside any of them. Deterministic matters — the signer and the
// verifier must produce byte-identical payloads, and plain JSON.stringify of an
// object does not guarantee key order. JSON-encoding each value (rather than
// String()) keeps null distinct from the string "null" and stops a name
// containing the separator from shifting field boundaries.
function canonicalPayload(license) {
  return Buffer.from(SIGNED_FIELDS.map((k) => JSON.stringify(license[k] ?? null)).join('\u0000'), 'utf8')
}

// Verify the Ed25519 signature on a licence record with the EMBEDDED PUBLIC KEY.
// Returns true only when: a public key is configured, the record is a plain object
// carrying a base64 signature, and that signature checks out over the canonical
// payload. Never throws — a malformed record is simply invalid.
//
// This answers ONE question: "did the licence holder sign this?" It deliberately
// does NOT check machineId binding or expiry; those are policy decisions for
// isLicenseValid(), which the activation step will implement. A caller must never
// treat verifyLicense() === true as "this licence entitles this machine to run".
function verifyLicense(license) {
  const key = getPublicKey()
  if (!key) return false // no key embedded → nothing can be trusted → fail closed
  if (!license || typeof license !== 'object' || Array.isArray(license)) return false
  if (typeof license.signature !== 'string' || !license.signature) return false

  let sig
  try {
    sig = Buffer.from(license.signature, 'base64')
    // Ed25519 signatures are exactly 64 bytes; Buffer.from() silently tolerates
    // junk, so reject anything of the wrong size before handing it to verify().
    if (sig.length !== 64) return false
  } catch {
    return false
  }

  try {
    // null algorithm: Ed25519 hashes internally, so no digest is passed.
    return crypto.verify(null, canonicalPayload(license), key, sig)
  } catch {
    return false
  }
}

// Has this licence's expiry passed? `null` means perpetual. An unparseable expiry
// is treated as EXPIRED, not as perpetual — a corrupt date must not grant a
// licence. (The expiry is signed, so this can only happen if you issue a bad one.)
function isExpiredLicense(license) {
  if (license.expiry == null) return false
  const ms = Date.parse(license.expiry)
  if (!Number.isFinite(ms)) return true
  return ms <= Date.now()
}

// Read the stored licence record. Never creates the file: a missing licence is the
// normal state for a trial user, not an error. A missing, unreadable or malformed
// file yields null. Never throws.
//
// Only the four known fields are returned — extra keys someone hand-added to
// license.dat are dropped, because they are outside the signature and must never
// reach a caller that might trust them.
function loadLicense() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getLicenseFilePath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return {
      machineId: parsed.machineId ?? null,
      customerName: parsed.customerName ?? null,
      expiry: parsed.expiry ?? null,
      signature: parsed.signature ?? null
    }
  } catch {
    return null
  }
}

// Persist a licence record, atomically (temp file + rename), so a crash mid-write
// cannot leave a half-written licence. Writes EXACTLY the issued document: the
// three signed fields plus the signature, nothing added, nothing renamed. Returns
// true on success, false on failure — never throws.
//
// It refuses to write a licence that does not verify. Persisting an unverified
// record would mean loadLicense() could later hand back something this app never
// vouched for; the only way into license.dat is through a valid signature.
function saveLicense(license) {
  if (!verifyLicense(license)) return false
  const record = {
    machineId: license.machineId,
    customerName: license.customerName,
    expiry: license.expiry ?? null,
    signature: license.signature
  }
  const file = getLicenseFilePath()
  const tmp = file + '.tmp'
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
    console.warn('[license] could not write license.dat')
    return false
  }
}

// Is there a valid, correctly-signed, unexpired licence for THIS machine?
// Three independent gates, all of which must pass:
//   1. Ed25519 signature checks out against the embedded public key.
//   2. The licence names this exact machine.
//   3. The expiry has not passed.
// Called on EVERY startup, so a licence that expires simply stops working — no
// grace period, no cached "was valid once".
//
// machineId is passed in rather than read here: the trial module owns machine
// identity, and this module must not depend on it. A caller that omits it gets
// false, since a licence that names no machine can't be for this one.
function isLicenseValid(machineId) {
  const license = loadLicense()
  if (!license) return false
  if (!verifyLicense(license)) return false
  if (!machineId || license.machineId !== machineId) return false
  if (isExpiredLicense(license)) return false
  return true
}

// Human-readable licence details, or null when there is no licence on disk.
// Reports what the file SAYS; `valid` reports whether it is actually honoured, so
// a caller can show "expired licence for X" rather than nothing at all. The
// signature is deliberately not returned — nothing needs to display it.
function getLicenseInfo(machineId) {
  const license = loadLicense()
  if (!license) return null
  return {
    machineId: license.machineId,
    customerName: license.customerName,
    expiry: license.expiry,
    expired: isExpiredLicense(license),
    valid: isLicenseValid(machineId)
  }
}

// ── Activation ───────────────────────────────────────────────────────────────
// Turn pasted licence text into a saved licence, or into a reason it was refused.
// Returns { ok, message }. NOTHING is written unless every check passes.
//
// The checks run in this order, and the order matters: an unsigned document tells
// us nothing about whose machine it names or when it expires, so the signature is
// settled first and its fields are only then believed.
const MSG = Object.freeze({
  INVALID: 'Invalid License',
  OTHER_MACHINE: 'This license belongs to another computer.',
  EXPIRED: 'License expired.',
  SAVE_FAILED: 'Could not save the license file.',
  OK: 'License activated.'
})

function activateLicense(licenseText, machineId) {
  let parsed
  try {
    parsed = JSON.parse(String(licenseText || ''))
  } catch {
    return { ok: false, message: MSG.INVALID } // not even JSON
  }

  // 1. Signature. Everything below trusts fields only because this passed.
  if (!verifyLicense(parsed)) return { ok: false, message: MSG.INVALID }

  // 2. This machine, or someone else's?
  if (!machineId || parsed.machineId !== machineId) return { ok: false, message: MSG.OTHER_MACHINE }

  // 3. Still in date?
  if (isExpiredLicense(parsed)) return { ok: false, message: MSG.EXPIRED }

  if (!saveLicense(parsed)) return { ok: false, message: MSG.SAVE_FAILED }
  return { ok: true, message: MSG.OK }
}

module.exports = { loadLicense, saveLicense, isLicenseValid, getLicenseInfo, verifyLicense, activateLicense, MSG }
