const LICENSE_SIZES = new Set(["small", "medium", "huge", "vector", "web", "sd", "hd", "4k"]);

function dimensionText(width, height) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  if (w > 0 && h > 0) return `${w}×${h}`;
  return "";
}

function sizeLabel(name, width, height) {
  const dims = dimensionText(width, height);
  return dims ? `${name} ${dims}` : name;
}

function scaleToWidth(width, height, targetWidth) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const target = Number(targetWidth) || 0;
  if (w <= 0 || h <= 0 || target <= 0) return { width: 0, height: 0 };
  const outW = Math.min(w, target);
  return { width: outW, height: Math.max(1, Math.round((h * outW) / w)) };
}

function scaleToHeight(width, height, targetHeight) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const target = Number(targetHeight) || 0;
  if (w <= 0 || h <= 0 || target <= 0) return { width: 0, height: 0 };
  const outH = Math.min(h, target);
  return { width: Math.max(1, Math.round((w * outH) / h)), height: outH };
}

function scaleToMaxEdge(width, height, maxEdge) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= h) return scaleToWidth(w, h, maxEdge);
  return scaleToHeight(w, h, maxEdge);
}

function uniqueSizes(rows) {
  const seen = new Set();
  const sizes = [];
  for (const row of rows) {
    if (!row?.id || (!row.url && !row.licenseSize) || seen.has(row.id)) continue;
    seen.add(row.id);
    sizes.push({
      id: String(row.id),
      label: row.label || String(row.id),
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      ...(row.url ? { url: row.url } : {}),
      ...(row.licenseSize ? { licenseSize: row.licenseSize } : {}),
    });
  }
  return sizes;
}

function withSizes(item, sizes, preferredId) {
  const list = uniqueSizes(sizes);
  const preferred = list.find((row) => row.id === preferredId) || list[0];
  return {
    ...item,
    width: Number(item.width) || preferred?.width || 0,
    height: Number(item.height) || preferred?.height || 0,
    sizes: list,
    defaultSize: preferred?.id || "",
    downloadSize: item.downloadSize || preferred?.id || "",
  };
}

function allowedDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  return (
    host === "images.unsplash.com" ||
    host === "upload.wikimedia.org" ||
    host === "pexels.com" ||
    host.endsWith(".pexels.com") ||
    host === "pixabay.com" ||
    host.endsWith(".pixabay.com") ||
    host.endsWith(".vimeo.com") ||
    host.endsWith(".vimeocdn.com")
  );
}

function resolveDownloadChoice(item) {
  const sizes = Array.isArray(item?.sizes) ? item.sizes : [];
  if (!sizes.length) return null;
  const id = String(item.downloadSize || item.defaultSize || "");
  const picked = sizes.find((row) => row && row.id === id);
  if (!picked) return null;
  if (picked.licenseSize && !LICENSE_SIZES.has(picked.licenseSize)) return null;
  if (picked.url && !allowedDownloadUrl(picked.url)) return null;
  return picked;
}

function pexelsImageSizes(photo) {
  const width = photo.width || 0;
  const height = photo.height || 0;
  const src = photo.src || {};
  const large2x = scaleToWidth(width, height, 1880);
  const large = scaleToWidth(width, height, 940);
  const medium = scaleToHeight(width, height, 350);
  const rows = [
    src.original ? { id: "original", label: sizeLabel("原圖", width, height), width, height, url: src.original } : null,
    src.large2x ? { id: "large2x", label: sizeLabel("大", large2x.width, large2x.height), ...large2x, url: src.large2x } : null,
    src.large ? { id: "large", label: sizeLabel("中", large.width, large.height), ...large, url: src.large } : null,
    src.medium ? { id: "medium", label: sizeLabel("小", medium.width, medium.height), ...medium, url: src.medium } : null,
  ];
  const current = src.large2x || src.large || src.original || "";
  const preferred = rows.find((row) => row && row.url === current)?.id || "original";
  return { sizes: uniqueSizes(rows), preferred };
}

function unsplashImageSizes(photo) {
  const width = photo.width || 0;
  const height = photo.height || 0;
  const urls = photo.urls || {};
  const full = scaleToMaxEdge(width, height, Math.max(width, height));
  const regular = scaleToWidth(width, height, 1080);
  const small = scaleToWidth(width, height, 400);
  const rows = [
    urls.raw ? { id: "raw", label: sizeLabel("原圖", width, height), width, height, url: urls.raw } : null,
    urls.full ? { id: "full", label: sizeLabel("大", full.width || width, full.height || height), width: full.width || width, height: full.height || height, url: urls.full } : null,
    urls.regular ? { id: "regular", label: sizeLabel("標準", regular.width, regular.height), ...regular, url: urls.regular } : null,
    urls.small ? { id: "small", label: sizeLabel("小", small.width, small.height), ...small, url: urls.small } : null,
  ];
  const current = urls.regular || urls.full || urls.raw || "";
  const preferred = rows.find((row) => row && row.url === current)?.id || "regular";
  return { sizes: uniqueSizes(rows), preferred };
}

