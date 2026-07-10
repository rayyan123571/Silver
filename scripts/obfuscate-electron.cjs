// Obfuscates BOTH shipped JS surfaces before packaging, so the exe carries no
// readable source either way someone opens it:
//   1. electron/**/*.cjs  -> electron-dist/   (main process: db, printing,
//      trial, license). Mirrors the directory structure exactly so every
//      relative require('./x.cjs') and __dirname-relative path (icons,
//      dist/index.html, preload scripts) keeps resolving after the move.
//   2. dist/assets/*.js   -> obfuscated IN PLACE (React renderer bundle,
//      already Vite/terser-minified — this is an extra layer on top).
// Dev mode (`npm run dev`) runs straight off electron/ and unbundled source —
// only `dist:win` (build -> obfuscate -> electron-builder) touches either.
const fs = require('fs')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const ELECTRON_SRC_DIR = path.join(__dirname, '..', 'electron')
const ELECTRON_OUT_DIR = path.join(__dirname, '..', 'electron-dist')
const RENDERER_ASSETS_DIR = path.join(__dirname, '..', 'dist', 'assets')

// Main process runs under Node, is never inspected via browser DevTools, and
// has no perf-sensitive hot loops — safe to obfuscate hard.
const MAIN_PROCESS_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  numbersToExpressions: true,
  simplify: true,
  target: 'node',
  // Node's `require` resolution and `__dirname` must keep working as-is.
  reservedNames: [],
  disableConsoleOutput: false
}

// Renderer runs in a live UI (typing, printing, live-price polling) and
// DevTools is now disabled in production (see main.cjs `devTools: isDev`), so
// this only needs to survive someone extracting app.asar and reading the
// bundle offline — no need for the heavier/riskier transforms (deadCodeInjection,
// selfDefending) that are more likely to trip up a stateful React app.
const RENDERER_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 10,
  simplify: true,
  target: 'browser',
  disableConsoleOutput: false
}

function walkElectron(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(dir, entry.name)
    const relPath = path.relative(ELECTRON_SRC_DIR, srcPath)
    const outPath = path.join(ELECTRON_OUT_DIR, relPath)
    if (entry.isDirectory()) {
      fs.mkdirSync(outPath, { recursive: true })
      walkElectron(srcPath)
    } else if (entry.name.endsWith('.cjs')) {
      const code = fs.readFileSync(srcPath, 'utf8')
      const obfuscated = JavaScriptObfuscator.obfuscate(code, MAIN_PROCESS_OPTIONS).getObfuscatedCode()
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, obfuscated, 'utf8')
      console.log(`[obfuscate:main] ${relPath}`)
    } else {
      fs.copyFileSync(srcPath, outPath)
      console.log(`[copy:main] ${relPath}`)
    }
  }
}

function obfuscateRendererAssets(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      obfuscateRendererAssets(entryPath)
    } else if (entry.name.endsWith('.js')) {
      const code = fs.readFileSync(entryPath, 'utf8')
      const obfuscated = JavaScriptObfuscator.obfuscate(code, RENDERER_OPTIONS).getObfuscatedCode()
      fs.writeFileSync(entryPath, obfuscated, 'utf8')
      console.log(`[obfuscate:renderer] ${path.relative(RENDERER_ASSETS_DIR, entryPath)}`)
    }
  }
}

fs.rmSync(ELECTRON_OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(ELECTRON_OUT_DIR, { recursive: true })
walkElectron(ELECTRON_SRC_DIR)
console.log(`[obfuscate] main process done -> ${ELECTRON_OUT_DIR}`)

obfuscateRendererAssets(RENDERER_ASSETS_DIR)
console.log(`[obfuscate] renderer bundle done -> ${RENDERER_ASSETS_DIR}`)
