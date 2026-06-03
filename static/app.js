const state = {
  threads: [],
  page: 1,
  pageSize: 5,
  total: 0,
};
const DEFAULT_LOCALE = "zh-CN";
const SUPPORTED_LOCALES = new Set(["zh-CN", "en-US"]);

const dbPath = document.querySelector("#dbPath");
const selectDbBtn = document.querySelector("#selectDbBtn");
const languageSelect = document.querySelector("#languageSelect");
const threadTable = document.querySelector("#threadTable");
const threadBody = document.querySelector("#threadBody");
const searchInput = document.querySelector("#searchInput");
const providerControl = document.querySelector("#providerControl");
const providerInput = document.querySelector("#providerInput");
const refreshBtn = document.querySelector("#refreshBtn");
const applyBtn = document.querySelector("#applyBtn");
const selectArchivedBtn = document.querySelector("#selectArchivedBtn");
const toggleArchivedBtn = document.querySelector("#toggleArchivedBtn");
const deleteArchivedBtn = document.querySelector("#deleteArchivedBtn");
const selectAll = document.querySelector("#selectAll");
const message = document.querySelector("#message");
const providerList = document.querySelector("#providerList");
const rolloutDialog = document.querySelector("#rolloutDialog");
const editorThreadId = document.querySelector("#editorThreadId");
const rolloutPathInput = document.querySelector("#rolloutPathInput");
const rolloutEditor = document.querySelector("#rolloutEditor");
const closeEditorBtn = document.querySelector("#closeEditorBtn");
const selectPathBtn = document.querySelector("#selectPathBtn");
const rawLink = document.querySelector("#rawLink");
const highlightLayer = document.querySelector("#highlightLayer");
const matchStatus = document.querySelector("#matchStatus");
const locateMatchBtn = document.querySelector("#locateMatchBtn");
const openBackupBtn = document.querySelector("#openBackupBtn");
const keepBackupsBtn = document.querySelector("#keepBackupsBtn");
const clearBackupsBtn = document.querySelector("#clearBackupsBtn");
const backupActions = document.querySelector("#backupActions");
const clearBackupDialog = document.querySelector("#clearBackupDialog");
const closeClearDialogBtn = document.querySelector("#closeClearDialogBtn");
const cancelClearBtn = document.querySelector("#cancelClearBtn");
const confirmClearBtn = document.querySelector("#confirmClearBtn");
const clearConfirmInput = document.querySelector("#clearConfirmInput");
const deleteArchivedDialog = document.querySelector("#deleteArchivedDialog");
const closeDeleteArchivedDialogBtn = document.querySelector("#closeDeleteArchivedDialogBtn");
const cancelDeleteArchivedBtn = document.querySelector("#cancelDeleteArchivedBtn");
const confirmDeleteArchivedBtn = document.querySelector("#confirmDeleteArchivedBtn");
const deleteArchivedConfirmInput = document.querySelector("#deleteArchivedConfirmInput");
const titleDialog = document.querySelector("#titleDialog");
const closeTitleDialogBtn = document.querySelector("#closeTitleDialogBtn");
const fullTitleText = document.querySelector("#fullTitleText");
const editorWrap = document.querySelector("#editorWrap");
const wrapToggle = document.querySelector("#wrapToggle");
const pageSizeSelect = document.querySelector("#pageSizeSelect");
const pageStatus = document.querySelector("#pageStatus");
const prevPageBtn = document.querySelector("#prevPageBtn");
const nextPageBtn = document.querySelector("#nextPageBtn");

let currentEditorId = null;
let modelProviderMatches = [];
let currentMatchIndex = 0;
let archivedMode = false;
let currentLocale = localStorage.getItem("locale") || DEFAULT_LOCALE;
let translations = {};

function t(key, values = {}) {
  const template = translations[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : `{${name}}`
  );
}

