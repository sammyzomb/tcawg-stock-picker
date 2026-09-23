#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { runCli } = require("../lib/cli");
const { hasLicenseCredentials, licenseShutterstockImages } = require("../lib/shutterstock");

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

runCli(async (argv, ctx) => {
  const idsArg = (argv.find((a) => a.startsWith("--ids=")) || "").slice(6);
  const size = (argv.find((a) => a.startsWith("--size=")) || "--size=huge").slice(7);
  const ids = idsArg.split(",").map((s) => s.trim()).filter(Boolean);

  if (!ids.length) {
    console.error("用法：stock-sstk-license --ids=123,456 [--size=huge]");
    return 1;
  }

  if (!hasLicenseCredentials()) {
    console.error("需要 SHUTTERSTOCK_API_TOKEN 與 SHUTTERSTOCK_SUBSCRIPTION_ID（.env）。");
    return 1;
  }

  console.log(`即將授權 ${ids.length} 張（size=${size}），會扣訂閱額度。`);
  console.log(`IDs：${ids.join(", ")}`);

  const licensed = await licenseShutterstockImages(ids, { size });
  const outDir = ctx.archiveDirs.shutterstock;
  fs.mkdirSync(outDir, { recursive: true });

  const creditsFile = path.join(outDir, "credits.json");
  let credits = [];
  if (fs.existsSync(creditsFile)) {
    try {
      credits = JSON.parse(fs.readFileSync(creditsFile, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      credits = [];
    }
  }

  for (const row of licensed) {
    if (!row.downloadUrl) {
      console.log(`  id=${row.imageId} 無下載網址`);
      continue;
    }
    const filename = `shutterstock-${row.imageId}.jpg`;
    const dest = path.join(outDir, filename);
    console.log(`下載 ${filename} …`);
    const bytes = await download(row.downloadUrl, dest);
    console.log(`  → ${path.relative(ctx.root, dest)} (${Math.round(bytes / 1024)} KB)`);

    const entry = {
      id: row.imageId,
      provider: "shutterstock",
      filename,
      searchKeyword: "",
      photographer: "Shutterstock",
      photographerUrl: "",
      pexelsPhotoUrl: "",
      unsplashPhotoUrl: "",
      shutterstockPhotoUrl: `https://www.shutterstock.com/image-photo/${row.imageId}`,
      photoPageUrl: `https://www.shutterstock.com/image-photo/${row.imageId}`,
      licenseSize: size,
      allotmentCharge: row.allotmentCharge,
      licensedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
    };
    credits = credits.filter((c) => String(c.id) !== String(row.imageId));
    credits.push(entry);
  }

  fs.writeFileSync(creditsFile, `${JSON.stringify(credits, null, 2)}\n`);
  console.log("\n完成。Credits 已更新。");
  return 0;
});
