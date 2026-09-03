'use strict';

/* Rendl renderer. All UI text comes from the locale files in /locales;
   use t('key') - never hard-code user-facing strings here. */

(async function bootstrap() {
  const api = window.rendl || (await createDemoApi());
  const strings = api.locales[api.defaultLocale] || {};

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    body: document.body,
    editorRoot: $('#editor-root'),
    docName: $('#doc-name'),
    dirtyDot: $('#dirty-dot'),
    sidebar: $('#sidebar'),
    recentList: $('#recent-list'),
    recentEmpty: $('#recent-empty'),
    welcome: $('#welcome'),
    toast: $('#toast'),
    dropIndicator: $('#drop-indicator'),
    modeSwitch: $('#mode-switch'),
    segmentedThumb: $('#segmented-thumb'),
    statusWords: $('#status-words'),
    statusChars: $('#status-chars'),
    statusReading: $('#status-reading'),
    statusSaved: $('#status-saved'),
  };

  const state = {
    filePath: null,
    fileName: null,
    savedContent: '',
    eol: '\r\n', // Line-ending style of the file on disk; the editor works in LF.
    themePref: localStorage.getItem('themePref') || 'auto',
    systemTheme: 'light',
    editorMode: localStorage.getItem('editorMode') === 'markdown' ? 'markdown' : 'wysiwyg',
  };

  let loadingDocument = false; // Suppresses change handling while we set content.

  // The editor works in LF; the original line-ending style (and any BOM)
  // is restored/dropped when writing back to disk.
  function normalizeContent(raw) {
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
    return raw.replace(/\r\n/g, '\n');
  }

  function serializeContent(markdown) {
    return state.eol === '\r\n' ? markdown.replace(/\n/g, '\r\n') : markdown;
  }

  function detectEol(raw) {
    return raw.includes('\r\n') || !raw.includes('\n') ? '\r\n' : '\n';
  }

  // ---------- i18n ----------

  function t(key, params = {}) {
    let value = strings[key] || key;
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function applyStaticStrings() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
    elements.docName.textContent = t('app.untitled');
  }

  // ---------- editor ----------

  // Register the editor's own UI strings from our locale file.
  if (strings.toastui) {
    toastui.Editor.setLanguage(['nl', 'nl-NL'], strings.toastui);
  }

  const { codeSyntaxHighlight, Prism } = window.rendlEditorPlugins || {};

  const editor = new toastui.Editor({
    el: elements.editorRoot,
    height: '100%',
    initialEditType: state.editorMode,
    previewStyle: 'tab',
    hideModeSwitch: true,
    usageStatistics: false,
    autofocus: false,
    language: 'nl-NL',
    placeholder: t('editor.placeholder'),
    plugins: codeSyntaxHighlight ? [[codeSyntaxHighlight, { highlighter: Prism }]] : [],
    events: { change: handleEditorChange },
  });

  function getMarkdown() {
    return editor.getMarkdown();
  }

  // ---------- theme ----------

  const TITLEBAR_SYMBOL_COLORS = { light: '#3b424c', dark: '#e2e6ec' };

  function resolvedTheme() {
    return state.themePref === 'auto' ? state.systemTheme : state.themePref;
  }

  function applyTheme() {
    const theme = resolvedTheme();
    elements.body.dataset.theme = theme;
    elements.body.dataset.themePref = state.themePref;
    const editorUi = elements.editorRoot.querySelector('.toastui-editor-defaultUI');
    if (editorUi) editorUi.classList.toggle('toastui-editor-dark', theme === 'dark');
    api.setTitleBarSymbolColor(TITLEBAR_SYMBOL_COLORS[theme]);
  }

  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    state.themePref = order[(order.indexOf(state.themePref) + 1) % order.length];
    localStorage.setItem('themePref', state.themePref);
    applyTheme();
    showToast(t(`theme.${state.themePref}`));
  }

  // ---------- mode (markdown source / live WYSIWYG) ----------

  function applyEditorMode(mode, { animate = true } = {}) {
    state.editorMode = mode;
    localStorage.setItem('editorMode', mode);

    if (editor.isMarkdownMode() !== (mode === 'markdown')) {
      editor.changeMode(mode, true);
    }

    for (const item of elements.modeSwitch.querySelectorAll('.segmented-item')) {
      item.classList.toggle('is-active', item.dataset.mode === mode);
      item.setAttribute('aria-selected', String(item.dataset.mode === mode));
    }
    positionSegmentedThumb(animate);
  }

  function positionSegmentedThumb(animate = true) {
    const active = elements.modeSwitch.querySelector('.segmented-item.is-active');
    if (!active) return;
    const thumb = elements.segmentedThumb;
    if (!animate) thumb.style.transition = 'none';
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
    if (!animate) requestAnimationFrame(() => { thumb.style.transition = ''; });
  }

  // ---------- document state ----------

  function isDirty() {
    return getMarkdown() !== state.savedContent;
  }

  function updateDocumentChrome() {
    const dirty = isDirty();
    elements.docName.textContent = state.fileName || t('app.untitled');
    elements.dirtyDot.hidden = !dirty;

    let statusKey = 'status.saved';
    if (dirty) statusKey = state.filePath ? 'status.saving' : 'status.unsaved';
    elements.statusSaved.textContent = t(statusKey);
    elements.statusSaved.classList.toggle('is-unsaved', dirty);

    document.title = `${dirty ? '• ' : ''}${state.fileName || t('app.untitled')} — ${t('app.name')}`;
  }

  function updateStatistics() {
    const text = getMarkdown();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    elements.statusWords.textContent = t('status.words', { count: words });
    elements.statusChars.textContent = t('status.characters', { count: text.length });
    elements.statusReading.textContent = t('status.readingTime', { minutes: Math.max(1, Math.ceil(words / 220)) });
  }

  function setDocument({ path = null, name = null, content = '' }) {
    loadingDocument = true;
    state.filePath = path;
    state.fileName = name;
    state.eol = detectEol(content);
    editor.setMarkdown(normalizeContent(content), false);
    // Compare against the editor's own serialization so formatting
    // normalisation never counts as an unsaved change.
    state.savedContent = getMarkdown();
    loadingDocument = false;

    hideWelcome();
    updateDocumentChrome();
    updateStatistics();
    editor.setScrollTop(0);
    editor.focus();
    initHistory(path);
  }

  // ---------- persistent history (cross-session undo) ----------
  // The editor's own Ctrl+Z/Ctrl+Y covers this session. On top of that we
  // keep saved-state snapshots per document (stored by the main process in a
  // hidden %LOCALAPPDATA%\Rendl\history folder). When the in-session history
  // has nothing left to undo (content equals the session baseline), Ctrl+Z
  // steps back through the persisted snapshots — also right after reopening
  // a document in a fresh session. Ctrl+Y walks forward again.

  const history = { stack: [], index: -1, baseline: '' };

  async function initHistory(filePath) {
    history.stack = [];
    history.index = -1;
    history.baseline = getMarkdown();
    if (!filePath) return;

    const entries = await api.historyGet(filePath);
    const current = getMarkdown();
    history.stack = entries;
    if (history.stack.length === 0 || history.stack[history.stack.length - 1] !== current) {
      history.stack.push(current);
      api.historySave(filePath, history.stack);
    }
    history.index = history.stack.length - 1;
  }

  function recordHistory(content) {
    if (!state.filePath) return;
    if (history.stack[history.index] === content) return; // e.g. after a snapshot undo
    history.stack = history.stack.slice(0, history.index + 1);
    if (history.stack[history.stack.length - 1] !== content) history.stack.push(content);
    history.index = history.stack.length - 1;
    api.historySave(state.filePath, history.stack);
  }

  function tryHistoryStep(direction) {
    if (!state.filePath) return false;
    if (getMarkdown() !== history.baseline) return false; // session history is still active
    const target = history.index + direction;
    if (target < 0 || target >= history.stack.length) return false;

    loadingDocument = true;
    editor.setMarkdown(history.stack[target], false);
    loadingDocument = false;
    history.index = target;
    history.baseline = getMarkdown();
    updateDocumentChrome();
    updateStatistics();
    scheduleAutosave();
    return true;
  }

  // ---------- change handling & autosave ----------

  const AUTOSAVE_DELAY_MS = 900;
  let autosaveTimer = null;

  function handleEditorChange() {
    if (loadingDocument) return;
    hideWelcome();
    updateDocumentChrome();
    updateStatistics();
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (!state.filePath) return; // An untitled document is saved via Ctrl+S first.
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (state.filePath && isDirty()) saveDocument({ silent: true });
    }, AUTOSAVE_DELAY_MS);
  }

  // ---------- guarded destructive actions ----------

  async function confirmDiscardIfDirty() {
    if (!isDirty()) return true;
    // With autosave, only untitled documents can still hold unsaved work.
    if (state.filePath) return (await saveDocument({ silent: true }));
    const choice = await api.confirmDiscard({
      documentName: state.fileName || t('app.untitled'),
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') return saveDocument();
    return true; // discard
  }

  // ---------- file actions ----------

  async function newDocument() {
    if (!(await confirmDiscardIfDirty())) return;
    api.unwatchFile();
    setDocument({ content: '' });
  }

  async function openDocumentDialog() {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      const result = await api.openFileDialog();
      if (result) {
        setDocument(result);
        renderRecentList(result.recent);
      }
    } catch {
      showToast(t('error.openFailed.message'));
    }
  }

  async function openPath(filePath) {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      const result = await api.readFile(filePath);
      setDocument(result);
      renderRecentList(result.recent);
    } catch {
      showToast(t('error.openFailed.message'));
      refreshRecentList();
    }
  }

  async function saveDocument({ silent = false } = {}) {
    try {
      if (state.filePath) {
        const markdown = getMarkdown();
        const result = await api.saveFile(state.filePath, serializeContent(markdown));
        state.savedContent = markdown;
        recordHistory(markdown);
        renderRecentList(result.recent);
        updateDocumentChrome();
        if (!silent) showToast(t('toast.saved', { name: result.name }));
        return true;
      }
      return saveDocumentAs();
    } catch {
      showToast(t('error.saveFailed.message'));
      return false;
    }
  }

  async function saveDocumentAs() {
    try {
      const markdown = getMarkdown();
      const result = await api.saveFileDialog(serializeContent(markdown), state.fileName || 'naamloos.md');
      if (!result) return false;
      state.filePath = result.path;
      state.fileName = result.name;
      state.savedContent = markdown;
      await initHistory(result.path);
      renderRecentList(result.recent);
      updateDocumentChrome();
      showToast(t('toast.saved', { name: result.name }));
      return true;
    } catch {
      showToast(t('error.saveFailed.message'));
      return false;
    }
  }

  // ---------- recent files ----------

  function renderRecentList(list) {
    if (!Array.isArray(list)) return;
    elements.recentList.innerHTML = '';
    elements.recentEmpty.hidden = list.length > 0;

    for (const filePath of list) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'recent-item';
      if (filePath === state.filePath) button.classList.add('is-current');

      const name = document.createElement('span');
      name.className = 'recent-item-name';
      name.textContent = filePath.split(/[\\/]/).pop();

      const pathLabel = document.createElement('span');
      pathLabel.className = 'recent-item-path';
      pathLabel.textContent = filePath;
      pathLabel.title = filePath;

      button.append(name, pathLabel);
      button.addEventListener('click', () => openPath(filePath));
      item.appendChild(button);
      elements.recentList.appendChild(item);
    }
  }

  async function refreshRecentList() {
    renderRecentList(await api.listRecentFiles());
  }

  // ---------- welcome, toast, sidebar ----------

  function hideWelcome() {
    elements.welcome.hidden = true;
  }

  let toastTimer = null;
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2200);
  }

  function toggleSidebar() {
    elements.sidebar.hidden = !elements.sidebar.hidden;
    if (!elements.sidebar.hidden) refreshRecentList();
  }

  // ---------- event wiring ----------

  $('#btn-new').addEventListener('click', newDocument);
  $('#btn-open').addEventListener('click', openDocumentDialog);
  $('#btn-save').addEventListener('click', () => saveDocument());
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  $('#btn-theme').addEventListener('click', cycleTheme);
  $('#btn-clear-recent').addEventListener('click', async () => renderRecentList(await api.clearRecentFiles()));
  $('#btn-welcome-new').addEventListener('click', () => { hideWelcome(); editor.focus(); });
  $('#btn-welcome-open').addEventListener('click', openDocumentDialog);

  const installButton = $('#btn-install');
  installButton.addEventListener('click', async () => {
    const installed = await api.installApp();
    if (installed) installButton.hidden = true;
  });

  for (const item of elements.modeSwitch.querySelectorAll('.segmented-item')) {
    item.addEventListener('click', () => applyEditorMode(item.dataset.mode));
  }

  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = event.key.toLowerCase();
    // Cross-session undo/redo: only intercepts when the in-session history
    // has nothing left to do; otherwise the editor handles Ctrl+Z/Ctrl+Y.
    if (key === 'z' && !event.shiftKey) {
      if (tryHistoryStep(-1)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      if (tryHistoryStep(1)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (key === 'n') { event.preventDefault(); newDocument(); }
    else if (key === 'o') { event.preventDefault(); openDocumentDialog(); }
    else if (key === 's' && event.shiftKey) { event.preventDefault(); saveDocumentAs(); }
    else if (key === 's') { event.preventDefault(); saveDocument(); }
    else if (key === 'e') {
      event.preventDefault();
      applyEditorMode(state.editorMode === 'markdown' ? 'wysiwyg' : 'markdown');
    }
    else if (key === 'b' && event.shiftKey) { event.preventDefault(); toggleSidebar(); }
  }, true);

  // Drag & drop of Markdown files onto the window (capture phase, so the
  // editor's own image-drop handling doesn't swallow file drops).
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropIndicator.hidden = false;
  }, true);
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) elements.dropIndicator.hidden = true;
  }, true);
  window.addEventListener('drop', (event) => {
    elements.dropIndicator.hidden = true;
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (!file) return;
    const filePath = api.getPathForFile(file);
    if (filePath && /\.(md|markdown|mdown|txt)$/i.test(filePath)) {
      event.preventDefault();
      event.stopPropagation();
      openPath(filePath);
    }
  }, true);

  window.addEventListener('resize', () => positionSegmentedThumb(false));

  // Close flow: the main process asks us for the current dirty state.
  api.onCloseRequested(() => {
    api.confirmClose({
      dirty: isDirty(),
      documentName: state.fileName || t('app.untitled'),
      filePath: state.filePath,
      content: serializeContent(getMarkdown()),
    });
  });

  api.onOpenExternalFile((filePath) => openPath(filePath));

  // Live reload: the main process pushes the newest content when the open
  // file changes on disk. Our own (auto)saves arrive here too, but match
  // the current content and are absorbed silently.
  api.onFileChangedOnDisk(({ path, content }) => {
    if (path !== state.filePath) return;
    const normalized = normalizeContent(content);
    if (normalized === state.savedContent || normalized === getMarkdown()) {
      state.savedContent = getMarkdown();
      updateDocumentChrome();
      return;
    }

    const scrollTop = editor.getScrollTop();
    loadingDocument = true;
    state.eol = detectEol(content);
    editor.setMarkdown(normalized, false);
    state.savedContent = getMarkdown();
    loadingDocument = false;
    history.baseline = getMarkdown();
    recordHistory(history.baseline);
    updateDocumentChrome();
    updateStatistics();
    editor.setScrollTop(scrollTop);
    showToast(t('toast.reloaded'));
  });

  api.onSystemThemeChanged((theme) => {
    state.systemTheme = theme;
    if (state.themePref === 'auto') applyTheme();
  });

  // ---------- startup ----------

  applyStaticStrings();
  installButton.hidden = !(await api.canInstall());
  state.systemTheme = await api.getSystemTheme();
  applyTheme();
  applyEditorMode(state.editorMode, { animate: false });
  updateDocumentChrome();
  updateStatistics();
  refreshRecentList();

  const startupFile = await api.getStartupFile();
  if (startupFile) {
    await openPath(startupFile);
  } else if (api.demoContent) {
    setDocument({ name: 'voorbeeld.md', content: api.demoContent });
  } else {
    elements.welcome.hidden = false;
  }

  positionSegmentedThumb(false);

  // ---------- browser demo fallback ----------
  // Lets the UI run in a plain browser (no Electron preload) during development.

  async function createDemoApi() {
    let locales = { nl: {} };
    try {
      const response = await fetch('../locales/nl.json');
      locales = { nl: await response.json() };
    } catch { /* file:// fetch may be blocked; keys will show as labels */ }

    return {
      locales,
      defaultLocale: 'nl',
      demoContent: [
        '# Rendl\n',
        'Een kleine, moderne app om **Markdown** te *schrijven* en te lezen.\n',
        '## Mogelijkheden\n',
        '- Volwaardige opmaakwerkbalk boven de editor',
        '- Live (WYSIWYG) en opmaakweergave',
        '- Automatisch opslaan, zoals in Google Docs\n',
        '> Dit is een voorbeelddocument in de browserdemo.\n',
        '```js\nfunction greet(name) {\n  return `Hallo, ${name}!`;\n}\n```\n',
        '| Sneltoets | Actie |\n| --- | --- |\n| Ctrl+S | Opslaan |\n| Ctrl+E | Weergave wisselen |\n',
        '- [x] Ontwerp\n- [ ] Vertalingen\n',
      ].join('\n'),
      openFileDialog: async () => null,
      readFile: async () => { throw new Error('demo'); },
      saveFile: async () => { throw new Error('demo'); },
      saveFileDialog: async () => null,
      getStartupFile: async () => null,
      getPathForFile: () => null,
      unwatchFile: () => {},
      onFileChangedOnDisk: () => {},
      listRecentFiles: async () => [],
      clearRecentFiles: async () => [],
      getSystemTheme: async () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
      setTitleBarSymbolColor: () => {},
      onSystemThemeChanged: () => {},
      onCloseRequested: () => {},
      confirmClose: async () => {},
      confirmDiscard: async () => 'discard',
      onOpenExternalFile: () => {},
      openExternal: (url) => window.open(url, '_blank'),
      canInstall: async () => false,
      installApp: async () => false,
      historyGet: async () => [],
      historySave: async () => {},
    };
  }
})();
