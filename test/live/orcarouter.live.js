// Live verification for the OrcaRouter provider. Run with a real key:
//   ORCAROUTER_API_KEY=… node test/live/orcarouter.live.js
// It exercises the same code paths the server uses (catalog discovery and the
// provider adapter), not a standalone curl.
import assert from "node:assert/strict";
import { fetchOrcaRouterCatalog } from "../../ai/orcarouter.js";
import { generateProviderJson } from "../../ai/providers.js";

const env = process.env;
if (!env.ORCAROUTER_API_KEY && !env.ORCA_API_KEY) {
  console.error("SKIP: ORCAROUTER_API_KEY is not set.");
  process.exit(2);
}

const catalog = await fetchOrcaRouterCatalog({ env, capability: "chat" });
console.log(`catalog source=${catalog.source} chat_models=${catalog.models.length} degraded=${catalog.degraded}`);
assert.equal(catalog.source, "live", `live catalog unavailable: ${catalog.error}`);
assert.ok(catalog.models.length > 0, "live catalog returned no chat models");
assert.ok(
  catalog.models.every((model) => !model.endpointTypes.includes("image-generation") && !model.endpointTypes.includes("jina-rerank")),
  "chat catalog leaked non-chat models"
);

const candidates = catalog.models.slice(0, 5);
let lastError = null;
let called = null;
for (const model of candidates) {
  try {
    const result = await generateProviderJson(
      "orcarouter",
      { prompt: 'Return exactly this JSON object: {"summary":"ok","candidates":[]}', maxTokens: 256 },
      { env, model: model.id, timeoutMs: 90_000 }
    );
    assert.equal(result.provider, "orcarouter");
    assert.equal(typeof result.parsed, "object");
    called = { model: result.model, usage: result.usage };
    break;
  } catch (error) {
    lastError = error;
    console.log(`retry: ${model.id} rejected (${error.status || "error"}: ${String(error.message).slice(0, 100)})`);
  }
}
if (!called) throw lastError;
console.log(`inference provider=orcarouter model=${called.model} usage=${JSON.stringify(called.usage)}`);
console.log("LIVE CHECKS PASSED");
