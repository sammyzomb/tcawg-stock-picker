const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createContext } = require("../lib/context");
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
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function createWebServer(options = {}) {
  const packageRoot = options.packageRoot || path.resolve(__dirname, "..");
  const webRoot = path.join(packageRoot, "web");
  const defaultProject = options.defaultProject || path.join(packageRoot, "preview-web");
  let currentProject = options.projectRoot || defaultProject;
  let ctx = createContext(currentProject);

  function setProject(projectRoot) {
    const resolved = path.resolve(projectRoot);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Project path not found: ${resolved}`);
    }
    currentProject = resolved;
    ctx = createContext(currentProject);
    return currentProject;
  }

  async function handleApi(req, res, url) {
    try {
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
          },
        });
      }

      if (url.pathname === "/api/quota" && req.method === "GET") {
        const quotas = await collectQuotaStatus(ctx);
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

      if (url.pathname === "/api/nas/search" && req.method === "GET") {
        const timeoutParam = Number(url.searchParams.get("timeout") || url.searchParams.get("timeoutMs"));
        const slotId = (url.searchParams.get("slotId") || "").trim();
        const nasOptions = {
          timeoutMs: timeoutParam > 0 ? timeoutParam : DEFAULT_TIMEOUT_MS,
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
        const payload = searchNas(currentProject, nasOptions);
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/nas/preview" && req.method === "GET") {
        const filePath = resolveNasPreviewPath(currentProject, url.searchParams.get("path") || "");
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (url.pathname === "/api/nas/copy" && req.method === "POST") {
        const body = await readBody(req);
        const payload = copyNasFile(ctx, body.path, { slotId: body.slotId });
        return sendJson(res, 200, payload);
      }

      if (url.pathname === "/api/download" && req.method === "POST") {
        const body = await readBody(req);
        const payload = await downloadStockItems(ctx, body);
        return sendJson(res, 200, payload);
      }

      sendJson(res, 404, { error: "API route not found." });
    } catch (err) {
      sendJson(res, 400, { error: err.message || String(err) });
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
