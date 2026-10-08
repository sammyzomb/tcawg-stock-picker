// Integration checks executable by Node 16 without its experimental test runner.
require("../lib/runtime-compat");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { createWebServer } = require("../server/web-server");
const { createContext } = require("../lib/context");
const { createNasIndexClient } = require("../lib/nas-index");
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => server.close(resolve));
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-legacy-smoke-"));
  const upstream = http.createServer((req, res) => {
    if (req.url === "/login") {
      res.writeHead(303, {"Set-Cookie": ["nas_sess=test-session; HttpOnly", "nas_auth=test-auth; HttpOnly"], Location: "/"});
      return res.end();
    }
    if (!String(req.headers.cookie).includes("nas_sess=test-session") || !String(req.headers.cookie).includes("nas_auth=test-auth")) {
      res.writeHead(401); return res.end("{}");
    }
    if (req.url.startsWith("/api/thumb") || req.url.startsWith("/api/download")) {
      res.writeHead(200, {"Content-Type": "image/jpeg"}); return res.end("test-image-bytes");
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.startsWith("/api/search")
      ? {rows: [{id: 7, name: "sample.jpg", path: "sample.jpg", share: "test"}], hasMore: false}
      : {user: "test", shares: []}));
  });
  let app;
  try {
    await listen(upstream);
    fs.writeFileSync(path.join(root, "stock-picker.config.json"), JSON.stringify({slotsFile: "slots.json"}));
    fs.writeFileSync(path.join(root, "slots.json"), JSON.stringify({slots: []}));
    fs.writeFileSync(path.join(root, "nas_config.json"), JSON.stringify({searchService: {url: `http://127.0.0.1:${upstream.address().port}`}}));
    app = createWebServer({projectRoot: root});
    await listen(app.server);
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(base + "/api/status")).status, 200);
    const client = createNasIndexClient();
    let cookie;
    const request = () => ({headers: {host: "localhost:3456", ...(cookie ? {cookie} : {})}, socket: {remoteAddress: "127.0.0.1"}});
    await assert.rejects(client.meta(root, request()), error => error.status === 401);
    await client.login(root, request(), {setHeader(name, value) {cookie = value.split(";")[0];}}, {user: "test", password: "test"});
    assert.ok(cookie && !cookie.includes("test-session"));
    assert.equal((await client.search(root, {query: "sample"}, request())).results.length, 1);
    let thumbnail = "";
    const output = new Writable({write(chunk, encoding, done) {thumbnail += chunk; done();}});
    output.writeHead = status => assert.equal(status, 200);
    await client.media(root, request(), output, "thumb", 7);
    assert.equal(thumbnail, "test-image-bytes");
    const copied = await client.copy(createContext(root), {id: 7}, request());
    assert.equal(fs.readFileSync(path.resolve(root, copied.archive), "utf8"), "test-image-bytes");
    console.log(`PASS ${process.version}: web, status, NAS authentication, multiple cookies, search, thumbnail and download`);
  } finally {
    if (app) await close(app.server);
    await close(upstream);
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("stock-legacy-smoke-"));
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
