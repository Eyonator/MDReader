'use strict';

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');

const strings = require('./locales/nl.json');

const RECENT_FILE_LIMIT = 12;
const recentStorePath = () => path.join(app.getPath('userData'), 'recent-files.json');

let mainWindow = null;
let splashWindow = null;
let splashShownAt = 0;
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

// --- Live reload: watch every open file and push disk changes to the UI ---
// Stat polling (fs.watchFile) survives editors that replace files on save.
// With tabs, the renderer reconciles the watched set to its open documents.

const watchedPaths = new Set();

function watchFile(filePath) {
  if (watchedPaths.has(filePath)) return;
  watchedPaths.add(filePath);
  fs.watchFile(filePath, { interval: 400 }, async (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    if (!mainWindow || !watchedPaths.has(filePath)) return;
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      mainWindow.webContents.send('file:changed-on-disk', { path: filePath, content });
    } catch {
      // The file may be mid-write or deleted; the next poll will retry.
    }
  });
}

function unwatchFile(filePath) {
  if (!watchedPaths.has(filePath)) return;
  fs.unwatchFile(filePath);
  watchedPaths.delete(filePath);
}

function setWatchedFiles(filePaths) {
  const next = new Set(filePaths.filter(Boolean));
  for (const existing of [...watchedPaths]) {
    if (!next.has(existing)) unwatchFile(existing);
  }
  for (const filePath of next) watchFile(filePath);
}

// --- Projects: a folder whose Markdown files show in the sidebar ----------

const PROJECT_FILE_EXTENSIONS = /\.(md|markdown|mdown)$/i;
const PROJECT_SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor', 'bower_components', '__pycache__']);
const PROJECT_MAX_DEPTH = 4;
const PROJECT_MAX_FILES = 400;

async function scanProjectFolder(rootDir) {
  const files = [];

  async function walk(dir, depth) {
    if (depth > PROJECT_MAX_DEPTH || files.length >= PROJECT_MAX_FILES) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory; skip.
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const entry of entries) {
      if (files.length >= PROJECT_MAX_FILES) return;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PROJECT_SKIP_DIRS.has(entry.name.toLowerCase())) await walk(fullPath, depth + 1);
      } else if (PROJECT_FILE_EXTENSIONS.test(entry.name)) {
        files.push({ path: fullPath, relative: path.relative(rootDir, fullPath) });
      }
    }
  }

  await walk(rootDir, 0);
  return { root: rootDir, name: path.basename(rootDir), files };
}

const recentProjectsPath = () => path.join(app.getPath('userData'), 'recent-projects.json');

