const PER_PAGE = 15;

function pickBestVideoFile(files) {
  const mp4s = (files || []).filter((file) => file.file_type === "video/mp4" && file.link);
  if (mp4s.length === 0) return null;

  mp4s.sort((a, b) => {
    const aPixels = (a.width || 0) * (a.height || 0);
    const bPixels = (b.width || 0) * (b.height || 0);
    return bPixels - aPixels;
  });

  const hdOrBelow = mp4s.find((file) => (file.width || 0) <= 1920);
  return hdOrBelow || mp4s[0];
}

function mapPexelsVideo(video) {
  const bestFile = pickBestVideoFile(video.video_files);
  const pageUrl = video.url || `https://www.pexels.com/video/${video.id}/`;

  return {
    provider: "pexels",
    mediaType: "video",
    id: String(video.id),
    previewUrl: video.image || bestFile?.link || "",
    photographer: video.user?.name || "Unknown",
    photographerUrl: video.user?.url || "",
    photoPageUrl: pageUrl,
    pexelsPhotoUrl: pageUrl,
    unsplashPhotoUrl: "",
    shutterstockPhotoUrl: "",
    originalImageUrl: bestFile?.link || "",
    downloadUrl: bestFile?.link || "",
    duration: video.duration || 0,
    width: bestFile?.width || 0,
    height: bestFile?.height || 0,
    requiresLicense: false,
  };
}

async function searchPexelsVideos(query, apiKey, options = {}) {
  const { perPage = PER_PAGE, orientation = "landscape" } = options;
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  if (orientation) url.searchParams.set("orientation", orientation);

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels Video API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.videos || [])
    .map(mapPexelsVideo)
    .filter((item) => Boolean(item.downloadUrl));
}

module.exports = {
  PER_PAGE,
  pickBestVideoFile,
  mapPexelsVideo,
  searchPexelsVideos,
};
