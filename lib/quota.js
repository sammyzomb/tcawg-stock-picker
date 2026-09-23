function formatResetTime(unixSeconds) {
  if (!unixSeconds) return "";
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n * 1000).toLocaleString("zh-TW", { hour12: false });
  } catch {
    return "";
  }
}

function formatPeriodEnd(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false });
  } catch {
    return iso;
  }
}

async function fetchPexelsQuota(apiKey) {
  if (!apiKey) {
    return { ok: false, configured: false, message: "MISSING" };
  }

  const res = await fetch("https://api.pexels.com/v1/search?query=quota-check&per_page=1", {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      configured: true,
      status: res.status,
      message: body.slice(0, 120),
    };
  }

  const hourlyLimit = res.headers.get("x-ratelimit-limit");
  const hourlyRemaining = res.headers.get("x-ratelimit-remaining");
  const monthlyLimit = res.headers.get("X-Ratelimit-Limit");
  const monthlyRemaining = res.headers.get("X-Ratelimit-Remaining");
  const monthlyReset = res.headers.get("X-Ratelimit-Reset");

  return {
    ok: true,
    configured: true,
    status: res.status,
    hourlyLimit: hourlyLimit || monthlyLimit,
    hourlyRemaining: hourlyRemaining || monthlyRemaining,
    monthlyLimit,
    monthlyRemaining,
    monthlyReset: formatResetTime(monthlyReset),
  };
}

async function fetchUnsplashQuota(accessKey) {
  if (!accessKey) {
    return { ok: false, configured: false, message: "MISSING" };
  }

  const res = await fetch("https://api.unsplash.com/search/photos?query=quota-check&per_page=1", {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      configured: true,
      status: res.status,
      message: body.slice(0, 120),
    };
  }

  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const tier = limit && Number(limit) > 50 ? "Production" : "Demo";

  return {
    ok: true,
    configured: true,
    status: res.status,
    hourlyLimit: limit,
    hourlyRemaining: remaining,
    tier,
  };
}