async function loadLocale(locale) {
  const target = SUPPORTED_LOCALES.has(locale) ? locale : DEFAULT_LOCALE;
  const res = await fetch(`/locales/${target}.json`);
  if (!res.ok) throw new Error(`Failed to load locale: ${target}`);
  currentLocale = target;
  translations = await res.json();
  localStorage.setItem("locale", target);
}

function applyTranslations() {
  document.documentElement.lang = currentLocale;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  languageSelect.value = currentLocale;
}

async function switchLocale(locale) {
  await loadLocale(locale);
  applyTranslations();
  renderArchiveControls();
  renderRows();
  renderHighlights();
  await loadThreads();
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

async function loadBackupStatus() {
  try {
    const res = await fetch("/api/backups");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.backupStatusError"));
    return data;
  } catch (error) {
    setMessage(error.message, true);
    return null;
  }
}

function providerHistory() {
  try {
    const values = JSON.parse(localStorage.getItem("modelProviderHistory") || "[]");
    return Array.isArray(values) ? values.filter((item) => typeof item === "string" && item) : [];
  } catch {
    return [];
  }
}

function rememberProvider(value) {
  const provider = value.trim();
  if (!provider) return;
  const values = [provider, ...providerHistory().filter((item) => item !== provider)].slice(0, 30);
  localStorage.setItem("modelProviderHistory", JSON.stringify(values));
  renderProviderOptions();
}

function renderProviderOptions(extraValues = []) {
  const values = new Set(["openai", "custom", ...extraValues, ...providerHistory()]);
  providerList.innerHTML = "";
  [...values].filter(Boolean).sort().forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    providerList.append(option);
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function findModelProviderMatches(value) {
  const matches = [];
  const pattern = /"model_provider"\s*:\s*"[^"]*"/g;
  let match = pattern.exec(value);
  while (match) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(value);
  }
  return matches;
}

function renderHighlights() {
  const value = rolloutEditor.value;
  modelProviderMatches = findModelProviderMatches(value);
  if (currentMatchIndex >= modelProviderMatches.length) {
    currentMatchIndex = 0;
  }

  let html = "";
  let cursor = 0;
  for (const item of modelProviderMatches) {
    html += escapeHtml(value.slice(cursor, item.start));
    html += `<mark>${escapeHtml(value.slice(item.start, item.end))}</mark>`;
    cursor = item.end;
  }
  html += escapeHtml(value.slice(cursor));
  highlightLayer.innerHTML = html || " ";
  highlightLayer.scrollTop = rolloutEditor.scrollTop;
  highlightLayer.scrollLeft = rolloutEditor.scrollLeft;

  const found = modelProviderMatches.length > 0;
  locateMatchBtn.disabled = !found;
  matchStatus.classList.toggle("missing", !found);
  matchStatus.textContent = found
    ? t("match.found", { count: modelProviderMatches.length })
    : t("match.missing");
}

function editorMetrics() {
  const style = getComputedStyle(rolloutEditor);
  const probe = document.createElement("span");
  probe.textContent = "MMMMMMMMMM";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.letterSpacing = style.letterSpacing;
  document.body.append(probe);
  const charWidth = probe.getBoundingClientRect().width / 10 || 7.2;
  probe.remove();
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const horizontalPadding =
    parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
  return {
    charWidth,
    lineHeight,
    usableWidth: Math.max(1, rolloutEditor.clientWidth - horizontalPadding),
  };
}

function applyWrapMode() {
  const enabled = wrapToggle.checked;
  editorWrap.classList.toggle("wrap-lines", enabled);
  editorWrap.classList.toggle("no-wrap", !enabled);
  rolloutEditor.wrap = enabled ? "soft" : "off";
  localStorage.setItem("rolloutEditorWrap", enabled ? "1" : "0");
  renderHighlights();
  if (modelProviderMatches.length > 0) {
    focusMatch(0);
  }
}

