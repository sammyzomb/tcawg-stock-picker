const test = require("node:test");
const assert = require("node:assert/strict");
const {fetchPexelsQuota, fetchPixabayQuota, fetchShutterstockQuota, collectQuotaStatus} = require("../lib/quota");

test("quota headers preserve zero and Pexels is not counted twice as hourly and monthly", async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => new Response(JSON.stringify({totalHits: 1}), {headers: {
    "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "60",
  }});
  const pexels = await fetchPexelsQuota("test");
  assert.equal(pexels.requestsRemaining, "0");
  assert.equal(pexels.hourlyRemaining, undefined);
  const pixabay = await fetchPixabayQuota("test");
  assert.equal(pixabay.requestsRemaining, "0");
  assert.equal(pixabay.resetSeconds, "60");
});

test("Shutterstock displays only the configured subscription without returning its ID", async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async url => new Response(JSON.stringify(url.includes("subscriptions") ? {data: [
    {id: "other", asset_type: "images", allotment: {downloads_left: 500, downloads_limit: 500}},
    {id: "selected", asset_type: "images", allotment: {downloads_left: 0, downloads_limit: 10}},
  ]} : {}));
  const result = await fetchShutterstockQuota("test", "selected");
  assert.equal(result.allotments.length, 1);
  assert.equal(result.allotments[0].downloadsLeft, 0);
  assert.equal(result.allotments[0].id, undefined);
});

test("one provider connection failure does not discard other quota results or expose credentials", async t => {
  const original = global.fetch;
  const key = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = "synthetic-test-key";
  t.after(() => { global.fetch = original; if (key === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = key; });
  global.fetch = async () => { throw new Error("private synthetic-test-key details"); };
  const result = await collectQuotaStatus({});
  assert.equal(result.pexels.ok, false);
  assert.ok(result.checkedAt);
  assert.ok(result.unsplash);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-test-key/);
});
