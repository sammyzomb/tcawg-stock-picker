const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { test } = require("node:test");
const { createContext } = require("../lib/context");
const { createNasIndexClient } = require("../lib/nas-index");
const { describeNasSearch, loadNasConfig, searchNas } = require("../lib/nas-search");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nas-index-test-"));
  fs.writeFileSync(path.join(root, "nas_config.json"), JSON.stringify({ searchService: { url: "http://nas.test:8088" } }));
  fs.writeFileSync(path.join(root, "stock-picker.config.json"), JSON.stringify({ slotsFile: "slots.json" }));
  fs.writeFileSync(path.join(root, "slots.json"), JSON.stringify({ slots: [{ id: "hero", file: "hero.jpg" }] }));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("nas-index-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function mockFetch(t, callback) {
  const original = global.fetch;
  global.fetch = callback;
  t.after(() => { global.fetch = original; });
}
const json = (body, options) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...options });
const req = (cookie = "", ip = "127.0.0.1") => ({ headers: { cookie, host: "localhost:3456", origin: "http://localhost:3456" }, socket: { remoteAddress: ip } });

test("indexed configuration selects full-file indexing and refuses legacy scanning", (t) => {
  const root = fixture(t);
  assert.equal(describeNasSearch(loadNasConfig(root).config).scope, "index");
  assert.throws(() => searchNas(root, { query: "莊園" }), /索引服務/);
});

test("NAS 401 is preserved and never falls back to filesystem scanning", async (t) => {
  const root = fixture(t);
  mockFetch(t, async () => json({ error: "login required" }, { status: 401 }));
  await assert.rejects(createNasIndexClient().search(root, { query: "莊園" }, req()), (error) => error.status === 401);
});

test("login credentials stay out of local cookies and failed logins cannot create a session", async (t) => {
  const root = fixture(t);
  mockFetch(t, async () => new Response("incorrect password"));
  let setCookie = false;
  await assert.rejects(createNasIndexClient().login(root, req(), { setHeader() { setCookie = true; } }, { user: "person", password: "test-secret" }), /登入未成功/);
  assert.equal(setCookie, false);
});

test("NAS login, search filters, thumbnail and downloads use each browser's upstream session", async (t) => {
  const root = fixture(t), client = createNasIndexClient();
  const received = [];
  let denyDownload = false;
  const row = { id: 7, name: "莊園.jpg", path: "\\\\nas\\share\\country\\莊園.jpg", share: "share" };
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    received.push({ url: parsed, options });
    if (parsed.pathname === "/login") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("user"), "person");
      assert.equal(form.get("password"), "test-secret");
      return new Response(null, { status: 303, headers: { "Set-Cookie": "nas_sess=upstream-token; HttpOnly; Path=/", Location: "/" } });
    }
    if (options.headers.Cookie !== "nas_sess=upstream-token") return json({}, { status: 401 });
    if (parsed.pathname === "/api/meta") return json({ user: "person", shares: [{ share: "share" }] });
    if (parsed.pathname === "/api/search") return json({ rows: [row], hasMore: false });
    if (parsed.pathname === "/api/thumb") return new Response("thumbnail", { headers: { "Content-Type": "image/jpeg" } });
    if (parsed.pathname === "/api/download") return denyDownload
      ? new Response("access denied", { status: 403 })
      : new Response("original-image", { headers: { "Content-Type": "image/jpeg" } });
    throw new Error("Unexpected route");
  });
  let cookie;
  await client.login(root, req(), { setHeader(name, value) { assert.equal(name, "Set-Cookie"); cookie = value.split(";")[0]; } }, { user: "person", password: "test-secret" });
  assert.ok(!cookie.includes("upstream-token") && !cookie.includes("test-secret") && !cookie.includes("person"));
  const result = await client.search(root, { query: "俄羅斯 莊園", mediaType: "image", share: "share", ext: "jpg,png" }, req(cookie));
  const params = received.at(-1).url.searchParams;
  assert.equal(params.get("q"), "俄羅斯 莊園");
  assert.equal(params.get("cat"), "圖片");
  assert.equal(params.get("sort"), "rel");
  assert.equal(params.get("share"), "share");
  assert.equal(params.get("ext"), "jpg,png");
  assert.equal(params.get("hidedup"), "0");
  assert.equal(result.matchMode, "all");
  assert.equal(result.results[0].previewUrl, "/api/nas/index/thumb?id=7");
  assert.equal(result.searchScope, "index");
  let thumbnail = "";
  const output = new Writable({ write(chunk, encoding, done) { thumbnail += chunk; done(); } });
  output.writeHead = (status, headers) => { assert.equal(status, 200); assert.equal(headers["Content-Type"], "image/jpeg"); };
  await client.media(root, req(cookie), output, "thumb", 7);
  assert.equal(thumbnail, "thumbnail");
  const copied = await client.copy(createContext(root), { id: 7, slotId: "hero", path: "untrusted path" }, req(cookie));
  assert.equal(copied.copies.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "images/project-shutter/hero.jpg"), "utf8"), "original-image");
  denyDownload = true;
  const archives = fs.readdirSync(path.join(root, "public/images/nas"));
  await assert.rejects(client.copy(createContext(root), { id: 7, slotId: "hero" }, req(cookie)), /HTTP 403/);
  assert.deepEqual(fs.readdirSync(path.join(root, "public/images/nas")), archives);
  await assert.rejects(client.meta(root, req()), (error) => error.status === 401);
  await assert.rejects(client.meta(root, req(cookie, "other-client")), (error) => error.status === 401);
  await assert.rejects(client.copy(createContext(root), { id: 8 }, req(cookie)), /先登入並搜尋/);
});

test("video filtering and duplicate query results follow the original index API", async (t) => {
  const root = fixture(t);
  const calls = [];
  mockFetch(t, async (url) => {
    const parsed = new URL(url); calls.push(parsed);
    return json({ rows: [{ id: 9, name: "clip.mp4", path: "\\\\nas\\share\\clip.mp4", share: "share" }], hasMore: true });
  });
  const result = await createNasIndexClient().search(root, { queries: ["宮殿", "莊園"], mediaType: "video" }, req());
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].mediaType, "video");
  assert.equal(result.results[0].previewIsImage, true);
  assert.equal(result.hasMore, true);
  assert.equal(calls[0].searchParams.get("cat"), "影片");
  assert.equal(calls[0].searchParams.get("hidedup"), "1");
});
