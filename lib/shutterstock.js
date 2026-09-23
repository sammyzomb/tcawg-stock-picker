const API_HOST = "api.shutterstock.com";

const SHUTTERSTOCK_SORT_OPTIONS = ["popular", "relevance", "newest", "random"];
const DEFAULT_SHUTTERSTOCK_SORT = "popular";

function getAuthHeader(env = process.env) {
  if (env.SHUTTERSTOCK_API_TOKEN) {
    return `Bearer ${env.SHUTTERSTOCK_API_TOKEN}`;
  }
  if (env.SHUTTERSTOCK_CONSUMER_KEY && env.SHUTTERSTOCK_CONSUMER_SECRET) {
    const basic = Buffer.from(
      `${env.SHUTTERSTOCK_CONSUMER_KEY}:${env.SHUTTERSTOCK_CONSUMER_SECRET}`
    ).toString("base64");
    return `Basic ${basic}`;
  }
  return null;
}

function hasSearchCredentials(env = process.env) {
  return Boolean(getAuthHeader(env));
}

function hasLicenseCredentials(env = process.env) {
  return Boolean(env.SHUTTERSTOCK_API_TOKEN && env.SHUTTERSTOCK_SUBSCRIPTION_ID);
}

async function shutterstockRequest(method, urlPath, body, env = process.env) {
  const auth = getAuthHeader(env);
  if (!auth) {
    throw new Error("Shutterstock credentials missing (API token or consumer key/secret).");
  }

  const res = await fetch(`https://${API_HOST}${urlPath}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "tcawg-stock-picker/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shutterstock API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeSort(sort) {
  const value = String(sort || DEFAULT_SHUTTERSTOCK_SORT).toLowerCase();
  return SHUTTERSTOCK_SORT_OPTIONS.includes(value) ? value : DEFAULT_SHUTTERSTOCK_SORT;
}

function assetDimensions(row) {
  const assets = row.assets || {};
  const candidates = [
    assets.huge_thumb,
    assets.preview_1500,
    assets.preview_1000,
    assets.preview,
    assets.small_thumb,
  ].filter(Boolean);

  let width = 0;
  let height = 0;
  for (const asset of candidates) {
    width = Math.max(width, asset.width || 0);
    height = Math.max(height, asset.height || 0);
  }

  return { width, height, pixels: width * height };
}

function mapSearchResult(row, meta = {}) {
  const previewUrl =
    row.assets?.huge_thumb?.url ||
    row.assets?.preview_1500?.url ||
    row.assets?.preview_1000?.url ||
    row.assets?.preview?.url ||
    "";
  const dims = assetDimensions(row);

  return {
    provider: "shutterstock",
    id: String(row.id),
    previewUrl,
    photographer: row.contributor?.id ? `Contributor ${row.contributor.id}` : "Shutterstock",
    photographerUrl: "",
    photoPageUrl: `https://www.shutterstock.com/image-photo/${row.id}`,
    originalImageUrl: previewUrl,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: `https://www.shutterstock.com/image-photo/${row.id}`,
    description: (row.description || "").slice(0, 160),
    requiresLicense: true,
    sstkRank: meta.rank ?? 0,
    sstkSort: meta.sort || DEFAULT_SHUTTERSTOCK_SORT,
    queryIndex: meta.queryIndex ?? 0,
    assetWidth: dims.width,
    assetHeight: dims.height,
    qualityScore: dims.pixels,
  };
}

function shutterstockRankScore(item) {
  const queryIndex = Number.isFinite(item.queryIndex) ? item.queryIndex : 0;
  const rank = Number.isFinite(item.sstkRank) ? item.sstkRank : 999;
  return queryIndex * 1000 + rank;
}

function compareShutterstockQuality(a, b) {
  const scoreDiff = shutterstockRankScore(a) - shutterstockRankScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  return (b.qualityScore || 0) - (a.qualityScore || 0);
}

function sortShutterstockByRank(items) {
  return [...items].sort(compareShutterstockQuality);
}

async function searchShutterstock(query, options = {}) {
  const {
    perPage = 20,
    orientation = "horizontal",
    sort = DEFAULT_SHUTTERSTOCK_SORT,
    region = "",
    queryIndex = 0,
    env = process.env,
  } = options;

  const normalizedSort = normalizeSort(sort);
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    orientation,
    image_type: "photo",
    sort: normalizedSort,
    view: "full",
  });
  if (region) params.set("region", region);

  const data = await shutterstockRequest("GET", `/v2/images/search?${params.toString()}`, null, env);
  return (data.data || []).map((row, index) =>
    mapSearchResult(row, {
      rank: index,
      sort: normalizedSort,
      queryIndex,
    })
  );
}

