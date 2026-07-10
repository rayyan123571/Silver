// Preload for the trial-gate window ONLY. Exposes exactly three verbs — copy the
// machine id, attempt activation, quit the app — across the context bridge. No
// node, no fs, no db, nothing from the main application's preload. The gate page
// is a local data URL with no remote content, so this is the whole of its attack
// surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gate', {
  copyMachineId: () => ipcRenderer.invoke('trial-gate:copy'),
  // Returns { ok, message }. Today `ok` is always false and nothing is verified
  // or written — the real handler arrives with the activation step.
  activate: (key) => ipcRenderer.invoke('trial-gate:activate', key),
  exit: () => ipcRenderer.send('trial-gate:exit')
})
