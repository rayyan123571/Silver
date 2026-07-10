#!/usr/bin/env node
// ─── Gold Lab offline licence generator ──────────────────────────────────────
// A STANDALONE Node CLI. It is not part of the application: it lives outside
// electron/, so electron-builder never packages it (build.files ships only
// dist/, electron/ and package.json), and nothing in the app requires it.
//
// It holds the other half of the Ed25519 pair. The PRIVATE key is read from a PEM
// file you pass on the command line — never hardcoded, never generated here, never
// committed. The application embeds only the PUBLIC key and can therefore verify a
// licence but never mint one.
//
//   Generate the pair ONCE, offline, on a machine that does not build the app:
//     openssl genpkey -algorithm ed25519 -out license_private.pem
//     openssl pkey -in license_private.pem -pubout -out license_public.pem
//   Paste license_public.pem into LICENSE_PUBLIC_KEY in
//   electron/license/licenseManager.cjs. Keep license_private.pem offline.
//
//   node generate-license.cjs --key license_private.pem \
//     --machine-id GL-8A7F91CD22EF --name "Chaudhry Gold Lab" --lifetime
//
//   node generate-license.cjs --key license_private.pem \
//     --machine-id GL-8A7F91CD22EF --name "Some Shop" --expiry 2027-01-01 \
//     --out license.dat
//
// stdout carries the licence JSON and nothing else, so it can be piped or
// redirected. Every message, warning and error goes to stderr.
const fs = require('fs')
const crypto = require('crypto')

// MUST stay byte-identical to canonicalPayload() in
// electron/license/licenseManager.cjs. It is duplicated rather than imported on
// purpose: the generator must not depend on the app, and the app must never
// depend on the generator. If you change one, change the other — the self-check
// at the bottom of sign() will catch a mismatch in the signature, but only a
// matching PUBLIC key in the app will catch a mismatch in the FORMAT.
const SIGNED_FIELDS = ['machineId', 'customerName', 'expiry']
const SEPARATOR = '\u0000' // cannot occur inside any signed value

function canonicalPayload(license) {
  return Buffer.from(SIGNED_FIELDS.map((k) => JSON.stringify(license[k] ?? null)).join(SEPARATOR), 'utf8')
}

const die = (msg) => { console.error('error: ' + msg); process.exit(1) }

function parseArgs(argv) {
  const out = { lifetime: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { const v = argv[++i]; if (v === undefined) die(`${a} needs a value`); return v }
    if (a === '--key') out.key = next()
    else if (a === '--machine-id') out.machineId = next()
    else if (a === '--name') out.customerName = next()
    else if (a === '--expiry') out.expiry = next()
    else if (a === '--lifetime') out.lifetime = true
    else if (a === '--out') out.out = next()
    else if (a === '--help' || a === '-h') out.help = true
    else die(`unknown argument: ${a}`)
  }
  return out
}

const USAGE = `
Gold Lab offline licence generator

  --key <file>          Ed25519 PRIVATE key, PEM (required). Never committed.
  --machine-id <id>     Target machine, e.g. GL-8A7F91CD22EF (required)
  --name <text>         Customer name (required)
  --expiry <ISO date>   Licence expiry, e.g. 2027-01-01   ] exactly
  --lifetime            Perpetual licence (expiry: null)   ] one of these
  --out <file>          Write JSON here instead of stdout
`

// Read and validate the private key. Anything that is not an Ed25519 private key
// is refused outright — a public key, an RSA key or a passphrase-protected PEM
// would otherwise fail deep inside crypto.sign() with an opaque message.
function loadPrivateKey(file) {
  let pem
  try {
    pem = fs.readFileSync(file, 'utf8')
  } catch (e) {
    die(`cannot read private key '${file}': ${e.code === 'ENOENT' ? 'no such file' : e.message}`)
  }
  if (/BEGIN\s+PUBLIC\s+KEY/.test(pem)) die(`'${file}' is a PUBLIC key — the generator needs the PRIVATE half`)
  let key
  try {
    key = crypto.createPrivateKey(pem)
  } catch (e) {
    die(`'${file}' is not a valid private key PEM: ${e.message}`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    die(`'${file}' is ${key.asymmetricKeyType || 'an unknown type'}, expected ed25519`)
  }
  return key
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || process.argv.length === 2) { console.error(USAGE); process.exit(args.help ? 0 : 1) }

  if (!args.key) die('--key is required (path to the Ed25519 private key PEM)')
  if (!args.machineId) die('--machine-id is required')
  if (!args.customerName) die('--name is required')
  if (args.lifetime && args.expiry) die('use --lifetime OR --expiry, not both')
  if (!args.lifetime && !args.expiry) die('use --lifetime OR --expiry')

  // The app derives ids as GL- + 12 uppercase hex. A typo here mints a licence
  // that silently matches no machine, so refuse anything else.
  if (!/^GL-[0-9A-F]{12}$/.test(args.machineId)) {
    die(`--machine-id must look like GL-8A7F91CD22EF (got '${args.machineId}')`)
  }
  if (!args.customerName.trim()) die('--name cannot be blank')

  let expiry = null
  if (args.expiry) {
    const ms = Date.parse(args.expiry)
    if (!Number.isFinite(ms)) die(`--expiry is not a date: '${args.expiry}'`)
    if (ms <= Date.now()) console.error('warning: --expiry is in the past; this licence is already expired')
    expiry = new Date(ms).toISOString()
  }

  const privateKey = loadPrivateKey(args.key)

  const license = {
    machineId: args.machineId,
    customerName: args.customerName,
    expiry // null == perpetual
  }
  license.signature = crypto.sign(null, canonicalPayload(license), privateKey).toString('base64')

  // Self-check: verify what we just signed with the PUBLIC half derived from this
  // private key. Catches a broken canonicalPayload before a bad licence is handed
  // to a customer. It cannot catch a format drift against the app — for that, the
  // app's embedded public key must be the pair of this private key.
  const publicKey = crypto.createPublicKey(privateKey)
  if (!crypto.verify(null, canonicalPayload(license), publicKey, Buffer.from(license.signature, 'base64'))) {
    die('self-check failed: the generated signature does not verify')
  }

  const json = JSON.stringify(license, null, 2)
  if (args.out) {
    fs.writeFileSync(args.out, json + '\n', 'utf8')
    console.error(`licence written to ${args.out}`)
    console.error(`  machine : ${license.machineId}`)
    console.error(`  customer: ${license.customerName}`)
    console.error(`  expiry  : ${license.expiry || 'lifetime'}`)
  } else {
    process.stdout.write(json + '\n')
  }
}

main()
