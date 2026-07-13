const { contextBridge, ipcRenderer } = require('electron')

// Thin typed-ish bridge. Every DB call funnels through one IPC channel.
const call = (fn, ...args) => ipcRenderer.invoke('db', { fn, args })

contextBridge.exposeInMainWorld('api', {
  getRates: () => call('getRates'),
  saveRates: (r) => call('saveRates', r),
  receiptNoExists: (n) => call('receiptNoExists', n),
  listDrafts: () => call('listDrafts'),
  upsertDraft: (seq, d) => call('upsertDraft', seq, d),
  deleteDraft: (seq) => call('deleteDraft', seq),
  clearDrafts: () => call('clearDrafts'),
  findCustomers: (q) => call('findCustomers', q),
  listAllCustomers: () => call('listAllCustomers'),
  getCustomer: (id) => call('getCustomer', id),
  peekNextCustomerId: () => call('peekNextCustomerId'),
  getFirstCustomer: () => call('getFirstCustomer'),
  getLastCustomer: () => call('getLastCustomer'),
  getNextCustomer: (id) => call('getNextCustomer', id),
  getPrevCustomer: (id) => call('getPrevCustomer', id),
  upsertCustomer: (c) => call('upsertCustomer', c),
  nextReceiptNo: () => call('nextReceiptNo'),
  getFirstReceiptNo: () => call('getFirstReceiptNo'),
  getLastReceiptNo: () => call('getLastReceiptNo'),
  getNextReceiptNo: (current) => call('getNextReceiptNo', current),
  getPrevReceiptNo: (current) => call('getPrevReceiptNo', current),
  // ALL saved receipt numbers, ascending — feeds the merged ◀/▶ nav timeline.
  listReceiptNos: () => call('listReceiptNos'),
  resetTransactions: () => call('resetTransactions'),
  addTransaction: (t) => call('addTransaction', t),
  // Manual bottom-bar balance adjustment (اندراج) — one-shot 'adjustment' txn.
  addAdjustment: (a) => call('addAdjustment', a),
  updateTransaction: (id, fields) => call('updateTransaction', id, fields),
  deleteTransaction: (id) => call('deleteTransaction', id),
  settleTransaction: (t) => call('settleTransaction', t),
  addExpense: (e) => call('addExpense', e),
  getExpenses: (from, to) => call('getExpenses', from, to),
  updateExpense: (id, fields) => call('updateExpense', id, fields),
  deleteExpense: (id) => call('deleteExpense', id),
  resetExpenses: () => call('resetExpenses'),
  getExpensesTotalForDate: (date) => call('getExpensesTotalForDate', date),
  // Sum of ALL expenses up to & including `date` — feeds the bottom-bar کیش display
  // so expenses permanently reduce cash (not just on their entry day).
  getExpensesTotalUpTo: (date) => call('getExpensesTotalUpTo', date),
  // نیا سودا — standalone deals list (own table only, never the ledger).
  addNayaSoda: (r) => call('addNayaSoda', r),
  listNayaSoda: (status, from, to) => call('listNayaSoda', status, from, to),
  setNayaSodaStatus: (id, status) => call('setNayaSodaStatus', id, status),
  deleteNayaSoda: (id) => call('deleteNayaSoda', id),
  // نیا سودا per-receipt draft (unsaved form values, one per parchi number).
  getNayaSodaDraft: (receiptNo) => call('getNayaSodaDraft', receiptNo),
  saveNayaSodaDraft: (receiptNo, form) => call('saveNayaSodaDraft', receiptNo, form),
  clearNayaSodaDraft: (receiptNo) => call('clearNayaSodaDraft', receiptNo),
  exportPDF: (defaultName, opts) => ipcRenderer.invoke('export-pdf', { defaultName, ...(opts || {}) }),
  saveReceipt: (r) => call('saveReceipt', r),
  replaceReceipt: (arg) => call('replaceReceipt', arg),
  freeReceipt: (n) => call('freeReceipt', n),
  getReceiptByNo: (n) => call('getReceiptByNo', n),
  getReport: (opts) => call('getReport', opts),
  reportGroup1: (opts) => call('reportGroup1', opts),
  // NET per-customer balance for the four GROUP1 buttons (give netted against
  // take, getCustomerLedger sign). side = 'lena' | 'dena'.
  reportGoldBalanceNet: (side, opts) => call('reportGoldBalanceNet', side, opts),
  reportCashBalanceNet: (side, opts) => call('reportCashBalanceNet', side, opts),
  // اندراج رپورٹ — manual adjustment transactions only (date range optional).
  getAdjustmentsReport: (opts) => call('getAdjustmentsReport', opts),
  // beforeReceiptNo (optional): count only parchis numbered before it — see db.cjs.
  getCustomerLedger: (id, beforeReceiptNo) => call('getCustomerLedger', id, beforeReceiptNo),
  listCustomersWithBalances: () => call('listCustomersWithBalances'),
  getDaybook: (date) => call('getDaybook', date),
  listDates: () => call('listDates'),
  getShopTotals: () => call('getShopTotals'),
  // Quit the whole app (the top-left red "X" button calls this).
  quitApp: () => ipcRenderer.invoke('quit-app'),
  // Minimize the window to the taskbar (the "–" button next to the red "X").
  minimizeApp: () => ipcRenderer.invoke('minimize-window'),
  // Maximize / restore toggle — full-screen on/off (the "□" button).
  maximizeApp: () => ipcRenderer.invoke('toggle-maximize'),
  // Print through the main process (native dialog) — avoids Electron's renderer
  // "does not support print preview" error.
  printPage: (opts) => ipcRenderer.invoke('print-page', opts),
  // Direct 1-bit ESC/POS raster print of a slip HTML (576 dots, RAW spool) —
  // the sharp, never-clips receipt path; callers fall back to printPage on !ok.
  rasterPrintSlip: (opts) => ipcRenderer.invoke('raster-print-slip', opts),
  // Calibration / worst-case printer test pages from the settings dialog.
  rasterTestPrint: (kind) => ipcRenderer.invoke('raster-test-print', { kind }),
  // Snapshot a window region to the system clipboard as an image (WhatsApp share).
  captureToClipboard: (rect) => ipcRenderer.invoke('capture-to-clipboard', rect),
  // Open WhatsApp (desktop app if installed, else embedded web) for a receipt.
  openWhatsApp: (opts) => ipcRenderer.invoke('open-whatsapp', opts),
  // Live silver spot ticker (display-only). Subscribe to main's poll pushes;
  // returns an unsubscribe function. getLiveSilver does one fetch+parse now.
  onLiveSilver: (cb) => {
    const handler = (_evt, data) => cb(data)
    ipcRenderer.on('live-silver', handler)
    return () => ipcRenderer.removeListener('live-silver', handler)
  },
  getLiveSilver: () => ipcRenderer.invoke('get-live-silver')
})
