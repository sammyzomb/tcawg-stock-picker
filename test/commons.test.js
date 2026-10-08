const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {mapFile, searchCommons} = require("../lib/commons");
const {createContext} = require("../lib/context");
const {searchStock, downloadStockItems} = require("../lib/search-service");

function page(id = 42, license = "CC BY-SA 4.0", licenseUrl = "https://creativecommons.org/licenses/by-sa/4.0/") {
  return {pageid: id, title: "File:Kolomenskoye palace.png", index: 1, imageinfo: [{
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Palace.png", thumburl: "https://upload.wikimedia.org/thumb.png", mime: "image/png", timestamp: "2025-01-01T00:00:00Z",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Palace.png",
    extmetadata: {Artist: {value: "<a href='/wiki/User:Author'>Author &amp; Friend</a>"}, ImageDescription: {value: "<p>Kolomenskoye palace</p>"}, LicenseShortName: {value: license}, LicenseUrl: {value: licenseUrl}},
  }]};
}
function mockFetch(t, implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  t.after(() => {global.fetch = original;});
}
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commons-stock-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, "image-slots.json"), JSON.stringify({slots: [], providerPriority: ["pixabay"]}));
  return createContext(root);
}

test("Commons accepts commercial license metadata and strips HTML from attribution", () => {
  const row = mapFile(page());
  assert.equal(row.photographer, "Author & Friend");
  assert.equal(row.description, "Kolomenskoye palace");
  assert.equal(row.attributionRequired, true);
  assert.equal(row.shareAlike, true);
  assert.equal(row.originalExtension, ".png");
  assert.equal(mapFile(page(43, "CC0", "http://creativecommons.org/publicdomain/zero/1.0/deed.en")).attributionRequired, false);
  assert.equal(mapFile(page(44, "Public domain", "")).attributionRequired, false);
  assert.equal(mapFile(page(45, "CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0/")), null);
  assert.equal(mapFile(page(46, "CC BY-ND 4.0", "https://creativecommons.org/licenses/by-nd/4.0/")), null);
  assert.equal(mapFile(page(47, "Unknown", "")), null);
  const missingArtist = page(); delete missingArtist.imageinfo[0].extmetadata.Artist;
  assert.equal(mapFile(missingArtist), null);
  assert.equal(mapFile(page(48, "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0")).shareAlike, true);
  assert.equal(mapFile(page(49, "CC0", "https://creativecommons.org/publicdomain/zero/1.0")).attributionRequired, false);
  assert.equal(mapFile(page(50, "CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0")), null);
  assert.equal(mapFile(page(51, "Unknown", "https://creativecommons.org/licenses/by/4.0fake")), null);
  assert.equal(mapFile(page(52, "Unknown", "https://creativecommons.org.fake/licenses/by/4.0")), null);
});

test("Commons searches file namespace through official API and remains visible with old provider priorities", async t => {
  const requests = [];
  mockFetch(t, async url => {
    requests.push(new URL(url));
    return {ok: true, json: async () => ({query: {pages: [page()]}})};
  });
  const rows = await searchCommons("Kolomenskoye palace", {perPage: 5});
  assert.equal(rows.length, 1);
  assert.equal(requests[0].searchParams.get("gsrnamespace"), "6");
  assert.equal(requests[0].searchParams.get("gsrsearch"), "Kolomenskoye palace");
  const result = await searchStock(project(t), {query: "Kolomenskoye palace", providers: "commons", precise: false});
  assert.equal(result.results[0].provider, "commons");
  assert.equal(result.providerCounts.commons, 1);
});

test("precise Morocco search finds licensed images beyond the first five Commons hits", async t => {
  mockFetch(t, async url => {
    const query = new URL(url);
    assert.equal(query.searchParams.get("gsrsearch"), "Morocco");
    const hits = Array.from({length: 5}, (_, index) => page(index + 1, "Unknown", ""));
    const allowed = page(6);
    allowed.title = "File:Morocco garden.png";
    allowed.imageinfo[0].extmetadata.ImageDescription.value = "Garden in Morocco";
    hits.push(allowed);
    return {ok: true, json: async () => ({query: {pages: hits.slice(0, Number(query.searchParams.get("gsrlimit")))}})};
  });
  const result = await searchStock(project(t), {query: "摩洛哥", providers: "commons", precise: true});
  assert.equal(result.queryEnglish, "Morocco");
  assert.deepEqual(result.results.map(row => row.id), ["6"]);
});

