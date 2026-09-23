const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  hasSearchCredentials,
  hasLicenseCredentials,
  searchShutterstock,
  licenseShutterstockImages,
  searchShutterstockVideos,
  licenseShutterstockVideos,
} = require("./shutterstock");
const { searchPexelsVideos } = require("./pexels-video");
const { searchPixabayImages, searchPixabayVideos } = require("./pixabay");
const {
  slotMediaType,
  filenameForMedia,
  creditsPathForProvider,
} = require("./slot-media");
const { runQuota } = require("./quota");

const PER_PAGE = 20;
const ORIENTATION = "landscape";

function parseArgs(argv) {
  const flags = {
    pexelsOnly: false,
    unsplashOnly: false,
    pixabayOnly: false,
    shutterstockOnly: false,
    help: false,
    checkKeys: false,
    checkQuota: false,
    listSlots: false,
    confirmLicense: false,
    slot: "",
    licenseSize: "huge",
    videoLicenseSize: "hd",
    video: false,
    image: false,
  };
  const queryParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--pexels-only") flags.pexelsOnly = true;
    else if (arg === "--unsplash-only") flags.unsplashOnly = true;
    else if (arg === "--pixabay-only") flags.pixabayOnly = true;
    else if (arg === "--shutterstock-only") flags.shutterstockOnly = true;
    else if (arg === "--check-keys") flags.checkKeys = true;
    else if (arg === "--check-quota") flags.checkQuota = true;
    else if (arg === "--list-slots") flags.listSlots = true;
    else if (arg === "--confirm-license") flags.confirmLicense = true;
    else if (arg === "--size") {
      flags.licenseSize = (argv[i + 1] || "huge").trim();
      i += 1;
    } else if (arg === "--video-size") {
      flags.videoLicenseSize = (argv[i + 1] || "hd").trim();
      i += 1;
    } else if (arg === "--video") flags.video = true;
    else if (arg === "--image") flags.image = true;
    else if (arg === "--slot") {
      flags.slot = (argv[i + 1] || "").trim();
      i += 1;
    } else queryParts.push(arg);
  }

  const onlyCount = [flags.pexelsOnly, flags.unsplashOnly, flags.pixabayOnly, flags.shutterstockOnly].filter(
    Boolean
  ).length;
  if (onlyCount > 1) {
    throw new Error("Use only one of --pexels-only, --unsplash-only, --pixabay-only, --shutterstock-only.");
  }
  if (flags.video && flags.image) {
    throw new Error("Use only one of --video, --image.");
  }

  return { flags, query: queryParts.join(" ").trim() };
}

function resolveMediaType(flags, slotMeta) {
  if (flags.video) return "video";
  if (flags.image) return "image";
  if (slotMeta) return slotMediaType(slotMeta);
  return "image";
}

function loadSlotsManifest(ctx) {
  return ctx.loadManifest();
}

function findSlotById(manifest, slotId) {
  const slot = manifest.slots.find((row) => row.id === slotId);
  if (!slot) {
    const ids = manifest.slots.map((row) => row.id).join(", ");
    throw new Error(`Unknown slot "${slotId}". Available: ${ids}`);
  }
  return slot;
}

function printSlotList(manifest) {
  console.log(`\n${manifest.project || "Project"} media slots (${manifest.slots.length}):\n`);
  for (const slot of manifest.slots) {
    const kind = slotMediaType(slot);
    console.log(`  ${slot.id.padEnd(22)} [${kind}] -> ${slot.file}`);
    console.log(`    query: ${slot.query}`);
  }
  console.log(`\nUse: node scripts/find-images.js --slot <id>\n`);
}

