const fs = require("fs");
const path = require("path");
const { hasSearchCredentials, hasLicenseCredentials, searchShutterstock, searchShutterstockVideos } = require("./shutterstock");
const { searchPixabayImages, searchPixabayVideos } = require("./pixabay");
const { searchPexelsVideos } = require("./pexels-video");
const { searchCommons, resolveCommonsFiles } = require("./commons");
const { mergeByPriority, DEFAULT_PROVIDER_PRIORITY } = require("./provider-priority");
const { filenameForMedia, slotMediaType } = require("./slot-media");
const {
  searchPexels,
  searchUnsplash,
  downloadSelected,
  downloadedIdSet,
  PER_PAGE,
  ORIENTATION,
} = require("./find");
const {
  hasChinese,
  resolveSearchQueries,
  queryForProvider,
  englishSearchTerms,
  relevanceScore,
  shutterstockSearchVariants,
  ENGLISH_PROVIDERS,
} = require("./query-translate");

const FREE_PROVIDERS = ["unsplash", "pixabay", "pexels", "commons"];
const ALL_PROVIDERS = ["shutterstock", ...FREE_PROVIDERS];
const PRECISE_RESULT_LIMIT = 8;
const PRECISE_PER_PROVIDER = 20;

function resolveProvidersForSearch(options) {
  const freeOnly = Boolean(options.freeOnly);
  return {providers: parseProviders(options.providers, freeOnly), freeOnly};
}

