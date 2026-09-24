const state = {
  results: [],
  selected: new Set(),
  lastQuery: "",
  mediaType: "image",
  stockCount: 0,
  nasCount: 0,
  nasPending: false,
  nasSearchToken: 0,
  activeSlotId: "",
  slotQueries: [],
  slotsById: new Map(),
};

const els = {
  statusPanel: document.getElementById("statusPanel"),
  projectPath: document.getElementById("projectPath"),
  projectHint: document.getElementById("projectHint"),
  searchSlotSelect: document.getElementById("searchSlotSelect"),
  slotQueryHint: document.getElementById("slotQueryHint"),
  altQueryChips: document.getElementById("altQueryChips"),
  queryInput: document.getElementById("queryInput"),
  queryEnInput: document.getElementById("queryEnInput"),
  mediaType: document.getElementById("mediaType"),
  sourceMode: document.getElementById("sourceMode"),
  preciseMode: document.getElementById("preciseMode"),
  includeNas: document.getElementById("includeNas"),
  includeDownloaded: document.getElementById("includeDownloaded"),
  slotSelect: document.getElementById("slotSelect"),
  confirmLicense: document.getElementById("confirmLicense"),
  searchBtn: document.getElementById("searchBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  copyNasBtn: document.getElementById("copyNasBtn"),
  applyProjectBtn: document.getElementById("applyProjectBtn"),
  selectAllBtn: document.getElementById("selectAllBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  resultSummary: document.getElementById("resultSummary"),
  message: document.getElementById("message"),
  results: document.getElementById("results"),
};

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
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
    return { providers: "unsplash,pixabay,pexels", freeOnly: "1" };
  }
  if (mode === "all") {
    return { providers: "all", freeOnly: "0" };
  }
  return { providers: mode, freeOnly: "0" };
}

function itemKey(item) {
  return `${item.provider}:${item.id}`;
}

function updateSelectionUi() {
  const count = state.selected.size;
  const nasCount = [...state.selected].filter((key) => key.startsWith("nas:")).length;
  const stockCount = count - nasCount;

  els.downloadBtn.disabled = stockCount === 0;
  els.downloadBtn.textContent = `下載選取（${stockCount}）`;
  els.copyNasBtn.disabled = nasCount === 0;
  els.copyNasBtn.textContent = `複製 NAS 選取（${nasCount}）`;
  els.selectAllBtn.disabled = state.results.length === 0;
  els.clearAllBtn.disabled = count === 0;
}

function renderStatus(status, quotas) {
  const providers = status.providers;
  const lines = [
    `專案：${status.projectRoot}`,
    `API：${[
      providers.unsplash ? "Unsplash" : null,
      providers.pixabay ? "Pixabay" : null,
      providers.pexels ? "Pexels" : null,
      providers.shutterstock ? "SS" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "未設定"}`,
    status.nas.configured
      ? `NAS：${status.nas.searchScope === "projectPaths" ? "限定目錄" : "全庫掃描（慢）"}`
      : "NAS：未設定 nas_config.json",
  ];

  if (quotas?.unsplash?.hourlyRemaining) {
    lines.push(`Unsplash 剩餘 ${quotas.unsplash.hourlyRemaining}/${quotas.unsplash.hourlyLimit} 次/時`);
  }
  if (quotas?.pexels?.hourlyRemaining) {
    lines.push(`Pexels 剩餘 ${quotas.pexels.hourlyRemaining}/${quotas.pexels.hourlyLimit} 次/時`);
  }

  els.statusPanel.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
}

function renderSlotOption(select, slot, prefix = "") {
  const option = document.createElement("option");
  option.value = slot.id;
  option.textContent = `${prefix}${slot.id} → ${slot.file} [${slot.type}]`;
  select.appendChild(option);
}

