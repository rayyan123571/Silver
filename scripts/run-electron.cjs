// Launch Electron as a GUI app, robust to terminals that export
// ELECTRON_RUN_AS_NODE=1 (VS Code's integrated terminal, Claude Code, some CI).
// When that var is set, Electron runs as plain Node and require('electron') in
// main.cjs returns a path string instead of the API object — so ipcMain/app are
// undefined and the app crashes at startup ("Cannot read properties of undefined
// (reading 'handle')"). We strip the var, then spawn the real electron binary.
//
// This script itself runs under Node, so require('electron') here resolves to the
// electron executable PATH — exactly what we want to spawn.
const { spawn } = require('child_process')
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Pass through any extra CLI args (e.g. a custom NODE_ENV is set by the caller).
const args = process.argv.slice(2)
if (!args.length) args.push('.')

const child = spawn(electronPath, args, { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code == null ? 0 : code))
child.on('error', (err) => { console.error('Failed to launch Electron:', err); process.exit(1) })
