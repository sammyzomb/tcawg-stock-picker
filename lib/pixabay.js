const PER_PAGE = 20;

function queryLang(query) {
  return /[\u4e00-\u9fff]/.test(query) ? "zh" : "en";
}

function mapOrientation(orientation) {
  if (orientation === "landscape") return "horizontal";
  if (orientation === "portrait") return "vertical";
  return orientation || "horizontal";
}

function mapPixabayImage(hit) {
  const pageUrl = hit.pageURL || `https://pixabay.com/photos/${hit.id}/`;
  const downloadUrl = hit.largeImageURL || hit.webformatURL || hit.previewURL || "";

  return {
    provider: "pixabay",
    mediaType: "image",
    id: String(hit.id),
    previewUrl: hit.previewURL || hit.webformatURL || downloadUrl,
    photographer: hit.user || "Unknown",
    photographerUrl: hit.user_id ? `https://pixabay.com/users/${hit.user}-${hit.user_id}/` : "https://pixabay.com/",
    photoPageUrl: pageUrl,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: "",
    pixabayPhotoUrl: pageUrl,
    originalImageUrl: downloadUrl,
    downloadUrl,
    requiresLicense: false,
  };
}

function pickBestPixabayVideoFile(videos) {
  if (!videos || typeof videos !== "object") return null;
  for (const size of ["large", "medium", "small", "tiny"]) {
    const row = videos[size];
    if (row?.url) return row;
  }
  return null;
}

function mapPixabayVideo(hit) {
  const bestFile = pickBestPixabayVideoFile(hit.videos);
  const pageUrl = hit.pageURL || `https://pixabay.com/videos/${hit.id}/`;

  return {
    provider: "pixabay",
    mediaType: "video",
    id: String(hit.id),
    previewUrl: hit.userImageURL || bestFile?.url || "",
    photographer: hit.user || "Unknown",
    photographerUrl: hit.user_id ? `https://pixabay.com/users/${hit.user}-${hit.user_id}/` : "https://pixabay.com/",
    photoPageUrl: pageUrl,
    pexelsPhotoUrl: "",
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: "",
    pixabayPhotoUrl: pageUrl,
    originalImageUrl: bestFile?.url || "",
    downloadUrl: bestFile?.url || "",
    duration: hit.duration || 0,
    width: bestFile?.width || 0,
    height: bestFile?.height || 0,
    requiresLicense: false,
  };
}

async function searchPixabayImages(query, apiKey, options = {}) {
  const { perPage = PER_PAGE, orientation = "landscape", lang } = options;
  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("orientation", mapOrientation(orientation));
  url.searchParams.set("per_page", String(Math.min(Math.max(perPage, 3), 200)));
  url.searchParams.set("lang", lang || queryLang(query));

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Pixabay API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = JSON.parse(body);
  if (data.error) {
    throw new Error(`Pixabay API: ${data.error}`);
  }

  return (data.hits || [])
    .map(mapPixabayImage)
    .filter((item) => Boolean(item.downloadUrl));
}

async function searchPixabayVideos(query, apiKey, options = {}) {
  const { perPage = PER_PAGE, lang } = options;
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(Math.min(Math.max(perPage, 3), 200)));
  url.searchParams.set("lang", lang || queryLang(query));

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Pixabay Video API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = JSON.parse(body);
  if (data.error) {
    throw new Error(`Pixabay Video API: ${data.error}`);
  }

  return (data.hits || [])
    .map(mapPixabayVideo)
    .filter((item) => Boolean(item.downloadUrl));
}

module.exports = {
  PER_PAGE,
  queryLang,
  mapPixabayImage,
  mapPixabayVideo,
  searchPixabayImages,
  searchPixabayVideos,
};
