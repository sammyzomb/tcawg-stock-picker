const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {createDownloadDelivery} = require("../server/download-delivery");

test("browser downloads stream only registered archive files to the requesting browser", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-delivery-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const ctx = {archiveRoot: path.join(root, "images"), videoArchiveRoot: path.join(root, "videos")};
  fs.mkdirSync(ctx.archiveRoot);
  const filename = path.join(ctx.archiveRoot, "莊園.jpg");
  fs.writeFileSync(filename, "image bytes");
  const outside = path.join(root, "secret.txt");
  fs.writeFileSync(outside, "private");
  const delivery = createDownloadDelivery();
  let cookie;
  const request = {headers: {}};
  const response = {setHeader(name, value) { if (name === "Set-Cookie") cookie = value.split(";")[0]; }};
  assert.throws(() => delivery.register(request, response, ctx, [{path: outside}]), /無效/);
  const [file] = delivery.register(request, response, ctx, [{path: filename}]);
  assert.equal(file.filename, "莊園.jpg");
  assert.equal("path" in file, false);
  const server = http.createServer(async (req, res) => {
    try { await delivery.serve(req, res, req.url.split("/").at(-1)); }
    catch (err) { res.writeHead(err.status || 400); res.end(err.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}${file.url}`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, {headers: {cookie: "stock_download_browser=" + "a".repeat(48)}})).status, 403);
  const download = await fetch(url, {headers: {cookie}});
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "image bytes");
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.match(download.headers.get("content-disposition"), /%E8%8E%8A/);
});
