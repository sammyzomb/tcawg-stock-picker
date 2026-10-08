const state = {
  results: [],
  selected: new Set(),
  lastQuery: "",
  mediaType: "image",
  stockCount: 0,
  nasCount: 0,
  nasPending: false,
  nasSearchToken: 0,
  activeProvider: "all",
  searchedProviders: [],
  providerErrors: {},
  downloadingKeys: new Set(),
};

const SOURCE_LABELS = {all: "全部", shutterstock: "Shutterstock", unsplash: "Unsplash", pixabay: "Pixabay", pexels: "Pexels", commons: "Wikimedia Commons", nas: "NAS"};

const els = {
  statusPanel: document.getElementById("statusPanel"),
  quotaUpdated: document.getElementById("quotaUpdated"),
  refreshQuotaBtn: document.getElementById("refreshQuotaBtn"),
  queryInput: document.getElementById("queryInput"),
  queryEnInput: document.getElementById("queryEnInput"),
  queryEnWrap: document.getElementById("queryEnWrap"),
  mediaType: document.getElementById("mediaType"),
  sourceMode: document.getElementById("sourceMode"),
  preciseMode: document.getElementById("preciseMode"),
  includeNasWrap: document.getElementById("includeNasWrap"),
  includeNas: document.getElementById("includeNas"),
  includeDownloaded: document.getElementById("includeDownloaded"),
  confirmLicenseWrap: document.getElementById("confirmLicenseWrap"),
  confirmLicense: document.getElementById("confirmLicense"),
  searchBtn: document.getElementById("searchBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  chooseFolderBtn: document.getElementById("chooseFolderBtn"),
  saveLocation: document.getElementById("saveLocation"),
  selectAllBtn: document.getElementById("selectAllBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  resultSummary: document.getElementById("resultSummary"),
  message: document.getElementById("message"),
  results: document.getElementById("results"),
  sourceTabs: document.getElementById("sourceTabs"),
  nasPanel: document.getElementById("nasPanel"),
  nasLoginStatus: document.getElementById("nasLoginStatus"),
  nasLoginFields: document.getElementById("nasLoginFields"),
  nasUser: document.getElementById("nasUser"),
  nasPassword: document.getElementById("nasPassword"),
  nasLoginBtn: document.getElementById("nasLoginBtn"),
  nasLoginDialog: document.getElementById("nasLoginDialog"),
  nasLoginForm: document.getElementById("nasLoginForm"),
  nasLoginError: document.getElementById("nasLoginError"),
  nasOpenLoginBtn: document.getElementById("nasOpenLoginBtn"),
  nasCancelLoginBtn: document.getElementById("nasCancelLoginBtn"),
  nasShare: document.getElementById("nasShare"),
  nasExt: document.getElementById("nasExt"),
  nasServiceLink: document.getElementById("nasServiceLink"),
};

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function showMessage(text, type = "info") {
  els.message.textContent = text;
  els.message.classList.remove("hidden", "success");
  if (type === "success") {
    els.message.classList.add("success");
  }
}

function hideMessage() {
  els.message.classList.add("hidden");
}

function providerParams() {
  const mode = els.sourceMode.value;
  if (mode === "free") {
    return { providers: "unsplash,pixabay,pexels,commons", freeOnly: "1" };
  }
  if (mode === "all") {
    return { providers: "all", freeOnly: "0" };
  }
  return { providers: mode, freeOnly: "0" };
}

function itemKey(item) {
  return `${item.provider}:${item.id}`;
}

function dimensionLabel(item) {
  const width = Number(item.width) || 0;
  const height = Number(item.height) || 0;
  if (width > 0 && height > 0) return `原圖 ${width} × ${height}`;
  const bytes = Number(item.fileBytes) || 0;
  if (bytes >= 1048576) return `檔案 ${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `檔案 ${Math.round(bytes / 1024)} KB`;
  if (bytes > 0) return `檔案 ${bytes} B`;
  return "";
}

function sizeSelectHtml(item) {
  const sizes = Array.isArray(item.sizes) ? item.sizes : [];
  if (sizes.length < 2) return "";
  const options = sizes.map((size) => {
    const selected = size.id === (item.downloadSize || item.defaultSize) ? " selected" : "";
    return `<option value="${escapeHtml(size.id)}"${selected}>${escapeHtml(size.label)}</option>`;
  }).join("");
  return `<label class="size-field">下載尺寸<select class="size-select">${options}</select></label>`;
}

function updateSelectionUi() {
  const count = state.selected.size;
  const licensed = state.results.some(item => state.selected.has(itemKey(item)) && item.provider === "shutterstock");
  els.downloadBtn.disabled = count === 0 || state.downloading;
  els.downloadBtn.textContent = state.downloading ? "下載中…" : `下載選取（${count}）`;
  els.confirmLicenseWrap.classList.toggle("hidden", !licensed);
  if (!licensed) els.confirmLicense.checked = false;
  const visible = visibleResults();
  els.selectAllBtn.disabled = visible.length === 0 || state.downloading;
  els.clearAllBtn.disabled = !visible.some(item => state.selected.has(itemKey(item))) || state.downloading;
}

function visibleResults() {
  return state.activeProvider === "all" ? state.results : state.results.filter(item => item.provider === state.activeProvider);
}

function selectSourceTab(provider) {
  state.activeProvider = provider;
  renderResults();
}

function renderSourceTabs() {
  els.sourceTabs.innerHTML = "";
  for (const [provider, label] of Object.entries(SOURCE_LABELS)) {
    const count = provider === "all" ? state.results.length : state.results.filter(item => item.provider === provider).length;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "source-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "results");
    tab.setAttribute("aria-selected", String(state.activeProvider === provider));
    tab.textContent = `${label} (${count})`;
    tab.addEventListener("click", () => selectSourceTab(provider));
    els.sourceTabs.appendChild(tab);
  }
}

function renderStatus(status) {
  state.libraryStatus = status;
  const providers = ["unsplash", "pixabay", "pexels", "commons", "shutterstock"].filter(name => status.providers[name]);
  if (status.nas.configured) providers.push("nas");
  els.statusPanel.innerHTML = providers.length ? providers.map(name => {
    const quota = state.quotas?.[name];
    let detail = "額度查詢中…";
    if (name === "commons") detail = "免費素材 · 無下載張數額度";
    else if (name === "nas") detail = "內網素材 · 無下載張數額度";
    else if (quota) {
      if (!quota.configured) detail = "額度未設定";
      else if (!quota.ok && name !== "shutterstock") detail = "額度暫時無法讀取";
      else if (name === "shutterstock") {
        const labels = {images: "圖片", videos: "影片", audio: "音訊", editorial: "編輯素材"};
        detail = quota.allotments?.length ? quota.allotments.map(row => `${labels[row.assetType] || row.assetType}剩 ${row.downloadsLeft ?? "未提供"} / ${row.downloadsLimit ?? "未提供"} 張`).join("；") : "下載額度暫時無法讀取";
      } else {
        const left = name === "unsplash" ? quota.hourlyRemaining : quota.requestsRemaining;
        const limit = name === "unsplash" ? quota.hourlyLimit : quota.requestLimit;
        const period = name === "unsplash" ? "每小時" : name === "pexels" ? "每月" : "目前時間窗";
        detail = left == null ? "API 未提供剩餘搜尋額度" : `搜尋剩 ${left} / ${limit ?? "未提供"} 次（${period}）`;
      }
    } else if (state.quotaFailed) detail = "額度暫時無法讀取";
    return `<div class="quota-item"><strong>${escapeHtml(SOURCE_LABELS[name])}</strong><span>${escapeHtml(detail)}</span></div>`;
  }).join("") : "目前沒有可用圖庫";
}

async function refreshQuotas() {
  if (state.quotaLoading) return;
  state.quotaLoading = true;
  els.refreshQuotaBtn.disabled = true;
  try {
    state.quotas = await api("/api/quota");
    state.quotaFailed = false;
    els.quotaUpdated.textContent = `更新：${new Date(state.quotas.checkedAt).toLocaleTimeString("zh-TW", {hour12: false})}（共用帳號，快取 60 秒）`;
  } catch {
    state.quotaFailed = true;
    els.quotaUpdated.textContent = "額度更新失敗，請稍後重試";
  } finally {
    state.quotaLoading = false;
    els.refreshQuotaBtn.disabled = false;
    if (state.libraryStatus) renderStatus(state.libraryStatus);
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
}

function renderResults() {
  renderSourceTabs();
  els.results.innerHTML = "";
  const visible = visibleResults();
  if (visible.length === 0) {
    let message = "輸入關鍵字開始搜尋";
    if (state.searching || (state.nasPending && ["all", "nas"].includes(state.activeProvider))) message = "搜尋中…";
    else if (state.lastQuery) {
      const provider = state.activeProvider;
      if (state.providerErrors[provider]) message = `${SOURCE_LABELS[provider]}：${state.providerErrors[provider]}`;
      else if (provider === "nas" && state.nasIndexed && !state.nasLoggedIn) message = "請先登入 NAS，並勾選「同時搜 NAS 圖庫」後搜尋。";
      else if (provider !== "all" && !state.searchedProviders.includes(provider)) message = "本次未搜尋此來源。請在左側選擇此圖庫或「全部線上圖庫」後搜尋；NAS 需勾選「同時搜 NAS 圖庫」。";
      else message = provider === "all" ? "沒有結果，請試試其他關鍵字。" : `${SOURCE_LABELS[provider]} 本次沒有匹配的結果，可取消精準篩選或更換關鍵字。`;
    }
    els.results.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
    updateSelectionUi();
    return;
  }

  for (const item of visible) {
    const key = itemKey(item);
    const card = document.createElement("article");
    card.className = `card${state.selected.has(key) ? " selected" : ""}`;
    card.dataset.key = key;

    const display = Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === "string" ? escapeHtml(value) : value]));
    const isVideo = item.mediaType === "video";
    const mediaTag = isVideo && !display.previewIsImage
      ? `<video src="${display.previewUrl}" muted playsinline preload="metadata"></video>`
      : `<img src="${display.previewUrl}" alt="${display.filename || display.id}" loading="lazy" />`;

    card.innerHTML = `
      <div class="card-head">
        <label class="check">
          <input type="checkbox" ${state.selected.has(key) ? "checked" : ""} />
          選取
        </label>
        <span class="badge ${display.provider}">${display.provider === "commons" ? "Wikimedia Commons" : display.provider}</span>
      </div>
      <div class="thumb-wrap">${mediaTag}</div>
      <div class="card-actions">
        <button type="button" class="btn primary card-download" data-key="${escapeHtml(key)}" ${state.downloading || state.downloadingKeys.has(key) ? "disabled" : ""}>
          ${state.downloadingKeys.has(key) ? "下載中…" : item.provider === "shutterstock" ? "下載這張（扣張數）" : "下載這張"}
        </button>
      </div>
      <div class="card-body">
        <p><strong>${display.photographer || "Unknown"}</strong></p>
        ${dimensionLabel(item) ? `<p class="dims">${escapeHtml(dimensionLabel(item))}</p>` : ""}
        ${sizeSelectHtml(item)}
        ${display.description ? `<p>${display.description}</p>` : ""}
        ${display.filename ? `<p>${display.filename}</p>` : ""}
        ${display.licenseName ? `<p><strong>授權：${display.licenseName}</strong>${display.licenseUrl ? ` · <a href="${display.licenseUrl}" target="_blank" rel="noopener">授權條款</a>` : ""}</p><p>${display.attributionRequired ? "使用時需署名並附授權連結" : "不要求署名"}${display.shareAlike ? "；改作須採相同授權" : ""}</p>${display.attribution ? `<p>署名：${display.attribution}</p>` : ""}${display.restrictions ? `<p>其他限制：${display.restrictions}</p>` : ""}` : ""}
        ${display.downloaded ? `<p>已下載</p>` : ""}
        ${display.requiresLicense ? `<p>Shutterstock 下載會扣張數</p>` : ""}
        <p><a href="${display.photoPageUrl}" target="_blank" rel="noopener">原頁 / 路徑</a></p>
      </div>
    `;

    const sizeSelect = card.querySelector(".size-select");
    if (sizeSelect) {
      sizeSelect.addEventListener("change", () => {
        item.downloadSize = sizeSelect.value;
      });
    }

    const downloadButton = card.querySelector(".card-download");
    downloadButton.addEventListener("click", () => downloadCard(item));

    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selected.add(key);
        card.classList.add("selected");
      } else {
        state.selected.delete(key);
        card.classList.remove("selected");
      }
      updateSelectionUi();
    });

    els.results.appendChild(card);
  }

  updateSelectionUi();
}

async function loadLibraries() {
  const status = await api("/api/status");
  renderStatus(status);
  refreshQuotas();
  state.nasIndexed = status.nas.searchScope === "index";
  if (state.nasIndexed) {
    els.nasServiceLink.href = status.nas.serviceUrl;
    try { renderNasLogin(await api("/api/nas/meta")); }
    catch (err) {
      state.nasLoggedIn = false;
      els.nasLoginFields.classList.remove("hidden");
      els.nasLoginStatus.textContent = err.status === 401 ? "請使用 NAS 帳號登入後搜尋。" : `NAS 服務無法連線：${err.message}`;
    }
  }
  updateNasOptions();
  renderResults();
  if (els.includeNas.checked || els.sourceMode.value === "nas") ensureNasLogin();
}

function updateNasOptions() {
  const nasOnly = els.sourceMode.value === "nas";
  els.includeNasWrap.classList.toggle("hidden", nasOnly);
  const visible = state.nasIndexed && (nasOnly || els.includeNas.checked);
  els.nasPanel.classList.toggle("hidden", !visible);
  if (visible && !state.nasLoggedIn) els.nasPanel.open = true;
}

function renderNasLogin(meta) {
  state.nasLoggedIn = true;
  els.nasLoginStatus.textContent = `已登入：${meta.user || "NAS 搜尋"}`;
  els.nasLoginFields.classList.add("hidden");
  els.nasOpenLoginBtn.textContent = "切換 NAS 帳號";
  els.nasShare.innerHTML = '<option value="">全部可存取資料夾</option>';
  for (const row of meta.shares || []) {
    const option = document.createElement("option");
    option.value = row.share;
    option.textContent = row.share;
    els.nasShare.appendChild(option);
  }
}

function openNasLogin() {
  els.nasLoginFields.classList.remove("hidden");
  els.nasLoginError.textContent = "";
  if (!els.nasLoginDialog.open) els.nasLoginDialog.showModal();
  els.nasUser.focus();
}

async function ensureNasLogin() {
  if (!state.nasIndexed || (!els.includeNas.checked && els.sourceMode.value !== "nas")) return;
  try {
    const meta = await api("/api/nas/meta");
    if (!els.includeNas.checked && els.sourceMode.value !== "nas") return;
    renderNasLogin(meta);
  } catch (err) {
    if (!els.includeNas.checked && els.sourceMode.value !== "nas") return;
    if (err.status === 401) {
      state.nasLoggedIn = false;
      updateNasOptions();
      openNasLogin();
    } else showMessage(`NAS 服務無法連線：${err.message}`);
  }
}

async function loginNas() {
  if (state.nasLoggingIn) return;
  state.nasLoggingIn = true;
  els.nasLoginBtn.disabled = true;
  try {
    renderNasLogin(await api("/api/nas/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: els.nasUser.value.trim(), password: els.nasPassword.value }),
    }));
    els.includeNas.checked = true;
    updateNasOptions();
    els.nasPanel.open = false;
    if (els.nasLoginDialog.open) els.nasLoginDialog.close();
    showMessage("NAS 已登入。按搜尋即可查詢完整圖庫索引。", "success");
  } catch (err) {
    els.nasLoginStatus.textContent = err.message;
    els.nasLoginError.textContent = err.message;
  } finally {
    els.nasPassword.value = "";
    els.nasLoginBtn.disabled = false;
    state.nasLoggingIn = false;
  }
}



function updateResultSummary(query) {
  const parts = [`「${query}」`];
  if (state.nasCount > 0) {
    parts.push(`NAS ${state.nasCount}`);
  }
  if (state.stockCount > 0) {
    parts.push(`線上 ${state.stockCount}`);
  }
  if (state.nasPending) {
    parts.push("NAS 搜尋中…");
  }
  if (!state.nasPending && state.nasCount === 0 && state.stockCount === 0) {
    parts.push("共 0 筆");
  } else if (!state.nasPending) {
    parts.push(`共 ${state.results.length} 筆`);
  }
  els.resultSummary.textContent = parts.join(" · ");
}

function buildSearchParams() {
  const params = new URLSearchParams({
    q: els.queryInput.value.trim(),
    mediaType: els.mediaType.value,
    includeDownloaded: els.includeDownloaded.checked ? "1" : "0",
    precise: els.preciseMode.checked ? "1" : "0",
    ...providerParams(),
  });
  if (els.queryEnInput.dataset.manual === "1" && els.queryEnInput.value.trim()) params.set("queryEn", els.queryEnInput.value.trim());
  return params;
}

let translationTimer;
let translationVersion = 0;
function updateChineseQuery(event) {
  useEditedQuery();
  clearTimeout(translationTimer);
  translationVersion += 1;
  els.queryEnInput.value = "";
  els.queryEnInput.dataset.manual = "0";
  const chinese = /[\u3400-\u9fff]/.test(els.queryInput.value);
  els.queryEnWrap.classList.toggle("hidden", !chinese);
  if (chinese && !event?.isComposing) translationTimer = setTimeout(suggestEnglishQuery, 500);
}

async function suggestEnglishQuery() {
  const q = els.queryInput.value.trim();
  if (!/[\u3400-\u9fff]/.test(q) || els.queryEnInput.dataset.manual === "1") return;
  const version = translationVersion;
  try {
    const payload = await api(`/api/translate?q=${encodeURIComponent(q)}`);
    if (version !== translationVersion || q !== els.queryInput.value.trim() || els.queryEnInput.dataset.manual === "1") return;
    els.queryEnInput.value = payload.english || "";
  } catch {
    // Searching still works: the server can resolve the Chinese query itself.
  }
}

function useEditedQuery() {
  state.nasSearchToken += 1;
  state.searching = false;
  state.lastQuery = "";
  state.results = [];
  state.selected.clear();
  state.stockCount = 0;
  state.nasCount = 0;
  state.nasPending = false;
  state.searchedProviders = [];
  state.providerErrors = {};
  els.searchBtn.disabled = false;
  renderResults();
  els.resultSummary.textContent = "關鍵字已變更，請按搜尋取得新結果";
}

function buildNasParams() {
  const params = new URLSearchParams({q: els.queryInput.value.trim(), mediaType: els.mediaType.value, timeout: "30000", precise: els.preciseMode.checked ? "1" : "0"});
  if (els.nasShare.value) params.set("share", els.nasShare.value);
  if (els.nasExt.value.trim()) params.set("ext", els.nasExt.value.trim());
  return params;
}

async function searchNasInBackground(queryLabel, token) {
  state.nasPending = true;
  els.toolbar?.setAttribute("data-nas-pending", "true");
  updateResultSummary(queryLabel);

  try {
    const nas = await api(`/api/nas/search?${buildNasParams().toString()}`);
    if (token !== state.nasSearchToken) {
      return;
    }

    if (!nas.configured) {
      if (nas.message) {
        showMessage(nas.message);
      }
      return;
    }

    const stockOnly = state.results.filter((item) => item.provider !== "nas");
    state.nasCount = nas.results.length;
    if (!state.searchedProviders.includes("nas")) state.searchedProviders.push("nas");
    state.results = [...nas.results, ...stockOnly];
    renderResults();

    const notes = [];
    if (nas.timedOut) {
      notes.push(`NAS 搜尋已達 30 秒上限（找到 ${nas.results.length} 筆）。可縮小 projectPaths 或改用單一關鍵字。`);
    }
    if (nas.searchScope === "fullRoots") {
      notes.push(nas.scopeHint);
    }
    if (nas.errors?.length) {
      notes.push(`部分 NAS 路徑無法讀取：${nas.errors.map((row) => row.root).join("；")}`);
    }
    if (notes.length > 0) {
      showMessage(notes.join(" "));
    }
  } catch (err) {
    if (token === state.nasSearchToken) {
      showMessage(`NAS 搜尋失敗：${err.message}`);
      if (err.status === 401) {
        state.nasLoggedIn = false;
        els.nasPanel.classList.remove("hidden");
        els.nasPanel.open = true;
        els.nasLoginFields.classList.remove("hidden");
        els.nasLoginStatus.textContent = "請登入 NAS 後再搜尋。";
        openNasLogin();
      }
      state.providerErrors.nas = err.message;
    }
  } finally {
    if (token === state.nasSearchToken) {
      state.nasPending = false;
      if (!state.searching && !visibleResults().length) renderResults();
      els.toolbar?.removeAttribute("data-nas-pending");
      updateResultSummary(queryLabel);
    }
  }
}

async function runSearch() {
  hideMessage();
  const queryLabel = els.queryInput.value.trim();
  if (!queryLabel) { showMessage("請輸入關鍵字。"); return; }
  const token = ++state.nasSearchToken;
  const nasOnly = els.sourceMode.value === "nas";
  const includeNas = els.includeNas.checked;
  state.lastQuery = queryLabel;
  state.searching = true;
  state.mediaType = els.mediaType.value;
  state.selected.clear();
  state.results = [];
  state.nasCount = 0;
  state.stockCount = 0;
  state.searchedProviders = [];
  state.providerErrors = {};
  state.nasPending = false;
  renderResults();
  els.searchBtn.disabled = true;
  els.resultSummary.textContent = `搜尋中：${queryLabel}…`;
  // Start both sources independently so an online error cannot prevent NAS results.
  const nasTask = nasOnly || includeNas ? searchNasInBackground(queryLabel, token) : null;
  try {
    if (nasOnly) { await nasTask; return; }
    clearTimeout(translationTimer);
    if (/[\u3400-\u9fff]/.test(queryLabel) && !els.queryEnInput.value.trim()) await suggestEnglishQuery();
    if (token !== state.nasSearchToken) return;
    const searchParams = buildSearchParams();
    const stock = await api(`/api/search?${searchParams.toString()}`);
    if (token !== state.nasSearchToken) return;
    state.searching = false;
    state.stockCount = (stock.results || []).length;
    if (els.queryEnInput.dataset.manual !== "1" && stock.queryEnglish) els.queryEnInput.value = stock.queryEnglish;
    state.searchedProviders = [...new Set([...state.searchedProviders, ...(stock.providers || [])])];
    for (const error of stock.errors || []) state.providerErrors[error.provider] = error.message;
    state.results = [...state.results.filter(item => item.provider === "nas"), ...(stock.results || [])];
    renderResults();
    updateResultSummary(queryLabel);
    const notes = [];
    if (stock.filteredOut) notes.push(`已排除 ${stock.filteredOut} 筆未匹配搜尋詞的結果。`);
    if (stock.errors?.length) notes.push(`部分圖庫搜尋失敗：${stock.errors.map(row => row.provider + ": " + row.message).join("；")}`);
    if (stock.translated && stock.queryEnglish) notes.push(`搜尋詞：${stock.queryEnglish}`);
    if (notes.length) showMessage(notes.join(" "));
  } catch (err) {
    if (token !== state.nasSearchToken) return;
    showMessage(err.message);
    updateResultSummary(queryLabel);
  } finally {
    if (token === state.nasSearchToken) {
      state.searching = false;
      els.searchBtn.disabled = false;
      if (!visibleResults().length) renderResults();
    }
  }
}

function setDownloadButtonsBusy(keys, busy) {
  const buttons = els.results.querySelectorAll?.(".card-download");
  if (!buttons) return;
  for (const button of buttons) {
    if (!keys.includes(button.dataset.key)) continue;
    button.disabled = busy;
    if (busy) button.textContent = "下載中…";
  }
}

async function downloadCard(item) {
  await downloadItems([item], { single: true });
}

async function downloadSelected() {
  const items = state.results.filter(item => state.selected.has(itemKey(item)));
  if (!items.length) { showMessage("請先勾選結果。"); return; }
  await downloadItems(items);
}

async function downloadItems(items, options = {}) {
  if (state.downloading) return;
  const pending = items.filter(item => !state.downloadingKeys.has(itemKey(item)));
  if (!pending.length) return;
  if (pending.some(item => item.provider === "shutterstock") && !els.confirmLicense.checked) {
    els.confirmLicenseWrap.classList.remove("hidden");
    showMessage("下載 Shutterstock 前請先勾選確認扣張數。");
    return;
  }
  for (const item of pending) state.downloadingKeys.add(itemKey(item));
  if (!options.single) state.downloading = true;
  els.chooseFolderBtn.disabled = true;
  updateSelectionUi();
  setDownloadButtonsBusy(pending.map(itemKey), true);
  let saved = 0, existing = 0;
  const errors = [];
  const markSaved = item => { item.downloaded = true; state.selected.delete(itemKey(item)); };
  try {
    const online = pending.filter(item => item.provider !== "nas");
    if (online.length) {
      try {
        const payload = await api("/api/download", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({query: state.lastQuery, mediaType: state.mediaType, items: online, confirmLicense: els.confirmLicense.checked, exportToBrowser: true}),
        });
        existing += payload.existing || 0;
        for (const file of (payload.files || []).filter(file => !file.companion)) {
          const item = online.find(item => itemKey(item) === itemKey(file));
          try {
            const savedName = await saveToComputer(file);
            for (const companion of payload.files.filter(row => row.companion && itemKey(row) === itemKey(file))) {
              await saveToComputer({...companion, filename: (savedName || file.filename) + ".license.txt"});
            }
            saved += 1;
            if (item) markSaved(item);
          } catch (err) { errors.push(`${file.filename}：${err.message}`); }
        }
        for (const failure of [...(payload.failed || []), ...(payload.skipped || [])]) errors.push(`${failure.provider} #${failure.id}：${failure.error || failure.reason}`);
      } catch (err) { errors.push(err.message); }
    }
    for (const item of pending.filter(item => item.provider === "nas")) {
      try {
        const payload = await api("/api/nas/copy", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path: item.filePath, id: item.nasFileId, exportToBrowser: true})});
        if (!payload.files?.length) throw new Error("沒有可下載的檔案。");
        await saveToComputer(payload.files[0]);
        saved += 1;
        markSaved(item);
      } catch (err) { errors.push(`${item.filename || item.id}：${err.message}`); }
    }
    const notes = [state.saveDirectory ? `已儲存 ${saved} 個檔案至「${state.saveDirectory.name}」。` : `已開始下載 ${saved} 個檔案。`];
    if (existing) notes.push(`${existing} 個檔案沿用已下載素材。`);
    if (errors.length) notes.push(`部分下載未完成：${errors.join("；")}`);
    showMessage(notes.join(" "), errors.length ? "info" : "success");
  } finally {
    for (const item of pending) state.downloadingKeys.delete(itemKey(item));
    state.downloading = false;
    els.chooseFolderBtn.disabled = false;
    renderResults();
  }
}

