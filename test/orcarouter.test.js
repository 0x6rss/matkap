import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ORCAROUTER_VERIFIED_SEED,
  assertCompatibleModel,
  clearOrcaRouterApiKey,
  filterCatalogForEntry,
  findCatalogModel,
  normalizeCatalogEntry,
  normalizeOrcaRouterApiKey,
  orcaRouterCredentialStatus,
  orderCatalogModels,
  publicCatalogPayload,
  resolveOrcaRouterApiBase,
  resolveSelectedModel,
  saveOrcaRouterApiKey,
  fetchOrcaRouterCatalog,
} from "../ai/orcarouter.js";
import { AI_PROVIDER_IDS, generateProviderJson, getProviderConfig, listProviderStatus } from "../ai/providers.js";

const FAKE_KEY = "test-orcarouter-key-not-real";
const API_BASE = "https://api.orcarouter.ai/v1";

// Fixtures mirror the shape of OrcaRouter's GET /v1/models payload.
const CATALOG_FIXTURE = {
  data: [
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      context_length: 400000,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_endpoint_types: ["openai", "openai-response"],
      reasoning_efforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "anthropic/claude-opus-4.8",
      name: "Claude Opus 4.8",
      context_length: 200000,
      architecture: { input_modalities: ["text", "image"] },
      supported_endpoint_types: ["anthropic"],
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      architecture: { input_modalities: ["text"] },
      supported_endpoint_types: ["openai"],
    },
    {
      id: "orcarouter/auto",
      name: "OrcaRouter Auto",
      architecture: { input_modalities: ["text"] },
      supported_endpoint_types: ["openai"],
    },
    {
      id: "openai/text-embedding-4",
      name: "Text Embedding 4",
      architecture: { input_modalities: ["text"] },
      supported_endpoint_types: ["embeddings"],
    },
    {
      id: "openai/gpt-image-3",
      name: "GPT Image 3",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      supported_endpoint_types: ["image-generation"],
    },
    {
      id: "openai/sora-3",
      name: "Sora 3",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["video"] },
      supported_endpoint_types: ["openai-video"],
    },
    {
      id: "jina/reranker-3",
      name: "Jina Reranker 3",
      architecture: { input_modalities: ["text"] },
      supported_endpoint_types: ["jina-rerank"],
    },
    {
      id: "google/gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      architecture: { input_modalities: ["text", "image", "audio", "video"] },
      supported_endpoint_types: ["gemini"],
    },
    { id: "", name: "broken" },
    { id: "bad id with spaces", name: "broken" },
  ],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function catalogFetch(calls = []) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(CATALOG_FIXTURE);
  };
}

test("orcarouter is a named first-class provider with its own configuration", () => {
  assert.ok(AI_PROVIDER_IDS.includes("orcarouter"));
  const config = getProviderConfig("orcarouter", { ORCAROUTER_API_KEY: FAKE_KEY });
  assert.equal(config.label, "OrcaRouter");
  assert.equal(config.baseUrl, API_BASE);
  assert.equal(config.model, "orcarouter/auto");
  assert.equal(config.transport, "chat_completions");

  const status = listProviderStatus({ ORCAROUTER_API_KEY: FAKE_KEY });
  const entry = status.find((item) => item.id === "orcarouter");
  assert.equal(entry.configured, true);
  assert.ok(!JSON.stringify(status).includes(FAKE_KEY));
});

test("orcarouter accepts the repo's env aliases and honours explicit base overrides", () => {
  assert.equal(getProviderConfig("orcarouter", { ORCA_API_KEY: FAKE_KEY }).apiKey, FAKE_KEY);
  assert.equal(getProviderConfig("orcarouter", { ORCA_BASE_URL: "https://gateway.internal/v1" }).baseUrl, "https://gateway.internal/v1");
  assert.equal(
    getProviderConfig("orcarouter", {
      ORCA_BASE_URL: "https://shared.internal/v1",
      ORCAROUTER_API_BASE_URL: "https://api.internal/v1",
    }).baseUrl,
    "https://api.internal/v1"
  );
});