function printKeyStatus(ctx) {
  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const pixabayKey = process.env.PIXABAY_API_KEY || "";
  const envExists = fs.existsSync(ctx.envFile);

  console.log("\nAPI key status:\n");
  console.log(`  .env file     : ${envExists ? ".env" : "missing (run scripts/setup-env.ps1)"}`);
  console.log(`  PEXELS        : ${pexelsKey ? "SET" : "MISSING"}`);
  console.log(`  UNSPLASH      : ${unsplashKey ? "SET" : "MISSING"}`);
  console.log(`  PIXABAY       : ${pixabayKey ? "SET" : "MISSING"}`);
  console.log(`  SHUTTERSTOCK  : ${hasSearchCredentials() ? "SEARCH OK" : "MISSING (token or key/secret)"}`);
  console.log(
    `  SSTK LICENSE  : ${hasLicenseCredentials() ? "READY (token + subscription)" : "MISSING (need token + subscription id)"}`
  );
  console.log("");
}

function printHelp() {
  console.log(`
stock-find — search stock libraries by keyword, preview, then download (image or video).

Usage:
  stock-find [options] "search keywords in English"
  stock-find --project <dir> --slot <id>
  stock-find --video "ocean waves drone"
  stock-find --list-slots
  stock-find --check-keys

Options:
  --project <dir>       Project root (default: auto-detect)
  --slot <id>           Search using query from image-slots.json (auto image/video from slot)
  --list-slots          List all slots and queries
  --check-keys          Show whether .env keys are configured (no values printed)
  --check-quota         Show remaining API quota for Pexels / Unsplash / Pixabay / Shutterstock
  --video               Search videos (Pexels + Pixabay + Shutterstock)
  --image               Force image search (default when no --video)
  --pexels-only         Search Pexels only
  --unsplash-only       Search Unsplash only (images only)
  --pixabay-only        Search Pixabay only (supports Chinese keywords via lang=zh)
  --shutterstock-only   Search Shutterstock only
  --confirm-license     Skip YES prompt before Shutterstock licensing (charges credits!)
  --size <name>         Shutterstock image license size (default: huge)
  --video-size <name>   Shutterstock video license size (default: hd)
  -h, --help            Show this help

Environment variables (loaded from .env in project root; never commit .env):
  PEXELS_API_KEY
  UNSPLASH_ACCESS_KEY
  PIXABAY_API_KEY
  SHUTTERSTOCK_API_TOKEN (or SHUTTERSTOCK_CONSUMER_KEY + SHUTTERSTOCK_CONSUMER_SECRET)
  SHUTTERSTOCK_SUBSCRIPTION_ID (required to download Shutterstock images)

Output:
  public/images/{pexels,unsplash,pixabay,shutterstock}/  + credits.json
  public/videos/{pexels,pixabay,shutterstock}/           + credits.json

Notes:
  - Image order: Shutterstock → Unsplash → Pixabay → Pexels (see image-slots.json providerPriority)
  - Video order: Shutterstock → Pixabay → Pexels (Unsplash has no video API)
  - Pixabay auto-uses lang=zh when query contains Chinese characters
  - Slot type: set "type": "video" or use .mp4 filename in image-slots.json
  - Shutterstock search is free; download requires a paid subscription license.

Examples:
  node scripts/find-images.js --check-keys
  node scripts/find-images.js --slot hero
  node scripts/find-images.js --video "Galapagos ocean waves aerial"
  node scripts/find-images.js --slot hero-video
  node scripts/find-images.js --shutterstock-only "Galapagos marine iguana"
  node scripts/find-images.js --unsplash-only "Quito Ecuador old town"
  node scripts/find-images.js --pixabay-only "加拉巴哥 海洋"
`);
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

function downloadedIdSet(ctx, provider, mediaType = "image") {
  const set = new Set();
  for (const row of loadCredits(ctx, provider, mediaType)) {
    if (row && row.id != null) set.add(String(row.id));
  }
  return set;
}

async function searchPexels(query, apiKey) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", ORIENTATION);
  url.searchParams.set("per_page", String(PER_PAGE));

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.photos || []).map((photo) => ({
    provider: "pexels",
    id: String(photo.id),
    previewUrl: photo.src?.medium || photo.src?.small || photo.src?.original,
    photographer: photo.photographer || "Unknown",
    photographerUrl: photo.photographer_url || "",
    photoPageUrl: photo.url || `https://www.pexels.com/photo/${photo.id}/`,
    originalImageUrl: photo.src?.large2x || photo.src?.large || photo.src?.original,
    pexelsPhotoUrl: photo.url || `https://www.pexels.com/photo/${photo.id}/`,
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: "",
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
    previewUrl: photo.urls?.small || photo.urls?.thumb || photo.urls?.regular,
    photographer: photo.user?.name || "Unknown",
    photographerUrl: photo.user?.links?.html || "",
    photoPageUrl: photo.links?.html || `https://unsplash.com/photos/${photo.id}`,
    originalImageUrl: photo.urls?.regular || photo.urls?.full || photo.urls?.raw,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: photo.links?.html || `https://unsplash.com/photos/${photo.id}`,
    shutterstockPhotoUrl: "",
  }));
}

