const state = {
  threads: [],
};

const dbPath = document.querySelector("#dbPath");
const threadBody = document.querySelector("#threadBody");
const searchInput = document.querySelector("#searchInput");
const providerInput = document.querySelector("#providerInput");
const refreshBtn = document.querySelector("#refreshBtn");
const applyBtn = document.querySelector("#applyBtn");
const selectAll = document.querySelector("#selectAll");
const message = document.querySelector("#message");
const providerList = document.querySelector("#providerList");
const rolloutDialog = document.querySelector("#rolloutDialog");
const editorThreadId = document.querySelector("#editorThreadId");
const rolloutPathInput = document.querySelector("#rolloutPathInput");
const rolloutEditor = document.querySelector("#rolloutEditor");
const closeEditorBtn = document.querySelector("#closeEditorBtn");
const saveRolloutBtn = document.querySelector("#saveRolloutBtn");
const selectPathBtn = document.querySelector("#selectPathBtn");
const savePathBtn = document.querySelector("#savePathBtn");
const rawLink = document.querySelector("#rawLink");
const highlightLayer = document.querySelector("#highlightLayer");
const matchStatus = document.querySelector("#matchStatus");
const prevMatchBtn = document.querySelector("#prevMatchBtn");
const nextMatchBtn = document.querySelector("#nextMatchBtn");
const openBackupBtn = document.querySelector("#openBackupBtn");
const keepBackupsBtn = document.querySelector("#keepBackupsBtn");
const clearBackupsBtn = document.querySelector("#clearBackupsBtn");
const clearBackupDialog = document.querySelector("#clearBackupDialog");
const closeClearDialogBtn = document.querySelector("#closeClearDialogBtn");
const cancelClearBtn = document.querySelector("#cancelClearBtn");
const confirmClearBtn = document.querySelector("#confirmClearBtn");
const clearConfirmInput = document.querySelector("#clearConfirmInput");

let currentEditorId = null;
let modelProviderMatches = [];
let currentMatchIndex = 0;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

async function loadBackupStatus() {
  try {
    const res = await fetch("/api/backups");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "读取备份状态失败");
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
  prevMatchBtn.disabled = !found;
  nextMatchBtn.disabled = !found;
  matchStatus.classList.toggle("missing", !found);
  matchStatus.textContent = found
    ? `找到 model_provider：${modelProviderMatches.length} 处`
    : "可能未找到 model_provider 文本，请自行判断文件是否正确";
}

function focusMatch(offset) {
  if (modelProviderMatches.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex + offset + modelProviderMatches.length) % modelProviderMatches.length;
  const item = modelProviderMatches[currentMatchIndex];
  rolloutEditor.focus();
  rolloutEditor.setSelectionRange(item.start, item.end);

  const before = rolloutEditor.value.slice(0, item.start);
  const line = before.split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(rolloutEditor).lineHeight) || 18;
  rolloutEditor.scrollTop = Math.max(0, line * lineHeight - rolloutEditor.clientHeight / 3);
  highlightLayer.scrollTop = rolloutEditor.scrollTop;
  highlightLayer.scrollLeft = rolloutEditor.scrollLeft;
}

function formatTime(seconds) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return date.toLocaleString();
}

function selectedIds() {
  return [...document.querySelectorAll("tbody input[type='checkbox']:checked")].map((box) => box.value);
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
    title.textContent = item.title || item.id;

    const provider = document.createElement("td");
    const providerBadge = document.createElement("span");
    providerBadge.className = "provider";
    providerBadge.textContent = item.model_provider;
    provider.append(providerBadge);

    const rolloutProvider = document.createElement("td");
    rolloutProvider.textContent = item.rollout_provider || "";
    if (!item.rollout_exists) {
      rolloutProvider.textContent = "文件不存在";
      rolloutProvider.className = "missing";
    }

    const updated = document.createElement("td");
    updated.textContent = formatTime(item.updated_at);

    const cwd = document.createElement("td");
    cwd.className = "mono";
    cwd.textContent = item.cwd;

    const rollout = document.createElement("td");
    const pathCell = document.createElement("div");
    pathCell.className = "path-cell";
    const pathText = document.createElement("div");
    pathText.className = "mono";
    pathText.textContent = item.rollout_path;
    const pathActions = document.createElement("div");
    pathActions.className = "path-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "查看/编辑";
    editButton.addEventListener("click", () => openRolloutEditor(item.id));
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.textContent = "选择文件";
    selectButton.addEventListener("click", () => selectRolloutFile(item.id));
    pathActions.append(editButton, selectButton);
    pathCell.append(pathText, pathActions);
    rollout.append(pathCell);

    row.append(checkCell, title, provider, rolloutProvider, updated, cwd, rollout);
    threadBody.append(row);
  }
  selectAll.checked = false;
}

