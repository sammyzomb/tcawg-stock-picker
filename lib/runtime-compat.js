// Node 16.20.2 compatibility for the isolated Server 2012 R2 deployment.
// Modern installations keep their native HTTP implementation.
if (typeof globalThis.fetch !== "function" || process.env.STOCK_LEGACY_HTTP === "1") {
  const http = require("node-fetch");
  globalThis.fetch = http;
  http.Headers.prototype.getSetCookie = function () {
    return Object.entries(this.raw()).filter(([name]) => name.toLowerCase() === "set-cookie").flatMap(([, values]) => values);
  };
  for (const name of ["Headers", "Request", "Response"]) {
    globalThis[name] = http[name];
  }
}

const { Readable } = require("node:stream");
function fromWebStream(body) {
  if (body && typeof body.pipe === "function") return body;
  if (Buffer.isBuffer(body)) return Readable.from([body]);
  if (typeof Readable.fromWeb === "function") return Readable.fromWeb(body);
  return Readable.from((async function* () {
    const reader = body.getReader();
    let complete = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { complete = true; break; }
        yield Buffer.from(value);
      }
    } finally {
      if (!complete) await reader.cancel();
      reader.releaseLock();
    }
  })());
}
module.exports = { fromWebStream };
