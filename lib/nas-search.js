const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const DEFAULT_MAX_RESULTS = 40;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_TIMEOUT_MS = 30000;

function loadNasConfig(projectRoot) {
  const candidates = [
    path.join(projectRoot, "nas_config.json"),
    path.join(projectRoot, "assets", "nas_config.json"),
    path.join(projectRoot, "scripts", "nas_config.json"),
    path.join(projectRoot, "data", "nas_config.json"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && Array.isArray(data.hosts)) {
        return { file, config: data };
      }
    } catch {
      /* try next */
    }
  }

  return { file: null, config: null };
}

function normalizeRoots(config) {
  const roots = [];
  for (const host of config.hosts || []) {
    for (const root of host.roots || []) {
      roots.push({
        hostId: host.id || "nas",
        label: host.label || host.id || "NAS",
        root: path.normalize(root),
      });
    }
  }
  return roots;
}

function getSearchRoots(config) {
  const roots = [];

  if (Array.isArray(config.searchPaths)) {
    for (const entry of config.searchPaths) {
      if (typeof entry === "string" && entry.trim()) {
        roots.push({
          hostId: "searchPaths",
          label: "searchPaths",
          root: path.normalize(entry.trim()),
        });
      } else if (entry && typeof entry.path === "string" && entry.path.trim()) {
        roots.push({
          hostId: entry.id || entry.label || "searchPaths",
          label: entry.label || entry.id || "searchPaths",
          root: path.normalize(entry.path.trim()),
        });
      }
    }
  }

  if (roots.length === 0 && config.projectPaths && typeof config.projectPaths === "object") {
    for (const [key, value] of Object.entries(config.projectPaths)) {
      if (typeof value === "string" && value.trim()) {
        roots.push({
          hostId: key,
          label: key,
          root: path.normalize(value.trim()),
        });
      }
    }
  }

  if (roots.length > 0) {
    return { roots, scope: "projectPaths" };
  }

  return { roots: normalizeRoots(config), scope: "fullRoots" };
}

function describeNasSearch(config) {
  if (!config) {
    return { configured: false, scope: "none", roots: [] };
  }
  const { roots, scope } = getSearchRoots(config);
  return {
    configured: roots.length > 0,
    scope,
    roots: roots.map((row) => ({ id: row.hostId, label: row.label, root: row.root })),
  };
}

function isAllowedNasPath(filePath, roots) {
  const normalized = path.normalize(filePath);
  return roots.some((row) => normalized.toLowerCase().startsWith(row.root.toLowerCase()));
}

function keywordMatches(name, keywords, matchMode = "all") {
  const lower = name.toLowerCase();
  if (matchMode === "phrase") {
    const phrase = keywords.join(" ").toLowerCase();
    return phrase.length > 0 && lower.includes(phrase);
  }
  if (matchMode === "any") {
    return keywords.some((word) => lower.includes(word.toLowerCase()));
  }
  return keywords.every((word) => lower.includes(word.toLowerCase()));
}

function walkForMatches(dir, keywords, options, state) {
  if (state.deadline && Date.now() > state.deadline) {
    state.timedOut = true;
    return;
  }
  if (state.results.length >= options.maxResults) return;
  if (state.visited.has(dir)) return;
  state.visited.add(dir);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.results.length >= options.maxResults) break;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (options.depth >= options.maxDepth) continue;
      walkForMatches(fullPath, keywords, { ...options, depth: options.depth + 1 }, state);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isVideo = VIDEO_EXTENSIONS.has(ext);
    if (!isImage && !isVideo) continue;
    if (options.mediaType === "image" && !isImage) continue;
    if (options.mediaType === "video" && !isVideo) continue;
    if (!keywordMatches(entry.name, keywords, options.matchMode)) continue;

    state.results.push({
      provider: "nas",
      id: fullPath,
      filePath: fullPath,
      filename: entry.name,
      mediaType: isVideo ? "video" : "image",
      previewUrl: `/api/nas/preview?path=${encodeURIComponent(fullPath)}`,
      photoPageUrl: fullPath,
      photographer: "NAS",
      photographerUrl: "",
      hostLabel: state.hostLabel,
      root: state.root,
      downloaded: false,
      requiresLicense: false,
    });
  }
}

