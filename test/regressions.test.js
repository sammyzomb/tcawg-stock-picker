const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadDotEnv } = require("../lib/env");
const { createContext } = require("../lib/context");
const { createWebServer } = require("../server/web-server");
const { syncSlots } = require("../lib/sync");
const { downloadStockItems } = require("../lib/search-service");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-picker-test-"));
  t.after(() => {
    loadDotEnv(null);
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("stock-picker-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function project(root, name, env = "") {
  const dir = path.join(root, name);
  write(path.join(dir, "stock-picker.config.json"), JSON.stringify({ slotsFile: "slots.json" }));
  write(path.join(dir, "slots.json"), JSON.stringify({ targetRoot: "target", slots: [
    { id: "hero", file: "hero.jpg", type: "image" },
    { id: "clip", file: "clip.mp4", type: "video" },
  ] }));
  write(path.join(dir, ".env"), env);
  return dir;
}

function mockFetch(t, handler) {
  const original = global.fetch;
  global.fetch = handler;
  t.after(() => { global.fetch = original; });
}

function credentials(t) {
  for (const key of ["SHUTTERSTOCK_API_TOKEN", "SHUTTERSTOCK_SUBSCRIPTION_ID"]) {
    const original = process.env[key];
    process.env[key] = "synthetic-test-value";
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
}

test("project environments replace loaded values, clear missing keys, and preserve external overrides", (t) => {
  const root = fixture(t);
  const a = path.join(root, "a.env");
  const b = path.join(root, "b.env");
  const key = "STOCK_PICKER_TEST_KEY";
  const removed = "STOCK_PICKER_TEST_REMOVED";
  const external = "STOCK_PICKER_TEST_EXTERNAL";
  process.env[external] = "shell";
  t.after(() => { delete process.env[external]; delete process.env[key]; delete process.env[removed]; });
  write(a, `${key}=A\n${removed}=old\n${external}=file-A\n`);
  write(b, `${key}='B'\n${external}=file-B\n`);
  loadDotEnv(a);
  assert.equal(process.env[key], "A");
  loadDotEnv(b);
  assert.equal(process.env[key], "B");
  assert.equal(process.env[removed], undefined);
  assert.equal(process.env[external], "shell");
  process.env[key] = "external-change";
  loadDotEnv(a);
  assert.equal(process.env[key], "external-change");
  delete process.env[key];
  loadDotEnv(b);
  assert.throws(() => loadDotEnv(root));
  assert.equal(process.env[key], "B");
  loadDotEnv(path.join(root, "missing.env"));
  assert.equal(process.env[key], undefined);
  assert.equal(process.env[external], "shell");
});

test("failed project switches preserve path, context, and credentials", (t) => {
  const root = fixture(t);
  const a = project(root, "a", "STOCK_PICKER_TEST_SWITCH=A\n");
  const b = project(root, "b", "STOCK_PICKER_TEST_SWITCH=B\n");
  const app = createWebServer({ projectRoot: a });
  t.after(() => { app.server.close(); delete process.env.STOCK_PICKER_TEST_SWITCH; });
  const invalid = path.join(root, "invalid");
  fs.mkdirSync(invalid);
  const badManifest = project(root, "bad-manifest", "STOCK_PICKER_TEST_SWITCH=bad\n");
  write(path.join(badManifest, "slots.json"), "{}");
  const badJson = project(root, "bad-json");
  write(path.join(badJson, "slots.json"), "{");
  const missingSlots = project(root, "missing-slots");
  fs.unlinkSync(path.join(missingSlots, "slots.json"));
  const badEnv = project(root, "bad-env");
  fs.unlinkSync(path.join(badEnv, ".env"));
  fs.mkdirSync(path.join(badEnv, ".env"));
  const original = app.getContext();
  for (const dir of [invalid, badManifest, badJson, missingSlots, badEnv, path.join(root, "missing")]) {
    assert.throws(() => app.setProject(dir));
    assert.equal(app.getProjectRoot(), a);
    assert.equal(app.getContext(), original);
    assert.equal(process.env.STOCK_PICKER_TEST_SWITCH, "A");
  }
  app.setProject(b);
  assert.equal(app.getContext().root, b);
  assert.equal(app.getProjectRoot(), b);
  assert.equal(process.env.STOCK_PICKER_TEST_SWITCH, "B");
});

test("sync restores Pixabay image and video slots from archive credits", (t) => {
  const ctx = createContext(project(fixture(t), "sync"));
  for (const [type, slotId, filename] of [["image", "hero", "pixabay-1.jpg"], ["video", "clip", "pixabay-2.mp4"]]) {
    const dir = (type === "video" ? ctx.videoArchiveDirs : ctx.archiveDirs).pixabay;
    write(path.join(dir, filename), `data-${type}`);
    write(path.join(dir, "credits.json"), JSON.stringify([{ slotId, id: type === "image" ? "1" : "2", provider: "pixabay", mediaType: type, filename }]));
  }
  const result = syncSlots(ctx, false);
  assert.ok(result.results.every((row) => row.ok && row.provider === "pixabay"));
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/hero.jpg"), "utf8"), "data-image");
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/clip.mp4"), "utf8"), "data-video");
  assert.ok(syncSlots(ctx, true).results.every((row) => row.ok));
});

test("slot validation rejects multiple items, unknown slots, and mismatched media before any downloads", async (t) => {
  const ctx = createContext(project(fixture(t), "validation"));
  write(path.join(ctx.root, "target/hero.jpg"), "original");
  let calls = 0;
  mockFetch(t, async () => { calls++; throw new Error("No network allowed"); });
  const image = { provider: "pexels", id: "1", mediaType: "image" };
  await assert.rejects(downloadStockItems(ctx, { slotId: "hero", items: [image, { ...image, id: "2" }] }), /單一圖槽/);
  await assert.rejects(downloadStockItems(ctx, { slotId: "missing", items: [image] }), /Unknown slot/);
  await assert.rejects(downloadStockItems(ctx, { slotId: "clip", items: [image] }), /媒體類型/);
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/hero.jpg"), "utf8"), "original");
  assert.equal(fs.existsSync(ctx.archiveRoot), false);
});

test("batch reports downloads, existing files, unsupported items, and individual failures accurately", async (t) => {
  const ctx = createContext(project(fixture(t), "batch"));
  credentials(t);
  write(path.join(ctx.archiveDirs.pexels, "pexels-existing.jpg"), "cached");
  const calls = [];
  mockFetch(t, async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.shutterstock.com")) return { ok: true, text: async () => JSON.stringify({ data: [{ image_id: "no-url" }] }) };
    if (String(url) === "mock:failure") return { ok: false, status: 503 };
    if (String(url) === "mock:success") return { ok: true, arrayBuffer: async () => Buffer.from("downloaded") };
    throw new Error("Unexpected fetch");
  });
  const result = await downloadStockItems(ctx, { confirmLicense: true, items: [
    { provider: "pexels", id: "existing", originalImageUrl: "mock:cached" },
    { provider: "pexels", id: "new", originalImageUrl: "mock:success" },
    { provider: "pixabay", id: "bad", originalImageUrl: "mock:failure" },
    { provider: "unsupported", id: "skip" },
    { provider: "shutterstock", id: "no-url" },
  ] });
  assert.equal(result.downloaded, 1);
  assert.equal(result.existing, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].error, /503/);
  assert.match(result.failed[1].error, /No license download URL/);
  assert.deepEqual(result.files.map((row) => row.id).sort(), ["existing", "new"]);
  assert.equal(calls.length, 3);
  assert.equal(fs.readFileSync(path.join(ctx.archiveDirs.pexels, "pexels-new.jpg"), "utf8"), "downloaded");
  const credits = JSON.parse(fs.readFileSync(path.join(ctx.archiveDirs.pexels, "credits.json"), "utf8"));
  assert.equal(credits[0].id, "new");
  assert.equal(fs.existsSync(path.join(ctx.archiveDirs.pixabay, "pixabay-bad.jpg")), false);
});

test("an existing archive item can fill a slot without counting as a new download", async (t) => {
  const ctx = createContext(project(fixture(t), "existing"));
  write(path.join(ctx.archiveDirs.pexels, "pexels-1.jpg"), "cached");
  mockFetch(t, async () => { throw new Error("No fetch expected"); });
  const result = await downloadStockItems(ctx, { slotId: "hero", items: [{ provider: "pexels", id: "1" }] });
  assert.equal(result.downloaded, 0);
  assert.equal(result.existing, 1);
  assert.equal(result.copies.length, 1);
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/hero.jpg"), "utf8"), "cached");
});

test("a failed Shutterstock license never copies a stale archive to the slot", async (t) => {
  const ctx = createContext(project(fixture(t), "license-failure"));
  credentials(t);
  write(path.join(ctx.archiveDirs.shutterstock, "shutterstock-1.jpg"), "stale");
  write(path.join(ctx.root, "target/hero.jpg"), "original");
  mockFetch(t, async () => ({ ok: true, text: async () => JSON.stringify({ data: [] }) }));
  const result = await downloadStockItems(ctx, { confirmLicense: true, slotId: "hero", items: [{ provider: "shutterstock", id: "1" }] });
  assert.equal(result.downloaded, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.files.length, 0);
  assert.equal(result.copies.length, 0);
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/hero.jpg"), "utf8"), "original");
});

test("a successful new download fills exactly one slot", async (t) => {
  const ctx = createContext(project(fixture(t), "new"));
  mockFetch(t, async () => ({ ok: true, arrayBuffer: async () => Buffer.from("fresh") }));
  const result = await downloadStockItems(ctx, { slotId: "hero", items: [{ provider: "pixabay", id: "7", originalImageUrl: "mock:fresh" }] });
  assert.equal(result.downloaded, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.copies.length, 1);
  assert.equal(fs.readFileSync(path.join(ctx.root, "target/hero.jpg"), "utf8"), "fresh");
});