function pixabayImageSizes(hit) {
  const width = hit.imageWidth || 0;
  const height = hit.imageHeight || 0;
  const large = scaleToMaxEdge(width, height, 1280);
  const fullHd = scaleToMaxEdge(width, height, 1920);
  const rows = [
    hit.imageURL ? { id: "original", label: sizeLabel("原圖", width, height), width, height, url: hit.imageURL } : null,
    hit.fullHDURL ? { id: "fullhd", label: sizeLabel("Full HD", fullHd.width, fullHd.height), ...fullHd, url: hit.fullHDURL } : null,
    hit.largeImageURL ? { id: "large", label: sizeLabel("大", large.width, large.height), ...large, url: hit.largeImageURL } : null,
    hit.webformatURL
      ? {
          id: "web",
          label: sizeLabel("中", hit.webformatWidth, hit.webformatHeight),
          width: hit.webformatWidth || 0,
          height: hit.webformatHeight || 0,
          url: hit.webformatURL,
        }
      : null,
  ];
  const current = hit.largeImageURL || hit.webformatURL || hit.previewURL || "";
  const preferred = rows.find((row) => row && row.url === current)?.id || "large";
  return { sizes: uniqueSizes(rows), preferred, width, height };
}

function pexelsVideoSizes(files) {
  const rows = (files || [])
    .filter((file) => file?.file_type === "video/mp4" && file.link)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))
    .map((file) => ({
      id: `${file.width || 0}x${file.height || 0}`,
      label: sizeLabel(file.quality || "影片", file.width, file.height),
      width: file.width || 0,
      height: file.height || 0,
      url: file.link,
    }));
  return uniqueSizes(rows);
}

function pixabayVideoSizes(videos) {
  const names = { large: "大", medium: "中", small: "小", tiny: "預覽" };
  return uniqueSizes(
    ["large", "medium", "small", "tiny"].map((id) => {
      const row = videos?.[id];
      if (!row?.url) return null;
      return {
        id,
        label: sizeLabel(names[id], row.width, row.height),
        width: row.width || 0,
        height: row.height || 0,
        url: row.url,
      };
    })
  );
}

function shutterstockImageSizes(width, height) {
  return uniqueSizes([
    { id: "huge", label: sizeLabel("最大", width, height), width, height, licenseSize: "huge" },
    { id: "medium", label: "中", licenseSize: "medium" },
    { id: "small", label: "小", licenseSize: "small" },
  ]);
}

function shutterstockVideoSizes() {
  return uniqueSizes([
    { id: "hd", label: "HD", licenseSize: "hd" },
    { id: "sd", label: "SD", licenseSize: "sd" },
    { id: "web", label: "Web", licenseSize: "web" },
  ]);
}

function commonsThumbUrl(originalUrl, width) {
  const match = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(.+\/)([^/?#]+)$/.exec(originalUrl || "");
  if (!match || !Number.isInteger(width) || width < 1) return "";
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${match[1]}${match[2]}/${width}px-${match[2]}`;
}

function commonsImageSizes(info) {
  const width = info.width || 0;
  const height = info.height || 0;
  const original = info.url || "";
  const rows = [{ id: "original", label: sizeLabel("原圖", width, height), width, height, url: original }];
  for (const edge of [1920, 1280, 640]) {
    if (!width || !height || Math.max(width, height) <= edge) continue;
    const dims = scaleToMaxEdge(width, height, edge);
    const url = commonsThumbUrl(original, edge);
    if (!url) continue;
    rows.push({ id: `w${edge}`, label: sizeLabel(edge >= 1920 ? "大" : edge >= 1280 ? "中" : "小", dims.width, dims.height), ...dims, url });
  }
  return uniqueSizes(rows);
}

module.exports = {
  dimensionText,
  allowedDownloadUrl,
  resolveDownloadChoice,
  withSizes,
  pexelsImageSizes,
  unsplashImageSizes,
  pixabayImageSizes,
  pexelsVideoSizes,
  pixabayVideoSizes,
  shutterstockImageSizes,
  shutterstockVideoSizes,
  commonsThumbUrl,
  commonsImageSizes,
};
