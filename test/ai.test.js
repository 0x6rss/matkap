import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderFindings } from "../ai/model-router.js";
import { AI_PROVIDER_IDS, FINDING_SCHEMA, generateProviderJson, listProviderStatus } from "../ai/providers.js";

const syntheticToken = `123456789:${"B".repeat(35)}`;
const parsedResult = {
  summary: `Found ${syntheticToken}`,
  candidates: [
    {
      kind: "bot_token",
      value: syntheticToken,
      confidence: 0.91,
      evidence: `token=${syntheticToken}`,
      reason: "Exact static string",
    },
    {
      kind: "chat_id",
      value: "-1001234567890",
      confidence: 0.88,
      evidence: "chat_id assignment",
      reason: "Exact numeric value",
    },
  ],
};

const testEnv = {
  OPENAI_API_KEY: "test-openai",
  ANTHROPIC_API_KEY: "test-anthropic",
  GEMINI_API_KEY: "test-gemini",
  XAI_API_KEY: "test-xai",
  KIMI_API_KEY: "test-kimi",
  DEEPSEEK_API_KEY: "test-deepseek",
  ORCAROUTER_API_KEY: "test-orcarouter",
  OPENAI_BASE_URL: "https://openai.invalid/v1",
  ANTHROPIC_BASE_URL: "https://anthropic.invalid/v1",
  GEMINI_BASE_URL: "https://gemini.invalid/v1beta",
  XAI_BASE_URL: "https://xai.invalid/v1",
  KIMI_BASE_URL: "https://kimi.invalid/v1",
  DEEPSEEK_BASE_URL: "https://deepseek.invalid",
  ORCAROUTER_BASE_URL: "https://orcarouter.invalid/v1",
};

function responseFor(url) {
  if (url.includes("anthropic")) return { content: [{ type: "text", text: JSON.stringify(parsedResult) }] };
  if (url.includes("gemini")) {
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(parsedResult) }] } }] };
  }
  if (url.endsWith("/chat/completions")) {
    return { choices: [{ message: { content: JSON.stringify(parsedResult) } }], usage: { total_tokens: 12 } };
  }
  return {
    output: [{ content: [{ type: "output_text", text: JSON.stringify(parsedResult) }] }],
    usage: { total_tokens: 12 },
  };
}

async function fakeFetch(url, options) {
  assert.equal(options.method, "POST");
  assert.ok(options.body.includes("UNTRUSTED_MCP_OUTPUT"));
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseFor(String(url))),
  };
}

const providerRequest = {
  system: "Return exact Telegram candidates as JSON.",
  prompt: "<UNTRUSTED_MCP_OUTPUT>telegram evidence</UNTRUSTED_MCP_OUTPUT>",
  schema: FINDING_SCHEMA,
  schemaName: "matkap_provider_test",
  maxTokens: 2_048,
};

test("all AI providers are configurable without exposing API keys", () => {
  const status = listProviderStatus(testEnv);
  assert.deepEqual(status.map((item) => item.id), AI_PROVIDER_IDS);
  assert.ok(status.every((item) => item.configured));
  assert.ok(!JSON.stringify(status).includes("test-openai"));
});

for (const provider of AI_PROVIDER_IDS) {
  test(`${provider} adapter parses a normalized JSON response`, async () => {
    const result = await generateProviderJson(
      provider,
      providerRequest,
      { env: testEnv, fetchImpl: fakeFetch, timeoutMs: 5_000 }
    );
    assert.equal(result.provider, provider);
    assert.equal(result.parsed.candidates.length, 2);
  });
}

test("anthropic adapter removes unsupported structured-output constraints", async () => {
  let requestBody;
  await generateProviderJson(
    "anthropic",
    providerRequest,
    {
      env: testEnv,
      timeoutMs: 5_000,
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(responseFor("https://anthropic.invalid/v1/messages")),
        };
      },
    }
  );

  const schema = requestBody.output_config.format.schema;
  assert.equal(schema.properties.candidates.maxItems, undefined);
  const confidence = schema.properties.candidates.items.properties.confidence;
  assert.equal(confidence.minimum, undefined);
  assert.equal(confidence.maximum, undefined);
});

test("provider candidates are accepted only when their exact formats are valid", () => {
  const accepted = normalizeProviderFindings(
    { provider: "openai", model: "fixture", parsed: parsedResult },
    { artifact: "fixture" }
  );
  assert.equal(accepted.length, 2);
  assert.ok(!accepted[0].context.includes(syntheticToken));
  const invalid = normalizeProviderFindings(
    { provider: "openai", model: "fixture", parsed: { candidates: [{ kind: "bot_token", value: "not-a-token" }] } },
    { artifact: "fixture" }
  );
  assert.deepEqual(invalid, []);
});