function printResults(query, results, skippedCounts, mediaType = "image") {
  const label = mediaType === "video" ? "videos" : "photos";
  console.log(`\nSearch (${mediaType}): "${query}"  |  orientation=${ORIENTATION}  |  per_page=${PER_PAGE}\n`);

  if (results.length === 0) {
    console.log(`No new ${label} to choose from (all results may already be downloaded).`);
    return;
  }

  console.log(`Select ${label} to download (comma-separated numbers, e.g. 1,3,5 | all | none):\n`);

  results.forEach((item, index) => {
    const tag = item.provider.toUpperCase();
    console.log(`[${index + 1}] ${tag}  ID ${item.id}`);
    if (item.provider === "shutterstock") {
      console.log(
        `    Rank         : #${(item.sstkRank ?? 0) + 1} (${item.sstkSort || "popular"} — API 排序，愈前愈熱門/相關)`
      );
    }
    console.log(`    Photographer : ${item.photographer}`);
    if (item.description) console.log(`    Description  : ${item.description}`);
    if (item.duration) console.log(`    Duration     : ${item.duration}s`);
    console.log(`    Preview      : ${item.previewUrl}`);
    console.log(`    Page         : ${item.photoPageUrl}`);
    if (item.requiresLicense) console.log(`    Note         : Shutterstock — download will charge subscription credits`);
    console.log("");
  });

  if (skippedCounts.pexels || skippedCounts.unsplash || skippedCounts.pixabay || skippedCounts.shutterstock) {
    console.log(
      `Already downloaded (skipped): Pexels ${skippedCounts.pexels}, Unsplash ${skippedCounts.unsplash}, Pixabay ${skippedCounts.pixabay}, Shutterstock ${skippedCounts.shutterstock}`
    );
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseSelection(input, max) {
  const normalized = input.toLowerCase();
  if (normalized === "" || normalized === "none" || normalized === "n" || normalized === "q") {
    return [];
  }
  if (normalized === "all" || normalized === "a") {
    return Array.from({ length: max }, (_, i) => i);
  }

  const indexes = new Set();
  for (const part of input.split(",")) {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new Error(`Invalid selection: "${part.trim()}" (use 1-${max})`);
    }
    indexes.add(n - 1);
  }
  return [...indexes].sort((a, b) => a - b);
}

function toCreditEntry(item, query) {
  return {
    id: item.id,
    provider: item.provider,
    mediaType: item.mediaType || "image",
    filename: filenameForMedia(item),
    searchKeyword: query,
    photographer: item.photographer,
    photographerUrl: item.photographerUrl,
    pexelsPhotoUrl: item.pexelsPhotoUrl || "",
    unsplashPhotoUrl: item.unsplashPhotoUrl || "",
    pixabayPhotoUrl: item.pixabayPhotoUrl || "",
    shutterstockPhotoUrl: item.shutterstockPhotoUrl || "",
    photoPageUrl: item.photoPageUrl,
    originalImageUrl: item.originalImageUrl,
    previewUrl: item.previewUrl,
    downloadedAt: new Date().toISOString(),
  };
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return buffer.length;
}

async function downloadSelected(ctx, selected, query, options = {}) {
  const {
    confirmLicense = false,
    licenseSize = "huge",
    videoLicenseSize = "hd",
    mediaType = "image",
  } = options;
  const shutterstockItems = selected.filter((item) => item.provider === "shutterstock");
  const mediaLabel = mediaType === "video" ? "video(s)" : "image(s)";

  if (shutterstockItems.length > 0) {
    if (!hasLicenseCredentials()) {
      throw new Error(
        "Shutterstock download requires SHUTTERSTOCK_API_TOKEN and SHUTTERSTOCK_SUBSCRIPTION_ID in .env"
      );
    }
    if (!confirmLicense) {
      if (options.interactive === false) {
        throw new Error(
          `Shutterstock download requires confirmLicense (will charge credits for ${shutterstockItems.length} ${mediaLabel}).`
        );
      }
      const answer = await ask(
        `\nWARNING: ${shutterstockItems.length} Shutterstock ${mediaLabel} will charge subscription credits.\nType YES to confirm licensing: `
      );
      if (answer.toUpperCase() !== "YES") {
        console.log("Shutterstock licensing cancelled.");
        selected = selected.filter((item) => item.provider !== "shutterstock");
        if (selected.length === 0) return;
      }
    }
  }

  for (const item of selected) {
    const itemMediaType = item.mediaType || mediaType;
    const dirs = itemMediaType === "video" ? ctx.videoArchiveDirs : ctx.archiveDirs;
    const dir = dirs[item.provider];
    if (!dir) {
      console.log(`Skip unsupported provider for ${itemMediaType}: ${item.provider}`);
      continue;
    }
    const dest = path.join(dir, filenameForMedia(item));
    if (fs.existsSync(dest) && item.provider !== "shutterstock") {
      console.log(`Skip existing file: ${path.relative(ctx.root, dest)}`);
      continue;
    }

    process.stdout.write(`Downloading ${item.provider} #${item.id} ... `);

    let bytes;
    let licenseMeta = null;

    if (item.provider === "shutterstock") {
      if (itemMediaType === "video") {
        const licensed = await licenseShutterstockVideos([item.id], { size: videoLicenseSize });
        const row = licensed[0];
        if (!row?.downloadUrl) {
          console.log("FAIL (no license download URL)");
          continue;
        }
        bytes = await downloadFile(row.downloadUrl, dest);
        licenseMeta = { allotmentCharge: row.allotmentCharge, licenseSize: videoLicenseSize };
      } else {
        const licensed = await licenseShutterstockImages([item.id], { size: licenseSize });
        const row = licensed[0];
        if (!row?.downloadUrl) {
          console.log("FAIL (no license download URL)");
          continue;
        }
        bytes = await downloadFile(row.downloadUrl, dest);
        licenseMeta = { allotmentCharge: row.allotmentCharge, licenseSize };
      }
    } else {
      bytes = await downloadFile(item.originalImageUrl || item.downloadUrl, dest);
    }

    console.log(`${Math.round(bytes / 1024)} KB -> ${path.relative(ctx.root, dest)}`);

    const credits = loadCredits(ctx, item.provider, itemMediaType);
    const entry = toCreditEntry(item, query);
    if (licenseMeta) {
      entry.licenseSize = licenseMeta.licenseSize;
      entry.allotmentCharge = licenseMeta.allotmentCharge;
      entry.licensedAt = new Date().toISOString();
    }
    const withoutDup = credits.filter((row) => String(row.id) !== String(item.id));
    withoutDup.push(entry);
    saveCredits(ctx, item.provider, withoutDup, itemMediaType);

    if (item.provider === "unsplash" && process.env.UNSPLASH_ACCESS_KEY) {
      try {
        await fetch(`https://api.unsplash.com/photos/${item.id}/download`, {
          headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
        });
      } catch {
        /* Unsplash download tracking is best-effort */
      }
    }
  }
}

async function runFind(argv, ctx) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  if (parsed.flags.help) {
    printHelp();
    return 0;
  }

  if (parsed.flags.checkKeys) {
    printKeyStatus(ctx);
    return 0;
  }

  if (parsed.flags.checkQuota) {
    return runQuota([], ctx);
  }

  if (parsed.flags.listSlots) {
    printSlotList(loadSlotsManifest(ctx));
    return 0;
  }

  let query = parsed.query;
  let slotMeta = null;

  if (parsed.flags.slot) {
    const manifest = loadSlotsManifest(ctx);
    slotMeta = findSlotById(manifest, parsed.flags.slot);
    query = slotMeta.query;
    console.log(`Slot: ${slotMeta.id} [${slotMediaType(slotMeta)}] -> ${slotMeta.file}`);
    console.log(`Query: "${query}"\n`);
  }

  if (!query) {
    console.error(
      'Missing search query. Example: node scripts/find-images.js "Galapagos tortoise" or --slot hero'
    );
    printHelp();
    return 1;
  }

  const mediaType = resolveMediaType(parsed.flags, slotMeta);
  if (mediaType === "video") {
    ctx.ensureVideoArchiveDirs();
  } else {
    ctx.ensureArchiveDirs();
  }

  let manifest = null;
  try {
    manifest = loadSlotsManifest(ctx);
  } catch {
    manifest = { shutterstockSort: "popular", shutterstockRegion: "" };
  }
  const shutterstockSearch = {
    sort: manifest.shutterstockSort || "popular",
    region: manifest.shutterstockRegion || "",
  };

  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const pixabayKey = process.env.PIXABAY_API_KEY || "";

  if (parsed.flags.unsplashOnly && mediaType === "video") {
    console.error("Unsplash does not provide a video API. Use --video with Pexels or Shutterstock.");
    return 1;
  }

  const onlyOne =
    parsed.flags.pexelsOnly ||
    parsed.flags.unsplashOnly ||
    parsed.flags.pixabayOnly ||
    parsed.flags.shutterstockOnly;

  const usePexels = onlyOne ? parsed.flags.pexelsOnly && Boolean(pexelsKey) : Boolean(pexelsKey);
  const useUnsplash =
    mediaType === "video"
      ? false
      : onlyOne
        ? parsed.flags.unsplashOnly && Boolean(unsplashKey)
        : Boolean(unsplashKey);
  const usePixabay = onlyOne ? parsed.flags.pixabayOnly && Boolean(pixabayKey) : Boolean(pixabayKey);
  const useShutterstock = onlyOne
    ? parsed.flags.shutterstockOnly && hasSearchCredentials()
    : hasSearchCredentials();

  if (parsed.flags.pexelsOnly && !pexelsKey) {
    console.error("PEXELS_API_KEY is not set.");
    return 1;
  }
  if (parsed.flags.unsplashOnly && !unsplashKey) {
    console.error("UNSPLASH_ACCESS_KEY is not set.");
    return 1;
  }
  if (parsed.flags.pixabayOnly && !pixabayKey) {
    console.error("PIXABAY_API_KEY is not set.");
    return 1;
  }
  if (parsed.flags.shutterstockOnly && !hasSearchCredentials()) {
    console.error("Shutterstock credentials are not set.");
    return 1;
  }
  if (!usePexels && !useUnsplash && !usePixabay && !useShutterstock) {
    console.error("Set at least one provider key in .env (run scripts/setup-env.ps1).");
    return 1;
  }

  const skippedCounts = { pexels: 0, unsplash: 0, pixabay: 0, shutterstock: 0 };
  const pexelsDownloaded = downloadedIdSet(ctx, "pexels", mediaType);
  const unsplashDownloaded = downloadedIdSet(ctx, "unsplash", mediaType);
  const pixabayDownloaded = downloadedIdSet(ctx, "pixabay", mediaType);
  const shutterstockDownloaded = downloadedIdSet(ctx, "shutterstock", mediaType);

  const batches = [];

  if (useShutterstock) {
    console.log(`Searching Shutterstock ${mediaType} (primary, sort=${shutterstockSearch.sort})...`);
    const results =
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
    const fresh = results.filter((p) => {
      if (shutterstockDownloaded.has(p.id)) {
        skippedCounts.shutterstock += 1;
        return false;
      }
      return true;
    });
    batches.push(...fresh);
  } else if (!parsed.flags.pexelsOnly && !parsed.flags.unsplashOnly && !parsed.flags.pixabayOnly) {
    console.log("Skipping Shutterstock (credentials not set).");
  }

  if (useUnsplash) {
    console.log("Searching Unsplash...");
    const photos = await searchUnsplash(query, unsplashKey);
    const fresh = photos.filter((p) => {
      if (unsplashDownloaded.has(p.id)) {
        skippedCounts.unsplash += 1;
        return false;
      }
      return true;
    });
    batches.push(...fresh);
  } else if (
    !parsed.flags.pexelsOnly &&
    !parsed.flags.shutterstockOnly &&
    !parsed.flags.pixabayOnly &&
    mediaType === "image"
  ) {
    console.log("Skipping Unsplash (UNSPLASH_ACCESS_KEY not set).");
  }

  if (usePixabay) {
    console.log(`Searching Pixabay ${mediaType}...`);
    const results =
      mediaType === "video"
        ? await searchPixabayVideos(query, pixabayKey, { perPage: PER_PAGE })
        : await searchPixabayImages(query, pixabayKey, { perPage: PER_PAGE, orientation: ORIENTATION });
    const fresh = results.filter((p) => {
      if (pixabayDownloaded.has(p.id)) {
        skippedCounts.pixabay += 1;
        return false;
      }
      return true;
    });
    batches.push(...fresh);
  } else if (!parsed.flags.pexelsOnly && !parsed.flags.unsplashOnly && !parsed.flags.shutterstockOnly) {
    console.log("Skipping Pixabay (PIXABAY_API_KEY not set).");
  }

  if (usePexels) {
    console.log(`Searching Pexels ${mediaType}...`);
    const results =
      mediaType === "video"
        ? await searchPexelsVideos(query, pexelsKey, { perPage: PER_PAGE, orientation: ORIENTATION })
        : await searchPexels(query, pexelsKey);
    const fresh = results.filter((p) => {
      if (pexelsDownloaded.has(p.id)) {
        skippedCounts.pexels += 1;
        return false;
      }
      return true;
    });
    batches.push(...fresh);
  } else if (!parsed.flags.unsplashOnly && !parsed.flags.shutterstockOnly && !parsed.flags.pixabayOnly) {
    console.log("Skipping Pexels (PEXELS_API_KEY not set).");
  }

  printResults(query, batches, skippedCounts, mediaType);

  if (batches.length === 0) {
    return;
  }

  const answer = await ask("\nEnter numbers to download (or all / none): ");
  let indexes;
  try {
    indexes = parseSelection(answer, batches.length);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  if (indexes.length === 0) {
    console.log(`No ${mediaType === "video" ? "videos" : "photos"} downloaded.`);
    return;
  }

  const selected = indexes.map((i) => batches[i]);
  console.log(`\nDownloading ${selected.length} ${mediaType === "video" ? "video(s)" : "photo(s)"}...\n`);
  await downloadSelected(ctx, selected, query, {
    confirmLicense: parsed.flags.confirmLicense,
    licenseSize: parsed.flags.licenseSize,
    videoLicenseSize: parsed.flags.videoLicenseSize,
    mediaType,
  });
  if (slotMeta) {
    console.log(`\nTarget path for this slot: ${manifestTargetPath(ctx, slotMeta)}`);
    console.log("Copy/crop the chosen file there after download.");
  }
  console.log("\nDone. Credits updated in archive credits.json files.");
  return 0;
}

function manifestTargetPath(ctx, slot) {
  try {
    const manifest = loadSlotsManifest(ctx);
    return ctx.targetPath(manifest, slot);
  } catch {
    return slot.file;
  }
}

module.exports = {
  runFind,
  printKeyStatus,
  parseArgs,
  printHelp,
  searchPexels,
  searchUnsplash,
  downloadSelected,
  downloadedIdSet,
  loadCredits,
  toCreditEntry,
  PER_PAGE,
  ORIENTATION,
};