function focusMatch(offset) {
  if (modelProviderMatches.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex + offset + modelProviderMatches.length) % modelProviderMatches.length;
  const item = modelProviderMatches[currentMatchIndex];
  rolloutEditor.focus();
  rolloutEditor.setSelectionRange(item.start, item.end);

  const before = rolloutEditor.value.slice(0, item.start);
  const lines = before.split("\n");
  const line = lines.length - 1;
  const column = lines[lines.length - 1].length;
  const metrics = editorMetrics();
  let visualLine = line;
  if (wrapToggle.checked) {
    const charsPerLine = Math.max(1, Math.floor(metrics.usableWidth / metrics.charWidth));
    visualLine += Math.floor(column / charsPerLine);
    rolloutEditor.scrollLeft = 0;
  } else {
    const targetLeft = column * metrics.charWidth - rolloutEditor.clientWidth / 3;
    rolloutEditor.scrollLeft = Math.max(0, targetLeft);
  }
  rolloutEditor.scrollTop = Math.max(0, visualLine * metrics.lineHeight - rolloutEditor.clientHeight / 3);
  highlightLayer.scrollTop = rolloutEditor.scrollTop;
  highlightLayer.scrollLeft = rolloutEditor.scrollLeft;
}

function formatTime(seconds) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return date.toLocaleString();
}

