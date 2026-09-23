#!/usr/bin/env node
const path = require("path");
const { startWebServer } = require("../server/web-server");

function parseArgs(argv) {
  const options = {
    port: 3456,
    host: "127.0.0.1",
    projectRoot: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      options.port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--host" && argv[i + 1]) {
      options.host = argv[i + 1];
      i += 1;
    } else if ((arg === "--project" || arg === "-p") && argv[i + 1]) {
      options.projectRoot = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
stock-web — 本機網頁版圖庫搜尋器

Usage:
  node bin/stock-web.js [--port 3456] [--host 127.0.0.1] [--project <專案根目錄>]

Examples:
  npm run web
  node bin/stock-web.js --project "D:/GITHUB_2/UIO16A 加拉巴哥群島 厄瓜多 哥倫比亞雙城 咖啡風情 16日"
`);
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const packageRoot = path.resolve(__dirname, "..");
  const app = await startWebServer({
    packageRoot,
    port: cli.port,
    host: cli.host,
    projectRoot: cli.projectRoot || undefined,
    defaultProject: path.join(packageRoot, "preview-web"),
  });

  console.log("\n  tcawg-stock-picker Web UI");
  console.log(`  URL     : ${app.url}`);
  console.log(`  Project : ${app.getProjectRoot()}`);
  console.log("\n  在瀏覽器開啟上述 URL。按 Ctrl+C 結束。\n");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
