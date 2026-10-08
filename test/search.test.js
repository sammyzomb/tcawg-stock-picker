const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { resolveSearchQueries, translateToEnglish, relevanceScore } = require("../lib/query-translate");
const { searchStock } = require("../lib/search-service");

test("the confirmed Chinese estate name resolves to Kolomenskoye without machine translation", async (t) => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("Translation must not be needed"); };
  t.after(() => { global.fetch = original; });
  const queries = await resolveSearchQueries("洛明思科婭莊園");
  assert.equal(queries.english, "Kolomenskoye palace");
  assert.equal(relevanceScore({ description: "Palace at Kolomenskoe" }, ["kolomenskoye"]), 2);
  assert.equal(relevanceScore({ description: "Cusco traditional festival", photographer: "Kolomenskoye" }, ["kolomenskoye"]), 0);
});

test("partial Chinese dictionary matches do not discard the unknown subject", async (t) => {
  const original = global.fetch;
  let translated = "";
  global.fetch = async (url) => {
    translated = new URL(url).searchParams.get("q");
    return { ok: true, json: async () => ({ responseData: { translatedText: "Peru unknown palace" } }) };
  };
  t.after(() => { global.fetch = original; });
  assert.equal(await translateToEnglish("祕魯 未知宮殿"), "Peru unknown palace");
  assert.equal(translated, "祕魯 未知宮殿");
});

test("Spain and common country names use offline translations and retain intentional English edits", async t => {
  const previous = global.fetch;
  global.fetch = async () => { throw new Error("Country names must not use machine translation"); };
  t.after(() => {global.fetch = previous;});
  assert.equal((await resolveSearchQueries("西班牙")).english, "Spain");
  assert.equal((await resolveSearchQueries("葡萄牙")).english, "Portugal");
  assert.equal((await resolveSearchQueries("法國")).english, "France");
  assert.equal((await resolveSearchQueries("西班牙", "Barcelona Spain")).english, "Barcelona Spain");
});

test("precise search sends the estate name to both providers and removes unrelated results", async (t) => {
  const originalFetch = global.fetch;
  const keys = ["SHUTTERSTOCK_API_TOKEN", "PIXABAY_API_KEY"];
  const originalKeys = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = "synthetic-test"; });
  t.after(() => {
    global.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originalKeys[index] === undefined) delete process.env[key];
      else process.env[key] = originalKeys[index];
    });
  });
  const requests = [];
  global.fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed.searchParams.get("query") || parsed.searchParams.get("q"));
    const data = parsed.hostname === "api.shutterstock.com" ? { data: [
      { id: "1", description: "Kolomenskoye wooden palace in Moscow" },
      { id: "2", description: "Cusco Peru sacred valley" },
      { id: "5", description: "Kolomenskoye park apple trees" },
      { id: "6", description: "Royal palace in Paris" },
    ] } : { hits: [
      { id: "3", tags: "Kolomenskoe palace", largeImageURL: "mock:image", pageURL: "https://pixabay.com/photos/estate-3/" },
      { id: "4", tags: "sunset taiwan", largeImageURL: "mock:image", pageURL: "https://pixabay.com/photos/sunset-4/" },
    ] };
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  const archiveDirs = Object.fromEntries(["pexels", "pixabay", "unsplash", "shutterstock"].map((provider) => [provider, path.join(os.tmpdir(), "stock-picker-no-archive", provider)]));
  const ctx = { loadManifest: () => ({ slots: [] }), ensureArchiveDirs() {}, archiveDirs, videoArchiveDirs: archiveDirs };
  const result = await searchStock(ctx, { query: "洛明思科婭莊園", providers: "shutterstock,pixabay", precise: true });
  assert.deepEqual(requests, ["Kolomenskoye palace", "Kolomenskoye palace"]);
  assert.equal(result.queryEnglish, "Kolomenskoye palace");
  assert.equal(result.filteredOut, 4);
  assert.deepEqual(result.results.map((row) => row.id).sort(), ["1", "3"]);
  assert.equal(result.errors.length, 0);
});