function formatTokens(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function shortTitle(value) {
  const text = value || "";
  return text.length > 38 ? `${text.slice(0, 38)}...` : text;
}

function openTitleDialog(value) {
  fullTitleText.textContent = value || "";
  if (!titleDialog.open) {
    titleDialog.showModal();
  }
}

function selectedIds() {
  return [...document.querySelectorAll("tbody input[type='checkbox']:checked")].map((box) => box.value);
}

function visibleCheckboxes() {
  return [...document.querySelectorAll("tbody input[type='checkbox']")];
}

function selectVisibleRows() {
  visibleCheckboxes().forEach((box) => {
    box.checked = true;
  });
  selectAll.checked = visibleCheckboxes().length > 0;
}

function renderArchiveControls() {
  if (toggleArchivedBtn) {
    toggleArchivedBtn.textContent = archivedMode ? t("archive.back") : t("archive.view");
  }
  deleteArchivedBtn?.classList.toggle("hidden", !archivedMode);
  applyBtn.classList.toggle("hidden", archivedMode);
  selectArchivedBtn?.classList.toggle("hidden", archivedMode);
  providerControl.classList.toggle("hidden", archivedMode);
  backupActions.classList.toggle("hidden", archivedMode);
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const end = Math.min(state.total, state.page * state.pageSize);
  pageStatus.textContent = t("pagination.status", {
    page: state.page,
    totalPages,
    start,
    end,
    total: state.total,
  });
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = state.page >= totalPages;
  pageSizeSelect.value = String(state.pageSize);
}

function renderRows() {
  threadBody.innerHTML = "";
  for (const item of state.threads) {
    const row = document.createElement("tr");

    const checkCell = document.createElement("td");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.value = item.id;
    checkCell.append(check);

    const title = document.createElement("td");
    const fullTitle = item.title || item.id;
    title.className = "title-cell";
    title.textContent = shortTitle(fullTitle);
    title.title = t("titleCell.tooltip");
    title.addEventListener("dblclick", () => openTitleDialog(fullTitle));

    const provider = document.createElement("td");
    const providerBadge = document.createElement("span");
    providerBadge.className = "provider";
    providerBadge.textContent = item.model_provider;
    provider.append(providerBadge);

    const rolloutProvider = document.createElement("td");
    rolloutProvider.textContent = item.rollout_provider || "";
    if (!item.rollout_exists) {
      rolloutProvider.textContent = t("row.fileMissing");
      rolloutProvider.className = "missing";
    }
    if (item.model_provider !== item.rollout_provider) {
      provider.classList.add("owner-mismatch");
      rolloutProvider.classList.add("owner-mismatch");
    }

    const tokens = document.createElement("td");
    tokens.className = "number-cell";
    tokens.textContent = formatTokens(item.tokens_used);

    const updated = document.createElement("td");
    updated.textContent = formatTime(item.updated_at);

    const cwd = document.createElement("td");
    cwd.className = "mono";
    cwd.textContent = item.cwd;

    const rollout = document.createElement("td");
    const pathText = document.createElement("div");
    pathText.className = "mono path-text";
    pathText.textContent = item.rollout_path;
    rollout.append(pathText);

    const actions = document.createElement("td");
    const pathActions = document.createElement("div");
    pathActions.className = "path-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = t("button.view");
    editButton.addEventListener("click", () => openRolloutEditor(item.id));
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.textContent = t("button.selectFile");
    selectButton.addEventListener("click", () => selectRolloutFile(item.id));
    pathActions.append(editButton, selectButton);
    actions.append(pathActions);

    row.append(checkCell, title, provider, rolloutProvider, tokens, updated, cwd, rollout, actions);
    threadBody.append(row);
  }
  selectAll.checked = false;
  renderPagination();
}

async function loadThreads() {
  refreshBtn.disabled = true;
  setMessage(t("message.loading"));
  try {
    const params = new URLSearchParams({
      search: searchInput.value.trim(),
      page: String(state.page),
      page_size: String(state.pageSize),
      archived: archivedMode ? "1" : "0",
    });
    const res = await fetch(`/api/threads?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.loadError"));
    state.threads = data.threads;
    state.page = data.page;
    state.pageSize = data.page_size;
    state.total = data.total;
    dbPath.textContent = data.db_path;
    renderRows();
    renderArchiveControls();
    renderProviderOptions(data.threads.map((item) => item.model_provider));
    setMessage(
      t("message.loaded", {
        area: archivedMode ? t("message.areaArchived") : t("message.areaActive"),
        count: state.threads.length,
      })
    );
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    refreshBtn.disabled = false;
  }
}

async function archiveSelectedThreads() {
  if (archivedMode) return;
  const ids = selectedIds();
  if (ids.length === 0) {
    setMessage(t("message.needActiveSelection"), true);
    return;
  }

  if (selectArchivedBtn) {
    selectArchivedBtn.disabled = true;
  }
  setMessage(t("message.archiving"));
  try {
    const res = await fetch("/api/threads/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.archiveError"));
    await loadThreads();
    setMessage(t("message.archived", { count: data.archived, path: data.db_backup }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    if (selectArchivedBtn) {
      selectArchivedBtn.disabled = false;
    }
  }
}

async function selectDatabaseFile() {
  selectDbBtn.disabled = true;
  setMessage(t("message.selectingDatabase"));
  try {
    const res = await fetch("/api/database/select", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.selectDatabaseError"));
    if (!data.selected) {
      setMessage(t("message.selectDatabaseCanceled"));
      return;
    }
    state.page = 1;
    await loadThreads();
    setMessage(t("message.databaseSelected", { path: data.db_path }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    selectDbBtn.disabled = false;
  }
}

async function toggleArchivedMode() {
  archivedMode = !archivedMode;
  state.page = 1;
  await loadThreads();
}

async function applyProvider() {
  const ids = selectedIds();
  const provider = providerInput.value.trim();
  if (ids.length === 0) {
    setMessage(t("message.needSelection"), true);
    return;
  }
  if (!provider) {
    setMessage(t("message.providerRequired"), true);
    return;
  }

  applyBtn.disabled = true;
  setMessage(t("message.updatingProvider"));
  try {
    const res = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, provider }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.updateError"));
    rememberProvider(provider);
    await loadThreads();
    setMessage(t("message.updated", { count: data.updated, path: data.db_backup }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    applyBtn.disabled = false;
  }
}

async function openRolloutEditor(id) {
  currentEditorId = id;
  currentMatchIndex = 0;
  editorThreadId.textContent = id;
  rolloutEditor.value = t("message.loading");
  renderHighlights();
  rolloutPathInput.value = "";
  rawLink.href = `/api/rollout/raw?id=${encodeURIComponent(id)}`;
  if (!rolloutDialog.open) {
    rolloutDialog.showModal();
  }
  try {
    const res = await fetch(`/api/rollout?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.readError"));
    rolloutPathInput.value = data.rollout_path;
    rolloutEditor.value = data.content;
    renderHighlights();
    focusMatch(0);
  } catch (error) {
    rolloutEditor.value = "";
    renderHighlights();
    setMessage(error.message, true);
  }
}

async function selectRolloutFile(id = currentEditorId) {
  if (!id) return;
  setMessage(t("message.selectingFile"));
  try {
    const res = await fetch("/api/rollout/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.selectFileError"));
    if (!data.selected && !data.rollout_path) {
      setMessage(t("message.selectFileCanceled"));
      return;
    }
    if (currentEditorId === id && data.rollout_path) {
      rolloutPathInput.value = data.rollout_path;
      await openRolloutEditor(id);
    } else {
      await loadThreads();
    }
    setMessage(t("message.rolloutPathUpdated", { path: data.rollout_path }));
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function openBackupDirectory() {
  openBackupBtn.disabled = true;
  try {
    const res = await fetch("/api/backups/open", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.openBackupError"));
    setMessage(t("message.openedBackup", { path: data.backup_root }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    openBackupBtn.disabled = false;
  }
}

async function keepThreeBackups() {
  if (!window.confirm(t("message.keepBackupsConfirm"))) return;
  keepBackupsBtn.disabled = true;
  try {
    const res = await fetch("/api/backups/keep3", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.cleanupBackupsError"));
    setMessage(t("message.cleanupBackupsDone", { deleted: data.deleted.length, count: data.count }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    keepBackupsBtn.disabled = false;
  }
}

function openClearBackupDialog() {
  clearConfirmInput.value = "";
  if (!clearBackupDialog.open) {
    clearBackupDialog.showModal();
  }
  clearConfirmInput.focus();
}

async function clearAllBackups() {
  const confirmText = clearConfirmInput.value;
  if (confirmText !== t("confirm.clearToken")) {
    setMessage(t("message.clearConfirmMismatch"), true);
    return;
  }
  confirmClearBtn.disabled = true;
  try {
    const res = await fetch("/api/backups/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm_text: confirmText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.clearBackupsError"));
    clearBackupDialog.close();
    setMessage(t("message.clearBackupsDone", { deleted: data.deleted.length, count: data.count }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    confirmClearBtn.disabled = false;
  }
}

function openDeleteArchivedDialog() {
  if (!archivedMode) return;
  selectVisibleRows();
  if (selectedIds().length === 0) {
    setMessage(t("message.noArchivedRows"), true);
    return;
  }
  deleteArchivedConfirmInput.value = "";
  if (!deleteArchivedDialog.open) {
    deleteArchivedDialog.showModal();
  }
  deleteArchivedConfirmInput.focus();
}

async function deleteSelectedArchived() {
  const ids = selectedIds();
  const confirmText = deleteArchivedConfirmInput.value;
  if (confirmText !== t("confirm.deleteToken")) {
    setMessage(t("message.deleteConfirmMismatch"), true);
    return;
  }
  if (ids.length === 0) {
    setMessage(t("message.needArchivedSelection"), true);
    return;
  }

  confirmDeleteArchivedBtn.disabled = true;
  try {
    const res = await fetch("/api/threads/delete-archived", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, confirm_text: confirmText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("message.deleteArchivedError"));
    deleteArchivedDialog.close();
    await loadThreads();
    setMessage(t("message.deletedArchived", { count: data.deleted, path: data.db_backup }));
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    confirmDeleteArchivedBtn.disabled = false;
  }
}

function goToPage(page) {
  state.page = Math.max(1, page);
  loadThreads();
}

function changePageSize() {
  state.pageSize = Number(pageSizeSelect.value);
  state.page = 1;
  loadThreads();
}

function columnStorageKey(column) {
  return `threadColumnWidth:${column}`;
}

function applyColumnWidth(column, width) {
  const col = threadTable.querySelector(`col[data-column="${column}"]`);
  if (!col) return;
  col.style.width = `${width}px`;
}

function initializeColumnWidths() {
  threadTable.querySelectorAll("col[data-column]").forEach((col) => {
    const column = col.dataset.column;
    const stored = Number(localStorage.getItem(columnStorageKey(column)));
    if (stored >= 80) {
      applyColumnWidth(column, stored);
    }
  });
}

function initializeColumnResizers() {
  document.querySelectorAll("th[data-resizable]").forEach((header) => {
    const column = header.dataset.resizable;
    const handle = document.createElement("span");
    handle.className = "column-resizer";
    handle.setAttribute("aria-hidden", "true");
    header.append(handle);

    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = header.getBoundingClientRect().width;

      const onMove = (moveEvent) => {
        const nextWidth = Math.max(80, Math.round(startWidth + moveEvent.clientX - startX));
        applyColumnWidth(column, nextWidth);
      };

      const onUp = () => {
        const width = Math.round(header.getBoundingClientRect().width);
        localStorage.setItem(columnStorageKey(column), String(width));
        document.body.classList.remove("resizing-column");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.body.classList.add("resizing-column");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

let timer = null;
searchInput.addEventListener("input", () => {
  window.clearTimeout(timer);
  state.page = 1;
  timer = window.setTimeout(loadThreads, 250);
});
refreshBtn.addEventListener("click", loadThreads);
selectDbBtn.addEventListener("click", selectDatabaseFile);
applyBtn.addEventListener("click", applyProvider);
selectArchivedBtn?.addEventListener("click", archiveSelectedThreads);
toggleArchivedBtn?.addEventListener("click", toggleArchivedMode);
deleteArchivedBtn?.addEventListener("click", openDeleteArchivedDialog);
providerInput.addEventListener("change", () => rememberProvider(providerInput.value));
closeEditorBtn.addEventListener("click", () => rolloutDialog.close());
selectPathBtn.addEventListener("click", () => selectRolloutFile());
locateMatchBtn.addEventListener("click", () => focusMatch(1));
openBackupBtn.addEventListener("click", openBackupDirectory);
keepBackupsBtn.addEventListener("click", keepThreeBackups);
clearBackupsBtn.addEventListener("click", openClearBackupDialog);
closeClearDialogBtn.addEventListener("click", () => clearBackupDialog.close());
cancelClearBtn.addEventListener("click", () => clearBackupDialog.close());
confirmClearBtn.addEventListener("click", clearAllBackups);
closeDeleteArchivedDialogBtn.addEventListener("click", () => deleteArchivedDialog.close());
cancelDeleteArchivedBtn.addEventListener("click", () => deleteArchivedDialog.close());
confirmDeleteArchivedBtn.addEventListener("click", deleteSelectedArchived);
closeTitleDialogBtn.addEventListener("click", () => titleDialog.close());
wrapToggle.addEventListener("change", applyWrapMode);
pageSizeSelect.addEventListener("change", changePageSize);
prevPageBtn.addEventListener("click", () => goToPage(state.page - 1));
nextPageBtn.addEventListener("click", () => goToPage(state.page + 1));
languageSelect.addEventListener("change", () => switchLocale(languageSelect.value));
rolloutEditor.addEventListener("input", renderHighlights);
rolloutEditor.addEventListener("scroll", () => {
  highlightLayer.scrollTop = rolloutEditor.scrollTop;
  highlightLayer.scrollLeft = rolloutEditor.scrollLeft;
});
selectAll.addEventListener("change", () => {
  document.querySelectorAll("tbody input[type='checkbox']").forEach((box) => {
    box.checked = selectAll.checked;
  });
});

async function initializeApp() {
  await loadLocale(currentLocale);
  applyTranslations();
  renderProviderOptions();
  initializeColumnWidths();
  initializeColumnResizers();
  wrapToggle.checked = localStorage.getItem("rolloutEditorWrap") !== "0";
  applyWrapMode();
  await loadThreads();
  loadBackupStatus();
}

initializeApp().catch((error) => setMessage(error.message, true));
