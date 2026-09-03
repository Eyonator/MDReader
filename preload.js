'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const localeNl = require('./locales/nl.json');

contextBridge.exposeInMainWorld('rendl', {
  // Localized strings, keyed by locale code so more translations can be added.
  locales: { nl: localeNl },
  defaultLocale: 'nl',

  // File operations.
  openFileDialog: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileDialog: (content, suggestedName) => ipcRenderer.invoke('file:save-dialog', content, suggestedName),
  getStartupFile: () => ipcRenderer.invoke('app:startup-file'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  setWatchedFiles: (filePaths) => ipcRenderer.invoke('watch:set', filePaths),
  onFileChangedOnDisk: (callback) => ipcRenderer.on('file:changed-on-disk', (_event, payload) => callback(payload)),

  // Projects (a folder of Markdown files).
  openFolderDialog: () => ipcRenderer.invoke('project:open-dialog'),
  scanProject: (dirPath) => ipcRenderer.invoke('project:scan', dirPath),

  // Recent files.
  listRecentFiles: () => ipcRenderer.invoke('recent:list'),
  clearRecentFiles: () => ipcRenderer.invoke('recent:clear'),

  // Theme and window chrome.
  getSystemTheme: () => ipcRenderer.invoke('theme:get-system'),
  setTitleBarSymbolColor: (symbolColor) => ipcRenderer.invoke('window:set-titlebar', { symbolColor }),
  onSystemThemeChanged: (callback) => ipcRenderer.on('theme:system-changed', (_event, theme) => callback(theme)),

  // Close flow.
  onCloseRequested: (callback) => ipcRenderer.on('app:close-requested', () => callback()),
  confirmClose: (state) => ipcRenderer.invoke('app:confirm-close', state),

  // Settle-request (before switching to the installed copy).
  onSettleRequested: (callback) => ipcRenderer.on('app:settle-request', () => callback()),
  settleResponse: (ok) => ipcRenderer.send('app:settle-response', ok),
  confirmDiscard: (info) => ipcRenderer.invoke('app:confirm-discard', info),

  // Open links in the system browser.
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // In-app installation (portable exe on Windows).
  canInstall: () => ipcRenderer.invoke('app:can-install'),
  installApp: () => ipcRenderer.invoke('app:install'),

  // Updates.
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_event, info) => callback(info)),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // Persistent per-document history (cross-session undo).
  historyGet: (documentPath) => ipcRenderer.invoke('history:get', documentPath),
  historySave: (documentPath, entries) => ipcRenderer.invoke('history:save', documentPath, entries),

  // External open requests (second instance with a file argument).
  onOpenExternalFile: (callback) => ipcRenderer.on('file:open-external', (_event, filePath) => callback(filePath)),
});
