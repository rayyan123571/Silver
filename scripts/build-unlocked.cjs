// Build a PERSONAL, UNLOCKED Windows exe — no trial, no licence gate, no security.
// For the owner's own use ONLY (do NOT ship this to paying customers).
//
// It flips the UNLICENSED_BUILD flag in electron/main.cjs to true, runs the normal
// packaging pipeline (vite build -> obfuscate -> electron-builder --win), then
// ALWAYS restores the flag to false in a finally block — so the customer build can
// never accidentally go out unlocked. Output lands in release/ like a normal build.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const MAIN = path.join(ROOT, 'electron', 'main.cjs')
const LOCKED = 'const UNLICENSED_BUILD = false'
const UNLOCKED = 'const UNLICENSED_BUILD = true'

const original = fs.readFileSync(MAIN, 'utf8')
if (!original.includes(LOCKED)) {
  console.error('[unlocked] Could not find the UNLICENSED_BUILD flag in electron/main.cjs — aborting.')
  process.exit(1)
}

try {
  fs.writeFileSync(MAIN, original.replace(LOCKED, UNLOCKED), 'utf8')
  console.log('[unlocked] UNLICENSED_BUILD = true — building unlocked exe (this can take a few minutes)...')
  execSync('npm run dist:win', { stdio: 'inherit', cwd: ROOT })
  console.log('[unlocked] Build done — see the release/ folder for the exe.')
} finally {
  fs.writeFileSync(MAIN, original, 'utf8')
  console.log('[unlocked] Restored UNLICENSED_BUILD = false (customer build stays gated).')
}