function limitAcrossProviders(results, limit) {
  const groups = new Map();
  for (const item of results) {
    if (!groups.has(item.provider)) groups.set(item.provider, []);
    groups.get(item.provider).push(item);
  }
  const selected = [];
  // Each pool retains its relevance order. Rotate through pools so one large
  // provider cannot consume every display slot in a multi-source search.
  while (selected.length < limit) {
    let added = false;
    for (const pool of groups.values()) {
      if (pool.length && selected.length < limit) {
        selected.push(pool.shift());
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

function getProviderStatus() {
  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const pixabayKey = process.env.PIXABAY_API_KEY || "";
  const shutterstockSearch = hasSearchCredentials();
  const shutterstockLicense = hasLicenseCredentials();

  return {
    pexels: Boolean(pexelsKey),
    unsplash: Boolean(unsplashKey),
    pixabay: Boolean(pixabayKey),
    shutterstock: shutterstockSearch,
    shutterstockLicense,
    commons: true,
  };
}

function parseProviders(input, freeOnly = false) {
  if (!input || input === "all") {
    return freeOnly ? [...FREE_PROVIDERS] : [...ALL_PROVIDERS];
  }
  const list = String(input)
    .split(",")
    .map((row) => row.trim().toLowerCase())
    .filter(Boolean);
  const allowed = freeOnly ? FREE_PROVIDERS : ALL_PROVIDERS;
  const picked = list.filter((provider) => allowed.includes(provider));
  return picked.length > 0 ? picked : freeOnly ? [...FREE_PROVIDERS] : [...ALL_PROVIDERS];
}

function loadManifestSafe(ctx) {
  try {
    return ctx.loadManifest();
  } catch {
    return {
      project: "default",
      shutterstockSort: "popular",
      shutterstockRegion: "",
      providerPriority: DEFAULT_PROVIDER_PRIORITY,
      slots: [],
    };
  }
}

function slotQueries(slot) {
  return [slot.query, ...(slot.altQueries || [])]
    .map((row) => String(row || "").trim())
    .filter(Boolean);
}

function listSlots(ctx) {
  const manifest = loadManifestSafe(ctx);
  return {
    project: manifest.project || path.basename(ctx.root),
    targetRoot: manifest.targetRoot || "",
    slots: (manifest.slots || []).map((slot) => ({
      id: slot.id,
      file: slot.file,
      query: slot.query,
      queryEn: slot.queryEn || "",
      altQueries: slot.altQueries || [],
      type: slotMediaType(slot),
    })),
  };
}

function markDownloaded(ctx, results, mediaType) {
  const sets = {
    pexels: downloadedIdSet(ctx, "pexels", mediaType),
    unsplash: downloadedIdSet(ctx, "unsplash", mediaType),
    pixabay: downloadedIdSet(ctx, "pixabay", mediaType),
    shutterstock: downloadedIdSet(ctx, "shutterstock", mediaType),
    commons: downloadedIdSet(ctx, "commons", mediaType),
  };

  return results.map((item) => ({
    ...item,
    downloaded: sets[item.provider]?.has(item.id) || false,
  }));
}

async function searchProviderRows(provider, searchQuery, ctx, options) {
  // License filtering removes some Commons hits. Sample a full page even when
  // precise mode requests only a handful of final results.
  if (provider === "commons" && options.mediaType === "image") return searchCommons(searchQuery, {perPage: Math.max(PER_PAGE, options.perPage)});
  const {
    mediaType,
    perPage,
    shutterstockSearch,
    unsplashKey,
    pixabayKey,
    pexelsKey,
    status,
  } = options;

  if (provider === "shutterstock" && status.shutterstock) {
    const variants = options.shutterstockVariants?.length
      ? options.shutterstockVariants
      : [{ query: searchQuery, language: "en" }];
    return await searchShutterstockMerged(variants, ctx, {
      ...options,
      orientation: ORIENTATION === "landscape" ? "horizontal" : ORIENTATION,
    });
  }

  if (provider === "unsplash" && status.unsplash && mediaType === "image") {
    const photos = await searchUnsplash(searchQuery, unsplashKey);
    return preciseSlice(photos, perPage, options.precise);
  }

  if (provider === "pixabay" && status.pixabay) {
    return mediaType === "video"
      ? await searchPixabayVideos(searchQuery, pixabayKey, { perPage })
      : await searchPixabayImages(searchQuery, pixabayKey, { perPage, orientation: ORIENTATION });
  }

  if (provider === "pexels" && status.pexels) {
    const rows =
      mediaType === "video"
        ? await searchPexelsVideos(searchQuery, pexelsKey, { perPage, orientation: ORIENTATION })
        : await searchPexels(searchQuery, pexelsKey);
    return preciseSlice(rows, perPage, options.precise && mediaType === "image");
  }

  return [];
}

function preciseSlice(rows, perPage, precise) {
  return precise ? rows.slice(0, perPage) : rows;
}

async function runShutterstockVariantSearch(variant, options) {
  const {
    mediaType,
    perPage,
    precise,
    shutterstockSearch,
    orientation,
    sort,
  } = options;

  const base = {
    perPage,
    sort,
    region: shutterstockSearch.region,
    language: variant.language || "",
  };

  if (mediaType === "video") {
    return await searchShutterstockVideos(variant.query, base);
  }

  const primaryOrientation = orientation || "horizontal";
  let rows = await searchShutterstock(variant.query, {
    ...base,
    orientation: primaryOrientation,
  });

  if (precise && rows.length === 0 && primaryOrientation) {
    rows = await searchShutterstock(variant.query, {
      ...base,
      orientation: "",
    });
  }

  return rows;
}

async function searchShutterstockMerged(searchVariants, ctx, options) {
  const { perPage, precise, shutterstockSearch, status } = options;

  if (!status.shutterstock) {
    return [];
  }

  const sort = precise ? "relevance" : shutterstockSearch.sort;
  const seen = new Set();
  const merged = [];
  const variants = searchVariants.slice(0, precise ? 4 : searchVariants.length);

  for (const variant of variants) {
    const rows = await runShutterstockVariantSearch(variant, {
      ...options,
      sort,
    });

    for (const item of rows) {
      const key = `${item.provider}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...item,
        searchVariant: variant.query,
        searchLanguage: variant.language || "en",
      });
    }

    if (precise && merged.length >= perPage) {
      return merged;
    }
  }

  return merged;
}

async function searchStock(ctx, options = {}) {
  const query = String(options.query || "").trim();
  if (!query) {
    throw new Error("Missing search query.");
  }

  const mediaType = options.mediaType === "video" ? "video" : "image";
  const includeDownloaded = Boolean(options.includeDownloaded);
  const precise = Boolean(options.precise);
  const { providers, freeOnly } = resolveProvidersForSearch(options);
  const status = getProviderStatus();
  const manifest = loadManifestSafe(ctx);
  const shutterstockSearch = {
    sort: manifest.shutterstockSort || "popular",
    region: manifest.shutterstockRegion || "",
  };

  if (mediaType === "image") {
    ctx.ensureArchiveDirs();
  } else {
    ctx.ensureVideoArchiveDirs();
  }

  const groups = { shutterstock: [], unsplash: [], pixabay: [], pexels: [], commons: [] };
  const errors = [];

  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const pixabayKey = process.env.PIXABAY_API_KEY || "";
  const perPage = precise ? PRECISE_PER_PROVIDER : PER_PAGE;
  const queries = await resolveSearchQueries(query, options.queryEn || "");
  const relevanceTerms = englishSearchTerms(queries);
  const englishVariants = precise ? [queries.english] : (queries.englishVariants || []).slice(0, 2);
  const shutterstockVariants = precise
    ? [{ query: queries.english, language: hasChinese(queries.english) ? "zh-Hant" : "en" }]
    : shutterstockSearchVariants(query, queries);
  const providerContext = {
    mediaType,
    perPage,
    precise,
    shutterstockSearch,
    shutterstockVariants,
    unsplashKey,
    pixabayKey,
    pexelsKey,
    status,
  };

  for (const provider of providers) {
    if (!status[provider]) {
      errors.push({provider, message: "尚未設定此圖庫的 API 金鑰，請由管理員在伺服器設定。"});
      continue;
    }
    const variantList =
      provider === "shutterstock"
        ? shutterstockVariants.map((row) => row.query)
        : ENGLISH_PROVIDERS.has(provider)
          ? englishVariants
          : [queryForProvider(provider, queries)];
    const seen = new Set();
    const merged = [];

    if (provider === "shutterstock") {
      try {
        const rows = await searchProviderRows(provider, query, ctx, providerContext);
        for (const item of rows) {
          const key = `${item.provider}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            ...item,
            searchVariant: item.searchVariant || item.searchQuery || queries.english,
            relevanceScore: relevanceScore(item, relevanceTerms),
          });
        }
      } catch (err) {
        errors.push({ provider, searchQuery: queries.english, message: err.message });
      }
    } else for (const variant of variantList) {
      try {
        const rows = await searchProviderRows(provider, variant, ctx, providerContext);
        for (const item of rows) {
          const key = `${item.provider}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            ...item,
            searchVariant: variant,
            relevanceScore: relevanceScore(item, relevanceTerms),
          });
        }
      } catch (err) {
        errors.push({ provider, searchQuery: variant, message: err.message });
      }
    }

    if (ENGLISH_PROVIDERS.has(provider)) {
      merged.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }
    groups[provider] = merged;
  }

  const priority = precise
    ? providers
    : freeOnly
      ? manifest.providerPriority?.filter((p) => p !== "shutterstock") || FREE_PROVIDERS
      : manifest.providerPriority || DEFAULT_PROVIDER_PRIORITY;

  let results = mergeByPriority(groups, [...new Set([...priority, ...providers])]).map((item) => ({
    ...item,
    mediaType: item.mediaType || mediaType,
  }));

  if (relevanceTerms.length > 0) {
    results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  results = markDownloaded(ctx, results, mediaType);
  if (!includeDownloaded) {
    results = results.filter((item) => !item.downloaded);
  }

  let filteredOut = 0;
  if (precise) {
    if (relevanceTerms.length > 0) {
      const matching = results.filter((item) => item.relevanceScore >= relevanceTerms.length * 2);
      filteredOut = results.length - matching.length;
      results = matching;
    }
    results = limitAcrossProviders(results, PRECISE_RESULT_LIMIT);
  }

  const providerCounts = {
    shutterstock: groups.shutterstock.length,
    unsplash: groups.unsplash.length,
    pixabay: groups.pixabay.length,
    pexels: groups.pexels.length,
    commons: groups.commons.length,
  };

  return {
    query,
    queryOriginal: queries.original,
    queryEnglish: queries.english,
    englishVariants: queries.englishVariants,
    translated: queries.translated,
    mediaType,
    orientation: ORIENTATION,
    perPage: precise ? PRECISE_RESULT_LIMIT : PER_PAGE,
    providers,
    freeOnly,
    precise,
    filteredOut,
    providerCounts,
    results,
    errors,
    status,
  };
}

function findSlot(ctx, slotId) {
  const manifest = loadManifestSafe(ctx);
  const slot = manifest.slots.find((row) => row.id === slotId);
  if (!slot) {
    throw new Error(`Unknown slot "${slotId}".`);
  }
  return { manifest, slot };
}

function copyArchiveToSlot(ctx, item, slotId) {
  const { manifest, slot } = findSlot(ctx, slotId);
  const mediaType = item.mediaType || slotMediaType(slot);
  const dirs = mediaType === "video" ? ctx.videoArchiveDirs : ctx.archiveDirs;
  const src = path.join(dirs[item.provider], filenameForMedia(item));
  if (!fs.existsSync(src)) {
    throw new Error(`Archive file not found: ${src}`);
  }
  const dest = ctx.targetPath(manifest, slot);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return {
    slotId,
    from: path.relative(ctx.root, src),
    to: path.relative(ctx.root, dest),
  };
}

async function downloadStockItems(ctx, payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw new Error("No items selected.");
  }

  const query = String(payload.query || "").trim();
  const mediaType = payload.mediaType === "video" ? "video" : "image";
  const confirmLicense = Boolean(payload.confirmLicense);
  const slotId = payload.slotId ? String(payload.slotId).trim() : "";

  // Validate before downloading or licensing anything.
  if (slotId) {
    if (items.length !== 1) {
      throw new Error("單一圖槽只能選取一個檔案；批次下載請取消目標圖槽。");
    }
    const { slot } = findSlot(ctx, slotId);
    if ((items[0].mediaType || mediaType) !== slotMediaType(slot)) {
      throw new Error("選取檔案的媒體類型與目標圖槽不符。");
    }
  }

  if (mediaType === "video") {
    ctx.ensureVideoArchiveDirs();
  } else {
    ctx.ensureArchiveDirs();
  }

  let normalized = items.map((item) => ({
    ...item,
    id: String(item.id),
    mediaType: item.mediaType || mediaType,
  }));
  const commonsItems = normalized.filter(item => item.provider === "commons");
  if (commonsItems.length) {
    if (commonsItems.some(item => item.mediaType !== "image")) throw new Error("Wikimedia Commons 目前只支援圖片。");
    const verified = await resolveCommonsFiles(commonsItems.map(item => item.id));
    normalized = normalized.map(item => {
      if (item.provider !== "commons") return item;
      const canonical = verified.find(row => row.id === item.id);
      if (!canonical) throw new Error(`Commons #${item.id} 無法確認可商用授權，已停止下載。`);
      const downloadSize = (canonical.sizes || []).some(row => row.id === item.downloadSize)
        ? item.downloadSize
        : canonical.downloadSize;
      return { ...canonical, downloadSize };
    });
  }

  const result = await downloadSelected(ctx, normalized, query, {
    confirmLicense,
    interactive: false,
    licenseSize: payload.licenseSize || "huge",
    videoLicenseSize: payload.videoLicenseSize || "hd",
    mediaType,
  });

  const copies = [];
  const available = [...result.downloaded, ...result.existing];
  if (slotId) {
    for (const item of available) {
      copies.push(copyArchiveToSlot(ctx, item, slotId));
    }
  }

  return {
    downloaded: result.downloaded.length,
    existing: result.existing.length,
    skipped: result.skipped.map(({ item, reason }) => ({ provider: item.provider, id: item.id, reason })),
    failed: result.failed.map(({ item, error }) => ({ provider: item.provider, id: item.id, error })),
    copies,
    files: available.map((item) => ({
      provider: item.provider,
      id: item.id,
      filename: filenameForMedia(item),
      ...(item.provider === "commons" ? {licenseFilename: filenameForMedia(item) + ".license.txt"} : {}),
    })),
  };
}

async function searchStockBySlot(ctx, slotId, options = {}) {
  const { manifest, slot } = findSlot(ctx, slotId);
  const allQueries = slotQueries(slot);
  if (allQueries.length === 0) {
    throw new Error(`Slot "${slotId}" has no query.`);
  }

  const queries = options.precise ? [allQueries[0]] : allQueries;
  const mediaType = slotMediaType(slot);
  const merged = [];
  const seen = new Set();
  const errors = [];

  for (const query of queries) {
    const payload = await searchStock(ctx, {
      ...options,
      query,
      queryEn: slot.queryEn || options.queryEn || "",
      mediaType,
    });
    for (const item of payload.results) {
      const key = `${item.provider}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...item, searchQuery: query });
    }
    for (const row of payload.errors || []) {
      errors.push({ ...row, searchQuery: query });
    }
  }

  return {
    slotId,
    slotFile: slot.file,
    queries,
    query: queries[0],
    mediaType,
    orientation: ORIENTATION,
    precise: Boolean(options.precise),
    results: merged,
    errors,
    status: getProviderStatus(),
    manifestProject: manifest.project || "",
  };
}

function getSlotSearchPlan(ctx, slotId) {
  const { slot } = findSlot(ctx, slotId);
  return {
    slotId,
    slotFile: slot.file,
    mediaType: slotMediaType(slot),
    queries: slotQueries(slot),
  };
}

module.exports = {
  ALL_PROVIDERS,
  FREE_PROVIDERS,
  getProviderStatus,
  listSlots,
  slotQueries,
  searchStock,
  searchStockBySlot,
  getSlotSearchPlan,
  downloadStockItems,
  copyArchiveToSlot,
  findSlot,
};
