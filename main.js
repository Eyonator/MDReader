'use strict';

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const strings = require('./locales/nl.json');

const RECENT_FILE_LIMIT = 12;
const recentStorePath = () => path.join(app.getPath('userData'), 'recent-files.json');

let mainWindow = null;
let forceClose = false;
let pendingOpenPath = resolveFileArgument(process.argv);

function t(key, params = {}) {
  let value = strings[key] || key;
  for (const [name, replacement] of Object.entries(params)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function resolveFileArgument(argv) {
  const candidates = argv.slice(1).filter((arg) => !arg.startsWith('-'));
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // Ignore invalid arguments.
    }
  }
  return null;
}

async function readRecentFiles() {
  try {
    const raw = await fsp.readFile(recentStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry === 'string');
  } catch {
    return [];
  }
}

async function writeRecentFiles(list) {
  try {
    await fsp.writeFile(recentStorePath(), JSON.stringify(list, null, 2), 'utf8');
  } catch {
    // Recent files are a convenience; failing to persist them is not fatal.
  }
}

async function addRecentFile(filePath) {
  const list = await readRecentFiles();
  const next = [filePath, ...list.filter((entry) => entry !== filePath)].slice(0, RECENT_FILE_LIMIT);
  await writeRecentFiles(next);
  return next;
}

function markdownFileFilters() {
  return [
    { name: t('dialog.filter.markdown'), extensions: ['md', 'markdown', 'mdown', 'txt'] },
    { name: t('dialog.filter.all'), extensions: ['*'] },
  ];
}

async function readFileForRenderer(filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  const recent = await addRecentFile(filePath);
  watchFile(filePath);
  return { path: filePath, name: path.basename(filePath), content, recent };
}

// --- Live reload: watch the open file and push disk changes to the UI -----
// Stat polling (fs.watchFile) survives editors that replace files on save.

let watchedPath = null;

function unwatchFile() {
  if (watchedPath) {
    fs.unwatchFile(watchedPath);
    watchedPath = null;
  }
}

function watchFile(filePath) {
  if (watchedPath === filePath) return;
  unwatchFile();
  watchedPath = filePath;
  fs.watchFile(filePath, { interval: 400 }, async (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    if (!mainWindow || filePath !== watchedPath) return;
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      mainWindow.webContents.send('file:changed-on-disk', { path: filePath, content });
    } catch {
      // The file may be mid-write or deleted; the next poll will retry.
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#5b6470',
      height: 46,
    },
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The window hosts local UI only; block navigation and new windows.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Intercept close so the renderer can flag unsaved changes first.
  mainWindow.on('close', (event) => {
    if (forceClose) return;
    event.preventDefault();
    mainWindow.webContents.send('app:close-requested');
  });

  mainWindow.on('closed', () => {
    unwatchFile();
    mainWindow = null;
  });
}

// --- IPC: file operations -------------------------------------------------

ipcMain.handle('file:open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('dialog.open.title'),
    properties: ['openFile'],
    filters: markdownFileFilters(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readFileForRenderer(result.filePaths[0]);
});

ipcMain.handle('file:read', async (_event, filePath) => {
  return readFileForRenderer(filePath);
});

ipcMain.handle('file:save', async (_event, filePath, content) => {
  await fsp.writeFile(filePath, content, 'utf8');
  const recent = await addRecentFile(filePath);
  watchFile(filePath);
  return { path: filePath, name: path.basename(filePath), recent };
});

ipcMain.handle('file:unwatch', () => unwatchFile());

ipcMain.handle('file:save-dialog', async (_event, content, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: t('dialog.save.title'),
    defaultPath: suggestedName || 'naamloos.md',
    filters: markdownFileFilters(),
  });
  if (result.canceled || !result.filePath) return null;
  await fsp.writeFile(result.filePath, content, 'utf8');
  const recent = await addRecentFile(result.filePath);
  watchFile(result.filePath);
  return { path: result.filePath, name: path.basename(result.filePath), recent };
});

ipcMain.handle('recent:list', async () => {
  const list = await readRecentFiles();
  const existing = list.filter((entry) => fs.existsSync(entry));
  if (existing.length !== list.length) await writeRecentFiles(existing);
  return existing;
});

ipcMain.handle('recent:clear', async () => {
  await writeRecentFiles([]);
  return [];
});

ipcMain.handle('app:startup-file', () => {
  const filePath = pendingOpenPath;
  pendingOpenPath = null;
  return filePath;
});

ipcMain.handle('shell:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.handle('app:confirm-discard', async (_event, { documentName }) => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: t('dialog.unsaved.title'),
    message: t('dialog.unsaved.message', { name: documentName || t('app.untitled') }),
    detail: t('dialog.unsaved.detail'),
    buttons: [t('dialog.unsaved.save'), t('dialog.unsaved.discard'), t('dialog.unsaved.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return ['save', 'discard', 'cancel'][choice.response];
});

// --- IPC: window and theme ------------------------------------------------

ipcMain.handle('window:set-titlebar', (_event, { symbolColor }) => {
  if (!mainWindow) return;
  mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 46 });
});

ipcMain.handle('theme:get-system', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));

nativeTheme.on('updated', () => {
  if (!mainWindow) return;
  mainWindow.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

// --- IPC: close flow ------------------------------------------------------

ipcMain.handle('app:confirm-close', async (_event, { dirty, documentName, filePath, content }) => {
  if (!dirty) {
    forceClose = true;
    mainWindow.close();
    return;
  }

  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: t('dialog.unsaved.title'),
    message: t('dialog.unsaved.message', { name: documentName || t('app.untitled') }),
    detail: t('dialog.unsaved.detail'),
    buttons: [t('dialog.unsaved.save'), t('dialog.unsaved.discard'), t('dialog.unsaved.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (choice.response === 2) return; // Cancel: keep the window open.

  if (choice.response === 0) {
    try {
      if (filePath) {
        await fsp.writeFile(filePath, content, 'utf8');
      } else {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: t('dialog.save.title'),
          defaultPath: 'naamloos.md',
          filters: markdownFileFilters(),
        });
        if (result.canceled || !result.filePath) return; // Treat as cancel.
        await fsp.writeFile(result.filePath, content, 'utf8');
      }
    } catch (error) {
      dialog.showErrorBox(t('error.saveFailed.title'), `${t('error.saveFailed.message')}\n${error.message}`);
      return;
    }
  }

  forceClose = true;
  mainWindow.close();
});

// --- App lifecycle --------------------------------------------------------

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = resolveFileArgument(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (filePath) mainWindow.webContents.send('file:open-external', filePath);
    }
  });

  app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