async function loadThreads() {
  refreshBtn.disabled = true;
  setMessage("加载中...");
  try {
    const params = new URLSearchParams({ search: searchInput.value.trim(), limit: "200" });
    const res = await fetch(`/api/threads?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    state.threads = data.threads;
    dbPath.textContent = data.db_path;
    renderRows();
    renderProviderOptions(data.threads.map((item) => item.model_provider));
    setMessage(`已加载 ${state.threads.length} 条记录`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    refreshBtn.disabled = false;
  }
}

async function applyProvider() {
  const ids = selectedIds();
  const provider = providerInput.value.trim();
  if (ids.length === 0) {
    setMessage("请先勾选至少一条记录", true);
    return;
  }
  if (!provider) {
    setMessage("model_provider 不能为空", true);
    return;
  }

  applyBtn.disabled = true;
  setMessage("正在写入数据库和 rollout 文件...");
  try {
    const res = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, provider }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "更新失败");
    rememberProvider(provider);
    await loadThreads();
    setMessage(`已更新 ${data.updated} 条记录；备份目录：${data.db_backup}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    applyBtn.disabled = false;
  }
}

async function openRolloutEditor(id) {
  currentEditorId = id;
  editorThreadId.textContent = id;
  rolloutEditor.value = "加载中...";
  renderHighlights();
  rolloutPathInput.value = "";
  rawLink.href = `/api/rollout/raw?id=${encodeURIComponent(id)}`;
  if (!rolloutDialog.open) {
    rolloutDialog.showModal();
  }
  try {
    const res = await fetch(`/api/rollout?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "读取失败");
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

async function saveRolloutContent() {
  if (!currentEditorId) return;
  saveRolloutBtn.disabled = true;
  setMessage("正在保存 rollout 文件...");
  try {
    const res = await fetch("/api/rollout/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentEditorId, content: rolloutEditor.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存失败");
    await loadThreads();
    setMessage(`已保存 rollout 文件；备份文件：${data.file_backup}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    saveRolloutBtn.disabled = false;
  }
}

async function saveRolloutPath() {
  if (!currentEditorId) return;
  savePathBtn.disabled = true;
  setMessage("正在保存 rollout_path...");
  try {
    const res = await fetch("/api/rollout/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentEditorId, rollout_path: rolloutPathInput.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存路径失败");
    await loadThreads();
    await openRolloutEditor(currentEditorId);
    setMessage(`已保存 rollout_path；数据库备份：${data.db_backup}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    savePathBtn.disabled = false;
  }
}

async function selectRolloutFile(id = currentEditorId) {
  if (!id) return;
  setMessage("正在等待文件选择...");
  try {
    const res = await fetch("/api/rollout/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "选择文件失败");
    if (!data.selected && !data.rollout_path) {
      setMessage("已取消选择文件");
      return;
    }
    if (currentEditorId === id && data.rollout_path) {
      rolloutPathInput.value = data.rollout_path;
      await openRolloutEditor(id);
    } else {
      await loadThreads();
    }
    setMessage(`已更新 rollout_path：${data.rollout_path}`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function openBackupDirectory() {
  openBackupBtn.disabled = true;
  try {
    const res = await fetch("/api/backups/open", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "打开备份目录失败");
    setMessage(`已打开备份目录：${data.backup_root}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    openBackupBtn.disabled = false;
  }
}

async function keepThreeBackups() {
  if (!window.confirm("将只保留最近 3 个备份目录，确认继续？")) return;
  keepBackupsBtn.disabled = true;
  try {
    const res = await fetch("/api/backups/keep3", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "清理备份失败");
    setMessage(`已清理 ${data.deleted.length} 个备份目录；当前保留 ${data.count} 个`);
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
  if (confirmText !== "确认清空") {
    setMessage("确认文本不匹配，必须输入：确认清空", true);
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
    if (!res.ok) throw new Error(data.error || "清空备份失败");
    clearBackupDialog.close();
    setMessage(`已清空 ${data.deleted.length} 个备份目录；当前保留 ${data.count} 个`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    confirmClearBtn.disabled = false;
  }
}

let timer = null;
searchInput.addEventListener("input", () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(loadThreads, 250);
});
refreshBtn.addEventListener("click", loadThreads);
applyBtn.addEventListener("click", applyProvider);
providerInput.addEventListener("change", () => rememberProvider(providerInput.value));
closeEditorBtn.addEventListener("click", () => rolloutDialog.close());
saveRolloutBtn.addEventListener("click", saveRolloutContent);
selectPathBtn.addEventListener("click", () => selectRolloutFile());
savePathBtn.addEventListener("click", saveRolloutPath);
prevMatchBtn.addEventListener("click", () => focusMatch(-1));
nextMatchBtn.addEventListener("click", () => focusMatch(1));
openBackupBtn.addEventListener("click", openBackupDirectory);
keepBackupsBtn.addEventListener("click", keepThreeBackups);
clearBackupsBtn.addEventListener("click", openClearBackupDialog);
closeClearDialogBtn.addEventListener("click", () => clearBackupDialog.close());
cancelClearBtn.addEventListener("click", () => clearBackupDialog.close());
confirmClearBtn.addEventListener("click", clearAllBackups);
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

renderProviderOptions();
loadThreads();
loadBackupStatus();
