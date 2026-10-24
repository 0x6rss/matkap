import fetch from "node-fetch";
import { resolveOrcaRouterApiBase } from "./orcarouter.js";

export const AI_PROVIDER_IDS = ["openai", "anthropic", "gemini", "xai", "kimi", "deepseek", "orcarouter"];

export const FINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    candidates: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["bot_token", "chat_id"] },
          value: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "string" },
          reason: { type: "string" },
        },
        required: ["kind", "value", "confidence", "evidence", "reason"],
      },
    },
  },
  required: ["summary", "candidates"],
};

const SYSTEM_PROMPT = "Return one valid JSON object that matches the supplied schema.";

const PROVIDERS = {
  openai: {
    label: "OpenAI",
    keyNames: ["OPENAI_API_KEY"],
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5.6-terra",
    baseEnv: "OPENAI_BASE_URL",
    defaultBase: "https://api.openai.com/v1",
    transport: "responses",
  },
  anthropic: {
    label: "Claude",
    keyNames: ["ANTHROPIC_API_KEY"],
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-5",
    baseEnv: "ANTHROPIC_BASE_URL",
    defaultBase: "https://api.anthropic.com/v1",
    transport: "messages",
  },
  gemini: {
    label: "Gemini",
    keyNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.7-flash",
    baseEnv: "GEMINI_BASE_URL",
    defaultBase: "https://generativelanguage.googleapis.com/v1beta",
    transport: "generateContent",
  },
  xai: {
    label: "Grok",
    keyNames: ["XAI_API_KEY"],
    modelEnv: "XAI_MODEL",
    defaultModel: "grok-4.6",
    baseEnv: "XAI_BASE_URL",
    defaultBase: "https://api.x.ai/v1",
    transport: "responses",
  },
  kimi: {
    label: "Kimi",
    keyNames: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
    modelEnv: "KIMI_MODEL",
    defaultModel: "kimi-k3",
    baseEnv: "KIMI_BASE_URL",
    defaultBase: "https://api.moonshot.ai/v1",
    transport: "chat_completions",
  },
  deepseek: {
    label: "DeepSeek",
    keyNames: ["DEEPSEEK_API_KEY"],
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-v4-flash",
    baseEnv: "DEEPSEEK_BASE_URL",
    defaultBase: "https://api.deepseek.com",
    transport: "chat_completions",
  },
  orcarouter: {
    label: "OrcaRouter",
    keyNames: ["ORCAROUTER_API_KEY", "ORCA_API_KEY"],
    modelEnv: "ORCAROUTER_MODEL",
    defaultModel: "orcarouter/auto",
    // OrcaRouter's OpenAI-compatible relay. An explicit override wins; the
    // shared ORCA_BASE_URL covers single-origin self-hosted deployments.
    baseEnv: "ORCAROUTER_BASE_URL",
    baseNames: ["ORCAROUTER_BASE_URL", "ORCAROUTER_API_BASE_URL", "ORCA_BASE_URL"],
    defaultBase: "https://api.orcarouter.ai/v1",
    transport: "chat_completions",
  },
};

function valueFrom(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function trimBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function getProviderConfig(id, env = process.env) {
  const definition = PROVIDERS[id];
  if (!definition) return null;
  const baseNames = definition.baseNames || [definition.baseEnv];
  return {
    id,
    label: definition.label,
    apiKey: valueFrom(env, definition.keyNames),
    model: String(env[definition.modelEnv] || definition.defaultModel).trim(),
    baseUrl: trimBaseUrl(valueFrom(env, baseNames) || definition.defaultBase),
    transport: definition.transport,
  };
}

export function listProviderStatus(env = process.env) {
  return AI_PROVIDER_IDS.map((id) => {
    const config = getProviderConfig(id, env);
    return {
      id: config.id,
      label: config.label,
      configured: Boolean(config.apiKey),
      model: config.model,
      transport: config.transport,
    };
  });
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function extractClaudeText(data) {
  return (data?.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function extractChatText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

function parseJsonOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("The provider returned no text output.");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("The provider output was not valid JSON.");
  }
}

async function postJson(url, headers, body, options = {}) {
  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(options.timeoutMs) || 90_000));
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.error || raw || `HTTP ${response.status}`;
      throw Object.assign(
        new Error(`Provider request failed (${response.status}): ${String(message).slice(0, 500)}`),
        { status: response.status }
      );
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Provider request timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function responseFormat(schema = FINDING_SCHEMA, name = "matkap_telegram_artifacts") {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
}

function anthropicCompatibleSchema(input) {
  const schema = structuredClone(input);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    delete value.maxItems;
    delete value.minItems;
    delete value.minimum;
    delete value.maximum;
    for (const child of Object.values(value)) visit(child);
  }
  visit(schema);
  return schema;
}

function requestConfig(request = {}) {
  return {
    system: String(request.system || SYSTEM_PROMPT),
    schema: request.schema || FINDING_SCHEMA,
    schemaName: String(request.schemaName || "matkap_telegram_artifacts").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    maxTokens: Math.max(256, Math.min(8_192, Number(request.maxTokens) || 2_048)),
  };
}

