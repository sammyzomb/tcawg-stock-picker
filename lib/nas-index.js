const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fromWebStream } = require("./runtime-compat");
const { pipeline } = require("node:stream/promises");
const { loadNasConfig } = require("./nas-search");

const COOKIE = "stock_nas_session";
const SESSION_MS = 8 * 60 * 60 * 1000;

function indexSettings(root) {
  const service = loadNasConfig(root).config?.searchService;
  if (!service?.url) return null;
  const url = new URL(service.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NAS 搜尋服務網址必須是 HTTP(S)，不可包含帳號密碼。");
  }
  return { url: url.origin, timeoutMs: Number(service.timeoutMs) > 0 ? Number(service.timeoutMs) : 30000 };
}

function serviceError(status) {
  const error = new Error(status === 401 ? "請先登入 NAS 快速搜尋，會沿用原服務的帳號權限。" : `NAS 搜尋服務回應 HTTP ${status}`);
  error.status = status === 401 ? 401 : 502;
  return error;
}

function createNasIndexClient() {
  const sessions = new Map();
  function session(req, settings) {
    for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    const token = String(req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const value = sessions.get(token);
    return value?.url === settings.url && value.ip === req.socket.remoteAddress ? value : null;
  }
  async function request(settings, route, current, options = {}) {
    const response = await fetch(settings.url + route, {
      ...options, redirect: "manual", signal: AbortSignal.timeout(settings.timeoutMs),
      headers: { ...options.headers, ...(current?.cookie ? { Cookie: current.cookie } : {}) },
    });
    return response;
  }
  async function json(settings, route, current) {
    const response = await request(settings, route, current);
    if (!response.ok) throw serviceError(response.status);
    return response.json();
  }
  async function login(root, req, res, body) {
    const settings = indexSettings(root);
    if (!settings) throw new Error("尚未設定 NAS 快速搜尋服務。");
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) throw new Error("登入來源不符。");
    const form = new URLSearchParams({ user: String(body.user || ""), username: "nas-search", password: String(body.password || "") });
    const response = await request(settings, "/login", null, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
    });
    const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((value) => /^(nas_sess|nas_auth|nas_session)=/.test(value));
    // Accept only a session issued by the original service, then verify its access.
    if (!cookies.length) {
      const error = new Error("NAS 登入未成功，請確認帳號密碼；若帳號被鎖定或服務無法連線，請至原 NAS 搜尋頁查看。");
      error.status = 401;
      throw error;
    }
    const value = { url: settings.url, ip: req.socket.remoteAddress, cookie: cookies.join("; "), expires: Date.now() + SESSION_MS, items: new Map() };
    const meta = await json(settings, "/api/meta", value);
    const token = crypto.randomUUID();
    sessions.set(token, value);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/nas; Max-Age=${SESSION_MS / 1000}`);
    return { user: meta.user || "已登入", shares: meta.shares || [] };
  }
  async function meta(root, req) {
    const settings = indexSettings(root);
    if (!settings) return { indexed: false };
    return { ...await json(settings, "/api/meta", session(req, settings)), indexed: true };
  }
  async function search(root, options, req) {
    const started = Date.now();
    const settings = indexSettings(root);
    const current = session(req, settings);
    const queries = options.queries?.length ? options.queries : [options.query];
    const mediaType = options.mediaType === "video" ? "video" : "image";
    const results = [], seen = new Set();
    const limit = Math.min(Math.max(Number(options.maxResults) || 40, 1), 500);
    let hasMore = false;
    for (const query of queries) {
      if (!String(query || "").trim()) throw new Error("請輸入 NAS 搜尋關鍵字。");
      const params = new URLSearchParams({ q: query, cat: mediaType === "video" ? "影片" : "圖片", sort: "rel", hidedup: options.share ? "0" : "1", limit: String(limit) });
      if (options.share) params.set("share", options.share);
      if (options.ext) params.set("ext", options.ext);
      const data = await json(settings, `/api/search?${params}`, current);
      hasMore ||= Boolean(data.hasMore);
      for (const row of data.rows || []) {
        if (!Number.isSafeInteger(row.id) || !row.path || seen.has(row.path)) continue;
        seen.add(row.path);
        const item = { provider: "nas", id: String(row.id), nasFileId: row.id, filePath: row.path, filename: row.name,
          mediaType, previewIsImage: true, previewUrl: `/api/nas/index/thumb?id=${row.id}`,
          photoPageUrl: `${settings.url}/?${new URLSearchParams({ q: row.name, share: row.share, sort: "rel" })}`,
          photographer: "NAS", hostLabel: row.share, fileBytes: Number(row.size || row.bytes) || 0,
          downloaded: false, requiresLicense: false };
        if (current) {
          current.items.set(String(row.id), item);
          if (current.items.size > 1000) current.items.delete(current.items.keys().next().value);
        }
        results.push(item);
        if (results.length >= limit) { hasMore = true; break; }
      }
      if (results.length >= limit) break;
    }
    return { configured: true, query: queries[0], queries, mediaType, matchMode: "all", searchScope: "index", results,
      errors: [], timedOut: false, elapsedMs: Date.now() - started, hasMore, serviceUrl: settings.url,
      scopeHint: "使用 nas-search 全檔案索引；空白分隔的關鍵字全部匹配完整路徑，依相關度排序。" };
  }
  async function media(root, req, res, kind, id) {
    if (!/^\d+$/.test(String(id))) throw new Error("無效的 NAS 檔案編號。");
    const settings = indexSettings(root);
    const response = await request(settings, `/api/${kind}?id=${id}`, session(req, settings));
    if (!response.ok) throw serviceError(response.status);
    res.writeHead(200, {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "private, no-store",
      ...(response.headers.get("Content-Disposition") ? { "Content-Disposition": response.headers.get("Content-Disposition") } : {}),
    });
    await pipeline(fromWebStream(response.body), res);
  }
  async function copy(ctx, body, req) {
    const settings = indexSettings(ctx.root);
    const current = session(req, settings);
    const item = current?.items.get(String(body.id));
    if (!item) throw new Error("請先登入並搜尋，再選取 NAS 檔案。");
    let dest;
    if (body.slotId) {
      const { findSlot } = require("./search-service");
      const { slotMediaType } = require("./slot-media");
      const { manifest, slot } = findSlot(ctx, body.slotId);
      if (slotMediaType(slot) !== item.mediaType) throw new Error("NAS 檔案與目標圖槽的媒體類型不符。");
      dest = ctx.targetPath(manifest, slot);
    }
    const response = await request(settings, `/api/download?id=${item.nasFileId}`, current);
    if (!response.ok) throw serviceError(response.status);
    const archiveDir = path.join(item.mediaType === "video" ? ctx.videoArchiveRoot : ctx.archiveRoot, "nas");
    fs.mkdirSync(archiveDir, { recursive: true });
    const archive = path.join(archiveDir, `nas-${crypto.randomUUID()}-${path.basename(item.filename).replace(/[^\w.\-]+/g, "_")}`);
    const temporary = archive + ".part";
    try {
      await pipeline(fromWebStream(response.body), fs.createWriteStream(temporary));
      fs.renameSync(temporary, archive);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
    const copies = [];
    if (dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(archive, dest);
      copies.push({ slotId: body.slotId, to: path.relative(ctx.root, dest) });
    }
    return { from: item.filePath, archive: path.relative(ctx.root, archive), copies };
  }
  return { login, meta, search, media, copy };
}

module.exports = { indexSettings, createNasIndexClient };