async function chooseSaveFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    showMessage("此瀏覽器不支援直接選擇資料夾。請用 Chrome 或 Edge 開啟本頁；也可以在瀏覽器下載設定啟用「下載前詢問儲存位置」。");
    return;
  }
  try {
    const directory = await window.showDirectoryPicker({id: "stock-downloads", mode: "readwrite"});
    state.saveDirectory = directory;
    els.saveLocation.textContent = `儲存資料夾：${directory.name}`;
    hideMessage();
  } catch (err) {
    if (err.name !== "AbortError") showMessage(`無法選擇資料夾：${err.message}`);
  }
}

async function saveToComputer(file) {
  if (!file.url || !file.filename) throw new Error("沒有可下載的檔案。");
  if (!state.saveDirectory) {
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return file.filename;
  }
  // Keep existing files; add a suffix instead of overwriting them.
  const dot = file.filename.lastIndexOf(".");
  const stem = dot > 0 ? file.filename.slice(0, dot) : file.filename;
  const extension = dot > 0 ? file.filename.slice(dot) : "";
  let name = file.filename;
  for (let index = 1; ; index += 1) {
    try { await state.saveDirectory.getFileHandle(name); }
    catch (err) { if (err.name === "NotFoundError") break; throw err; }
    name = `${stem} (${index})${extension}`;
  }
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`檔案下載失敗（${response.status}）`);
  const handle = await state.saveDirectory.getFileHandle(name, {create: true});
  const writable = await handle.createWritable();
  try { await response.body.pipeTo(writable); }
  catch (err) { try { await writable.abort(); } catch {} throw err; }
  return name;
}