test("base URL policy keeps auth-free HTTP off remote origins", () => {
  assert.equal(resolveOrcaRouterApiBase({}), API_BASE);
  assert.equal(resolveOrcaRouterApiBase({ ORCAROUTER_BASE_URL: "https://self.hosted/v1/" }), "https://self.hosted/v1");
  assert.equal(resolveOrcaRouterApiBase({ ORCA_BASE_URL: "http://127.0.0.1:8080/v1" }), "http://127.0.0.1:8080/v1");
  assert.throws(() => resolveOrcaRouterApiBase({ ORCAROUTER_BASE_URL: "http://remote.example/v1" }), /HTTPS/);
  assert.throws(() => resolveOrcaRouterApiBase({ ORCAROUTER_BASE_URL: "not a url" }), /valid URL/);
});

test("API-key adapter validates, saves, masks, and clears through the project secret store", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "matkap-orca-"));
  const envPath = path.join(dir, ".env");
  const env = {};
  try {
    assert.throws(() => normalizeOrcaRouterApiKey(""), /Enter an OrcaRouter API key/);
    assert.throws(() => normalizeOrcaRouterApiKey("has space"), /whitespace/);
    assert.throws(() => normalizeOrcaRouterApiKey("short"), /does not look like/);

    const saved = await saveOrcaRouterApiKey(FAKE_KEY, { env, envPath });
    assert.equal(saved.configured, true);
    assert.equal(saved.source, "api_key");
    assert.equal(saved.masked, "…");
    assert.ok(!saved.masked.includes("orcarouter"));
    assert.equal(env.ORCAROUTER_API_KEY, FAKE_KEY);
    assert.match(await readFile(envPath, "utf8"), /^ORCAROUTER_API_KEY=test-orcarouter-key-not-real$/m);

    const cleared = await clearOrcaRouterApiKey({ env, envPath });
    assert.equal(cleared.configured, false);
    assert.equal(cleared.source, "none");
    assert.equal(cleared.masked, "");
    assert.equal(env.ORCAROUTER_API_KEY, undefined);
    assert.doesNotMatch(await readFile(envPath, "utf8"), /ORCAROUTER_API_KEY/);
  } finally {
    delete process.env.ORCAROUTER_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("credential status never exposes the key material", () => {
  const status = orcaRouterCredentialStatus({ ORCAROUTER_API_KEY: FAKE_KEY });
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes(FAKE_KEY));
  assert.equal(orcaRouterCredentialStatus({}).configured, false);
});

test("catalog parsing keeps vendor/model namespaces and drops malformed entries", () => {
  const entries = CATALOG_FIXTURE.data.map(normalizeCatalogEntry).filter(Boolean);
  assert.deepEqual(entries.map((item) => item.id).slice(0, 3), [
    "openai/gpt-5.5",
    "anthropic/claude-opus-4.8",
    "deepseek/deepseek-v4-pro",
  ]);
  const gpt = findCatalogModel(entries, "openai/gpt-5.5");
  assert.deepEqual(gpt.reasoningEfforts, ["low", "medium", "high", "xhigh"]);
  assert.deepEqual(gpt.inputModalities, ["text", "image"]);
  assert.equal(entries.some((item) => item.id === ""), false);
});

test("chat capability keeps text models and excludes image/video/rerank/embedding routes", () => {
  const entries = CATALOG_FIXTURE.data.map(normalizeCatalogEntry).filter(Boolean);
  const chat = filterCatalogForEntry(entries, { capability: "chat" }).map((item) => item.id);
  assert.deepEqual(chat, [
    "openai/gpt-5.5",
    "anthropic/claude-opus-4.8",
    "deepseek/deepseek-v4-pro",
    "orcarouter/auto",
    "google/gemini-3.5-flash",
  ]);
  assert.deepEqual(filterCatalogForEntry(entries, { capability: "embedding" }).map((item) => item.id), ["openai/text-embedding-4"]);
  assert.deepEqual(filterCatalogForEntry(entries, { capability: "image" }).map((item) => item.id), ["openai/gpt-image-3"]);
  assert.deepEqual(filterCatalogForEntry(entries, { capability: "video" }).map((item) => item.id), ["openai/sora-3"]);
  assert.deepEqual(filterCatalogForEntry(entries, { capability: "rerank" }).map((item) => item.id), ["jina/reranker-3"]);
});