function webUi(fetch) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const item = {
      value: "", dataset: {}, checked: false, textContent: "", innerHTML: "", events: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, handler) { this.events[name] = handler; },
      querySelector() { return element(Symbol()); }, appendChild() {}, removeAttribute() {}, setAttribute() {},
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); },
    };
    elements.set(id, item);
    return item;
  }
  const context = vm.createContext({
    URLSearchParams, fetch, window: {}, setTimeout: () => 0, clearTimeout() {},
    document: { getElementById: element, querySelector: element, createElement: () => element(Symbol()) },
  });
  const source = fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8");
  const startup = source.lastIndexOf("\nloadLibraries().catch");
  assert.ok(startup > 0);
  vm.runInContext(source.slice(0, startup) + "\nglobalThis.ui = {state,els,buildSearchParams,runSearch,downloadSelected,downloadCard,chooseSaveFolder,saveToComputer,suggestEnglishQuery,ensureNasLogin,loginNas,selectSourceTab,visibleResults};", context);
  context.ui.els.sourceMode.value = "all";
  context.ui.els.mediaType.value = "image";
  return context.ui;
}

test("enabling NAS prompts for login only when the browser session is unauthenticated", async () => {
  let authenticated = false;
  const ui = webUi(async () => ({ok: authenticated, status: authenticated ? 200 : 401, json: async () => authenticated ? {user: "person", shares: []} : {error: "Login required"}}));
  ui.state.nasIndexed = true;
  ui.els.includeNas.checked = true;
  await ui.ensureNasLogin();
  assert.equal(ui.els.nasLoginDialog.open, true);
  ui.els.nasPassword.value = "test-password";
  ui.els.nasCancelLoginBtn.events.click();
  assert.equal(ui.els.includeNas.checked, false);
  assert.equal(ui.els.nasPassword.value, "");
  authenticated = true;
  ui.els.includeNas.checked = true;
  await ui.ensureNasLogin();
  assert.equal(ui.state.nasLoggedIn, true);
  assert.equal(ui.els.nasLoginDialog.open, false);
});

test("NAS login submits browser-filled credentials and closes the prompt without storing the password", async () => {
  let submitted;
  const ui = webUi(async (url, options) => {
    assert.equal(url, "/api/nas/login");
    submitted = JSON.parse(options.body);
    return {ok: true, json: async () => ({user: "person", shares: []})};
  });
  ui.state.nasIndexed = true;
  ui.els.nasLoginDialog.showModal();
  ui.els.nasUser.value = "person";
  ui.els.nasPassword.value = "test-password";
  await ui.loginNas();
  assert.deepEqual(submitted, {user: "person", password: "test-password"});
  assert.equal(ui.els.nasLoginDialog.open, false);
  assert.equal(ui.els.includeNas.checked, true);
  assert.equal(ui.els.nasPassword.value, "");
});

test("source tabs filter cards while keeping other tabs selected and bulk actions scoped to the current tab", () => {
  const ui = webUi(async () => { throw new Error("Switching tabs must not issue a new search"); });
  ui.state.results = [{provider: "pexels", id: "1"}, {provider: "unsplash", id: "2"}, {provider: "nas", id: "3"}];
  ui.state.selected.add("unsplash:2");
  ui.selectSourceTab("pexels");
  assert.deepEqual(Array.from(ui.visibleResults(), row => row.provider), ["pexels"]);
  assert.equal(ui.state.selected.has("unsplash:2"), true);
  ui.els.selectAllBtn.events.click();
  assert.deepEqual([...ui.state.selected].sort(), ["pexels:1", "unsplash:2"]);
  ui.els.clearAllBtn.events.click();
  assert.deepEqual([...ui.state.selected], ["unsplash:2"]);
  ui.selectSourceTab("all");
  assert.equal(ui.visibleResults().length, 3);
});

test("an empty provider tab explains its failed or unsearched state", () => {
  const ui = webUi(async () => { throw new Error("No request expected"); });
  ui.state.lastQuery = "Morocco";
  ui.state.searchedProviders = ["pexels"];
  ui.state.providerErrors.pexels = "尚未設定 API 金鑰";
  ui.selectSourceTab("pexels");
  assert.match(ui.els.results.innerHTML, /Pexels.*API 金鑰/);
  ui.selectSourceTab("unsplash");
  assert.match(ui.els.results.innerHTML, /本次未搜尋此來源/);
});

test("an empty NAS tab stops loading after a delayed failure while online images remain", async () => {
  let finishNas;
  const ui = webUi(url => url.startsWith("/api/nas/search")
    ? new Promise(resolve => { finishNas = resolve; })
    : Promise.resolve({ok: true, json: async () => ({providers: ["pexels"], results: [{provider: "pexels", id: "1"}]})}));
  ui.els.queryInput.value = "Spain";
  ui.els.includeNas.checked = true;
  ui.selectSourceTab("nas");
  await ui.runSearch();
  assert.match(ui.els.results.innerHTML, /搜尋中/);
  finishNas({ok: false, status: 503, json: async () => ({error: "NAS temporarily unavailable"})});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.state.results.length, 1);
  assert.equal(ui.state.nasPending, false);
  assert.match(ui.els.results.innerHTML, /NAS temporarily unavailable/);
  assert.doesNotMatch(ui.els.results.innerHTML, /搜尋中/);
});

