const fs = require("fs");
const path = require("path");
const { hasSearchCredentials, hasLicenseCredentials, searchShutterstock, searchShutterstockVideos } = require("./shutterstock");
const { searchPixabayImages, searchPixabayVideos } = require("./pixabay");
const { searchPexelsVideos } = require("./pexels-video");
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

const FREE_PROVIDERS = ["unsplash", "pixabay", "pexels"];
const ALL_PROVIDERS = ["shutterstock", ...FREE_PROVIDERS];

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
  };

  return results.map((item) => ({
    ...item,
    downloaded: sets[item.provider]?.has(item.id) || false,
  }));
}

async function searchStock(ctx, options = {}) {
  const query = String(options.query || "").trim();
  if (!query) {
    throw new Error("Missing search query.");
  }

  const mediaType = options.mediaType === "video" ? "video" : "image";
  const freeOnly = Boolean(options.freeOnly);
  const includeDownloaded = Boolean(options.includeDownloaded);
  const providers = parseProviders(options.providers, freeOnly);
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

  const groups = { shutterstock: [], unsplash: [], pixabay: [], pexels: [] };
  const errors = [];

  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const pixabayKey = process.env.PIXABAY_API_KEY || "";

  if (providers.includes("shutterstock") && status.shutterstock) {
    try {
      const rows =
        mediaType === "video"
          ? await searchShutterstockVideos(query, {
              perPage: PER_PAGE,
              sort: shutterstockSearch.sort,
              region: shutterstockSearch.region,
            })
          : await searchShutterstock(query, {
              perPage: PER_PAGE,
              orientation: ORIENTATION === "landscape" ? "horizontal" : ORIENTATION,
              sort: shutterstockSearch.sort,
              region: shutterstockSearch.region,
            });
      groups.shutterstock = rows;
    } catch (err) {
      errors.push({ provider: "shutterstock", message: err.message });
    }
  }

  if (providers.includes("unsplash") && status.unsplash && mediaType === "image") {
    try {
      groups.unsplash = await searchUnsplash(query, unsplashKey);
    } catch (err) {
      errors.push({ provider: "unsplash", message: err.message });
    }
  }

  if (providers.includes("pixabay") && status.pixabay) {
    try {
      groups.pixabay =
        mediaType === "video"
          ? await searchPixabayVideos(query, pixabayKey, { perPage: PER_PAGE })
          : await searchPixabayImages(query, pixabayKey, { perPage: PER_PAGE, orientation: ORIENTATION });
    } catch (err) {
      errors.push({ provider: "pixabay", message: err.message });
    }
  }

  if (providers.includes("pexels") && status.pexels) {
    try {
      groups.pexels =
        mediaType === "video"
          ? await searchPexelsVideos(query, pexelsKey, { perPage: PER_PAGE, orientation: ORIENTATION })
          : await searchPexels(query, pexelsKey);
    } catch (err) {
      errors.push({ provider: "pexels", message: err.message });
    }
  }

  const priority = freeOnly
    ? manifest.providerPriority?.filter((p) => p !== "shutterstock") || FREE_PROVIDERS
    : manifest.providerPriority || DEFAULT_PROVIDER_PRIORITY;

  let results = mergeByPriority(groups, priority).map((item) => ({
    ...item,
    mediaType: item.mediaType || mediaType,
  }));

  results = markDownloaded(ctx, results, mediaType);
  if (!includeDownloaded) {
    results = results.filter((item) => !item.downloaded);
  }

  return {
    query,
    mediaType,
    orientation: ORIENTATION,
    perPage: PER_PAGE,
    providers,
    freeOnly,
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

  if (mediaType === "video") {
    ctx.ensureVideoArchiveDirs();
  } else {
    ctx.ensureArchiveDirs();
  }

  const normalized = items.map((item) => ({
    ...item,
    id: String(item.id),
    mediaType: item.mediaType || mediaType,
  }));

  await downloadSelected(ctx, normalized, query, {
    confirmLicense,
    interactive: false,
    licenseSize: payload.licenseSize || "huge",
    videoLicenseSize: payload.videoLicenseSize || "hd",
    mediaType,
  });

  const copies = [];
  if (slotId) {
    for (const item of normalized) {
      copies.push(copyArchiveToSlot(ctx, item, slotId));
    }
  }

  return {
    downloaded: normalized.length,
    copies,
    files: normalized.map((item) => ({
      provider: item.provider,
      id: item.id,
      filename: filenameForMedia(item),
    })),
  };
}

async function searchStockBySlot(ctx, slotId, options = {}) {
  const { manifest, slot } = findSlot(ctx, slotId);
  const queries = slotQueries(slot);
  if (queries.length === 0) {
    throw new Error(`Slot "${slotId}" has no query.`);
  }

  const mediaType = slotMediaType(slot);
  const merged = [];
  const seen = new Set();
  const errors = [];

  for (const query of queries) {
    const payload = await searchStock(ctx, {
      ...options,
      query,
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
