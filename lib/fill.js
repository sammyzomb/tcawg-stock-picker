const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  hasSearchCredentials,
  hasLicenseCredentials,
  searchShutterstock,
  licenseShutterstockImages,
  searchShutterstockVideos,
  licenseShutterstockVideos,
  sortShutterstockByRank,
  shutterstockRankScore,
} = require("./shutterstock");
const {
  DEFAULT_PROVIDER_PRIORITY,
  mergeByPriority,
  pickByPriority,
} = require("./provider-priority");
const { searchPexelsVideos } = require("./pexels-video");
const {
  isVideoSlot,
  getProviderPriorityForSlot,
  filenameForMedia,
  creditsPathForProvider,
  archiveDirsForMediaType,
} = require("./slot-media");

const ORIENTATION = "landscape";
const PER_PAGE = 15;
const DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const flags = {
    all: false,
    weak: false,
    slot: "",
    help: false,
    rebuildOnly: false,
    freeOnly: false,
    confirmLicense: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--weak") flags.weak = true;
    else if (arg === "--rebuild-only") flags.rebuildOnly = true;
    else if (arg === "--free-only") flags.freeOnly = true;
    else if (arg === "--confirm-license") flags.confirmLicense = true;
    else if (arg === "--slot") {
      flags.slot = (argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return flags;
}

function printHelp() {
  console.log(`
Batch fill image slots — Shutterstock first, then Unsplash/Pexels.

Usage:
  node scripts/fill-slots.js --all              Replace all slots (Shutterstock if licensed)
  node scripts/fill-slots.js --all --free-only  Skip Shutterstock licensing, use free sources
  node scripts/fill-slots.js --weak             Replace only small/low-quality files
  node scripts/fill-slots.js --slot <id>        Fill one slot
  node scripts/fill-slots.js --rebuild-only     Rebuild 圖片授權說明.md from credits

Options:
  --confirm-license  Skip interactive confirm before Shutterstock batch licensing
  -h, --help         Show help
`);
}

function getShutterstockSearchOptions(manifest) {
  return {
    sort: manifest.shutterstockSort || "popular",
    region: manifest.shutterstockRegion || "",
  };
}

function upsertShutterstockCandidate(pool, seen, photo, queryIndex) {
  const candidate = {
    ...photo,
    downloadUrl: photo.previewUrl,
    queryIndex,
  };
  if (!seen.has(photo.id)) {
    seen.add(photo.id);
    pool.push(candidate);
    return;
  }

  const existing = pool.find((row) => row.id === photo.id);
  if (!existing) return;
  if (shutterstockRankScore(candidate) < shutterstockRankScore(existing)) {
    existing.sstkRank = candidate.sstkRank;
    existing.queryIndex = candidate.queryIndex;
    existing.sstkSort = candidate.sstkSort;
    existing.qualityScore = candidate.qualityScore;
    existing.assetWidth = candidate.assetWidth;
    existing.assetHeight = candidate.assetHeight;
    existing.description = candidate.description;
    existing.previewUrl = candidate.previewUrl;
    existing.downloadUrl = candidate.downloadUrl;
  }
}

function getProviderPriority(manifest, flags, slot = null) {
  if (slot) return getProviderPriorityForSlot(manifest, slot, flags);
  const base = manifest.providerPriority || DEFAULT_PROVIDER_PRIORITY;
  if (flags.freeOnly || !hasLicenseCredentials()) {
    return base.filter((provider) => provider !== "shutterstock");
  }
  return base;
}

function loadCredits(ctx, provider, mediaType = "image") {
  const file = creditsPathForProvider(ctx, provider, mediaType);
  if (!file || !fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveCredits(ctx, provider, entries, mediaType = "image") {
  const file = creditsPathForProvider(ctx, provider, mediaType);
  if (!file) return;
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function slotDimensions(file) {
  if (file.startsWith("wildlife/")) return { w: 800, h: 600, minBytes: 20000 };
  if (file.startsWith("spots/")) return { w: 480, h: 360, minBytes: 15000 };
  return { w: 1920, h: 1080, minBytes: 50000 };
}


function isWeakFile(filePath) {
  if (!fs.existsSync(filePath)) return true;
  return fs.statSync(filePath).size < 45000;
}

async function searchPexels(query, apiKey) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", ORIENTATION);
  url.searchParams.set("per_page", String(PER_PAGE));

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.photos || []).map((photo) => ({
    provider: "pexels",
    id: String(photo.id),
    photographer: photo.photographer || "Unknown",
    photographerUrl: photo.photographer_url || "",
    photoPageUrl: photo.url || `https://www.pexels.com/photo/${photo.id}/`,
    pexelsPhotoUrl: photo.url || `https://www.pexels.com/photo/${photo.id}/`,
    unsplashPhotoUrl: "",
    downloadUrl:
      photo.src?.large2x ||
      photo.src?.large ||
      photo.src?.original ||
      photo.src?.medium,
  }));
}

async function searchUnsplash(query, accessKey) {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", ORIENTATION);
  url.searchParams.set("per_page", String(PER_PAGE));

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Unsplash API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.results || []).map((photo) => ({
    provider: "unsplash",
    id: String(photo.id),
    photographer: photo.user?.name || "Unknown",
    photographerUrl: photo.user?.links?.html || "",
    photoPageUrl: photo.links?.html || `https://unsplash.com/photos/${photo.id}`,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: photo.links?.html || `https://unsplash.com/photos/${photo.id}`,
    downloadUrl: photo.urls?.raw || photo.urls?.full || photo.urls?.regular,
  }));
}

function sizedUrl(item, w, h) {
  if (item.provider === "unsplash") {
    const base = item.downloadUrl.split("?")[0];
    return `${base}?auto=format&fit=crop&w=${w}&h=${h}&q=85`;
  }
  const joiner = item.downloadUrl.includes("?") ? "&" : "?";
  return `${item.downloadUrl}${joiner}auto=compress&cs=tinysrgb&w=${w}&h=${h}&fit=crop`;
}

function toCreditEntry(item, query, slotId, targetFile) {
  return {
    id: item.id,
    provider: item.provider,
    mediaType: item.mediaType || "image",
    filename: filenameForMedia(item),
    slotId,
    targetFile,
    searchKeyword: query,
    photographer: item.photographer,
    photographerUrl: item.photographerUrl,
    pexelsPhotoUrl: item.pexelsPhotoUrl,
    unsplashPhotoUrl: item.unsplashPhotoUrl,
    shutterstockPhotoUrl: item.shutterstockPhotoUrl || "",
    photoPageUrl: item.photoPageUrl,
    downloadedAt: new Date().toISOString(),
  };
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
  return buffer.length;
}

async function trackUnsplashDownload(id, accessKey) {
  try {
    await fetch(`https://api.unsplash.com/photos/${id}/download`, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
  } catch {
    /* best-effort */
  }
}

function upsertCredit(ctx, provider, entry, mediaType = "image") {
  const credits = loadCredits(ctx, provider, mediaType);
  const next = credits.filter((row) => String(row.id) !== String(entry.id));
  next.push(entry);
  saveCredits(ctx, provider, next, mediaType);
}

function pickCandidate(candidates, usedKeys, slotIndex, priority) {
  return pickByPriority(candidates, usedKeys, slotIndex, priority);
}

async function searchAllQueries(slot, pexelsKey, unsplashKey, skipPexels, options = {}) {
  const { freeOnly = false, priority = DEFAULT_PROVIDER_PRIORITY, shutterstockSearch = {} } = options;
  const queries = [slot.query, ...(slot.altQueries || [])];
  const groups = { shutterstock: [], unsplash: [], pexels: [] };
  const seen = { shutterstock: new Set(), unsplash: new Set(), pexels: new Set() };

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    if (!freeOnly && hasSearchCredentials()) {
      try {
        for (const photo of await searchShutterstock(query, {
          perPage: PER_PAGE,
          orientation: ORIENTATION === "landscape" ? "horizontal" : ORIENTATION,
          sort: shutterstockSearch.sort,
          region: shutterstockSearch.region,
          queryIndex,
        })) {
          upsertShutterstockCandidate(groups.shutterstock, seen.shutterstock, photo, queryIndex);
        }
      } catch (err) {
        console.warn(`  Shutterstock "${query}": ${err.message}`);
      }
    }

    if (unsplashKey) {
      try {
        for (const photo of await searchUnsplash(query, unsplashKey)) {
          if (!seen.unsplash.has(photo.id)) {
            seen.unsplash.add(photo.id);
            groups.unsplash.push(photo);
          }
        }
      } catch (err) {
        if (String(err.message).includes("403")) throw err;
        console.warn(`  Unsplash "${query}": ${err.message}`);
      }
    }

    if (pexelsKey && !skipPexels) {
      try {
        for (const photo of await searchPexels(query, pexelsKey)) {
          if (!seen.pexels.has(photo.id)) {
            seen.pexels.add(photo.id);
            groups.pexels.push(photo);
          }
        }
      } catch (err) {
        if (String(err.message).includes("401")) {
          skipPexels = true;
          console.warn("  Pexels disabled (invalid API key).");
        } else {
          console.warn(`  Pexels "${query}": ${err.message}`);
        }
      }
    }

    const merged = mergeByPriority(groups, priority);
    if (merged.length >= PER_PAGE) break;
  }

  groups.shutterstock = sortShutterstockByRank(groups.shutterstock);
  return { merged: mergeByPriority(groups, priority), skipPexels };
}

async function searchVideoAllQueries(slot, pexelsKey, options = {}) {
  const { freeOnly = false, priority = ["shutterstock", "pexels"], shutterstockSearch = {} } = options;
  const queries = [slot.query, ...(slot.altQueries || [])];
  const groups = { shutterstock: [], pexels: [] };
  const seen = { shutterstock: new Set(), pexels: new Set() };

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    if (!freeOnly && hasSearchCredentials()) {
      try {
        for (const video of await searchShutterstockVideos(query, {
          perPage: PER_PAGE,
          sort: shutterstockSearch.sort,
          region: shutterstockSearch.region,
          queryIndex,
        })) {
          upsertShutterstockCandidate(groups.shutterstock, seen.shutterstock, video, queryIndex);
        }
      } catch (err) {
        console.warn(`  Shutterstock video "${query}": ${err.message}`);
      }
    }

    if (pexelsKey) {
      try {
        for (const video of await searchPexelsVideos(query, pexelsKey, { perPage: PER_PAGE })) {
          if (!seen.pexels.has(video.id)) {
            seen.pexels.add(video.id);
            groups.pexels.push(video);
          }
        }
      } catch (err) {
        console.warn(`  Pexels video "${query}": ${err.message}`);
      }
    }

    const merged = mergeByPriority(groups, priority);
    if (merged.length >= PER_PAGE) break;
  }

  groups.shutterstock = sortShutterstockByRank(groups.shutterstock);
  return { merged: mergeByPriority(groups, priority) };
}

async function fillVideoSlot(ctx, slot, manifest, usedKeys, pexelsKey, slotIndex, flags) {
  const dest = ctx.targetPath(manifest, slot);
  const minBytes = 100000;
  const priority = getProviderPriority(manifest, flags, slot);
  const shutterstockSearch = getShutterstockSearchOptions(manifest);

  let merged;
  try {
    ({ merged } = await searchVideoAllQueries(slot, pexelsKey, {
      freeOnly: flags.freeOnly,
      priority,
      shutterstockSearch,
    }));
  } catch (err) {
    return { ok: false, slot: slot.id, reason: err.message };
  }

  const pickedWrap = pickCandidate(merged, usedKeys, slotIndex, priority);
  if (!pickedWrap) {
    return { ok: false, slot: slot.id, reason: "no video search results" };
  }
  const picked = pickedWrap.item;
  const archivePath = path.join(
    archiveDirsForMediaType(ctx, "video")[picked.provider],
    filenameForMedia(picked)
  );
  let bytes;
  const entry = toCreditEntry(picked, slot.query, slot.id, slot.file);

  if (picked.provider === "shutterstock") {
    const licensed = await licenseShutterstockVideos([picked.id], { size: "hd" });
    const row = licensed.find((item) => item.videoId === String(picked.id));
    if (!row?.downloadUrl) {
      return { ok: false, slot: slot.id, reason: "shutterstock video license failed" };
    }
    bytes = await downloadFile(row.downloadUrl, dest);
    entry.licenseSize = "hd";
    entry.allotmentCharge = row.allotmentCharge;
    entry.licensedAt = new Date().toISOString();
    entry.shutterstockPhotoUrl = picked.shutterstockPhotoUrl || picked.photoPageUrl;
  } else {
    bytes = await downloadFile(picked.downloadUrl, dest);
  }

  if (bytes < minBytes) {
    return { ok: false, slot: slot.id, reason: `too small (${bytes} bytes)` };
  }

  if (!fs.existsSync(archivePath)) {
    fs.copyFileSync(dest, archivePath);
  }

  upsertCredit(ctx, picked.provider, entry, "video");
  usedKeys.add(`${picked.provider}:${picked.id}`);
  const rankTag =
    picked.provider === "shutterstock"
      ? ` rank #${(picked.sstkRank ?? 0) + 1} (${picked.sstkSort || shutterstockSearch.sort})`
      : "";
  return {
    ok: true,
    slot: slot.id,
    file: slot.file,
    provider: picked.provider,
    id: picked.id,
    bytes,
    reused: pickedWrap.reused,
    rankTag,
    hash: crypto.createHash("md5").update(fs.readFileSync(dest)).digest("hex"),
  };
}

async function fillSlot(ctx, slot, manifest, usedKeys, pexelsKey, unsplashKey, skipPexels, slotIndex, flags) {
  if (isVideoSlot(slot)) {
    return fillVideoSlot(ctx, slot, manifest, usedKeys, pexelsKey, slotIndex, flags);
  }

  const dest = ctx.targetPath(manifest, slot);
  const { w, h, minBytes } = slotDimensions(slot.file);
  const priority = getProviderPriority(manifest, flags, slot);
  const shutterstockSearch = getShutterstockSearchOptions(manifest);

  let merged;
  try {
    ({ merged, skipPexels } = await searchAllQueries(slot, pexelsKey, unsplashKey, skipPexels, {
      freeOnly: flags.freeOnly,
      priority,
      shutterstockSearch,
    }));
  } catch (err) {
    return { ok: false, slot: slot.id, reason: err.message, skipPexels };
  }

  const pickedWrap = pickCandidate(merged, usedKeys, slotIndex, priority);
  if (!pickedWrap) {
    return { ok: false, slot: slot.id, reason: "no search results", skipPexels };
  }
  const picked = pickedWrap.item;

  const archivePath = path.join(ctx.archiveDirs[picked.provider], filenameForMedia(picked));
  let bytes;
  const entry = toCreditEntry(picked, slot.query, slot.id, slot.file);

  if (picked.provider === "shutterstock") {
    const licensed = await licenseShutterstockImages([picked.id], { size: "huge" });
    const row = licensed.find((item) => item.imageId === String(picked.id));
    if (!row?.downloadUrl) {
      return { ok: false, slot: slot.id, reason: "shutterstock license failed", skipPexels };
    }
    bytes = await downloadFile(row.downloadUrl, dest);
    entry.licenseSize = "huge";
    entry.allotmentCharge = row.allotmentCharge;
    entry.licensedAt = new Date().toISOString();
    entry.shutterstockPhotoUrl = picked.shutterstockPhotoUrl || picked.photoPageUrl;
  } else {
    const url = sizedUrl(picked, w, h);
    bytes = await downloadFile(url, dest);
  }

  if (bytes < minBytes) {
    return { ok: false, slot: slot.id, reason: `too small (${bytes} bytes)`, skipPexels };
  }

  if (!fs.existsSync(archivePath)) {
    fs.copyFileSync(dest, archivePath);
  }

  upsertCredit(ctx, picked.provider, entry);
  if (picked.provider === "unsplash" && unsplashKey) {
    await trackUnsplashDownload(picked.id, unsplashKey);
  }

  usedKeys.add(`${picked.provider}:${picked.id}`);
  const rankTag =
    picked.provider === "shutterstock"
      ? ` rank #${(picked.sstkRank ?? 0) + 1} (${picked.sstkSort || shutterstockSearch.sort})`
      : "";
  return {
    ok: true,
    slot: slot.id,
    file: slot.file,
    provider: picked.provider,
    id: picked.id,
    bytes,
    reused: pickedWrap.reused,
    rankTag,
    hash: crypto.createHash("md5").update(fs.readFileSync(dest)).digest("hex"),
    skipPexels,
  };
}

function loadUsedKeysFromCredits(ctx) {
  const set = new Set();
  for (const provider of ["shutterstock", "unsplash", "pexels", "commons"]) {
    for (const row of loadCredits(ctx, provider, "image")) {
      if (row?.id) set.add(`${provider}:${String(row.id)}`);
    }
  }
  for (const provider of ["shutterstock", "pexels"]) {
    for (const row of loadCredits(ctx, provider, "video")) {
      if (row?.id) set.add(`${provider}:${String(row.id)}`);
    }
  }
  return set;
}

function rebuildLicenseFromCredits(ctx, manifest) {
  const rows = [];
  for (const slot of manifest.slots) {
    const credit =
      loadCredits(ctx, "shutterstock", "image").find((c) => c.slotId === slot.id) ||
      loadCredits(ctx, "shutterstock", "video").find((c) => c.slotId === slot.id) ||
      loadCredits(ctx, "commons", "image").find((c) => c.slotId === slot.id) ||
      loadCredits(ctx, "unsplash", "image").find((c) => c.slotId === slot.id) ||
      loadCredits(ctx, "pexels", "image").find((c) => c.slotId === slot.id) ||
      loadCredits(ctx, "pexels", "video").find((c) => c.slotId === slot.id);
    if (!credit) continue;
    rows.push({
      ok: true,
      slot: slot.id,
      file: slot.file,
      provider: credit.provider,
      id: credit.id,
      photographer: credit.photographer,
      unsplashUrl: credit.unsplashPhotoUrl,
      pexelsUrl: credit.pexelsPhotoUrl,
      shutterstockUrl: credit.shutterstockPhotoUrl,
      commonsUrl: credit.commonsPhotoUrl,
      license: credit.license,
    });
  }
  updateLicenseMarkdown(ctx, manifest, rows);
}

function writeShutterManifest(ctx, manifest, results) {
  const out = ctx.creditsManifestPath(manifest);
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        project: manifest.project,
        updatedAt: new Date().toISOString(),
        images: results.filter((r) => r.ok),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function updateLicenseMarkdown(ctx, manifest, results) {
  const mdPath = ctx.licenseMarkdownPath(manifest);
  const ok = results.filter((r) => r.ok);
  const main = ok.filter((r) => !r.file.includes("/"));
  const wildlife = ok.filter((r) => r.file.startsWith("wildlife/"));
  const spots = ok.filter((r) => r.file.startsWith("spots/"));

  function row(r) {
    let src = r.id;
    if (r.provider === "shutterstock") {
      src = `[Shutterstock](${r.shutterstockUrl || "https://www.shutterstock.com/"}) ${r.id}`;
    } else if (r.provider === "commons") {
      src = `[Wikimedia Commons](${r.commonsUrl || "https://commons.wikimedia.org/"}) ${r.license || "CC BY 2.0"}`;
    } else if (r.provider === "unsplash") {
      src = `[Unsplash](${r.unsplashUrl || "https://unsplash.com/"}) ${r.id}`;
    } else {
      src = `[Pexels](${r.pexelsUrl || "https://www.pexels.com/"}) ${r.id}`;
    }
    return `| \`${r.file}\` | ${r.slot} | ${r.photographer} | ${src} |`;
  }

  const enriched = ok.map((r) => {
    const slot = manifest.slots.find((s) => s.id === r.slot);
    const mediaType = slot ? (isVideoSlot(slot) ? "video" : "image") : "image";
    const credit =
      loadCredits(ctx, r.provider, mediaType).find((c) => String(c.id) === String(r.id)) || {};
    return {
      ...r,
      photographer: credit.photographer || r.photographer || "Unknown",
      unsplashUrl: credit.unsplashPhotoUrl,
      pexelsUrl: credit.pexelsPhotoUrl,
      shutterstockUrl: credit.shutterstockPhotoUrl,
      commonsUrl: credit.commonsPhotoUrl,
      license: credit.license,
    };
  });

  const body = `# UIO16A 行程圖片

來源：**Shutterstock**（訂閱授權）、**Unsplash**（[License](https://unsplash.com/license)）、**Pexels**（[License](https://www.pexels.com/license/)）、**Wikimedia Commons**（[CC BY 2.0](https://creativecommons.org/licenses/by/2.0) 等）。

> 正式上線請替換為自有授權圖片，上傳至官網  
> \`https://www.tcawg.com/data/images/202609/UIO16A/\`

更新方式：\`node scripts/fill-slots.js --all\`（預設 Shutterstock 優先）

## 主圖（${main.length} 張）

| 檔名 | Slot | 攝影師 | 來源 |
|------|------|--------|------|
${enriched
  .filter((r) => !r.file.includes("/"))
  .map(row)
  .join("\n")}

## 野生動物（\`wildlife/\`）

| 檔名 | Slot | 攝影師 | 來源 |
|------|------|--------|------|
${enriched
  .filter((r) => r.file.startsWith("wildlife/"))
  .map(row)
  .join("\n")}

## 景點小圖（\`spots/\`）

| 檔名 | Slot | 攝影師 | 來源 |
|------|------|--------|------|
${enriched
  .filter((r) => r.file.startsWith("spots/"))
  .map(row)
  .join("\n")}

最後更新：${new Date().toISOString().slice(0, 10)}（API 自動批次）
`;

  fs.writeFileSync(mdPath, body, "utf8");
}

async function runFill(argv, ctx) {
  const flags = parseArgs(argv);
  if (flags.help || (!flags.all && !flags.weak && !flags.slot && !flags.rebuildOnly)) {
    printHelp();
    return flags.help ? 0 : 1;
  }

  const manifest = ctx.loadManifest();

  if (flags.rebuildOnly) {
    rebuildLicenseFromCredits(ctx, manifest);
    console.log("Rebuilt 圖片授權說明.md from credits.");
    return 0;
  }
  ctx.ensureAllArchiveDirs();

  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  if (!pexelsKey && !unsplashKey && !hasSearchCredentials()) {
    console.error("Missing media API keys in .env (run scripts/setup-env.ps1).");
    return 1;
  }

  if (
    !flags.freeOnly &&
    hasLicenseCredentials() &&
    (flags.all || flags.weak) &&
    !flags.confirmLicense &&
    !flags.slot
  ) {
    console.log(
      "Shutterstock is PRIMARY — batch fill will license images and charge subscription credits."
    );
    console.log("Use --free-only to skip Shutterstock, or --confirm-license to proceed silently.\n");
    return 1;
  }

  let slots = manifest.slots;
  if (flags.slot) {
    slots = slots.filter((s) => s.id === flags.slot);
    if (slots.length === 0) {
      console.error(`Unknown slot: ${flags.slot}`);
      return 1;
    }
  } else if (flags.weak) {
    slots = slots.filter((s) => isWeakFile(ctx.targetPath(manifest, s)));
  }

  const usedKeys = loadUsedKeysFromCredits(ctx);
  const results = [];
  let skipPexels = false;

  const imageCount = slots.filter((s) => !isVideoSlot(s)).length;
  const videoCount = slots.length - imageCount;
  console.log(
    `Filling ${slots.length} slot(s) (${imageCount} image, ${videoCount} video)... default image priority: ${getProviderPriority(manifest, flags).join(" → ")}\n`
  );

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const dest = ctx.targetPath(manifest, slot);
    if (!flags.all && !flags.slot && flags.weak && !isWeakFile(dest)) {
      continue;
    }
    if (!flags.all && !flags.weak && !flags.slot && fs.existsSync(dest)) {
      continue;
    }

    process.stdout.write(`[${slot.id}] ${slot.file} ... `);
    try {
      const result = await fillSlot(ctx, slot, manifest, usedKeys, pexelsKey, unsplashKey, skipPexels, i, flags);
      if (result.skipPexels !== undefined) skipPexels = result.skipPexels;
      const existing = results.findIndex((r) => r.slot === slot.id);
      if (existing >= 0) results[existing] = result;
      else results.push(result);
      if (result.ok) {
        const tag = result.reused ? " (reused id)" : result.rankTag || "";
        console.log(`OK ${result.provider}#${result.id} (${Math.round(result.bytes / 1024)} KB)${tag}`);
      } else {
        console.log(`FAIL ${result.reason}`);
      }
    } catch (err) {
      results.push({ ok: false, slot: slot.id, reason: err.message });
      console.log(`ERROR ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  const failedIds = results.filter((r) => !r.ok).map((r) => r.slot);
  if (failedIds.length > 0 && (flags.all || flags.weak)) {
    console.log(`\nRetrying ${failedIds.length} failed slot(s) after 90s pause...`);
    await sleep(90000);
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (!failedIds.includes(slot.id)) continue;
      process.stdout.write(`[retry ${slot.id}] ${slot.file} ... `);
      try {
        const result = await fillSlot(ctx, slot, manifest, usedKeys, pexelsKey, unsplashKey, skipPexels, i, flags);
        if (result.skipPexels !== undefined) skipPexels = result.skipPexels;
        const existing = results.findIndex((r) => r.slot === slot.id);
        results[existing] = result;
        if (result.ok) {
          console.log(`OK ${result.provider}#${result.id} (${Math.round(result.bytes / 1024)} KB)`);
        } else {
          console.log(`FAIL ${result.reason}`);
        }
      } catch (err) {
        console.log(`ERROR ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nDone: ${okCount}/${results.length} succeeded.`);

  writeShutterManifest(ctx, manifest, results);
  rebuildLicenseFromCredits(ctx, manifest);
  if (okCount > 0) {
    console.log("Updated shutter-credits.json and 圖片授權說明.md");
  }

  const hashes = new Map();
  for (const slot of manifest.slots) {
    const p = ctx.targetPath(manifest, slot);
    if (!fs.existsSync(p)) continue;
    const hash = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
    if (hashes.has(hash)) {
      console.warn(`DUPLICATE HASH: ${slot.file} == ${hashes.get(hash)}`);
    } else {
      hashes.set(hash, slot.file);
    }
  }
}

module.exports = {
  runFill,
  parseArgs,
  printHelp,
};