test("editing a query clears thumbnails and selection and sends only the entered term", () => {
  const ui = webUi(async () => { throw new Error("Unexpected fetch"); });
  ui.state.results = [{ id: "old", provider: "shutterstock" }];
  ui.state.selected.add("shutterstock:old");
  ui.els.queryInput.value = "洛明思科婭莊園";
  ui.els.queryInput.events.input();
  const params = ui.buildSearchParams();
  assert.equal(params.get("q"), "洛明思科婭莊園");
  assert.equal(params.has("slotId"), false);
  assert.equal(params.has("queryEn"), false);
  assert.equal(ui.state.results.length, 0);
  assert.equal(ui.state.selected.size, 0);
});

test("NAS-only search uses the NAS endpoint without online search or translation", async () => {
  const requests = [];
  const ui = webUi(async url => {
    requests.push(url);
    return {ok: true, json: async () => ({configured: true, results: []})};
  });
  ui.els.sourceMode.value = "nas";
  ui.els.queryInput.value = "洛明思科婭莊園";
  ui.els.nasShare.value = "素材";
  await ui.runSearch();
  assert.equal(requests.length, 1);
  const url = new URL(requests[0], "http://localhost");
  assert.equal(url.pathname, "/api/nas/search");
  assert.equal(url.searchParams.get("q"), "洛明思科婭莊園");
  assert.equal(url.searchParams.get("share"), "素材");
  assert.equal(ui.state.nasPending, false);
});

test("late results for an old query cannot replace the newer query's cleared results", async () => {
  let resolve;
  const ui = webUi(() => new Promise((done) => { resolve = done; }));
  ui.els.queryInput.value = "Peru";
  const pending = ui.runSearch();
  ui.els.queryInput.value = "洛明思科婭莊園";
  ui.els.queryInput.events.input();
  resolve({ ok: true, json: async () => ({ results: [{ id: "old", provider: "shutterstock" }] }) });
  await pending;
  assert.equal(ui.state.results.length, 0);
  assert.match(ui.els.resultSummary.textContent, /關鍵字已變更/);
});

test("one download action saves online and NAS selections and retains failed items", async () => {
  const requests = [];
  const ui = webUi(async (url, options) => {
    if (!options) return {ok: true, body: {pipeTo: async () => {}}};
    requests.push({url, body: JSON.parse(options.body)});
    if (url === "/api/download") return {ok: true, json: async () => ({downloaded: 1, files: [{provider: "pixabay", id: "1", filename: "pixabay-1.jpg", url: "/api/files/test-online"}], failed: []})};
    const failed = JSON.parse(options.body).id === 3;
    return {ok: !failed, status: failed ? 403 : 200, json: async () => failed ? {error: "Access denied"} : {archive: "nas/file.jpg", files: [{filename: "nas-2.jpg", url: "/api/files/test-nas"}]}};
  });
  ui.state.saveDirectory = {name: "選定資料夾", async getFileHandle(name, options) { if (!options) throw Object.assign(new Error(), {name: "NotFoundError"}); return {async createWritable() { return {}; }}; }};
  ui.state.results = [{provider: "pixabay", id: "1"}, {provider: "nas", id: "2", nasFileId: 2}, {provider: "nas", id: "3", nasFileId: 3}];
  ui.state.results.forEach(item => ui.state.selected.add(item.provider + ":" + item.id));
  await ui.downloadSelected();
  assert.deepEqual(requests.map(row => row.url), ["/api/download", "/api/nas/copy", "/api/nas/copy"]);
  assert.equal(requests.some(row => "slotId" in row.body), false);
  assert.deepEqual([...ui.state.selected], ["nas:3"]);
  assert.match(ui.els.message.textContent, /已儲存 2/);
  assert.match(ui.els.message.textContent, /Access denied/);
});

test("a card download saves only that image", async () => {
  const bodies = [];
  const ui = webUi(async (url, options) => {
    if (!options) return {ok: true, body: {pipeTo: async () => {}}};
    bodies.push(JSON.parse(options.body));
    return {ok: true, json: async () => ({downloaded: 1, files: [{provider: "pixabay", id: "9", filename: "pixabay-9.jpg", url: "/api/files/one"}]})};
  });
  ui.state.saveDirectory = {name: "選定資料夾", async getFileHandle(name, options) { if (!options) throw Object.assign(new Error(), {name: "NotFoundError"}); return {async createWritable() { return {}; }}; }};
  const item = {provider: "pixabay", id: "9"};
  ui.state.results = [item, {provider: "pexels", id: "8"}];
  await ui.downloadCard(item);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].items.map(row => row.id), ["9"]);
  assert.equal(item.downloaded, true);
  assert.equal(ui.state.results[1].downloaded, undefined);
  assert.equal(ui.state.downloading, false);
});