function renderAltQueryChips(slot) {
  els.altQueryChips.innerHTML = "";
  if (!slot) return;

  const queries = [slot.query, ...(slot.altQueries || [])].filter(Boolean);
  for (const text of queries) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${text === els.queryInput.value ? " active" : ""}`;
    chip.textContent = text;
    chip.addEventListener("click", () => {
      els.queryInput.value = text;
      for (const node of els.altQueryChips.querySelectorAll(".chip")) {
        node.classList.toggle("active", node === chip);
      }
    });
    els.altQueryChips.appendChild(chip);
  }
}

function applySearchSlot(slotId) {
  state.activeSlotId = slotId;
  const slot = state.slotsById.get(slotId);
  if (!slot) {
    state.slotQueries = [];
    els.slotQueryHint.textContent =
      "手動模式：線上圖庫用輸入關鍵字；NAS 檔名比對任一關鍵字（較寬鬆）。";
    renderAltQueryChips(null);
    return;
  }

  state.slotQueries = [slot.query, ...(slot.altQueries || [])].filter(Boolean);
  els.queryInput.value = slot.query || "";
  els.queryEnInput.value = slot.queryEn || "";
  els.mediaType.value = slot.type || "image";
  els.slotSelect.value = slot.id;
  els.slotQueryHint.textContent = `圖槽 ${slot.id}：依序搜尋 ${state.slotQueries.length} 組關鍵字（主 query + altQueries）。下載後可複製到 ${slot.file}`;
  renderAltQueryChips(slot);
}

function renderSlots(slotsPayload) {
  const currentDownloadSlot = els.slotSelect.value;
  const currentSearchSlot = els.searchSlotSelect.value;

  state.slotsById = new Map();
  els.slotSelect.innerHTML = `<option value="">不下載到 slot，只存 archive</option>`;
  els.searchSlotSelect.innerHTML = `<option value="">手動輸入關鍵字</option>`;

  for (const slot of slotsPayload.slots || []) {
    state.slotsById.set(slot.id, slot);
    renderSlotOption(els.slotSelect, slot);
    renderSlotOption(els.searchSlotSelect, slot);
  }

  if (currentDownloadSlot) {
    els.slotSelect.value = currentDownloadSlot;
  }
  if (currentSearchSlot) {
    els.searchSlotSelect.value = currentSearchSlot;
    applySearchSlot(currentSearchSlot);
  }

  els.projectHint.textContent = slotsPayload.targetRoot
    ? `targetRoot: ${slotsPayload.targetRoot}`
    : "此專案尚未設定 targetRoot";
}

function renderResults() {
  els.results.innerHTML = "";
  if (state.results.length === 0) {
    els.results.innerHTML = `<div class="empty">沒有結果。試試其他關鍵字，或勾選「顯示已下載過的結果」。</div>`;
    updateSelectionUi();
    return;
  }

  for (const item of state.results) {
    const key = itemKey(item);
    const card = document.createElement("article");
    card.className = `card${state.selected.has(key) ? " selected" : ""}`;
    card.dataset.key = key;

    const isVideo = item.mediaType === "video";
    const mediaTag = isVideo
      ? `<video src="${item.previewUrl}" muted playsinline preload="metadata"></video>`
      : `<img src="${item.previewUrl}" alt="${item.filename || item.id}" loading="lazy" />`;

    card.innerHTML = `
      <div class="card-head">
        <label class="check">
          <input type="checkbox" ${state.selected.has(key) ? "checked" : ""} />
          選取
        </label>
        <span class="badge ${item.provider}">${item.provider}</span>
      </div>
      <div class="thumb-wrap">${mediaTag}</div>
      <div class="card-body">
        <p><strong>${item.photographer || "Unknown"}</strong></p>
        ${item.description ? `<p>${item.description}</p>` : ""}
        ${item.filename ? `<p>${item.filename}</p>` : ""}
        ${item.downloaded ? `<p>已下載</p>` : ""}
        ${item.requiresLicense ? `<p>Shutterstock 下載會扣張數</p>` : ""}
        <p><a href="${item.photoPageUrl}" target="_blank" rel="noopener">原頁 / 路徑</a></p>
      </div>
    `;

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

async function loadProject() {
  const [status, quotas, slots] = await Promise.all([
    api("/api/status"),
    api("/api/quota").catch(() => null),
    api("/api/slots"),
  ]);
  els.projectPath.value = status.projectRoot;
  renderStatus(status, quotas);
  renderSlots(slots);
}

async function applyProject() {
  const projectRoot = els.projectPath.value.trim();
  if (!projectRoot) {
    showMessage("請輸入專案根目錄。");
    return;
  }
  const payload = await api("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectRoot }),
  });
  renderSlots(payload);
  await loadProject();
  showMessage(`已切換專案：${payload.projectRoot}`, "success");
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
    mediaType: state.mediaType,
    includeDownloaded: els.includeDownloaded.checked ? "1" : "0",
    precise: els.preciseMode.checked ? "1" : "0",
    ...providerParams(),
  });
  const queryEn = els.queryEnInput.value.trim();
  if (queryEn) {
    params.set("queryEn", queryEn);
  }
  if (state.activeSlotId) {
    params.set("slotId", state.activeSlotId);
  } else {
    params.set("q", els.queryInput.value.trim());
  }
  return params;
}

async function suggestEnglishQuery() {
  const q = els.queryInput.value.trim();
  if (!q || state.activeSlotId) {
    return;
  }
  try {
    const payload = await api(`/api/translate?q=${encodeURIComponent(q)}`);
    if (!els.queryEnInput.value.trim() || els.queryEnInput.dataset.auto === "1") {
      els.queryEnInput.value = payload.english || "";
      els.queryEnInput.dataset.auto = "1";
    }
  } catch {
    // ignore translation failures; user can type English manually
  }
}

function buildNasParams() {
  const params = new URLSearchParams({
    timeout: "30000",
    precise: els.preciseMode.checked ? "1" : "0",
  });
  if (state.activeSlotId) {
    params.set("slotId", state.activeSlotId);
  } else {
    params.set("q", els.queryInput.value.trim());
    params.set("mediaType", state.mediaType);
  }
  return params;
}

function displayQueryLabel() {
  if (state.activeSlotId) {
    const slot = state.slotsById.get(state.activeSlotId);
    return slot ? `slot:${slot.id}` : state.activeSlotId;
  }
  return els.queryInput.value.trim();
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
    }
  } finally {
    if (token === state.nasSearchToken) {
      state.nasPending = false;
      els.toolbar?.removeAttribute("data-nas-pending");
      updateResultSummary(queryLabel);
    }
  }
}

async function runSearch() {
  hideMessage();
  const queryLabel = displayQueryLabel();
  if (!state.activeSlotId && !els.queryInput.value.trim()) {
    showMessage("請輸入關鍵字，或選擇圖槽。");
    return;
  }

  state.nasSearchToken += 1;
  const nasToken = state.nasSearchToken;
  state.lastQuery = state.activeSlotId
    ? state.slotQueries.join(" | ")
    : els.queryInput.value.trim();
  state.mediaType = els.mediaType.value;
  state.selected.clear();
  state.nasCount = 0;
  state.stockCount = 0;
  state.nasPending = false;
  els.searchBtn.disabled = true;
  els.resultSummary.textContent = state.activeSlotId
    ? `搜尋圖槽 ${queryLabel}（線上圖庫）…`
    : `搜尋線上圖庫：${queryLabel}…`;

  try {
    const stock = await api(`/api/search?${buildSearchParams().toString()}`);
    state.stockCount = (stock.results || []).length;
    state.results = [...(stock.results || [])];
    renderResults();
    updateResultSummary(queryLabel);

    const errors = (stock.errors || []).map((row) => `${row.provider}: ${row.message}`).join("；");
    const notes = [];
    if (errors) {
      notes.push(`部分線上來源搜尋失敗：${errors}`);
    }
    if (stock.translated && stock.queryEnglish) {
      const variants = (stock.englishVariants || []).slice(0, 3).join(" · ");
      notes.push(
        `英文搜圖：${stock.queryEnglish}${variants ? `（變體：${variants}）` : ""}`
      );
    }
    if (
      (stock.providers || []).includes("shutterstock") &&
      !(stock.results || []).some((item) => item.provider === "shutterstock")
    ) {
      notes.push("Shutterstock 這組關鍵字仍無結果，可改試其他中文關鍵字或來源選「僅 Shutterstock」。");
    }
    if (notes.length > 0) {
      showMessage(notes.join(" "));
    }
    if (state.activeSlotId && stock.queries?.length > 1 && !errors) {
      showMessage(`已用 ${stock.queries.length} 組關鍵字搜尋（${stock.queries.join(" → ")}）`, "success");
    }

    if (els.includeNas.checked) {
      searchNasInBackground(queryLabel, nasToken);
    }
  } catch (err) {
    showMessage(err.message);
    state.results = [];
    renderResults();
  } finally {
    els.searchBtn.disabled = false;
  }
}

async function downloadSelected() {
  const items = state.results.filter((item) => state.selected.has(itemKey(item)) && item.provider !== "nas");
  if (items.length === 0) {
    showMessage("請先勾選線上圖庫的結果。");
    return;
  }

  const hasShutterstock = items.some((item) => item.provider === "shutterstock");
  if (hasShutterstock && !els.confirmLicense.checked) {
    showMessage("下載 Shutterstock 前請先勾選確認扣張數。");
    return;
  }

  els.downloadBtn.disabled = true;
  try {
    const payload = await api("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: state.lastQuery,
        mediaType: state.mediaType,
        items,
        confirmLicense: els.confirmLicense.checked,
        slotId: els.slotSelect.value || "",
      }),
    });
    showMessage(`已下載 ${payload.downloaded} 個檔案。${payload.copies?.length ? ` 已複製到 slot。` : ""}`, "success");
    state.selected.clear();
    await runSearch();
  } catch (err) {
    showMessage(err.message);
  } finally {
    updateSelectionUi();
  }
}

async function copyNasSelected() {
  const items = state.results.filter((item) => state.selected.has(itemKey(item)) && item.provider === "nas");
  if (items.length === 0) {
    showMessage("請先勾選 NAS 結果。");
    return;
  }

  els.copyNasBtn.disabled = true;
  try {
    for (const item of items) {
      await api("/api/nas/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: item.filePath,
          slotId: els.slotSelect.value || "",
        }),
      });
    }
    showMessage(`已複製 ${items.length} 個 NAS 檔案。`, "success");
    state.selected.clear();
    renderResults();
  } catch (err) {
    showMessage(err.message);
  } finally {
    updateSelectionUi();
  }
}

els.toolbar = document.querySelector(".toolbar");
els.searchSlotSelect.addEventListener("change", () => {
  applySearchSlot(els.searchSlotSelect.value);
});
els.searchBtn.addEventListener("click", runSearch);
els.downloadBtn.addEventListener("click", downloadSelected);
els.copyNasBtn.addEventListener("click", copyNasSelected);
els.applyProjectBtn.addEventListener("click", applyProject);
els.queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runSearch();
  }
});
els.queryInput.addEventListener("blur", suggestEnglishQuery);
els.queryEnInput.addEventListener("input", () => {
  els.queryEnInput.dataset.auto = "0";
});
els.selectAllBtn.addEventListener("click", () => {
  for (const item of state.results) {
    state.selected.add(itemKey(item));
  }
  renderResults();
});
els.clearAllBtn.addEventListener("click", () => {
  state.selected.clear();
  renderResults();
});

loadProject().catch((err) => {
  showMessage(err.message);
});