async function fetchShutterstockQuota(token) {
  if (!token) {
    return { ok: false, configured: false, message: "MISSING" };
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const searchRes = await fetch(
    "https://api.shutterstock.com/v2/images/search?query=quota-check&per_page=1",
    { headers }
  );

  const searchOk = searchRes.ok;
  const searchStatus = searchRes.status;

  const subRes = await fetch("https://api.shutterstock.com/v2/user/subscriptions", { headers });
  const allotments = [];

  if (subRes.ok) {
    const data = await subRes.json();
    for (const sub of data.data || []) {
      const allotment = sub.allotment || {};
      if (allotment.downloads_limit == null && allotment.downloads_left == null) continue;
      allotments.push({
        license: sub.license || "",
        assetType: sub.asset_type || "",
        description: sub.description || "",
        downloadsLeft: allotment.downloads_left,
        downloadsLimit: allotment.downloads_limit,
        periodEnd: formatPeriodEnd(allotment.end_time || sub.expiration_time),
        expiration: formatPeriodEnd(sub.expiration_time),
      });
    }
  }

  const priority = { images: 0, videos: 1, audio: 2 };
  allotments.sort((a, b) => {
    const pa = priority[a.assetType] ?? 9;
    const pb = priority[b.assetType] ?? 9;
    return pa - pb;
  });

  return {
    ok: searchOk && subRes.ok,
    configured: true,
    searchStatus,
    subscriptionsStatus: subRes.status,
    searchNote: "搜圖 API 免費，不扣下載張數",
    allotments,
  };
}

async function collectQuotaStatus(ctx) {
  const pexelsKey = process.env.PEXELS_API_KEY || "";
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY || "";
  const sstkToken = process.env.SHUTTERSTOCK_API_TOKEN || "";

  const [pexels, unsplash, shutterstock] = await Promise.all([
    fetchPexelsQuota(pexelsKey),
    fetchUnsplashQuota(unsplashKey),
    fetchShutterstockQuota(sstkToken),
  ]);

  return { pexels, unsplash, shutterstock };
}

function printQuotaStatus(ctx, quotas) {
  console.log("\n圖庫 API 剩餘額度\n");
  console.log(`  .env : ${ctx.envFile && require("fs").existsSync(ctx.envFile) ? ".env" : "missing"}`);
  console.log("");

  const { pexels, unsplash, shutterstock } = quotas;

  console.log("── Pexels（免費）──");
  if (!pexels.configured) {
    console.log("  狀態   : 未設定 PEXELS_API_KEY");
  } else if (!pexels.ok) {
    console.log(`  狀態   : 錯誤 HTTP ${pexels.status}`);
    console.log(`  訊息   : ${pexels.message}`);
  } else {
    if (pexels.hourlyLimit) {
      console.log(`  搜尋   : ${pexels.hourlyRemaining} / ${pexels.hourlyLimit} 次（時）`);
    }
    if (pexels.monthlyLimit && pexels.monthlyLimit !== pexels.hourlyLimit) {
      console.log(`  搜尋   : ${pexels.monthlyRemaining} / ${pexels.monthlyLimit} 次（月）`);
    }
    if (pexels.monthlyReset) {
      console.log(`  月重置 : ${pexels.monthlyReset}`);
    }
    console.log("  下載   : 免費（不另計張數）");
  }
  console.log("");

  console.log("── Unsplash（免費）──");
  if (!unsplash.configured) {
    console.log("  狀態   : 未設定 UNSPLASH_ACCESS_KEY");
  } else if (!unsplash.ok) {
    console.log(`  狀態   : 錯誤 HTTP ${unsplash.status}`);
    console.log(`  訊息   : ${unsplash.message}`);
  } else {
    console.log(`  模式   : ${unsplash.tier}（Demo=50/時，Production=1000/時）`);
    console.log(`  搜尋   : ${unsplash.hourlyRemaining} / ${unsplash.hourlyLimit} 次（時）`);
    console.log("  下載   : 免費（僅 api.unsplash.com 計入限額）");
  }
  console.log("");

  console.log("── Shutterstock（訂閱）──");
  if (!shutterstock.configured) {
    console.log("  狀態   : 未設定 SHUTTERSTOCK_API_TOKEN");
  } else {
    console.log(`  搜圖   : HTTP ${shutterstock.searchStatus}（${shutterstock.searchNote}）`);
    if (shutterstock.subscriptionsStatus !== 200) {
      console.log(`  訂閱   : 無法讀取 HTTP ${shutterstock.subscriptionsStatus}`);
    } else if (shutterstock.allotments.length === 0) {
      console.log("  下載   : 無可讀取的 allotment 資料");
    } else {
      console.log("  授權下載（會扣張數）：");
      for (const row of shutterstock.allotments) {
        const label = [row.assetType, row.license].filter(Boolean).join(" / ");
        const left = row.downloadsLeft ?? "?";
        const limit = row.downloadsLimit ?? "?";
        console.log(`    ${label.padEnd(28)} ${left} / ${limit}  本期至 ${row.periodEnd || row.expiration || "?"}`);
      }
    }
  }
  console.log("");
}

async function runQuota(_argv, ctx) {
  const quotas = await collectQuotaStatus(ctx);
  printQuotaStatus(ctx, quotas);

  const anyError =
    (quotas.pexels.configured && !quotas.pexels.ok) ||
    (quotas.unsplash.configured && !quotas.unsplash.ok) ||
    (quotas.shutterstock.configured && !quotas.shutterstock.ok);

  return anyError ? 1 : 0;
}

module.exports = {
  collectQuotaStatus,
  printQuotaStatus,
  runQuota,
  fetchPexelsQuota,
  fetchUnsplashQuota,
  fetchShutterstockQuota,
};
