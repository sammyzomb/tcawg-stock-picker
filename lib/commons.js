const { commonsImageSizes, withSizes } = require("./image-sizes");

const USER_AGENT = "tcawg-stock-picker/1.0 (local desktop image search)";
const API_URL = "https://commons.wikimedia.org/w/api.php";

function plainText(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " "}[name])).replace(/\s+/g, " ").trim();
}

function mapFile(page) {
  const info = page.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp|tiff)$/.test(info.mime || "")) return null;
  const metadata = info.extmetadata || {};
  const value = key => plainText(metadata[key]?.value || "");
  const license = value("LicenseShortName");
  const licenseUrl = value("LicenseUrl");
  const cc = /^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/(by|by-sa)\/[1-4]\.0(?:\/[^?#]*)?(?:[?#].*)?$/.exec(licenseUrl);
  const cc0 = /^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/zero\/1\.0(?:\/[^?#]*)?(?:[?#].*)?$/.test(licenseUrl);
  const publicDomain = /^public domain$/i.test(license) || /^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/mark\/1\.0(?:\/[^?#]*)?(?:[?#].*)?$/.test(licenseUrl);
  if (!cc && !cc0 && !publicDomain) return null;
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(info.url || "")) return null;
  const artist = value("Artist");
  if (cc && !artist) return null;
  const extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/tiff": ".tif"}[info.mime];
  const sizes = commonsImageSizes(info);
  return withSizes({
    provider: "commons", id: String(page.pageid), mediaType: "image",
    filename: plainText(page.title?.replace(/^File:/, "") || ""),
    description: value("ImageDescription"),
    photographer: artist || "未提供作者", photographerUrl: "",
    previewUrl: info.thumburl || info.url, originalImageUrl: info.url,
    photoPageUrl: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    originalExtension: extension,
    width: info.width || 0, height: info.height || 0, fileBytes: info.size || 0,
    licenseName: license || (cc0 ? "CC0" : "Public domain"),
    licenseUrl, attributionRequired: Boolean(cc), shareAlike: cc?.[1] === "by-sa",
    attribution: value("Attribution") || artist,
    usageTerms: value("UsageTerms"), restrictions: value("Restrictions"),
    fileRevision: info.timestamp || "", licenseRetrievedAt: new Date().toISOString(),
  }, sizes, "original");
}

async function queryFiles(params) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({action: "query", format: "json", formatversion: "2", prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata|timestamp", iiurlwidth: "640", iiextmetadatalanguage: "en",
    iiextmetadatafilter: "Artist|ImageDescription|LicenseShortName|LicenseUrl|Attribution|UsageTerms|Restrictions",
    ...params}).toString();
  const response = await fetch(url, {headers: {"User-Agent": USER_AGENT}, signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Wikimedia Commons API ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.info || data.error.code);
  return (data.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map(mapFile).filter(Boolean);
}

async function searchCommons(query, {perPage = 20} = {}) {
  return queryFiles({generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: String(Math.min(20, perPage)), gsrwhat: "text"});
}

async function resolveCommonsFiles(ids) {
  if (!ids.length || ids.some(id => !/^\d+$/.test(String(id)))) throw new Error("無效的 Wikimedia Commons 圖片編號。");
  const rows = [];
  for (let index = 0; index < ids.length; index += 20) rows.push(...await queryFiles({pageids: ids.slice(index, index + 20).join("|")}));
  return rows;
}

function licenseText(item, filename) {
  return ["Wikimedia Commons 圖片授權紀錄", `下載檔名：${filename}`, `原檔名：${item.filename}`,
    `作者：${item.photographer}`, `原頁：${item.photoPageUrl}`, `授權：${item.licenseName}`, `授權連結：${item.licenseUrl || "請見原頁"}`,
    `署名：${item.attribution}`, `需要署名：${item.attributionRequired ? "是" : "否"}`,
    `改作須採相同授權：${item.shareAlike ? "是" : "否"}`, `使用條款：${item.usageTerms || item.licenseName}`,
    `其他限制：${item.restrictions || "未提供；人物、商標等其他權利仍需依用途確認"}`,
    `檔案版本：${item.fileRevision}`, `授權查詢時間：${item.licenseRetrievedAt}`, "修改图片時請標示修改；原頁記載的適用條件仍須遵守。", ""].join("\n");
}

module.exports = {searchCommons, resolveCommonsFiles, licenseText, mapFile, plainText, USER_AGENT};