test("multimodal filtering fails closed when a model does not declare the modality", () => {
  const entries = CATALOG_FIXTURE.data.map(normalizeCatalogEntry).filter(Boolean);
  const imageChat = filterCatalogForEntry(entries, { capability: "chat", modalities: ["image"] }).map((item) => item.id);
  assert.deepEqual(imageChat, ["openai/gpt-5.5", "anthropic/claude-opus-4.8", "google/gemini-3.5-flash"]);
  const audioChat = filterCatalogForEntry(entries, { capability: "chat", modalities: ["audio"] });
  assert.deepEqual(audioChat.map((item) => item.id), ["google/gemini-3.5-flash"]);
  // An entry point that uploads video must not receive a text-only model.
  const videoChat = filterCatalogForEntry(entries, { capability: "chat", modalities: ["video"] });
  assert.deepEqual(videoChat.map((item) => item.id), ["google/gemini-3.5-flash"]);
});

test("live discovery calls the official catalog endpoint with Bearer auth and filters it", async () => {
  const calls = [];
  const catalog = await fetchOrcaRouterCatalog({
    env: { ORCAROUTER_API_KEY: FAKE_KEY },
    fetchImpl: catalogFetch(calls),
    capability: "chat",
  });
  assert.equal(catalog.source, "live");
  assert.equal(catalog.degraded, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE}/models?capability=chat`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(catalog.models.every((model) => !model.endpointTypes.includes("image-generation")));
  assert.equal(catalog.models.length, 5);
  // Deterministic alphabetical ordering keeps the dropdown stable.
  assert.deepEqual(catalog.models.map((model) => model.id), [
    "anthropic/claude-opus-4.8",
    "deepseek/deepseek-v4-pro",
    "google/gemini-3.5-flash",
    "openai/gpt-5.5",
    "orcarouter/auto",
  ]);
  const publicPayload = publicCatalogPayload(catalog);
  assert.ok(!JSON.stringify(publicPayload).includes(FAKE_KEY));
  assert.deepEqual(Object.keys(publicPayload.models[0]).sort(), [
    "contextLength",
    "endpointTypes",
    "id",
    "inputModalities",
    "name",
    "reasoningEfforts",
  ]);
});

test("catalog ordering is stable across refreshes and ignores gateway order", () => {
  const entries = CATALOG_FIXTURE.data.map(normalizeCatalogEntry).filter(Boolean);
  const forward = orderCatalogModels(entries).map((model) => model.id);
  const reverse = orderCatalogModels([...entries].reverse()).map((model) => model.id);
  assert.deepEqual(forward, reverse);
  assert.equal(forward[0], "anthropic/claude-opus-4.8");
});

test("discovery without a key serves the verified seed and never a free-text model field", async () => {
  const catalog = await fetchOrcaRouterCatalog({ env: {}, fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.equal(catalog.source, "seed");
  assert.equal(catalog.degraded, true);
  assert.match(catalog.error, /API key/);
  assert.deepEqual(catalog.models.map((item) => item.id), ORCAROUTER_VERIFIED_SEED.map((item) => item.id));
  const gpt = findCatalogModel(catalog.models, "openai/gpt-5.5");
  assert.deepEqual(gpt.reasoningEfforts, ["low", "medium", "high", "xhigh"]);
});

test("a failed live catalog is reported as degraded with the seed metadata intact", async () => {
  const catalog = await fetchOrcaRouterCatalog({
    env: { ORCAROUTER_API_KEY: FAKE_KEY },
    fetchImpl: async () => { throw new Error("socket hang up"); },
  });
  assert.equal(catalog.source, "seed");
  assert.equal(catalog.degraded, true);
  assert.match(catalog.error, /socket hang up/);
  assert.deepEqual(catalog.models.map((item) => item.id), ORCAROUTER_VERIFIED_SEED.map((item) => item.id));
});

test("a rejected key produces an actionable catalog error without echoing the key", async () => {
  const catalog = await fetchOrcaRouterCatalog({
    env: { ORCAROUTER_API_KEY: FAKE_KEY },
    fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401),
  });
  assert.equal(catalog.degraded, true);
  assert.match(catalog.error, /Update or clear/);
  assert.ok(!catalog.error.includes(FAKE_KEY));
});

test("model selection is revalidated and a stale selection is cleared", () => {
  const entries = CATALOG_FIXTURE.data.map(normalizeCatalogEntry).filter(Boolean);
  assert.equal(findCatalogModel(entries, "openai/gpt-5.5").id, "openai/gpt-5.5");
  assert.throws(
    () => assertCompatibleModel(entries, "openai/gpt-image-3", { capability: "chat" }),
    /not available for this request/
  );
  assert.equal(assertCompatibleModel(entries, "openai/gpt-5.5", { capability: "chat" }).id, "openai/gpt-5.5");

  const kept = resolveSelectedModel("openai/gpt-5.5", entries, { capability: "chat" });
  assert.deepEqual(kept, { model: "openai/gpt-5.5", cleared: false, reason: "" });
  const cleared = resolveSelectedModel("openai/gpt-image-3", entries, { capability: "chat" });
  assert.equal(cleared.model, "");
  assert.equal(cleared.cleared, true);
  assert.match(cleared.reason, /not available/);
});

test("the provider adapter routes inference to the OrcaRouter relay with the selected model", async () => {
  const calls = [];
  const result = await generateProviderJson(
    "orcarouter",
    { prompt: "return json", maxTokens: 512 },
    {
      env: { ORCAROUTER_API_KEY: FAKE_KEY },
      model: "anthropic/claude-opus-4.8",
      timeoutMs: 5_000,
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ summary: "ok", candidates: [] }) } }],
          usage: { total_tokens: 7 },
        });
      },
    }
  );
  assert.equal(calls[0].url, `${API_BASE}/chat/completions`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "anthropic/claude-opus-4.8");
  assert.deepEqual(result.parsed, { summary: "ok", candidates: [] });
  assert.equal(result.model, "anthropic/claude-opus-4.8");
  assert.equal(result.provider, "orcarouter");
});

test("a 401 from the relay becomes a terminal, actionable error without the key", async () => {
  await assert.rejects(
    generateProviderJson("orcarouter", { prompt: "hi" }, {
      env: { ORCAROUTER_API_KEY: FAKE_KEY },
      timeoutMs: 5_000,
      fetchImpl: async () => jsonResponse({ error: { message: "invalid api key" } }, 401),
    }),
    (error) => {
      assert.match(error.message, /Update or clear/);
      assert.ok(!error.message.includes(FAKE_KEY));
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test("a 403 from the relay points at model access instead of blaming the key", async () => {
  await assert.rejects(
    generateProviderJson("orcarouter", { prompt: "hi" }, {
      env: { ORCAROUTER_API_KEY: FAKE_KEY },
      model: "orcarouter/auto",
      timeoutMs: 5_000,
      fetchImpl: async () => jsonResponse({ error: { message: "forbidden" } }, 403),
    }),
    (error) => {
      assert.match(error.message, /may not have access to the selected model/);
      assert.ok(!error.message.includes(FAKE_KEY));
      assert.equal(error.status, 403);
      return true;
    }
  );
});

test("an unconfigured OrcaRouter provider reports how to configure it", async () => {
  await assert.rejects(
    generateProviderJson("orcarouter", { prompt: "hi" }, { env: {}, fetchImpl: async () => jsonResponse({}) }),
    /Add an OrcaRouter API key/
  );
});

test("every existing provider still resolves its own transport and base URL", () => {
  for (const id of ["openai", "anthropic", "gemini", "xai", "kimi", "deepseek"]) {
    const config = getProviderConfig(id, {});
    assert.ok(config.baseUrl.startsWith("https://"), id);
    assert.ok(config.transport, id);
    assert.notEqual(config.baseUrl, API_BASE, id);
  }
});