test("searching an unconfigured provider reports missing credentials", async t => {
  const previous = process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = previous; });
  mockFetch(t, async () => { throw new Error("No request expected without credentials"); });
  const result = await searchStock(project(t), {query: "Morocco", providers: "pexels", precise: true});
  assert.equal(result.results.length, 0);
  assert.equal(result.errors[0].provider, "pexels");
  assert.match(result.errors[0].message, /API 金鑰/);
});

test("precise all-source and free searches include every selected provider in visible results", async t => {
  const keys = ["PEXELS_API_KEY", "UNSPLASH_ACCESS_KEY", "PIXABAY_API_KEY", "SHUTTERSTOCK_API_TOKEN"];
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => {process.env[key] = "synthetic-test";});
  t.after(() => keys.forEach((key, index) => {if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];}));
  const hosts = [];
  mockFetch(t, async url => {
    const host = new URL(url).hostname;
    hosts.push(host);
    const rows = Array.from({length: 12}, (_, index) => ({id: index + 1, description: "Morocco", alt: "Morocco", tags: "Morocco", largeImageURL: "mock:image", src: {medium: "mock:image"}, urls: {small: "mock:image"}}));
    let data;
    if (host === "commons.wikimedia.org") data = {query: {pages: rows.map(row => {
      const entry = page(row.id);
      entry.title = "File:Morocco " + row.id + ".png";
      entry.imageinfo[0].extmetadata.ImageDescription.value = "Morocco";
      return entry;
    })}};
    else if (host === "api.pexels.com") data = {photos: rows};
    else if (host === "api.unsplash.com") data = {results: rows};
    else if (host === "pixabay.com") data = {hits: rows};
    else if (host === "api.shutterstock.com") data = {data: rows};
    else throw new Error("Unexpected request host");
    return {ok: true, json: async () => data, text: async () => JSON.stringify(data)};
  });
  const ctx = project(t);
  const all = await searchStock(ctx, {query: "摩洛哥", providers: "all", precise: true});
  assert.equal(all.results.length, 8);
  assert.deepEqual([...new Set(all.results.map(row => row.provider))].sort(), ["commons", "pexels", "pixabay", "shutterstock", "unsplash"]);
  assert.equal(new Set(hosts).size, 5);
  hosts.length = 0;
  const free = await searchStock(ctx, {query: "摩洛哥", providers: "all", freeOnly: true, precise: true});
  assert.deepEqual([...new Set(free.results.map(row => row.provider))].sort(), ["commons", "pexels", "pixabay", "unsplash"]);
  assert.ok(!hosts.includes("api.shutterstock.com"));
});

test("Commons downloads revalidate metadata, preserve real extension and save license evidence for new and existing files", async t => {
  const ctx = project(t);
  const requested = [];
  let allowed = true;
  mockFetch(t, async url => {
    requested.push(String(url));
    if (new URL(url).hostname === "commons.wikimedia.org") return {ok: true, json: async () => ({query: {pages: [allowed ? page() : page(42, "Unknown", "")]}})};
    assert.equal(String(url), "https://upload.wikimedia.org/wikipedia/commons/a/ab/Palace.png");
    return {ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer};
  });
  const payload = {query: "palace", items: [{provider: "commons", id: "42", originalImageUrl: "https://untrusted.invalid/file", licenseName: "CC0"}]};
  const first = await downloadStockItems(ctx, payload);
  assert.equal(first.downloaded, 1);
  assert.equal(first.files[0].filename, "commons-42.png");
  const evidence = fs.readFileSync(path.join(ctx.archiveDirs.commons, first.files[0].licenseFilename), "utf8");
  assert.match(evidence, /CC BY-SA 4.0/);
  assert.match(evidence, /Author & Friend/);
  assert.match(evidence, /改作須採相同授權：是/);
  const credits = JSON.parse(fs.readFileSync(path.join(ctx.archiveDirs.commons, "credits.json"), "utf8"));
  assert.equal(credits[0].licenseName, "CC BY-SA 4.0");
  const second = await downloadStockItems(ctx, payload);
  assert.equal(second.existing, 1);
  assert.equal(requested.filter(url => url.includes("upload.wikimedia.org")).length, 1);
  allowed = false;
  await assert.rejects(() => downloadStockItems(ctx, payload), /無法確認可商用授權/);
});
