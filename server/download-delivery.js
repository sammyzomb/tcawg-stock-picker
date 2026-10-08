const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

function createDownloadDelivery() {
  const tickets = new Map();
  function browserId(req) {
    return /(?:^|;\s*)stock_download_browser=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
  }
  function register(req, res, ctx, files) {
    const now = Date.now();
    for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
    let owner = browserId(req);
    if (!owner) {
      owner = crypto.randomBytes(24).toString("hex");
      res.setHeader("Set-Cookie", `stock_download_browser=${owner}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600`);
    }
    return files.map(file => {
      const absolute = fs.realpathSync(file.path);
      const allowed = [ctx.archiveRoot, ctx.videoArchiveRoot].some(root => {
        if (!fs.existsSync(root)) return false;
        const relative = path.relative(fs.realpathSync(root), absolute);
        return relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
      });
      if (!allowed || !fs.statSync(absolute).isFile()) throw new Error("無效的下載檔案。");
      const ticket = crypto.randomBytes(24).toString("hex");
      tickets.set(ticket, {path: absolute, owner, expires: now + 3600000});
      const {path: ignored, ...info} = file;
      return {...info, filename: path.basename(absolute), url: `/api/files/${ticket}`};
    });
  }
  async function serve(req, res, ticket) {
    const file = tickets.get(ticket);
    if (!file || file.expires < Date.now() || file.owner !== browserId(req)) {
      const error = new Error("下載連結已失效，請重新勾選下載。");
      error.status = 403;
      throw error;
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": fs.statSync(file.path).size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.path))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    await pipeline(fs.createReadStream(file.path), res);
  }
  return {register, serve};
}

module.exports = {createDownloadDelivery};