async function callOpenAi(config, prompt, options, request) {
  const settings = requestConfig(request);
  const data = await postJson(
    `${config.baseUrl}/responses`,
    { Authorization: `Bearer ${config.apiKey}` },
    {
      model: config.model,
      instructions: settings.system,
      input: prompt,
      store: false,
      max_output_tokens: settings.maxTokens,
      text: {
        format: {
          type: "json_schema",
          name: settings.schemaName,
          strict: true,
          schema: settings.schema,
        },
      },
    },
    options
  );
  return { parsed: parseJsonOutput(extractResponsesText(data)), usage: data.usage || null };
}

async function callXai(config, prompt, options, request) {
  const settings = requestConfig(request);
  const data = await postJson(
    `${config.baseUrl}/responses`,
    { Authorization: `Bearer ${config.apiKey}` },
    { model: config.model, instructions: settings.system, input: prompt, store: false, max_output_tokens: settings.maxTokens },
    options
  );
  return { parsed: parseJsonOutput(extractResponsesText(data)), usage: data.usage || null };
}

async function callAnthropic(config, prompt, options, request) {
  const settings = requestConfig(request);
  const data = await postJson(
    `${config.baseUrl}/messages`,
    { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: config.model,
      max_tokens: settings.maxTokens,
      system: settings.system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: anthropicCompatibleSchema(settings.schema) } },
    },
    options
  );
  return { parsed: parseJsonOutput(extractClaudeText(data)), usage: data.usage || null };
}

async function callGemini(config, prompt, options, request) {
  const settings = requestConfig(request);
  const model = encodeURIComponent(config.model.replace(/^models\//, ""));
  const data = await postJson(
    `${config.baseUrl}/models/${model}:generateContent`,
    { "x-goog-api-key": config.apiKey },
    {
      systemInstruction: { parts: [{ text: settings.system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: settings.maxTokens,
        responseMimeType: "application/json",
        responseJsonSchema: settings.schema,
      },
    },
    options
  );
  return { parsed: parseJsonOutput(extractGeminiText(data)), usage: data.usageMetadata || null };
}

async function callChatCompletions(config, prompt, options, request) {
  const settings = requestConfig(request);
  // OrcaRouter is an OpenAI-compatible gateway: request plain JSON mode and let
  // parseJsonOutput accept fences/preamble from models without strict schema
  // support. Kimi keeps its native json_schema support.
  const format = config.id === "kimi"
    ? responseFormat(settings.schema, settings.schemaName)
    : { type: "json_object" };
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: settings.system },
      { role: "user", content: prompt },
    ],
    max_tokens: settings.maxTokens,
    response_format: format,
  };
  if (config.id === "deepseek") body.thinking = { type: "disabled" };
  const data = await postJson(
    `${config.baseUrl}/chat/completions`,
    { Authorization: `Bearer ${config.apiKey}` },
    body,
    options
  );
  return { parsed: parseJsonOutput(extractChatText(data)), usage: data.usage || null };
}

export async function generateProviderJson(providerId, request, options = {}) {
  const env = options.env || process.env;
  const config = getProviderConfig(providerId, env);
  if (!config) throw new Error(`Unknown AI provider: ${providerId}`);
  if (!config.apiKey) {
    throw new Error(providerId === "orcarouter"
      ? "OrcaRouter is not configured. Add an OrcaRouter API key in the OrcaRouter provider settings."
      : `${config.label} is not configured.`);
  }
  if (providerId === "orcarouter") {
    // Keep the explicit-origin policy in one place for both inference and
    // model discovery.
    config.baseUrl = resolveOrcaRouterApiBase(env);
  }
  const requestedModel = String(options.model || "").trim();
  if (requestedModel) {
    if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(requestedModel)) throw new Error("Invalid model identifier.");
    config.model = requestedModel;
  }
  const prompt = String(request?.prompt || "");
  let result;
  try {
    if (providerId === "openai") result = await callOpenAi(config, prompt, options, request);
    else if (providerId === "xai") result = await callXai(config, prompt, options, request);
    else if (providerId === "anthropic") result = await callAnthropic(config, prompt, options, request);
    else if (providerId === "gemini") result = await callGemini(config, prompt, options, request);
    else result = await callChatCompletions(config, prompt, options, request);
  } catch (error) {
    if (providerId === "orcarouter" && (error?.status === 401 || error?.status === 403)) {
      // Terminal auth failure: surface an actionable message, never the key or
      // the raw upstream body, and never retry.
      throw Object.assign(
        new Error(error.status === 401
          ? "OrcaRouter rejected the configured API key. Update or clear it in the OrcaRouter provider settings, then retry."
          : "OrcaRouter refused this request (403). The configured key may not have access to the selected model; choose another model or update the key."),
        { status: error.status }
      );
    }
    throw error;
  }
  return { provider: providerId, label: config.label, model: config.model, ...result };
}

export { parseJsonOutput };
