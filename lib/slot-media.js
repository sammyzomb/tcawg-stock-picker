const path = require("path");
const { hasLicenseCredentials } = require("./shutterstock");
const { DEFAULT_PROVIDER_PRIORITY } = require("./provider-priority");

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const DEFAULT_VIDEO_PROVIDER_PRIORITY = ["shutterstock", "pixabay", "pexels"];

function slotMediaType(slot) {
  if (!slot) return "image";
  const explicit = slot.type || slot.mediaType;
  if (explicit === "video" || explicit === "image") return explicit;
  const ext = path.extname(slot.file || "").toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "image";
}

function isVideoSlot(slot) {
  return slotMediaType(slot) === "video";
}

function isImageSlot(slot) {
  return slotMediaType(slot) === "image";
}

function getProviderPriorityForSlot(manifest, slot, flags = {}) {
  const mediaType = slotMediaType(slot);
  const base =
    mediaType === "video"
      ? manifest.videoProviderPriority || DEFAULT_VIDEO_PROVIDER_PRIORITY
      : manifest.providerPriority || DEFAULT_PROVIDER_PRIORITY;

  if (flags.freeOnly || !hasLicenseCredentials()) {
    return base.filter((provider) => provider !== "shutterstock");
  }
  return base;
}

function filenameForMedia(item) {
  const ext = item.mediaType === "video" ? ".mp4" : ".jpg";
  return `${item.provider}-${item.id}${ext}`;
}

function archiveDirsForMediaType(ctx, mediaType) {
  return mediaType === "video" ? ctx.videoArchiveDirs : ctx.archiveDirs;
}

function providerSupportsMediaType(provider, mediaType) {
  if (mediaType === "video") {
    return provider === "shutterstock" || provider === "pexels" || provider === "pixabay";
  }
  return (
    provider === "shutterstock" ||
    provider === "unsplash" ||
    provider === "pexels" ||
    provider === "pixabay" ||
    provider === "commons"
  );
}

function creditsPathForProvider(ctx, provider, mediaType) {
  if (!providerSupportsMediaType(provider, mediaType)) return null;
  const dirs = archiveDirsForMediaType(ctx, mediaType);
  const dir = dirs[provider];
  if (!dir) return null;
  return path.join(dir, "credits.json");
}

module.exports = {
  VIDEO_EXTENSIONS,
  DEFAULT_VIDEO_PROVIDER_PRIORITY,
  slotMediaType,
  isVideoSlot,
  isImageSlot,
  getProviderPriorityForSlot,
  filenameForMedia,
  archiveDirsForMediaType,
  providerSupportsMediaType,
  creditsPathForProvider,
};
