const fs = require("fs");
const path = require("path");
const { loadDotEnv, findEnvFile } = require("./env");

const DEFAULT_ARCHIVE_DIR = "public/images";
const DEFAULT_VIDEO_ARCHIVE_DIR = "public/videos";
const DEFAULT_SLOTS_CANDIDATES = ["scripts/image-slots.json", "image-slots.json"];

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, "stock-picker.config.json"))) {
      return dir;
    }
    for (const rel of DEFAULT_SLOTS_CANDIDATES) {
      if (fs.existsSync(path.join(dir, rel))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "找不到專案根目錄（需有 stock-picker.config.json 或 scripts/image-slots.json）。使用 --project <路徑> 指定。"
  );
}

function loadProjectConfig(root) {
  const configFile = path.join(root, "stock-picker.config.json");
  const fileConfig = readJson(configFile, {}) || {};

  let slotsFile = fileConfig.slotsFile;
  if (!slotsFile) {
    for (const rel of DEFAULT_SLOTS_CANDIDATES) {
      if (fs.existsSync(path.join(root, rel))) {
        slotsFile = rel;
        break;
      }
    }
  }
  if (!slotsFile) {
    throw new Error(`在 ${root} 找不到 image-slots.json，請建立 stock-picker.config.json`);
  }

  return {
    slotsFile,
    archiveDir: fileConfig.archiveDir || DEFAULT_ARCHIVE_DIR,
    videoArchiveDir: fileConfig.videoArchiveDir || DEFAULT_VIDEO_ARCHIVE_DIR,
    envFile: fileConfig.envFile || ".env",
    licenseMarkdown: fileConfig.licenseMarkdown || null,
    creditsManifest: fileConfig.creditsManifest || null,
  };
}

function createContext(projectRoot, overrides = {}) {
  const root = path.resolve(projectRoot || resolveProjectRoot(process.cwd()));
  const config = { ...loadProjectConfig(root), ...overrides };
  const envFile = findEnvFile(root, config.envFile);
  loadDotEnv(envFile);

  const archiveRoot = path.join(root, config.archiveDir);
  const archiveDirs = {
    pexels: path.join(archiveRoot, "pexels"),
    unsplash: path.join(archiveRoot, "unsplash"),
    pixabay: path.join(archiveRoot, "pixabay"),
    shutterstock: path.join(archiveRoot, "shutterstock"),
    commons: path.join(archiveRoot, "commons"),
  };

  const videoArchiveRoot = path.join(root, config.videoArchiveDir);
  const videoArchiveDirs = {
    pexels: path.join(videoArchiveRoot, "pexels"),
    pixabay: path.join(videoArchiveRoot, "pixabay"),
    shutterstock: path.join(videoArchiveRoot, "shutterstock"),
  };

  function loadManifest() {
    const slotsPath = path.join(root, config.slotsFile);
    const data = readJson(slotsPath);
    if (!data || !Array.isArray(data.slots)) {
      throw new Error(`${config.slotsFile} 必須包含 slots 陣列`);
    }
    return data;
  }

  function targetRoot(manifest) {
    return path.join(root, manifest.targetRoot || "images/project-shutter");
  }

  function targetPath(manifest, slot) {
    return path.join(targetRoot(manifest), slot.file);
  }

  function licenseMarkdownPath(manifest) {
    if (config.licenseMarkdown) {
      return path.isAbsolute(config.licenseMarkdown)
        ? config.licenseMarkdown
        : path.join(root, config.licenseMarkdown);
    }
    return path.join(targetRoot(manifest), "圖片授權說明.md");
  }

  function creditsManifestPath(manifest) {
    if (config.creditsManifest) {
      return path.isAbsolute(config.creditsManifest)
        ? config.creditsManifest
        : path.join(root, config.creditsManifest);
    }
    return path.join(targetRoot(manifest), "shutter-credits.json");
  }

  function ensureArchiveDirs() {
    for (const dir of Object.values(archiveDirs)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function ensureVideoArchiveDirs() {
    for (const dir of Object.values(videoArchiveDirs)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function ensureAllArchiveDirs() {
    ensureArchiveDirs();
    ensureVideoArchiveDirs();
  }

  return {
    root,
    config,
    envFile,
    slotsPath: path.join(root, config.slotsFile),
    archiveRoot,
    archiveDirs,
    videoArchiveRoot,
    videoArchiveDirs,
    loadManifest,
    targetRoot,
    targetPath,
    licenseMarkdownPath,
    creditsManifestPath,
    ensureArchiveDirs,
    ensureVideoArchiveDirs,
    ensureAllArchiveDirs,
  };
}

module.exports = {
  createContext,
  resolveProjectRoot,
  loadProjectConfig,
};
