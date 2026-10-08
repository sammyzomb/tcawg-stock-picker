const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { downloadSelected } = require("../lib/find");
const { filenameForMedia } = require("../lib/slot-media");
const {
  pexelsImageSizes,
  pixabayImageSizes,
  shutterstockImageSizes,
  commonsImageSizes,
  resolveDownloadChoice,
} = require("../lib/image-sizes");

test("stock libraries expose separate download sizes and keep the current default", () => {
  const pexels = pexelsImageSizes({
    width: 4000,
    height: 2667,
    src: {
      original: "https://images.pexels.com/original.jpg",
      large2x: "https://images.pexels.com/large2x.jpg",
      large: "https://images.pexels.com/large.jpg",
      medium: "https://images.pexels.com/medium.jpg",
    },
  });
  assert.equal(pexels.preferred, "large2x");
  assert.deepEqual(pexels.sizes.map((row) => row.id), ["original", "large2x", "large", "medium"]);
  assert.equal(pexels.sizes[1].width, 1880);

  const pixabay = pixabayImageSizes({
    imageWidth: 5000,
    imageHeight: 3000,
    largeImageURL: "https://cdn.pixabay.com/large.jpg",
    webformatURL: "https://cdn.pixabay.com/web.jpg",
    webformatWidth: 640,
    webformatHeight: 384,
  });
  assert.equal(pixabay.preferred, "large");
  assert.equal(pixabay.sizes.find((row) => row.id === "web").width, 640);

  assert.deepEqual(shutterstockImageSizes(6000, 4000).map((row) => row.licenseSize), ["huge", "medium", "small"]);
  const commons = commonsImageSizes({
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Palace.jpg",
    width: 3000,
    height: 2000,
  });
  assert.equal(commons[1].id, "w1920");
  assert.match(commons[1].url, /\/1920px-Palace\.jpg$/);
  assert.equal(filenameForMedia({ provider: "pixabay", id: "9", downloadSize: "web", defaultSize: "large" }), "pixabay-9-web.jpg");
  assert.equal(filenameForMedia({ provider: "pixabay", id: "9", downloadSize: "large", defaultSize: "large" }), "pixabay-9.jpg");
});

test("download fetches only the selected https size and rejects other hosts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-sizes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "pixabay");
  fs.mkdirSync(dir);
  const urls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  t.after(() => { global.fetch = original; });
  const item = {
    provider: "pixabay",
    id: "9",
    mediaType: "image",
    photographer: "Tester",
    originalImageUrl: "https://cdn.pixabay.com/large.jpg",
    downloadSize: "web",
    defaultSize: "large",
    sizes: [
      { id: "large", label: "大", width: 1280, height: 720, url: "https://cdn.pixabay.com/large.jpg" },
      { id: "web", label: "中", width: 640, height: 360, url: "https://cdn.pixabay.com/web.jpg" },
    ],
  };
  const ctx = { root, archiveDirs: { pixabay: dir }, videoArchiveDirs: { pixabay: dir } };
  const saved = await downloadSelected(ctx, [item], "測試", { interactive: false });
  assert.deepEqual(urls, ["https://cdn.pixabay.com/web.jpg"]);
  assert.equal(saved.downloaded[0].downloadSize, "web");
  assert.equal(fs.existsSync(path.join(dir, "pixabay-9-web.jpg")), true);
  assert.equal(resolveDownloadChoice({ ...item, sizes: [{ id: "web", url: "http://cdn.pixabay.com/web.jpg" }], downloadSize: "web" }), null);
  assert.equal(resolveDownloadChoice({ ...item, sizes: [{ id: "web", url: "https://evil.example/web.jpg" }], downloadSize: "web" }), null);
});