test("saving to the chosen browser folder keeps existing files and streams into a numbered filename", async () => {
  const writes = [];
  const ui = webUi(async url => ({ok: true, body: {pipeTo: async target => writes.push(target.name)}}));
  ui.state.saveDirectory = {
    name: "My photos",
    async getFileHandle(name, options) {
      if (!options && name !== "photo.jpg") throw Object.assign(new Error(), {name: "NotFoundError"});
      return {async createWritable() { return {name}; }};
    },
  };
  await ui.saveToComputer({filename: "photo.jpg", url: "/api/files/test"});
  assert.deepEqual(writes, ["photo (1).jpg"]);
});

test("Chinese input previews English and only sends an override after a manual edit", async () => {
  const ui = webUi(async () => ({ok: true, json: async () => ({english: "Kolomenskoye palace"})}));
  ui.els.queryInput.value = "洛明思科婭莊園";
  ui.els.queryInput.events.input();
  await ui.suggestEnglishQuery();
  assert.equal(ui.els.queryEnInput.value, "Kolomenskoye palace");
  const params = ui.buildSearchParams();
  assert.equal(params.get("q"), "洛明思科婭莊園");
  assert.equal(params.has("queryEn"), false);
  ui.els.queryEnInput.value = "Kolomenskoye winter";
  ui.els.queryEnInput.events.input();
  assert.equal(ui.buildSearchParams().get("queryEn"), "Kolomenskoye winter");
});

test("an incorrect automatic Spain suggestion cannot override the server country translation", async () => {
  const ui = webUi(async url => {
    const params = new URL(url, "http://localhost").searchParams;
    assert.equal(params.get("q"), "西班牙");
    assert.equal(params.has("queryEn"), false);
    return {ok: true, json: async () => ({queryEnglish: "Spain", translated: true, providers: ["shutterstock"], results: [], errors: []})};
  });
  ui.els.queryInput.value = "西班牙";
  ui.els.sourceMode.value = "shutterstock";
  ui.els.queryEnInput.value = "Espaillat";
  ui.els.queryEnInput.dataset.manual = "0";
  await ui.runSearch();
  assert.equal(ui.els.queryEnInput.value, "Spain");
});

test("late English suggestions cannot overwrite a newer Chinese query or a manual edit", async () => {
  let resolve;
  const ui = webUi(() => new Promise(done => {resolve = done;}));
  ui.els.queryInput.value = "祕魯";
  ui.els.queryInput.events.input();
  const pending = ui.suggestEnglishQuery();
  ui.els.queryInput.value = "洛明思科婭莊園";
  ui.els.queryInput.events.input();
  resolve({ok: true, json: async () => ({english: "Peru"})});
  await pending;
  assert.equal(ui.els.queryEnInput.value, "");
  const second = ui.suggestEnglishQuery();
  ui.els.queryEnInput.value = "Kolomenskoye winter";
  ui.els.queryEnInput.events.input();
  resolve({ok: true, json: async () => ({english: "Kolomenskoye palace"})});
  await second;
  assert.equal(ui.els.queryEnInput.value, "Kolomenskoye winter");
});

test("Commons browser saving includes license evidence and counts one image", async () => {
  const writes = [];
  const ui = webUi(async (url, options) => options ? {ok: true, json: async () => ({downloaded: 1, files: [
    {provider: "commons", id: "42", filename: "commons-42.png", url: "/api/files/photo"},
    {provider: "commons", id: "42", filename: "commons-42.png.license.txt", url: "/api/files/license", companion: true},
  ]})} : {ok: true, body: {pipeTo: async target => writes.push(target.name)}});
  ui.state.saveDirectory = {name: "Photos", async getFileHandle(name, options) {
    if (!options) throw Object.assign(new Error(), {name: "NotFoundError"});
    return {async createWritable() {return {name};}};
  }};
  ui.state.results = [{provider: "commons", id: "42"}];
  ui.state.selected.add("commons:42");
  await ui.downloadSelected();
  assert.deepEqual(writes, ["commons-42.png", "commons-42.png.license.txt"]);
  assert.equal(ui.state.selected.size, 0);
  assert.match(ui.els.message.textContent, /已儲存 1 個檔案/);
});