async function licenseShutterstockImages(imageIds, options = {}) {
  const { size = "huge", env = process.env } = options;
  const subscriptionId = env.SHUTTERSTOCK_SUBSCRIPTION_ID || "";

  if (!env.SHUTTERSTOCK_API_TOKEN) {
    throw new Error("SHUTTERSTOCK_API_TOKEN is required to license images.");
  }
  if (!subscriptionId) {
    throw new Error("SHUTTERSTOCK_SUBSCRIPTION_ID is required to license images.");
  }

  const body = {
    images: imageIds.map((imageId) => ({
      image_id: String(imageId),
      subscription_id: subscriptionId,
      size,
    })),
  };

  const result = await shutterstockRequest(
    "POST",
    `/v2/images/licenses?subscription_id=${encodeURIComponent(subscriptionId)}`,
    body,
    env
  );

  return (result.data || []).map((row) => ({
    imageId: String(row.image_id),
    downloadUrl: row.download?.url || "",
    allotmentCharge: row.allotment_charge,
  }));
}

function mapVideoSearchResult(row, meta = {}) {
  const previewUrl =
    row.assets?.preview_mp4?.url ||
    row.assets?.thumb_jpg?.url ||
    row.assets?.preview?.url ||
    "";
  const dims = assetDimensions(row);

  return {
    provider: "shutterstock",
    mediaType: "video",
    id: String(row.id),
    previewUrl,
    photographer: row.contributor?.id ? `Contributor ${row.contributor.id}` : "Shutterstock",
    photographerUrl: "",
    photoPageUrl: `https://www.shutterstock.com/video/clip-${row.id}`,
    originalImageUrl: previewUrl,
    downloadUrl: previewUrl,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: `https://www.shutterstock.com/video/clip-${row.id}`,
    description: (row.description || "").slice(0, 160),
    requiresLicense: true,
    duration: row.duration || 0,
    sstkRank: meta.rank ?? 0,
    sstkSort: meta.sort || DEFAULT_SHUTTERSTOCK_SORT,
    queryIndex: meta.queryIndex ?? 0,
    assetWidth: dims.width,
    assetHeight: dims.height,
    qualityScore: dims.pixels,
  };
}

async function searchShutterstockVideos(query, options = {}) {
  const {
    perPage = 20,
    sort = DEFAULT_SHUTTERSTOCK_SORT,
    region = "",
    queryIndex = 0,
    env = process.env,
  } = options;

  const normalizedSort = normalizeSort(sort);
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    sort: normalizedSort,
  });
  if (region) params.set("region", region);

  const data = await shutterstockRequest("GET", `/v2/videos/search?${params.toString()}`, null, env);
  return (data.data || []).map((row, index) =>
    mapVideoSearchResult(row, {
      rank: index,
      sort: normalizedSort,
      queryIndex,
    })
  );
}

async function licenseShutterstockVideos(videoIds, options = {}) {
  const { size = "hd", env = process.env } = options;
  const subscriptionId = env.SHUTTERSTOCK_SUBSCRIPTION_ID || "";

  if (!env.SHUTTERSTOCK_API_TOKEN) {
    throw new Error("SHUTTERSTOCK_API_TOKEN is required to license videos.");
  }
  if (!subscriptionId) {
    throw new Error("SHUTTERSTOCK_SUBSCRIPTION_ID is required to license videos.");
  }

  const body = {
    videos: videoIds.map((videoId) => ({
      video_id: String(videoId),
      subscription_id: subscriptionId,
      size,
    })),
  };

  const result = await shutterstockRequest(
    "POST",
    `/v2/videos/licenses?subscription_id=${encodeURIComponent(subscriptionId)}`,
    body,
    env
  );

  return (result.data || []).map((row) => ({
    videoId: String(row.video_id),
    downloadUrl: row.download?.url || "",
    allotmentCharge: row.allotment_charge,
  }));
}

module.exports = {
  API_HOST,
  DEFAULT_SHUTTERSTOCK_SORT,
  SHUTTERSTOCK_SORT_OPTIONS,
  getAuthHeader,
  hasSearchCredentials,
  hasLicenseCredentials,
  compareShutterstockQuality,
  sortShutterstockByRank,
  shutterstockRankScore,
  searchShutterstock,
  licenseShutterstockImages,
  searchShutterstockVideos,
  licenseShutterstockVideos,
};