async function readRecentProjects() {
  try {
    const parsed = JSON.parse(await fsp.readFile(recentProjectsPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

async function addRecentProject(dirPath) {
  const list = await readRecentProjects();
  const next = [dirPath, ...list.filter((entry) => entry !== dirPath)].slice(0, 8);
  try {
    await fsp.writeFile(recentProjectsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch { /* convenience only */ }
  return next;
}

ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('dialog.openFolder.title'),
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const project = await scanProjectFolder(result.filePaths[0]);
  await addRecentProject(project.root);
  return project;
});

ipcMain.handle('project:scan', async (_event, dirPath) => {
  if (!fs.existsSync(dirPath)) return null;
  const project = await scanProjectFolder(dirPath);
  await addRecentProject(project.root);
  return project;
});

ipcMain.handle('watch:set', (_event, filePaths) => setWatchedFiles(filePaths));

// --- Update checker & updater ---------------------------------------------
// Every start checks the latest GitHub release. On Windows an update is a
// one-click flow that reuses the silent in-app installation: download the
// new portable exe, quit, "--install-silent --relaunch". Other platforms
// open the release page. A private repo (or being offline) fails silently.

const UPDATE_REPO = 'Eyonator/Rendl';
const UPDATE_RECHECK_DELAY_MS = 10 * 60 * 1000;
let pendingUpdate = null;
let updateRecheckAttempts = 0;

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkForUpdates() {
  if (!app.isPackaged && !process.env.RENDL_UPDATE_FEED) return;
  try {
    const feedUrl = process.env.RENDL_UPDATE_FEED
      || `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
    const response = await net.fetch(feedUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Rendl-updater' },
    });
    if (!response.ok) return;
    const release = await response.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) return;

    const assetName = `Rendl-${latestVersion}-win.exe`;
    const asset = (release.assets || []).find((entry) => entry.name === assetName);

    // On Windows the update must install in place, never via the browser.
    // A release whose Windows asset is still uploading (CI publishes per
    // platform) is not offered yet; check again in a while.
    if (process.platform === 'win32' && !asset) {
      if (updateRecheckAttempts < 6) {
        updateRecheckAttempts += 1;
        setTimeout(checkForUpdates, UPDATE_RECHECK_DELAY_MS);
      }
      return;
    }

    pendingUpdate = {
      version: latestVersion,
      assetUrl: asset ? asset.browser_download_url : null,
      releaseUrl: release.html_url,
    };

    // Ask right away whether to install now; "later" keeps the topbar
    // button available. (RENDL_UPDATE_CHOICE is an automation hook.)
    if (process.platform === 'win32' && pendingUpdate.assetUrl && mainWindow) {
      let response;
      if (process.env.RENDL_UPDATE_CHOICE === 'now') response = 0;
      else if (process.env.RENDL_UPDATE_CHOICE === 'later') response = 1;
      else {
        ({ response } = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: t('update.prompt.title'),
          message: t('update.prompt.message', { version: latestVersion }),
          detail: t('update.prompt.detail'),
          buttons: [t('update.prompt.now'), t('update.prompt.later')],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }));
      }
      if (response === 0) {
        try {
          await startUpdateDownload();
          return;
        } catch (error) {
          dialog.showErrorBox(t('update.failed.title'), `${t('update.failed.message')}\n${error.message}`);
        }
      }
    }

    if (mainWindow) mainWindow.webContents.send('update:available', { version: latestVersion });
  } catch { /* offline, rate-limited or private repo: stay quiet */ }
}

async function startUpdateDownload() {
  const response = await net.fetch(pendingUpdate.assetUrl, {
    headers: { 'User-Agent': 'Rendl-updater' },
  });
  if (!response.ok) throw new Error(`download failed (${response.status})`);

  // Stream the download so the UI can show progress.
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastSent = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    if (total && mainWindow) {
      const percent = Math.min(99, Math.round((received / total) * 100));
      if (percent !== lastSent) {
        lastSent = percent;
        mainWindow.webContents.send('update:progress', percent);
      }
    }
  }
  const buffer = Buffer.concat(chunks);
  const updateExe = path.join(app.getPath('temp'), `Rendl-${pendingUpdate.version}-update.exe`);
  await fsp.writeFile(updateExe, buffer);

  // Preserve the user's original agent-skill choice.
  const skillInstalled = fs.existsSync(path.join(app.getPath('home'), '.claude', 'skills', 'rendl', 'SKILL.md'));
  const updateArgs = ['--install-silent', ...(skillInstalled ? [] : ['--no-skill'])];

  // Give this process a few seconds to exit, run the silent install and
  // relaunch from the cmd chain itself: the portable launcher kills its
  // own child processes via a job object when it exits, so the new app
  // must be started by cmd (outside that job), not by the installer run.
  const installedExe = path.join(INSTALL_DIR, 'Rendl.exe');
  const chainLog = path.join(app.getPath('temp'), 'rendl-chain.log');
  const chainScript = path.join(app.getPath('temp'), 'rendl-update.cmd');
  fs.writeFileSync(chainScript, [
    '@echo off',
    `echo chain-start >> "${chainLog}"`,
    'ping -n 4 127.0.0.1 > nul',
    `"${updateExe}" ${updateArgs.join(' ')}`,
    `echo installer-exit=%errorlevel% >> "${chainLog}"`,
    `start "" "${installedExe}"`,
    `echo relaunched >> "${chainLog}"`,
    '',
  ].join('\r\n'));
  // windowsHide is ignored for detached processes, so a directly spawned
  // cmd shows a console window during the update. wscript is a GUI-subsystem
  // binary and runs the script with window style 0: fully invisible.
  const chainLauncher = path.join(app.getPath('temp'), 'rendl-update.vbs');
  fs.writeFileSync(chainLauncher,
    `CreateObject("Wscript.Shell").Run """${chainScript}""", 0, False\r\n`);

  fs.writeFileSync(chainLog, 'spawning chain script\n');
  const chainChild = spawn('wscript.exe', [chainLauncher], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: app.getPath('temp'),
  });
  chainChild.on('error', (error) => {
    try { fs.appendFileSync(chainLog, `spawn-error: ${error.message}\n`); } catch { /* diagnostics only */ }
  });
  try { fs.appendFileSync(chainLog, `spawned pid=${chainChild.pid}\n`); } catch { /* diagnostics only */ }
  chainChild.unref();

  forceClose = true;
  if (mainWindow) mainWindow.close();
}

ipcMain.handle('update:install', async () => {
  if (!pendingUpdate) return false;

  // Windows always updates in place; other platforms open the download page.
  if (process.platform !== 'win32') {
    shell.openExternal(pendingUpdate.releaseUrl);
    return false;
  }
  if (!pendingUpdate.assetUrl) return false;

  try {
    await startUpdateDownload();
    return true;
  } catch (error) {
    dialog.showErrorBox(t('update.failed.title'), `${t('update.failed.message')}\n${error.message}`);
    return false;
  }
});

// --- Persistent per-document history --------------------------------------
// Snapshots of every saved state, kept in a hidden folder under
// %LOCALAPPDATA%\Rendl\history, so Ctrl+Z can step back into previous
// sessions after the app was closed and the same document is reopened.

const HISTORY_MAX_ENTRIES = 50;
const HISTORY_MAX_BYTES = 10 * 1024 * 1024;

function historyBaseDir() {
  return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Rendl');
}

async function ensureHistoryDir() {
  const base = historyBaseDir();
  const dir = path.join(base, 'history');
  if (!fs.existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
    if (process.platform === 'win32') {
      try {
        execFileSync('attrib', ['+h', base], { windowsHide: true });
      } catch { /* hidden attribute is cosmetic */ }
    }
  }
  return dir;
}

async function historyFilePath(documentPath) {
  const dir = await ensureHistoryDir();
  const hash = crypto.createHash('sha1').update(documentPath.toLowerCase()).digest('hex');
  return path.join(dir, `${hash}.json`);
}

ipcMain.handle('history:get', async (_event, documentPath) => {
  try {
    const raw = await fsp.readFile(await historyFilePath(documentPath), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries.map((e) => String(e.c)) : [];
  } catch {
    return [];
  }
});

ipcMain.handle('history:save', async (_event, documentPath, entries) => {
  if (!Array.isArray(entries)) return;
  let list = entries.map((c) => String(c)).slice(-HISTORY_MAX_ENTRIES);
  let totalBytes = list.reduce((sum, c) => sum + c.length, 0);
  while (list.length > 1 && totalBytes > HISTORY_MAX_BYTES) {
    totalBytes -= list[0].length;
    list = list.slice(1);
  }
  const payload = { path: documentPath, entries: list.map((c) => ({ t: Date.now(), c })) };
  await fsp.writeFile(await historyFilePath(documentPath), JSON.stringify(payload), 'utf8');
});

// --- In-app installation (Windows, per-user, no admin required) -----------
// The single distributed exe runs portable; from inside the app the user can
// install it permanently: files under %LOCALAPPDATA%\Programs\Rendl, a Start
// Menu shortcut, .md associations and an uninstall entry — all under HKCU.

const INSTALL_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Rendl')
  : null;
const PROG_ID = 'Rendl.Markdown';
const ASSOC_EXTENSIONS = ['.md', '.markdown', '.mdown'];

function isInstalledCopy() {
  return !!INSTALL_DIR && process.execPath.toLowerCase().startsWith(INSTALL_DIR.toLowerCase() + path.sep);
}

function canInstall() {
  return process.platform === 'win32' && !isInstalledCopy() && !!process.env.LOCALAPPDATA;
}

function regAdd(keyPath, valueName, data) {
  const args = ['add', keyPath, ...(valueName ? ['/v', valueName] : ['/ve']), '/t', 'REG_SZ', '/d', data, '/f'];
  execFileSync('reg', args, { windowsHide: true });
}

async function performInstall() {
  const installedExe = path.join(INSTALL_DIR, 'Rendl.exe');
  const sourceDir = path.dirname(process.execPath); // unpacked app directory

  // Disable Electron's asar virtualisation while copying, so app.asar is
  // treated as a plain file instead of a directory.
  process.noAsar = true;
  try {
    // During an update the previous copy may still be exiting and holding a
    // lock on its own exe; retry for a while before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rm(INSTALL_DIR, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt >= 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    await fsp.cp(sourceDir, INSTALL_DIR, { recursive: true });
  } finally {
    process.noAsar = false;
  }

  // Start Menu shortcut.
  const startMenuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  shell.writeShortcutLink(path.join(startMenuDir, 'Rendl.lnk'), {
    target: installedExe,
    description: 'Rendl — Markdown reader & writer',
  });

  // File type registration. Windows 10+ keeps the user's explicit choice
  // (UserChoice) authoritative; this makes Rendl available and the default
  // where the user has not picked another app.
  const classes = 'HKCU\\Software\\Classes';
  regAdd(`${classes}\\${PROG_ID}`, null, 'Markdown-bestand');
  regAdd(`${classes}\\${PROG_ID}\\DefaultIcon`, null, `"${installedExe}",0`);
  regAdd(`${classes}\\${PROG_ID}\\shell\\open\\command`, null, `"${installedExe}" "%1"`);
  for (const ext of ASSOC_EXTENSIONS) {
    regAdd(`${classes}\\${ext}`, null, PROG_ID);
    regAdd(`${classes}\\${ext}\\OpenWithProgids`, PROG_ID, '');
  }

  // Uninstall entry (Settings > Apps).
  const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Rendl';
  regAdd(uninstallKey, 'DisplayName', 'Rendl');
  regAdd(uninstallKey, 'DisplayVersion', app.getVersion());
  regAdd(uninstallKey, 'Publisher', 'Vincent van Soelen');
  regAdd(uninstallKey, 'DisplayIcon', installedExe);
  regAdd(uninstallKey, 'InstallLocation', INSTALL_DIR);
  regAdd(uninstallKey, 'UninstallString', `"${installedExe}" --uninstall`);
  regAdd(uninstallKey, 'NoModify', '1');
  regAdd(uninstallKey, 'NoRepair', '1');

  return installedExe;
}

// --- AI-agent skill (Claude Code, Codex, other agents) --------------------
// Optional at install time: teaches local AI agents to open Markdown for the
// user via Rendl (which live-reloads while the agent keeps writing).

const SNIPPET_START = '<!-- rendl-skill:start -->';
const SNIPPET_END = '<!-- rendl-skill:end -->';

function agentSkillSource(fileName) {
  return path.join(app.getAppPath(), 'resources', 'agent-skill', fileName);
}

async function installAgentSkill() {
  const home = app.getPath('home');
  const skillContent = await fsp.readFile(agentSkillSource('SKILL.md'), 'utf8');
  const snippetContent = await fsp.readFile(agentSkillSource('AGENTS-snippet.md'), 'utf8');

  // Claude Code: user-level skill.
  const claudeSkillDir = path.join(home, '.claude', 'skills', 'rendl');
  await fsp.mkdir(claudeSkillDir, { recursive: true });
  await fsp.writeFile(path.join(claudeSkillDir, 'SKILL.md'), skillContent, 'utf8');

  // Codex: add a marked section to the global AGENTS.md (idempotent), but
  // only when Codex is actually present on this machine.
  const codexDir = path.join(home, '.codex');
  if (fs.existsSync(codexDir)) {
    const agentsPath = path.join(codexDir, 'AGENTS.md');
    let existing = '';
    try { existing = await fsp.readFile(agentsPath, 'utf8'); } catch { /* new file */ }
    const startIndex = existing.indexOf(SNIPPET_START);
    if (startIndex >= 0) {
      const endIndex = existing.indexOf(SNIPPET_END);
      existing = existing.slice(0, startIndex) + existing.slice(endIndex + SNIPPET_END.length).replace(/^\r?\n/, '');
    }
    const next = existing.trimEnd() + (existing.trim() ? '\n\n' : '') + snippetContent;
    await fsp.writeFile(agentsPath, next, 'utf8');
  }

  // Copy both files next to the installed app for wiring up other agents.
  if (INSTALL_DIR) {
    const docsDir = path.join(INSTALL_DIR, 'agent-skill');
    await fsp.mkdir(docsDir, { recursive: true });
    await fsp.writeFile(path.join(docsDir, 'SKILL.md'), skillContent, 'utf8');
    await fsp.writeFile(path.join(docsDir, 'AGENTS-snippet.md'), snippetContent, 'utf8');
  }
}

function uninstallAgentSkill() {
  const home = app.getPath('home');
  try {
    fs.rmSync(path.join(home, '.claude', 'skills', 'rendl'), { recursive: true, force: true });
  } catch { /* not installed */ }

  const agentsPath = path.join(home, '.codex', 'AGENTS.md');
  try {
    let existing = fs.readFileSync(agentsPath, 'utf8');
    const startIndex = existing.indexOf(SNIPPET_START);
    if (startIndex >= 0) {
      const endIndex = existing.indexOf(SNIPPET_END);
      existing = existing.slice(0, startIndex) + existing.slice(endIndex + SNIPPET_END.length).replace(/^\r?\n/, '');
      fs.writeFileSync(agentsPath, existing, 'utf8');
    }
  } catch { /* no AGENTS.md */ }
}

function performUninstall() {
  uninstallAgentSkill();
  const regDelete = (keyPath) => {
    try {
      execFileSync('reg', ['delete', keyPath, '/f'], { windowsHide: true });
    } catch { /* key may not exist */ }
  };

  const classes = 'HKCU\\Software\\Classes';
  for (const ext of ASSOC_EXTENSIONS) {
    // Only remove the extension mapping if it still points to us.
    try {
      const current = execFileSync('reg', ['query', `${classes}\\${ext}`, '/ve'], { windowsHide: true }).toString();
      if (current.includes(PROG_ID)) regDelete(`${classes}\\${ext}`);
    } catch { /* not registered */ }
  }
  regDelete(`${classes}\\${PROG_ID}`);
  regDelete('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Rendl');

  try {
    fs.rmSync(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Rendl.lnk'), { force: true });
  } catch { /* shortcut may not exist */ }

  // The running exe lives inside INSTALL_DIR, so delete the directory from a
  // detached script after this process has exited — retrying while Windows
  // still holds locks on the exiting process's files.
  if (INSTALL_DIR) {
    const script = [
      '@echo off',
      'set /a tries=0',
      ':loop',
      'set /a tries+=1',
      'ping -n 2 127.0.0.1 > nul',
      `rmdir /s /q "${INSTALL_DIR}" 2> nul`,
      `if not exist "${INSTALL_DIR}" goto done`,
      'if %tries% lss 30 goto loop',
      ':done',
      'del "%~f0"',
    ].join('\r\n');
    const scriptPath = path.join(app.getPath('temp'), 'rendl-uninstall.cmd');
    fs.writeFileSync(scriptPath, script, 'utf8');
    spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

// Splash: a small transparent window with the spinning mark, shown while
// the main window loads and for a minimum beat so it never just flashes.
const SPLASH_MIN_VISIBLE_MS = 900;

function createSplashWindow(labelText) {
  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 280,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const loaded = splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'),
    labelText ? { query: { label: labelText } } : undefined);
  splashWindow.on('closed', () => { splashWindow = null; });
  return loaded;
}

function closeSplashAndShowMainWindow() {
  const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - (Date.now() - splashShownAt));
  setTimeout(() => {
    if (splashWindow) splashWindow.close();
    if (mainWindow) mainWindow.show();
  }, remaining);
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

  mainWindow.once('ready-to-show', closeSplashAndShowMainWindow);

  // Intercept close so the renderer can flag unsaved changes first.
  mainWindow.on('close', (event) => {
    if (forceClose) return;
    event.preventDefault();
    mainWindow.webContents.send('app:close-requested');
  });

  mainWindow.on('closed', () => {
    setWatchedFiles([]);
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

// --- IPC: in-app installation ---------------------------------------------

ipcMain.handle('app:can-install', () => canInstall());

// Starts the installed copy a moment after this (portable) process has
// exited. The portable launcher's job object kills any process we spawn
// directly, so the hand-off goes through the Task Scheduler, which starts
// processes outside our job. The task and its scripts clean themselves up.
function scheduleSwitchToInstalled(installedExe) {
  const temp = app.getPath('temp');
  const switchScript = path.join(temp, 'rendl-switch.cmd');
  const switchLauncher = path.join(temp, 'rendl-switch.vbs');
  fs.writeFileSync(switchScript, [
    '@echo off',
    'ping -n 3 127.0.0.1 > nul',
    `start "" "${installedExe}"`,
    'schtasks /delete /f /tn RendlSwitch >nul 2>&1',
    `del "${switchLauncher}"`,
    'del "%~f0"',
    '',
  ].join('\r\n'));
  fs.writeFileSync(switchLauncher,
    `CreateObject("Wscript.Shell").Run """${switchScript}""", 0, False\r\n`);
  execFileSync('schtasks', ['/create', '/f', '/tn', 'RendlSwitch', '/tr', `wscript.exe "${switchLauncher}"`, '/sc', 'once', '/st', '23:59'], { windowsHide: true });
  execFileSync('schtasks', ['/run', '/tn', 'RendlSwitch'], { windowsHide: true });
}

// Asks the renderer to settle every document (autosave + keep/discard
// dialogs for untitled work). Resolves false when the user cancels.
function settleRendererDocuments() {
  return new Promise((resolve) => {
    ipcMain.once('app:settle-response', (_event, ok) => resolve(Boolean(ok)));
    mainWindow.webContents.send('app:settle-request');
  });
}

ipcMain.handle('app:install', async () => {
  let response = 0;
  let checkboxChecked = true;
  if (process.env.RENDL_INSTALL_CHOICE) { // automation hook
    response = process.env.RENDL_INSTALL_CHOICE === 'cancel' ? 1 : 0;
    checkboxChecked = process.env.RENDL_INSTALL_CHOICE !== 'yes-no-skill';
  } else {
    ({ response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: t('install.confirm.title'),
      message: t('install.confirm.message'),
      detail: t('install.confirm.detail', { dir: INSTALL_DIR }),
      checkboxLabel: t('install.confirm.checkbox'),
      checkboxChecked: true,
      buttons: [t('install.confirm.ok'), t('install.confirm.cancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }));
  }
  if (response !== 0) return false;

  try {
    await performInstall();
    if (checkboxChecked) await installAgentSkill();

    // Offer to switch to the installed copy right away; open documents
    // come back via session restore (shared user data).
    let restart;
    if (process.env.RENDL_INSTALL_RESTART) { // automation hook
      restart = process.env.RENDL_INSTALL_RESTART === 'now' ? 0 : 1;
    } else {
      ({ response: restart } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: t('install.done.title'),
        message: t('install.done.message'),
        detail: t('install.done.restartDetail'),
        buttons: [t('install.done.restart'), t('install.done.later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }));
    }

    if (restart === 0) {
      if (await settleRendererDocuments()) {
        scheduleSwitchToInstalled(path.join(INSTALL_DIR, 'Rendl.exe'));
        forceClose = true;
        mainWindow.close();
      }
    }
    return true;
  } catch (error) {
    dialog.showErrorBox(t('install.failed.title'), `${t('install.failed.message')}\n${error.message}`);
    return false;
  }
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

// Maintenance runs (install/uninstall) skip the single-instance lock so they
// also work while a regular window is open.
const isMaintenanceRun = process.argv.includes('--uninstall') || process.argv.includes('--install-silent');
const hasSingleInstanceLock = isMaintenanceRun || app.requestSingleInstanceLock();

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

  app.whenReady().then(async () => {
    // Maintenance flags: run without a window, then exit.
    if (process.argv.includes('--uninstall')) {
      performUninstall();
      app.quit();
      return;
    }
    if (process.argv.includes('--install-silent')) {
      try {
        // Visual feedback while the update installs and relaunches. Wait for
        // the splash to finish loading BEFORE the install starts: the copy
        // runs with process.noAsar enabled, which would break the splash's
        // own resource loading from app.asar and leave an invisible window.
        try {
          await createSplashWindow(t('update.installing'));
        } catch (error) {
          try {
            fs.writeFileSync(path.join(app.getPath('temp'), 'rendl-splash.log'),
              `splash load failed: ${(error && error.stack) || error}\n`, 'utf8');
          } catch { /* diagnostics only */ }
        }
        await performInstall();
        if (!process.argv.includes('--no-skill')) await installAgentSkill();
        if (splashWindow) splashWindow.close();
        app.quit();
      } catch (error) {
        try {
          fs.writeFileSync(path.join(app.getPath('temp'), 'rendl-install.log'),
            `install failed: ${error.message}\n${error.stack}\n`, 'utf8');
        } catch { /* nothing more we can do */ }
        app.exit(1);
      }
      return;
    }

    createSplashWindow();
    createMainWindow();
    setTimeout(checkForUpdates, 3000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
