const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createContext, loadProjectConfig } = require("../lib/context");
const { collectQuotaStatus } = require("../lib/quota");
const {
  getProviderStatus,
  listSlots,
  searchStock,
  searchStockBySlot,
  getSlotSearchPlan,
  downloadStockItems,
} = require("../lib/search-service");
const { resolveSearchQueries } = require("../lib/query-translate");
const { indexSettings, createNasIndexClient } = require("../lib/nas-index");
const { createDownloadDelivery } = require("./download-delivery");
const {
  searchNas,
  resolveNasPreviewPath,
  copyNasFile,
  loadNasConfig,
  describeNasSearch,
  DEFAULT_TIMEOUT_MS,
} = require("../lib/nas-search");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(webRoot, pathname, res) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(webRoot, safePath === path.sep ? "index.html" : safePath);
  if (!filePath.startsWith(webRoot)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function createWebServer(options = {}) {
  const packageRoot = options.packageRoot || path.resolve(__dirname, "..");
  const webRoot = path.join(packageRoot, "web");
  const defaultProject = options.defaultProject || path.join(packageRoot, "preview-web");
  let currentProject = options.projectRoot || defaultProject;
  let ctx = createContext(currentProject);
  const nasIndex = createNasIndexClient();
  const delivery = createDownloadDelivery();

  function setProject(projectRoot) {
    const resolved = path.resolve(projectRoot);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Project path not found: ${resolved}`);
    }
    const config = loadProjectConfig(resolved);
    const manifest = JSON.parse(fs.readFileSync(path.join(resolved, config.slotsFile), "utf8"));
    if (!manifest || !Array.isArray(manifest.slots)) {
      throw new Error(`${config.slotsFile} 必須包含 slots 陣列`);
    }
    const nextContext = createContext(resolved);
    currentProject = resolved;
    ctx = nextContext;
    return currentProject;
  }

  let quotaSnapshot = null;
  let quotaPending = null;
  async function handleApi(req, res, url) {
    try {
      if (url.pathname.startsWith("/api/files/") && req.method === "GET") {
        return await delivery.serve(req, res, url.pathname.slice("/api/files/".length));
      }
      if (url.pathname === "/api/status" && req.method === "GET") {
        const nas = loadNasConfig(currentProject);
        const nasSearch = describeNasSearch(nas.config);
        return sendJson(res, 200, {
          projectRoot: currentProject,
          providers: getProviderStatus(),
          nas: {
            configured: Boolean(nas.config),
            configFile: nas.file,
            searchScope: nasSearch.scope,
            searchRoots: nasSearch.roots,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            serviceUrl: nasSearch.serviceUrl || "",
          },
        });
      }

      if (url.pathname === "/api/quota" && req.method === "GET") {
        if (!quotaSnapshot || Date.now() - quotaSnapshot.time >= 60000) {
          if (!quotaPending) quotaPending = collectQuotaStatus(ctx)
            .then(value => { quotaSnapshot = {time: Date.now(), value}; return value; })
            .finally(() => { quotaPending = null; });
          await quotaPending;
        }
        const quotas = quotaSnapshot.value;
        return sendJson(res, 200, quotas);
      }

      if (url.pathname === "/api/project" && req.method === "GET") {
        return sendJson(res, 200, {
          projectRoot: currentProject,
          slots: listSlots(ctx),
        });
      }

      if (url.pathname === "/api/project" && req.method === "POST") {
        const body = await readBody(req);
        const next = setProject(body.projectRoot || body.path);
        return sendJson(res, 200, {
          projectRoot: next,
          slots: listSlots(ctx),
        });
      }

      if (url.pathname === "/api/slots" && req.method === "GET") {
        return sendJson(res, 200, listSlots(ctx));
      }

      if (url.pathname === "/api/translate" && req.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        const queryEn = (url.searchParams.get("queryEn") || "").trim();
        const payload = await resolveSearchQueries(q, queryEn);
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/search" && req.method === "GET") {
        const slotId = (url.searchParams.get("slotId") || "").trim();
        const searchOptions = {
          mediaType: url.searchParams.get("mediaType") || "image",
          providers: url.searchParams.get("providers") || "all",
          freeOnly: url.searchParams.get("freeOnly") === "1",
          includeDownloaded: url.searchParams.get("includeDownloaded") === "1",
          precise: url.searchParams.get("precise") === "1",
          queryEn: (url.searchParams.get("queryEn") || "").trim(),
        };
        const payload = slotId
          ? await searchStockBySlot(ctx, slotId, searchOptions)
          : await searchStock(ctx, {
              ...searchOptions,
              query: url.searchParams.get("q") || "",
            });
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/nas/meta" && req.method === "GET") {
        return sendJson(res, 200, await nasIndex.meta(currentProject, req));
      }
      if (url.pathname === "/api/nas/login" && req.method === "POST") {
        return sendJson(res, 200, await nasIndex.login(currentProject, req, res, await readBody(req)));
      }
      if (url.pathname === "/api/nas/index/thumb" && req.method === "GET") {
        return await nasIndex.media(currentProject, req, res, "thumb", url.searchParams.get("id"));
      }
      if (url.pathname === "/api/nas/search" && req.method === "GET") {
        const timeoutParam = Number(url.searchParams.get("timeout") || url.searchParams.get("timeoutMs"));
        const slotId = (url.searchParams.get("slotId") || "").trim();
        const nasOptions = {
          timeoutMs: timeoutParam > 0 ? timeoutParam : DEFAULT_TIMEOUT_MS,
          share: url.searchParams.get("share") || "",
          ext: url.searchParams.get("ext") || "",
        };
        const precise = url.searchParams.get("precise") === "1";
        if (slotId) {
          const plan = getSlotSearchPlan(ctx, slotId);
          const queries = precise ? [plan.queries[0]].filter(Boolean) : plan.queries;
          Object.assign(nasOptions, {
            queries,
            mediaType: plan.mediaType,
            matchMode: "phrase",
          });
        } else {
          Object.assign(nasOptions, {
            query: url.searchParams.get("q") || "",
            mediaType: url.searchParams.get("mediaType") || "image",
            matchMode: "any",
          });
        }
        const payload = indexSettings(currentProject)
          ? await nasIndex.search(currentProject, nasOptions, req)
          : searchNas(currentProject, nasOptions);
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/nas/preview" && req.method === "GET") {
        if (indexSettings(currentProject)) throw new Error("索引模式請使用 NAS 服務縮圖，不能直接存取 UNC 路徑。");
        const filePath = resolveNasPreviewPath(currentProject, url.searchParams.get("path") || "");
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (url.pathname === "/api/nas/copy" && req.method === "POST") {
        const body = await readBody(req);
        const payload = indexSettings(currentProject)
          ? await nasIndex.copy(ctx, body, req)
          : copyNasFile(ctx, body.path, { slotId: body.slotId });
        if (body.exportToBrowser) payload.files = delivery.register(req, res, ctx, [{path: path.resolve(ctx.root, payload.archive)}]);
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/download" && req.method === "POST") {
        const body = await readBody(req);
        const payload = await downloadStockItems(ctx, body);
        if (body.exportToBrowser) {
          const files = payload.files;
          payload.files = delivery.register(req, res, ctx, files.flatMap(file => {
            const directory = (body.mediaType === "video" ? ctx.videoArchiveDirs : ctx.archiveDirs)[file.provider];
            const image = {...file, path: path.join(directory, file.filename)};
            return file.licenseFilename ? [image, {provider: file.provider, id: file.id, companion: true, path: path.join(directory, file.licenseFilename)}] : [image];
          }));
        }
        return sendJson(res, 200, payload);
      }

      sendJson(res, 404, { error: "API route not found." });
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.status || 400, { error: err.message || String(err) });
      else res.destroy();
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    const staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    serveStatic(webRoot, staticPath, res);
  });

  return {
    server,
    setProject,
    getProjectRoot: () => currentProject,
    getContext: () => ctx,
  };
}

function startWebServer(options = {}) {
  const port = Number(options.port) || 3456;
  const host = options.host || "127.0.0.1";
  const app = createWebServer(options);

  return new Promise((resolve) => {
    app.server.listen(port, host, () => {
      resolve({
        ...app,
        url: `http://${host}:${port}`,
        port,
        host,
      });
    });
  });
}

module.exports = {
  createWebServer,
  startWebServer,
};
