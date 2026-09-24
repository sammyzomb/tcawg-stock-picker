const PHRASE_MAP = {
  // 官網搜「祕魯太陽祭」會改顯示 peru sun festival，但 SS API 對該詞常為 0；
  // 實測 API 可用：Sacsayhuaman Cusco、Cusco ceremony、Cusco traditional
  祕魯太陽祭: "Sacsayhuaman Cusco",
  秘鲁太阳祭: "Sacsayhuaman Cusco",
  秘魯太陽祭: "Sacsayhuaman Cusco",
  印加太陽祭: "Sacsayhuaman Cusco",
  太陽祭: "Cusco ceremony",
  加拉巴哥: "Galapagos",
  加拉帕戈斯: "Galapagos",
  庫斯科: "Cusco",
  馬丘比丘: "Machu Picchu",
  馬丘畢丘: "Machu Picchu",
  祕魯: "Peru",
  秘鲁: "Peru",
  秘魯: "Peru",
  厄瓜多: "Ecuador",
  哥倫比亞: "Colombia",
  印加: "Inca",
  北歐: "Norway Scandinavia",
  挪威: "Norway",
  冰島: "Iceland",
};

const TOPIC_VARIANTS = [
  {
    test: (text) => /太陽祭/.test(text) && /祕魯|秘鲁|秘魯|庫斯科|库斯科/.test(text),
    variants: [
      "Sacsayhuaman Cusco",
      "Cusco ceremony",
      "Cusco traditional costume",
      "Inca Cusco",
      "Inti Raymi Cusco",
    ],
  },
  {
    test: (text) => /太陽祭/.test(text),
    variants: ["Cusco ceremony", "Sacsayhuaman Cusco", "Inti Raymi Cusco"],
  },
  {
    test: (text) => /馬丘比丘|马丘比丘|馬丘畢丘/.test(text),
    variants: ["Machu Picchu Peru", "Machu Picchu Andes mountains"],
  },
  {
    test: (text) => /加拉巴哥|加拉帕戈斯/.test(text),
    variants: ["Galapagos islands wildlife", "Galapagos marine iguana"],
  },
];

const ENGLISH_PROVIDERS = new Set(["shutterstock", "unsplash", "pexels"]);

const SHUTTERSTOCK_TOPIC_VARIANTS = [
  {
    test: (text) => /太陽祭/.test(text) && /祕魯|秘鲁|秘魯|庫斯科|库斯科/.test(text),
    variants: [
      { query: "Sacsayhuaman Cusco", language: "en" },
      { query: "Cusco ceremony", language: "en" },
      { query: "Cusco traditional costume", language: "en" },
      { query: "Inca Cusco", language: "en" },
    ],
  },
  {
    test: (text) => /太陽祭/.test(text),
    variants: [
      { query: "Cusco ceremony", language: "en" },
      { query: "Sacsayhuaman Cusco", language: "en" },
    ],
  },
];

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function normalizeCompact(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

function lookupPhrase(text) {
  const trimmed = String(text || "").trim();
  if (PHRASE_MAP[trimmed]) return PHRASE_MAP[trimmed];
  const compact = normalizeCompact(trimmed);
  for (const [phrase, english] of Object.entries(PHRASE_MAP)) {
    if (normalizeCompact(phrase) === compact) return english;
  }
  return "";
}

function mapPartsToEnglish(text) {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const mapped = parts.map((part) => lookupPhrase(part)).filter(Boolean);
  if (mapped.length === 0) return "";
  return mapped.join(" ");
}

async function fetchMachineTranslation(text) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "zh-TW|en");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Translation HTTP ${res.status}`);
  }
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || translated === text) {
    throw new Error("Translation empty");
  }
  return translated.replace(/\s+/g, " ").trim();
}

async function translateToEnglish(text) {
  const original = String(text || "").trim();
  if (!original) return "";
  if (!hasChinese(original)) return original;

  const phrase = lookupPhrase(original);
  if (phrase) return phrase;

  const fromParts = mapPartsToEnglish(original);
  if (fromParts) return fromParts;

  try {
    return await fetchMachineTranslation(original);
  } catch {
    return fromParts || original;
  }
}

function expandEnglishVariants(original, primaryEnglish) {
  const variants = new Set();
  const primary = String(primaryEnglish || "").trim();
  const source = String(original || "").trim();

  if (primary) variants.add(primary);

  for (const topic of TOPIC_VARIANTS) {
    if (topic.test(source) || (primary && topic.test(primary))) {
      for (const row of topic.variants) variants.add(row);
    }
  }

  const fromParts = mapPartsToEnglish(source);
  if (fromParts) variants.add(fromParts);

  return [...variants].filter(Boolean);
}

function englishSearchTerms(queries) {
  const terms = new Set();
  for (const text of [queries.english, ...(queries.englishVariants || [])]) {
    for (const word of String(text || "").split(/\s+/)) {
      const cleaned = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
      if (cleaned.length >= 4) terms.add(cleaned);
    }
  }
  return [...terms];
}

function relevanceScore(item, terms) {
  if (!terms.length) return 0;
  const text = `${item.description || ""} ${item.photographer || ""} ${item.filename || ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 2;
  }
  if (
    item.provider === "shutterstock" &&
    /inti|raymi|cusco|sacsayhuaman|inca|ceremony|festival|traditional/i.test(text)
  ) {
    score += 1;
  }
  return score;
}

function shutterstockSearchVariants(original, queries) {
  const source = String(original || "").trim();
  const variants = [];
  const seen = new Set();

  function add(query, language = "en") {
    const q = String(query || "").trim();
    if (!q) return;
    const key = `${language}:${q}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ query: q, language });
  }

  if (hasChinese(source)) {
    add(source, "zh-Hant");
    const compact = normalizeCompact(source);
    if (compact !== source) {
      add(compact, "zh-Hant");
    }
  }

  if (queries.englishOverride) {
    add(queries.englishOverride, "en");
  }
  add(queries.english, "en");

  for (const topic of SHUTTERSTOCK_TOPIC_VARIANTS) {
    if (topic.test(source) || (queries.english && topic.test(queries.english))) {
      for (const row of topic.variants) {
        add(row.query, row.language);
      }
    }
  }

  for (const row of queries.englishVariants || []) {
    add(row, "en");
  }

  return variants;
}

async function resolveSearchQueries(query, englishOverride = "") {
  const original = String(query || "").trim();
  const override = String(englishOverride || "").trim();
  const autoEnglish = override || (hasChinese(original) ? await translateToEnglish(original) : original);
  const english = autoEnglish || original;
  const englishVariants = expandEnglishVariants(original, english);
  const translated = hasChinese(original) && english !== original;

  return {
    original,
    english,
    englishVariants,
    englishOverride: override,
    translated: Boolean(override || translated),
  };
}

function queryForProvider(provider, queries) {
  if (ENGLISH_PROVIDERS.has(provider)) {
    return queries.english;
  }
  return queries.original;
}

module.exports = {
  PHRASE_MAP,
  hasChinese,
  translateToEnglish,
  expandEnglishVariants,
  resolveSearchQueries,
  queryForProvider,
  englishSearchTerms,
  relevanceScore,
  shutterstockSearchVariants,
  ENGLISH_PROVIDERS,
};
