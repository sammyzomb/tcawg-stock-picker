const fs = require("fs");
const path = require("path");
const { slotMediaType, archiveDirsForMediaType, filenameForMedia } = require("./slot-media");

const IMAGE_PROVIDERS = ["shutterstock", "commons", "unsplash", "pexels"];
const VIDEO_PROVIDERS = ["shutterstock", "pexels"];

function parseArgs(argv) {
  return { verifyOnly: argv.includes("--verify-only") || argv.includes("--check") };
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCredits(ctx, provider, mediaType = "image") {
  const dirs = archiveDirsForMediaType(ctx, mediaType);
  const dir = dirs[provider];
  if (!dir) return [];
  const file = path.join(dir, "credits.json");
  const data = loadJson(file, []);
  return Array.isArray(data) ? data : [];
}

function creditForSlot(ctx, slotId, mediaType = "image") {
  const providers = mediaType === "video" ? VIDEO_PROVIDERS : IMAGE_PROVIDERS;
  for (const provider of providers) {
    const row = loadCredits(ctx, provider, mediaType).find((item) => item.slotId === slotId);
    if (row) return row;
  }
  return null;
}

function archivePath(ctx, credit, mediaType = "image") {
  const provider = credit.provider;
  const filename =
    credit.filename ||
    filenameForMedia({ provider, id: credit.id, mediaType: credit.mediaType || mediaType });
  const dirs = archiveDirsForMediaType(ctx, credit.mediaType || mediaType);
  return path.join(dirs[provider], filename);
}

function syncSlots(ctx, verifyOnly) {
  const manifest = ctx.loadManifest();
  const targetRoot = ctx.targetRoot(manifest);
  const results = [];

  for (const slot of manifest.slots) {
    const dest = path.join(targetRoot, slot.file);
    const mediaType = slotMediaType(slot);
    const credit = creditForSlot(ctx, slot.id, mediaType);
    const row = {
      slot: slot.id,
      file: slot.file,
      provider: credit?.provider || "",
      id: credit?.id || "",
      ok: false,
      action: "",
      bytes: 0,
    };

    if (!credit) {
      row.action = fs.existsSync(dest) ? "kept existing (no credit)" : "missing credit";
      row.ok = fs.existsSync(dest);
      row.bytes = row.ok ? fs.statSync(dest).size : 0;
      results.push(row);
      continue;
    }

    const src = archivePath(ctx, credit, mediaType);
    if (!fs.existsSync(src)) {
      if (fs.existsSync(dest)) {
        row.action = "kept slot file (archive missing)";
        row.ok = true;
        row.bytes = fs.statSync(dest).size;
      } else {
        row.action = "missing archive and slot file";
      }
      results.push(row);
      continue;
    }

    const srcBytes = fs.statSync(src).size;
    const destBytes = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const shouldCopy = !fs.existsSync(dest) || srcBytes > destBytes;

    if (verifyOnly) {
      row.ok = fs.existsSync(dest);
      row.bytes = destBytes;
      row.action = row.ok ? "present" : "missing";
      results.push(row);
      continue;
    }

    if (shouldCopy) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      row.action = destBytes > 0 ? "updated from archive" : "copied from archive";
    } else {
      row.action = "already up to date";
    }

    row.ok = fs.existsSync(dest);
    row.bytes = fs.statSync(dest).size;
    results.push(row);
  }

  return { targetRoot, results };
}

async function runSync(argv, ctx) {
  const flags = parseArgs(argv);
  const { targetRoot, results } = syncSlots(ctx, flags.verifyOnly);
  const relRoot = path.relative(ctx.root, targetRoot).replace(/\\/g, "/");

  console.log(`Target: ${relRoot}/\n`);

  for (const row of results) {
    const tag = row.ok ? "OK" : "MISS";
    const kb = row.bytes ? `${Math.round(row.bytes / 1024)} KB` : "-";
    const meta = [row.provider, row.id].filter(Boolean).join("#");
    console.log(
      `[${tag}] ${row.slot.padEnd(22)} ${row.file.padEnd(28)} ${kb.padStart(8)}  ${row.action}${meta ? ` (${meta})` : ""}`
    );
  }

  const okCount = results.filter((row) => row.ok).length;
  console.log(`\n${okCount}/${results.length} files in project folder.`);

  return okCount < results.length ? 1 : 0;
}

module.exports = {
  runSync,
  syncSlots,
  parseArgs,
};