function searchNas(projectRoot, options = {}) {
  const startedAt = Date.now();
  const query = String(options.query || "").trim();
  const queryList = Array.isArray(options.queries)
    ? options.queries.map((row) => String(row).trim()).filter(Boolean)
    : [];

  if (!query && queryList.length === 0) {
    throw new Error("Missing NAS search query.");
  }

  const { config } = loadNasConfig(projectRoot);
  if (!config) {
    return {
      configured: false,
      query: query || queryList[0] || "",
      results: [],
      message: "找不到 nas_config.json（可從 templates/nas-config.example.json 複製到專案根目錄）。",
    };
  }
  const mediaType = options.mediaType === "video" ? "video" : "image";
  const matchMode = options.matchMode || (queryList.length > 0 ? "phrase" : "any");
  const maxResults = Number(options.maxResults) > 0 ? Number(options.maxResults) : DEFAULT_MAX_RESULTS;
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : DEFAULT_MAX_DEPTH;
  const timeoutMs =
    Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const { roots, scope } = getSearchRoots(config);
  const results = [];
  const errors = [];
  let timedOut = false;

  if (roots.length === 0) {
    return {
      configured: false,
      query,
      results: [],
      message: "nas_config.json 未設定可搜尋路徑（請填 projectPaths 或 searchPaths）。",
    };
  }

  const deadline = startedAt + timeoutMs;
  const searches =
    queryList.length > 0
      ? queryList.map((text) => ({ text, keywords: text.split(/\s+/).filter(Boolean) }))
      : [{ text: query, keywords: query.split(/\s+/).filter(Boolean) }];

  const seenPaths = new Set();

  for (const searchRow of searches) {
    if (!searchRow.text) continue;
    for (const row of roots) {
      const state = {
        results,
        visited: new Set(),
        hostLabel: row.label,
        root: row.root,
        deadline,
        timedOut: false,
      };
      try {
        if (!fs.existsSync(row.root)) {
          errors.push({ root: row.root, message: "路徑不存在或無法存取" });
          continue;
        }
        walkForMatches(
          row.root,
          searchRow.keywords,
          { mediaType, maxResults, maxDepth, depth: 0, matchMode },
          state
        );
        if (state.timedOut) {
          timedOut = true;
        }
      } catch (err) {
        errors.push({ root: row.root, message: err.message });
      }
      if (results.length >= maxResults || timedOut) break;
    }
    for (const item of results) {
      seenPaths.add(item.filePath);
    }
    if (results.length >= maxResults || timedOut) break;
  }

  const deduped = [];
  const dedupeSeen = new Set();
  for (const item of results) {
    if (dedupeSeen.has(item.filePath)) continue;
    dedupeSeen.add(item.filePath);
    deduped.push(item);
  }

  return {
    configured: true,
    query: queryList.length > 0 ? queryList[0] : query,
    queries: searches.map((row) => row.text),
    matchMode,
    mediaType,
    results: deduped.slice(0, maxResults),
    errors,
    timedOut,
    timeoutMs,
    elapsedMs: Date.now() - startedAt,
    searchScope: scope,
    scopeHint:
      scope === "fullRoots"
        ? "目前從整個 NAS 根目錄搜尋（較慢）。建議在 nas_config.json 設定 projectPaths 縮小範圍。"
        : "僅搜尋 projectPaths / searchPaths 指定目錄。",
    roots: roots.map((row) => ({ id: row.hostId, label: row.label, root: row.root })),
  };
}

function getAllowedRoots(config) {
  const seen = new Set();
  const merged = [];
  for (const row of [...getSearchRoots(config).roots, ...normalizeRoots(config)]) {
    const key = row.root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

function resolveNasPreviewPath(projectRoot, requestedPath) {
  const { config } = loadNasConfig(projectRoot);
  if (!config) {
    throw new Error("NAS is not configured.");
  }
  const roots = getAllowedRoots(config);
  const normalized = path.normalize(requestedPath);
  if (!isAllowedNasPath(normalized, roots)) {
    throw new Error("Path is outside configured NAS roots.");
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new Error("NAS file not found.");
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported NAS file type.");
  }
  return normalized;
}

function copyNasFile(ctx, sourcePath, options = {}) {
  const { findSlot } = require("./search-service");
  const normalized = resolveNasPreviewPath(ctx.root, sourcePath);
  const slotId = options.slotId ? String(options.slotId).trim() : "";
  const basename = path.basename(normalized);
  const ext = path.extname(basename) || ".jpg";
  const destName = `nas-${Date.now()}-${basename.replace(/[^\w.\-]+/g, "_")}`;
  const archiveDir = path.join(ctx.archiveRoot, "nas");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, destName.endsWith(ext) ? destName : `${destName}${ext}`);
  fs.copyFileSync(normalized, archivePath);

  const copies = [];
  if (slotId) {
    const { manifest, slot } = findSlot(ctx, slotId);
    const dest = ctx.targetPath(manifest, slot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(normalized, dest);
    copies.push({
      slotId,
      from: normalized,
      to: path.relative(ctx.root, dest),
    });
  }

  return {
    from: normalized,
    archive: path.relative(ctx.root, archivePath),
    copies,
  };
}

module.exports = {
  loadNasConfig,
  getSearchRoots,
  describeNasSearch,
  searchNas,
  resolveNasPreviewPath,
  copyNasFile,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  DEFAULT_TIMEOUT_MS,
};
