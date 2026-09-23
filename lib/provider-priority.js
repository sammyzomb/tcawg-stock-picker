const DEFAULT_PROVIDER_PRIORITY = ["shutterstock", "unsplash", "pixabay", "pexels"];

const { sortShutterstockByRank } = require("./shutterstock");

function mergeByPriority(groups, priority = DEFAULT_PROVIDER_PRIORITY) {
  const merged = [];
  const seen = new Set();

  for (const provider of priority) {
    const pool =
      provider === "shutterstock"
        ? sortShutterstockByRank(groups[provider] || [])
        : groups[provider] || [];
    for (const item of pool) {
      const key = `${item.provider}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }

  return merged;
}

function pickByPriority(candidates, usedKeys, slotIndex = 0, priority = DEFAULT_PROVIDER_PRIORITY) {
  for (const provider of priority) {
    let pool = candidates.filter((row) => row.provider === provider);
    if (provider === "shutterstock") {
      pool = sortShutterstockByRank(pool);
    }
    for (const item of pool) {
      const key = `${item.provider}:${item.id}`;
      if (!usedKeys.has(key)) return { item, reused: false };
    }
  }
  if (candidates.length === 0) return null;
  return { item: candidates[slotIndex % candidates.length], reused: true };
}

module.exports = {
  DEFAULT_PROVIDER_PRIORITY,
  mergeByPriority,
  pickByPriority,
};
