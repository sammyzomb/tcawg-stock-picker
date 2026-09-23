#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { runCli } = require("../lib/cli");
const { hasSearchCredentials, searchShutterstock } = require("../lib/shutterstock");

runCli(async (argv, ctx) => {
  const query = argv.find((a) => !a.startsWith("--"));
  const perPage = Number((argv.find((a) => a.startsWith("--n=")) || "--n=12").slice(4));
  const orient = (argv.find((a) => a.startsWith("--orient=")) || "--orient=horizontal").slice(9);

  if (!query) {
    console.error('用法：stock-sstk-search "Abu Simbel temple" [--orient=horizontal|vertical] [--n=12]');
    return 1;
  }

  if (!hasSearchCredentials()) {
    console.error("Shutterstock credentials missing. Configure .env in project root.");
    return 1;
  }

  console.log(`搜尋 Shutterstock：「${query}」…`);
  const rows = await searchShutterstock(query, { perPage, orientation: orient });
  if (!rows.length) {
    console.log("沒有結果。");
    return 0;
  }

  const slug = query.replace(/[^\w\u4e00-\u9fff]+/g, "_").slice(0, 40);
  const dir = path.join(ctx.archiveDirs.shutterstock, "search-cache", slug);
  fs.mkdirSync(dir, { recursive: true });

  const summary = rows.map((row, index) => ({
    i: index + 1,
    id: row.id,
    desc: row.description || "",
    preview: row.previewUrl,
    page: row.photoPageUrl,
  }));

  fs.writeFileSync(path.join(dir, "results.json"), `${JSON.stringify({ query, orient, summary }, null, 2)}\n`);

  console.log(`\n共 ${summary.length} 筆 → ${path.relative(ctx.root, dir)}`);
  summary.forEach((s) => console.log(`  [${s.i}] id=${s.id}  ${s.desc}`));
  console.log("\n下載（會扣訂閱額度）：");
  console.log(`  stock-sstk-license --project "${ctx.root}" --ids=${summary.slice(0, 3).map((s) => s.id).join(",")}`);
  return 0;
});
