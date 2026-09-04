'use strict';

/* Rendl renderer. All UI text comes from the locale files in /locales;
   use t('key') - never hard-code user-facing strings here. */

(async function bootstrap() {
  const api = window.rendl || (await createDemoApi());
  const strings = api.locales[api.defaultLocale] || {};

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    body: document.body,
    panesRow: $('#panes-row'),
    docName: $('#doc-name'),
    dirtyDot: $('#dirty-dot'),
    sidebar: $('#sidebar'),
    sidebarSwitch: $('#sidebar-switch'),
    sidebarThumb: $('#sidebar-thumb'),
    viewProject: $('#view-project'),
    viewRecent: $('#view-recent'),
    projectName: $('#project-name'),
    projectList: $('#project-list'),
    projectEmpty: $('#project-empty'),
    recentList: $('#recent-list'),
    recentEmpty: $('#recent-empty'),
    tabbarTabs: $('#tabbar-tabs'),
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
    themePref: localStorage.getItem('themePref') || 'auto',
    systemTheme: 'light',
    editorMode: localStorage.getItem('editorMode') === 'markdown' ? 'markdown' : 'wysiwyg',
    sidebarView: localStorage.getItem('sidebarView') === 'recent' ? 'recent' : 'project',
    project: null, // { root, name, files: [{path, relative}] }
  };

  // The editor works in LF; the original line-ending style (and any BOM)
  // is restored/dropped when writing back to disk.
  function normalizeContent(raw) {
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
    return raw.replace(/\r\n/g, '\n');
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

  // Register the editor's own UI strings from our locale file.
  if (strings.toastui) {
    toastui.Editor.setLanguage(['nl', 'nl-NL'], strings.toastui);
  }

  const { codeSyntaxHighlight, Prism } = window.rendlEditorPlugins || {};

  // ---------- tabs ----------
  // Each open document is a tab. A tab shown in a pane lives in that pane's
  // editor; other tabs keep their markdown in `content`. Each tab has its
  // own line-ending style, scroll position and undo-history state.

  let nextTabId = 1;
  const tabs = [];

  function tabById(id) {
    return tabs.find((tab) => tab.id === id) || null;
  }

  function makeTab({ path = null, name = null, content = '' }) {
    return {
      id: nextTabId++,
      filePath: path,
      fileName: name,
      eol: detectEol(content),
      content: normalizeContent(content),
      savedContent: normalizeContent(content),
      needsBaseline: true, // savedContent becomes editor-normalized on first show
      scrollTop: 0,
      history: { stack: [], index: -1, baseline: '', pending: true },
    };
  }

  // ---------- panes (split view) ----------
  // One editor instance per pane; the focused pane is what the top bar,
  // status bar and keyboard shortcuts act on.

  const MAX_PANES = 3;
  const panes = [];
  let nextPaneId = 1;
  let activePaneId = null;

  function activePane() {
    return panes.find((pane) => pane.id === activePaneId) || panes[0] || null;
  }

  function paneForTab(tabId) {
    return panes.find((pane) => pane.tabId === tabId) || null;
  }

  function createPane() {
    const el = document.createElement('section');
    el.className = 'editor-pane';

    // Header strip (visible when split) naming the file shown in this pane.
    const titleBar = document.createElement('div');
    titleBar.className = 'pane-title';
    const titleLabel = document.createElement('span');
    titleLabel.className = 'pane-title-label';
    const closeButton = document.createElement('button');
    closeButton.className = 'pane-close';
    closeButton.title = t('split.close');
    closeButton.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7m0-7l-7 7"/></svg>';
    titleBar.append(titleLabel, closeButton);

    const host = document.createElement('div');
    host.className = 'editor-host';

    // Calm empty state for a pane without a document; an untitled document
    // is only ever created by an explicit "new" action.
    const empty = document.createElement('div');
    empty.className = 'pane-empty';
    empty.innerHTML = '<svg class="pane-empty-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true">'
      + '<defs><linearGradient id="pe' + nextPaneId + '" x1=".1" y1=".9" x2=".9" y2=".1">'
      + '<stop offset="0" stop-color="#0A84FF"/><stop offset=".48" stop-color="#5AC8FA"/>'
      + '<stop offset=".76" stop-color="#9E8CFF"/><stop offset="1" stop-color="#ECEFF4"/></linearGradient></defs>'
      + '<path d="M142 422V242c0-93 75-168 168-168h74" fill="none" stroke="url(#pe' + nextPaneId + ')" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '<p class="pane-empty-hint"></p>';
    empty.querySelector('.pane-empty-hint').textContent = t('empty.hint');

    el.append(titleBar, host, empty);
    elements.panesRow.appendChild(el);

    const pane = {
      id: nextPaneId++,
      el,
      titleLabel,
      closeButton,
      tabId: null,
      mode: state.editorMode,
      loading: false,
      editor: null,
    };

    pane.editor = new toastui.Editor({
      el: host,
      height: '100%',
      initialEditType: pane.mode,
      previewStyle: 'tab',
      hideModeSwitch: true,
      usageStatistics: false,
      autofocus: false,
      language: 'nl-NL',
      placeholder: t('editor.placeholder'),
      plugins: codeSyntaxHighlight ? [[codeSyntaxHighlight, { highlighter: Prism }]] : [],
      events: { change: () => handlePaneChange(pane) },
    });

    closeButton.addEventListener('click', (event) => { event.stopPropagation(); closePane(pane.id); });
    el.addEventListener('mousedown', () => setActivePane(pane.id));
    el.addEventListener('focusin', () => setActivePane(pane.id));

    panes.push(pane);
    applyThemeToPane(pane);
    updatePaneChrome();
    return pane;
  }

  function closePane(paneId) {
    if (panes.length <= 1) return;
    const pane = panes.find((entry) => entry.id === paneId);
    if (!pane) return;
    syncPaneIntoTab(pane);
    pane.editor.destroy();
    pane.el.remove();
    panes.splice(panes.indexOf(pane), 1);
    if (activePaneId === paneId) setActivePane(panes[0].id);
    updatePaneChrome();
    renderTabs();
  }

  function splitView() {
    if (panes.length >= MAX_PANES) { showToast(t('split.max')); return; }
    const pane = createPane();
    const candidate = tabs.find((tab) => !paneForTab(tab.id));
    if (candidate) showTabInPane(candidate, pane);
    else setActivePane(pane.id); // stays empty; no unwanted untitled document
    updatePaneChrome();
  }

  function updatePaneChrome() {
    elements.panesRow.classList.toggle('is-split', panes.length > 1);
    for (const pane of panes) {
      const tab = tabById(pane.tabId);
      pane.el.classList.toggle('is-active-pane', pane.id === activePaneId);
      pane.el.classList.toggle('is-empty', !tab);
      pane.closeButton.hidden = panes.length <= 1;
      pane.titleLabel.textContent = tab ? (tab.fileName || t('app.untitled')) : '';
      pane.titleLabel.title = (tab && tab.filePath) || '';
    }
  }

  function setActivePane(paneId) {
    if (activePaneId === paneId) return;
    activePaneId = paneId;
    const pane = activePane();
    if (pane) reflectEditorMode(pane.mode);
    updatePaneChrome();
    renderTabs();
    renderProjectList();
    updateDocumentChrome();
    updateStatistics();
  }

  function getTabMarkdown(tab) {
    const pane = paneForTab(tab.id);
    return pane ? pane.editor.getMarkdown() : tab.content;
  }

  function isTabDirty(tab) {
    if (!tab) return false;
    if (!paneForTab(tab.id) && tab.needsBaseline) return false; // untouched since load
    return getTabMarkdown(tab) !== tab.savedContent;
  }

  function serializeTabContent(tab, markdown) {
    return tab.eol === '\r\n' ? markdown.replace(/\n/g, '\r\n') : markdown;
  }

  function syncPaneIntoTab(pane) {
    const tab = tabById(pane.tabId);
    if (!tab) return;
    tab.content = pane.editor.getMarkdown();
    tab.scrollTop = pane.editor.getScrollTop();
  }

  function showTabInPane(tab, pane, { focus = true } = {}) {
    const existingPane = paneForTab(tab.id);
    if (existingPane && existingPane !== pane) { setActivePane(existingPane.id); return; }
    if (pane.tabId === tab.id) { setActivePane(pane.id); return; }

    syncPaneIntoTab(pane);
    pane.tabId = tab.id;

    pane.loading = true;
    pane.editor.setMarkdown(tab.content, false);
    if (tab.needsBaseline) {
      tab.savedContent = pane.editor.getMarkdown();
      tab.needsBaseline = false;
    }
    tab.content = pane.editor.getMarkdown();
    pane.loading = false;

    if (tab.history.pending) initHistory(tab);
    else tab.history.baseline = tab.content;

    pane.editor.setScrollTop(tab.scrollTop || 0);
    if (focus) pane.editor.focus();
    setActivePane(pane.id);
    renderTabs();
    renderProjectList();
    updateDocumentChrome();
    updateStatistics();
    persistSession();
  }

  function activateTab(id, { focus = true } = {}) {
    const tab = tabById(id);
    if (!tab) return;
    const pane = paneForTab(id) || activePane();
    showTabInPane(tab, pane, { focus });
  }

  async function openInTab(filePath, { background = false } = {}) {
    const existing = tabs.find((tab) => tab.filePath === filePath);
    if (existing) {
      if (!background) activateTab(existing.id);
      return existing;
    }
    try {
      const result = await api.readFile(filePath);
      const tab = makeTab(result);
      tabs.push(tab);
      renderRecentList(result.recent);
      renderTabs();
      updateWatchedFiles();
      if (!background) activateTab(tab.id);
      persistSession();
      return tab;
    } catch {
      showToast(t('error.openFailed.message'));
      refreshRecentList();
      return null;
    }
  }

  function newTab() {
    const tab = makeTab({ content: '' });
    tabs.push(tab);
    renderTabs();
    activateTab(tab.id);
  }

  async function closeTab(id) {
    const tab = tabById(id);
    if (!tab) return;

    if (isTabDirty(tab)) {
      if (tab.filePath) {
        await saveTab(tab, { silent: true });
      } else {
        activateTab(tab.id);
        const choice = await api.confirmDiscard({ documentName: tab.fileName || t('app.untitled') });
        if (choice === 'cancel') return;
        if (choice === 'save' && !(await saveTabAs(tab))) return;
      }
    }

    const pane = paneForTab(tab.id);
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);

    if (pane) {
      pane.tabId = null;
      const replacement = tabs.find((entry) => !paneForTab(entry.id));
      if (replacement) {
        showTabInPane(replacement, pane, { focus: pane.id === activePaneId });
      } else if (panes.length > 1) {
        closePane(pane.id);
      } else {
        // No documents left: show the calm empty state — never auto-create
        // an untitled document.
        pane.loading = true;
        pane.editor.setMarkdown('', false);
        pane.loading = false;
      }
    }
    renderTabs();
    updateWatchedFiles();
    updateDocumentChrome();
    updateStatistics();
    persistSession();
  }

  function cycleTab(direction) {
    if (tabs.length < 2) return;
    const pane = activePane();
    const index = tabs.findIndex((tab) => tab.id === pane.tabId);
    for (let step = 1; step <= tabs.length; step++) {
      const next = tabs[(index + direction * step + tabs.length * step) % tabs.length];
      const otherPane = paneForTab(next.id);
      if (!otherPane || otherPane === pane) { showTabInPane(next, pane); return; }
    }
  }

  // Tab drag-reordering: HTML5 drag & drop within the tab strip.
  let draggedTabId = null;

  function clearDropMarkers() {
    for (const el of elements.tabbarTabs.querySelectorAll('.drop-before, .drop-after')) {
      el.classList.remove('drop-before', 'drop-after');
    }
  }

  function reorderTab(tabId, targetIndex) {
    const from = tabs.findIndex((tab) => tab.id === tabId);
    if (from < 0) return;
    const [moved] = tabs.splice(from, 1);
    if (targetIndex > from) targetIndex -= 1;
    tabs.splice(Math.max(0, Math.min(targetIndex, tabs.length)), 0, moved);
    renderTabs();
    persistSession();
  }

  function renderTabs() {
    elements.tabbarTabs.innerHTML = '';
    const active = activePane();
    for (const tab of tabs) {
      const pane = paneForTab(tab.id);
      const el = document.createElement('div');
      el.className = 'tab'
        + (active && pane && pane.id === active.id ? ' is-active' : '')
        + (pane ? ' is-open' : '');
      el.title = tab.filePath || t('app.untitled');
      el.draggable = true;

      el.addEventListener('dragstart', (event) => {
        draggedTabId = tab.id;
        event.dataTransfer.setData('text/rendl-tab', String(tab.id));
        event.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => { draggedTabId = null; clearDropMarkers(); });
      el.addEventListener('dragover', (event) => {
        if (draggedTabId === null || draggedTabId === tab.id) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const before = event.clientX < rect.left + rect.width / 2;
        clearDropMarkers();
        el.classList.add(before ? 'drop-before' : 'drop-after');
      });
      el.addEventListener('drop', (event) => {
        if (draggedTabId === null) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = el.getBoundingClientRect();
        const before = event.clientX < rect.left + rect.width / 2;
        const index = tabs.indexOf(tab);
        reorderTab(draggedTabId, before ? index : index + 1);
        draggedTabId = null;
        clearDropMarkers();
      });

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.fileName || t('app.untitled');
      el.appendChild(label);

      if (isTabDirty(tab) && !tab.filePath) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty';
        el.appendChild(dot);
      }

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.title = t('tabs.close');
      close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7m0-7l-7 7"/></svg>';
      close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab.id); });
      el.appendChild(close);

      el.addEventListener('click', () => activateTab(tab.id));
      el.addEventListener('auxclick', (event) => { if (event.button === 1) closeTab(tab.id); });
      elements.tabbarTabs.appendChild(el);
    }
    updatePaneChrome();
  }

  // Dropping on the empty strip after the last tab appends at the end.
  elements.tabbarTabs.addEventListener('dragover', (event) => {
    if (draggedTabId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  elements.tabbarTabs.addEventListener('drop', (event) => {
    if (draggedTabId === null) return;
    event.preventDefault();
    reorderTab(draggedTabId, tabs.length);
    draggedTabId = null;
    clearDropMarkers();
  });

  function updateWatchedFiles() {
    api.setWatchedFiles(tabs.map((tab) => tab.filePath).filter(Boolean));
  }

  function persistSession() {
    localStorage.setItem('openTabs', JSON.stringify(tabs.map((tab) => tab.filePath).filter(Boolean)));
    const pane = activePane();
    const active = pane ? tabById(pane.tabId) : null;
    localStorage.setItem('activeTabPath', (active && active.filePath) || '');
  }

  // ---------- theme ----------

  const TITLEBAR_SYMBOL_COLORS = { light: '#3b424c', dark: '#e2e6ec' };

  function resolvedTheme() {
    return state.themePref === 'auto' ? state.systemTheme : state.themePref;
  }

  function applyThemeToPane(pane) {
    const editorUi = pane.el.querySelector('.toastui-editor-defaultUI');
    if (editorUi) editorUi.classList.toggle('toastui-editor-dark', resolvedTheme() === 'dark');
  }

  function applyTheme() {
    const theme = resolvedTheme();
    elements.body.dataset.theme = theme;
    elements.body.dataset.themePref = state.themePref;
    for (const pane of panes) applyThemeToPane(pane);
    api.setTitleBarSymbolColor(TITLEBAR_SYMBOL_COLORS[theme]);
  }

  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    state.themePref = order[(order.indexOf(state.themePref) + 1) % order.length];
    localStorage.setItem('themePref', state.themePref);
    applyTheme();
    showToast(t(`theme.${state.themePref}`));
  }

  // ---------- mode (markdown source / live WYSIWYG), per pane ----------

  function reflectEditorMode(mode) {
    for (const item of elements.modeSwitch.querySelectorAll('.segmented-item')) {
      item.classList.toggle('is-active', item.dataset.mode === mode);
      item.setAttribute('aria-selected', String(item.dataset.mode === mode));
    }
    positionThumb(elements.modeSwitch, elements.segmentedThumb, true);
  }

  function applyEditorMode(mode, { animate = true } = {}) {
    state.editorMode = mode;
    localStorage.setItem('editorMode', mode);
    const pane = activePane();
    if (pane) {
      pane.mode = mode;
      if (pane.editor.isMarkdownMode() !== (mode === 'markdown')) {
        pane.editor.changeMode(mode, true);
      }
    }
    reflectEditorMode(mode);
    if (!animate) positionThumb(elements.modeSwitch, elements.segmentedThumb, false);
  }

  function positionThumb(container, thumb, animate = true) {
    const active = container.querySelector('.segmented-item.is-active');
    if (!active) return;
    if (!animate) thumb.style.transition = 'none';
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
    if (!animate) requestAnimationFrame(() => { thumb.style.transition = ''; });
  }

  // ---------- document chrome & statistics (follow the active pane) -------

  function activeTabOfPane() {
    const pane = activePane();
    return pane ? tabById(pane.tabId) : null;
  }

  function updateDocumentChrome() {
    const tab = activeTabOfPane();

    if (!tab) {
      // No document open: keep the chrome completely quiet.
      elements.docName.textContent = '';
      elements.dirtyDot.hidden = true;
      elements.statusSaved.textContent = '';
      elements.statusSaved.classList.remove('is-unsaved');
      document.title = t('app.name');
      return;
    }

    const dirty = isTabDirty(tab);
    const name = tab.fileName || t('app.untitled');
    elements.docName.textContent = name;
    elements.dirtyDot.hidden = !dirty;

    let statusKey = 'status.saved';
    if (dirty) statusKey = tab.filePath ? 'status.saving' : 'status.unsaved';
    elements.statusSaved.textContent = t(statusKey);
    elements.statusSaved.classList.toggle('is-unsaved', dirty);

    document.title = `${dirty ? '• ' : ''}${name} — ${t('app.name')}`;
  }

  function updateStatistics() {
    const tab = activeTabOfPane();
    if (!tab) {
      elements.statusWords.textContent = '';
      elements.statusChars.textContent = '';
      elements.statusReading.textContent = '';
      return;
    }
    const text = getTabMarkdown(tab);
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    elements.statusWords.textContent = t('status.words', { count: words });
    elements.statusChars.textContent = t('status.characters', { count: text.length });
    elements.statusReading.textContent = t('status.readingTime', { minutes: Math.max(1, Math.ceil(words / 220)) });
  }

  // ---------- persistent history (cross-session undo) ----------
  // The editor's own Ctrl+Z/Ctrl+Y covers this session. On top of that each
  // tab keeps saved-state snapshots (stored by the main process in a hidden
  // %LOCALAPPDATA%\Rendl\history folder). When the in-session history has
  // nothing left to undo (content equals the baseline), Ctrl+Z steps back
  // through the persisted snapshots. Ctrl+Y walks forward again.

  async function initHistory(tab) {
    const shownIn = paneForTab(tab.id);
    tab.history = { stack: [], index: -1, baseline: getTabMarkdown(tab), pending: false };
    if (!tab.filePath) return;

    const entries = await api.historyGet(tab.filePath);
    if (!paneForTab(tab.id)) { tab.history.pending = true; return; } // hidden meanwhile
    const current = getTabMarkdown(tab);
    tab.history.stack = entries;
    if (tab.history.stack.length === 0 || tab.history.stack[tab.history.stack.length - 1] !== current) {
      tab.history.stack.push(current);
      api.historySave(tab.filePath, tab.history.stack);
    }
    tab.history.index = tab.history.stack.length - 1;
    void shownIn;
  }

  function recordHistory(tab, content) {
    if (!tab || !tab.filePath || tab.history.pending) return;
    const history = tab.history;
    if (history.stack[history.index] === content) return; // e.g. after a snapshot undo
    history.stack = history.stack.slice(0, history.index + 1);
    if (history.stack[history.stack.length - 1] !== content) history.stack.push(content);
    history.index = history.stack.length - 1;
    api.historySave(tab.filePath, history.stack);
  }

  function tryHistoryStep(direction) {
    const pane = activePane();
    const tab = pane ? tabById(pane.tabId) : null;
    if (!tab || !tab.filePath || tab.history.pending) return false;
    if (pane.editor.getMarkdown() !== tab.history.baseline) return false; // session history active
    const target = tab.history.index + direction;
    if (target < 0 || target >= tab.history.stack.length) return false;

    pane.loading = true;
    pane.editor.setMarkdown(tab.history.stack[target], false);
    pane.loading = false;
    tab.history.index = target;
    tab.history.baseline = pane.editor.getMarkdown();
    tab.content = tab.history.baseline;
    updateDocumentChrome();
    updateStatistics();
    scheduleAutosave(tab);
    return true;
  }

  // ---------- change handling & autosave ----------

  const AUTOSAVE_DELAY_MS = 900;
  const autosaveTimers = new Map();

  function handlePaneChange(pane) {
    if (pane.loading) return;
    const tab = tabById(pane.tabId);
    if (!tab) return;
    tab.content = pane.editor.getMarkdown();
    if (pane.id === activePaneId) {
      updateDocumentChrome();
      updateStatistics();
    }
    scheduleAutosave(tab);
  }

  function scheduleAutosave(tab) {
    if (!tab || !tab.filePath) return; // An untitled document is saved via Ctrl+S first.
    clearTimeout(autosaveTimers.get(tab.id));
    autosaveTimers.set(tab.id, setTimeout(() => {
      if (tabs.includes(tab) && tab.filePath && isTabDirty(tab)) saveTab(tab, { silent: true });
    }, AUTOSAVE_DELAY_MS));
  }

  // ---------- file actions ----------

  async function saveTab(tab, { silent = false } = {}) {
    if (!tab) return false;
    try {
      if (tab.filePath) {
        const markdown = getTabMarkdown(tab);
        const result = await api.saveFile(tab.filePath, serializeTabContent(tab, markdown));
        tab.savedContent = markdown;
        tab.content = markdown;
        recordHistory(tab, markdown);
        renderRecentList(result.recent);
        renderTabs();
        updateDocumentChrome();
        if (!silent) showToast(t('toast.saved', { name: result.name }));
        return true;
      }
      return saveTabAs(tab);
    } catch {
      showToast(t('error.saveFailed.message'));
      return false;
    }
  }

  async function saveTabAs(tab) {
    if (!tab) return false;
    try {
      const markdown = getTabMarkdown(tab);
      const result = await api.saveFileDialog(serializeTabContent(tab, markdown), tab.fileName || 'naamloos.md');
      if (!result) return false;
      tab.filePath = result.path;
      tab.fileName = result.name;
      tab.savedContent = markdown;
      tab.content = markdown;
      tab.history.pending = true;
      if (paneForTab(tab.id)) await initHistory(tab);
      renderRecentList(result.recent);
      renderTabs();
      updateWatchedFiles();
      updateDocumentChrome();
      persistSession();
      showToast(t('toast.saved', { name: result.name }));
      return true;
    } catch {
      showToast(t('error.saveFailed.message'));
      return false;
    }
  }

  async function openDocumentDialog() {
    try {
      const result = await api.openFileDialog();
      if (!result) return;
      const existing = tabs.find((tab) => tab.filePath === result.path);
      if (existing) { activateTab(existing.id); return; }
      const tab = makeTab(result);
      tabs.push(tab);
      renderRecentList(result.recent);
      renderTabs();
      updateWatchedFiles();
      activateTab(tab.id);
    } catch {
      showToast(t('error.openFailed.message'));
    }
  }

  // Saves every document; untitled dirty tabs get the keep/discard dialog.
  // Returns false when the user cancels.
  async function ensureAllTabsSettled() {
    for (const pane of panes) syncPaneIntoTab(pane);
    for (const tab of [...tabs]) {
      if (!isTabDirty(tab)) continue;
      if (tab.filePath) {
        if (!(await saveTab(tab, { silent: true }))) return false;
      } else {
        activateTab(tab.id);
        const choice = await api.confirmDiscard({ documentName: tab.fileName || t('app.untitled') });
        if (choice === 'cancel') return false;
        if (choice === 'save' && !(await saveTabAs(tab))) return false;
      }
    }
    return true;
  }

  // ---------- project ----------

  function renderProjectList() {
    const project = state.project;
    elements.projectName.textContent = project ? project.name : t('sidebar.project');
    elements.projectList.innerHTML = '';

    if (!project) {
      elements.projectEmpty.textContent = t('project.none');
      elements.projectEmpty.hidden = false;
      return;
    }
    if (project.files.length === 0) {
      elements.projectEmpty.textContent = t('project.empty');
      elements.projectEmpty.hidden = false;
      return;
    }
    elements.projectEmpty.hidden = true;

    const active = activeTabOfPane();
    let currentFolder = null;
    for (const file of project.files) {
      const separator = file.relative.includes('\\') ? '\\' : '/';
      const parts = file.relative.split(/[\\/]/);
      const folder = parts.length > 1 ? parts.slice(0, -1).join(separator) : '';
      if (folder !== currentFolder) {
        currentFolder = folder;
        if (folder) {
          const header = document.createElement('li');
          header.className = 'project-folder';
          header.textContent = folder;
          header.title = folder;
          elements.projectList.appendChild(header);
        }
      }

      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'project-item';
      if (active && active.filePath === file.path) button.classList.add('is-current');
      button.textContent = parts[parts.length - 1];
      button.title = file.path;
      button.addEventListener('click', () => openInTab(file.path));
      item.appendChild(button);
      elements.projectList.appendChild(item);
    }
  }

  async function openProjectDialog() {
    const project = await api.openFolderDialog();
    if (!project) return;
    state.project = project;
    localStorage.setItem('projectPath', project.root);
    applySidebarView('project');
    renderProjectList();
  }

  async function restoreProject() {
    const saved = localStorage.getItem('projectPath');
    if (!saved) return;
    const project = await api.scanProject(saved);
    if (project) state.project = project;
    renderProjectList();
  }

  async function refreshProject() {
    if (!state.project) return;
    const project = await api.scanProject(state.project.root);
    if (project) state.project = project;
    renderProjectList();
  }

  function applySidebarView(view, { animate = true } = {}) {
    state.sidebarView = view;
    localStorage.setItem('sidebarView', view);
    elements.viewProject.hidden = view !== 'project';
    elements.viewRecent.hidden = view !== 'recent';
    for (const item of elements.sidebarSwitch.querySelectorAll('.segmented-item')) {
      item.classList.toggle('is-active', item.dataset.view === view);
    }
    positionThumb(elements.sidebarSwitch, elements.sidebarThumb, animate);
  }

  // ---------- recent files ----------

  function renderRecentList(list) {
    if (!Array.isArray(list)) return;
    elements.recentList.innerHTML = '';
    elements.recentEmpty.hidden = list.length > 0;

    const active = activeTabOfPane();
    for (const filePath of list) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'recent-item';
      if (active && filePath === active.filePath) button.classList.add('is-current');

      const name = document.createElement('span');
      name.className = 'recent-item-name';
      name.textContent = filePath.split(/[\\/]/).pop();

      const pathLabel = document.createElement('span');
      pathLabel.className = 'recent-item-path';
      pathLabel.textContent = filePath;
      pathLabel.title = filePath;

      button.append(name, pathLabel);
      button.addEventListener('click', () => openInTab(filePath));
      item.appendChild(button);
      elements.recentList.appendChild(item);
    }
  }

  async function refreshRecentList() {
    renderRecentList(await api.listRecentFiles());
  }

  // ---------- toast, sidebar ----------

  let toastTimer = null;
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2200);
  }

  function toggleSidebar() {
    elements.sidebar.hidden = !elements.sidebar.hidden;
    if (!elements.sidebar.hidden) {
      refreshRecentList();
      refreshProject();
      applySidebarView(state.sidebarView, { animate: false });
    }
  }

  // ---------- event wiring ----------

  $('#btn-new').addEventListener('click', newTab);
  $('#btn-new-tab').addEventListener('click', newTab);
  $('#btn-open').addEventListener('click', openDocumentDialog);
  $('#btn-save').addEventListener('click', () => saveTab(activeTabOfPane()));
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  $('#btn-theme').addEventListener('click', cycleTheme);
  $('#btn-split').addEventListener('click', splitView);
  $('#btn-clear-recent').addEventListener('click', async () => renderRecentList(await api.clearRecentFiles()));
  $('#btn-open-project').addEventListener('click', openProjectDialog);

  for (const item of elements.sidebarSwitch.querySelectorAll('.segmented-item')) {
    item.addEventListener('click', () => applySidebarView(item.dataset.view));
  }

  const installButton = $('#btn-install');
  installButton.addEventListener('click', async () => {
    const installed = await api.installApp();
    if (installed) installButton.hidden = true;
  });

  const updateButton = $('#btn-update');
  api.onUpdateAvailable(({ version }) => {
    updateButton.textContent = t('update.available', { version });
    updateButton.hidden = false;
  });
  // Download progress — also covers the dialog-initiated update, where the
  // button was never shown yet.
  api.onUpdateProgress((percent) => {
    updateButton.hidden = false;
    updateButton.disabled = true;
    updateButton.textContent = t('update.downloadingPct', { pct: percent });
  });
  updateButton.addEventListener('click', async () => {
    // Unsaved untitled documents would be lost by the restart.
    if (!(await ensureAllTabsSettled())) return;
    updateButton.disabled = true;
    updateButton.textContent = t('update.downloading');
    const started = await api.installUpdate();
    if (!started) {
      updateButton.disabled = false;
      updateButton.hidden = true;
    }
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
    if (key === 'n' || key === 't') { event.preventDefault(); newTab(); }
    else if (key === 'o') { event.preventDefault(); openDocumentDialog(); }
    else if (key === 'w') {
      event.preventDefault();
      const tab = activeTabOfPane();
      if (tab) closeTab(tab.id);
    }
    else if (key === 'tab') { event.preventDefault(); cycleTab(event.shiftKey ? -1 : 1); }
    else if (key === '\\') { event.preventDefault(); splitView(); }
    else if (key === 's' && event.shiftKey) { event.preventDefault(); saveTabAs(activeTabOfPane()); }
    else if (key === 's') { event.preventDefault(); saveTab(activeTabOfPane()); }
    else if (key === 'e') {
      event.preventDefault();
      const pane = activePane();
      applyEditorMode(pane && pane.mode === 'markdown' ? 'wysiwyg' : 'markdown');
    }
    else if (key === 'b' && event.shiftKey) { event.preventDefault(); toggleSidebar(); }
  }, true);

  // Drag & drop of Markdown files onto the window (capture phase, so the
  // editor's own image-drop handling doesn't swallow file drops).
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    // Only externally dragged files get the drop indicator, not tab drags.
    const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
    if (types.includes('Files')) elements.dropIndicator.hidden = false;
  }, true);
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) elements.dropIndicator.hidden = true;
  }, true);
  window.addEventListener('drop', (event) => {
    elements.dropIndicator.hidden = true;
    const files = event.dataTransfer ? [...event.dataTransfer.files] : [];
    const paths = files.map((file) => api.getPathForFile(file))
      .filter((filePath) => filePath && /\.(md|markdown|mdown|txt)$/i.test(filePath));
    if (paths.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    (async () => {
      for (const filePath of paths) await openInTab(filePath);
    })();
  }, true);

  window.addEventListener('resize', () => {
    positionThumb(elements.modeSwitch, elements.segmentedThumb, false);
    if (!elements.sidebar.hidden) positionThumb(elements.sidebarSwitch, elements.sidebarThumb, false);
  });

  // Close flow: settle every tab first, then let the main process close us.
  api.onCloseRequested(async () => {
    if (!(await ensureAllTabsSettled())) return; // user cancelled
    api.confirmClose({ dirty: false, documentName: '', filePath: null, content: '' });
  });

  // Before switching to the freshly installed copy, settle all documents.
  api.onSettleRequested(async () => {
    api.settleResponse(await ensureAllTabsSettled());
  });

  api.onOpenExternalFile((filePath) => openInTab(filePath));

  // Live reload: the main process pushes the newest content when an open
  // file changes on disk. Our own (auto)saves arrive here too, but match
  // the current content and are absorbed silently.
  api.onFileChangedOnDisk(({ path, content }) => {
    const tab = tabs.find((entry) => entry.filePath === path);
    if (!tab) return;
    const normalized = normalizeContent(content);
    const pane = paneForTab(tab.id);

    if (!pane) {
      // Hidden tab: adopt the disk state unless it has unsaved changes.
      if (!isTabDirty(tab)) {
        tab.eol = detectEol(content);
        tab.content = normalized;
        tab.savedContent = normalized;
        tab.needsBaseline = true;
        tab.history.pending = true;
      }
      return;
    }

    if (normalized === tab.savedContent || normalized === pane.editor.getMarkdown()) {
      tab.savedContent = pane.editor.getMarkdown();
      if (pane.id === activePaneId) updateDocumentChrome();
      return;
    }

    const scrollTop = pane.editor.getScrollTop();
    pane.loading = true;
    tab.eol = detectEol(content);
    pane.editor.setMarkdown(normalized, false);
    tab.savedContent = pane.editor.getMarkdown();
    tab.content = tab.savedContent;
    pane.loading = false;
    tab.history.baseline = tab.savedContent;
    recordHistory(tab, tab.history.baseline);
    if (pane.id === activePaneId) {
      updateDocumentChrome();
      updateStatistics();
    }
    pane.editor.setScrollTop(scrollTop);
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

  const firstPane = createPane();
  activePaneId = firstPane.id;
  applyTheme();
  reflectEditorMode(state.editorMode);
  positionThumb(elements.modeSwitch, elements.segmentedThumb, false);
  refreshRecentList();
  restoreProject();

  // Restore the previous session's tabs, then any file passed on startup.
  let restoredPaths = [];
  try { restoredPaths = JSON.parse(localStorage.getItem('openTabs') || '[]'); } catch { /* fresh start */ }
  for (const filePath of restoredPaths) {
    await openInTab(filePath, { background: true });
  }

  const startupFile = await api.getStartupFile();
  if (startupFile) {
    await openInTab(startupFile);
  } else if (tabs.length > 0) {
    const preferred = tabs.find((tab) => tab.filePath === localStorage.getItem('activeTabPath'));
    activateTab((preferred || tabs[0]).id, { focus: false });
  }

  if (tabs.length === 0 && api.demoContent) {
    const tab = makeTab({ name: 'voorbeeld.md', content: api.demoContent });
    tabs.push(tab);
    activateTab(tab.id, { focus: false });
  }
  // With no tabs at all the pane simply shows its calm empty state.

  renderTabs();
  updateDocumentChrome();
  updateStatistics();

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
        '- Projecten, tabbladen, split view en automatisch opslaan\n',
        '> Dit is een voorbeelddocument in de browserdemo.\n',
        '```js\nfunction greet(name) {\n  return `Hallo, ${name}!`;\n}\n```\n',
        '| Sneltoets | Actie |\n| --- | --- |\n| Ctrl+S | Opslaan |\n| Ctrl+\\\\ | Splitsen |\n',
        '- [x] Ontwerp\n- [ ] Vertalingen\n',
      ].join('\n'),
      openFileDialog: async () => null,
      readFile: async () => { throw new Error('demo'); },
      saveFile: async () => { throw new Error('demo'); },
      saveFileDialog: async () => null,
      getStartupFile: async () => null,
      getPathForFile: () => null,
      setWatchedFiles: () => {},
      onFileChangedOnDisk: () => {},
      openFolderDialog: async () => null,
      scanProject: async () => null,
      listRecentFiles: async () => [],
      clearRecentFiles: async () => [],
      getSystemTheme: async () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
      setTitleBarSymbolColor: () => {},
      onSystemThemeChanged: () => {},
      onCloseRequested: () => {},
      confirmClose: async () => {},
      onSettleRequested: () => {},
      settleResponse: () => {},
      confirmDiscard: async () => 'discard',
      onOpenExternalFile: () => {},
      openExternal: (url) => window.open(url, '_blank'),
      canInstall: async () => false,
      installApp: async () => false,
      historyGet: async () => [],
      historySave: async () => {},
      onUpdateAvailable: () => {},
      onUpdateProgress: () => {},
      installUpdate: async () => false,
    };
  }
})();