els.toolbar = document.querySelector(".toolbar");
els.nasLoginForm.addEventListener("submit", event => { event.preventDefault(); loginNas(); });
els.nasOpenLoginBtn.addEventListener("click", openNasLogin);
els.nasCancelLoginBtn.addEventListener("click", () => els.nasLoginDialog.close());
els.nasLoginDialog.addEventListener("close", () => {
  els.nasPassword.value = "";
  if (!state.nasLoggedIn) { els.includeNas.checked = false; updateNasOptions(); }
});
for (const control of [els.sourceMode, els.includeNas, els.mediaType, els.preciseMode, els.includeDownloaded, els.nasShare, els.nasExt]) {
  control.addEventListener("change", () => {
    useEditedQuery(); updateNasOptions();
    if (control === els.sourceMode) state.activeProvider = Object.hasOwn(SOURCE_LABELS, els.sourceMode.value) ? els.sourceMode.value : "all";
    if (control === els.sourceMode) renderResults();
    if (control === els.includeNas || control === els.sourceMode) ensureNasLogin();
  });
}

els.queryInput.addEventListener("input", updateChineseQuery);
els.queryInput.addEventListener("compositionend", updateChineseQuery);
els.queryEnInput.addEventListener("input", () => {
  translationVersion += 1;
  els.queryEnInput.dataset.manual = "1";
  useEditedQuery();
});
els.refreshQuotaBtn.addEventListener("click", refreshQuotas);
els.searchBtn.addEventListener("click", runSearch);
els.downloadBtn.addEventListener("click", downloadSelected);
els.chooseFolderBtn.addEventListener("click", chooseSaveFolder);
els.queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    runSearch();
  }
});


els.selectAllBtn.addEventListener("click", () => {
  for (const item of visibleResults()) {
    state.selected.add(itemKey(item));
  }
  renderResults();
});
els.clearAllBtn.addEventListener("click", () => {
  for (const item of visibleResults()) state.selected.delete(itemKey(item));
  renderResults();
});

loadLibraries().catch((err) => {
  showMessage(err.message);
});
