import { persistEnvValue, removeEnvValue } from "../env-session.js";

// OrcaRouter is an OpenAI-compatible AI gateway. Inference and model discovery
// live on the API origin; key management lives in the user's OrcaRouter console.
export const ORCAROUTER_PROVIDER_ID = "orcarouter";
export const ORCAROUTER_DEFAULT_API_BASE = "https://api.orcarouter.ai/v1";
export const ORCAROUTER_KEY_NAMES = ["ORCAROUTER_API_KEY", "ORCA_API_KEY"];
export const ORCAROUTER_BASE_NAMES = ["ORCAROUTER_BASE_URL", "ORCAROUTER_API_BASE_URL", "ORCA_BASE_URL"];
export const ORCAROUTER_KEYS_URL = "https://www.orcarouter.ai/console/api-keys";

const TEXT_ENDPOINT_TYPES = new Set(["openai", "anthropic", "gemini", "openai-response"]);
const NON_TEXT_ENDPOINT_TYPES = new Set(["image-generation", "openai-video", "jina-rerank", "embeddings"]);
const CATALOG_TIMEOUT_MS = 12_000;
const CATALOG_MAX_BYTES = 2_000_000;
const CATALOG_MAX_MODELS = 500;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,200}$/;

// Small, verified cold-start catalog. Live discovery is authoritative whenever
// it succeeds; this seed only keeps a fresh install usable during an outage and
// carries the metadata MATKAP already relies on (context and reasoning effort).
export const ORCAROUTER_VERIFIED_SEED = [
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    contextLength: 400_000,
    inputModalities: ["text", "image"],
    endpointTypes: ["openai", "openai-response"],
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    contextLength: 200_000,
    inputModalities: ["text", "image"],
    endpointTypes: ["anthropic"],
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    contextLength: 1_000_000,
    inputModalities: ["text", "image", "audio", "video"],
    endpointTypes: ["gemini"],
    reasoningEfforts: [],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextLength: 128_000,
    inputModalities: ["text"],
    endpointTypes: ["openai"],
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "orcarouter/auto",
    name: "OrcaRouter Auto",
    contextLength: 128_000,
    inputModalities: ["text"],
    endpointTypes: ["openai"],
    reasoningEfforts: [],
  },
];

function firstValue(env, names) {
  for (const name of names) {
    const value = String(env?.[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Resolve the inference/model-discovery base. Explicit overrides win over the
 * shared self-hosted fallback. Remote origins must be HTTPS; plain HTTP is only
 * accepted for loopback development.
 */
export function resolveOrcaRouterApiBase(env = process.env) {
  const explicit = firstValue(env, ["ORCAROUTER_API_BASE_URL", "ORCAROUTER_BASE_URL"]);
  const shared = firstValue(env, ["ORCA_BASE_URL"]);
  const raw = explicit || shared || ORCAROUTER_DEFAULT_API_BASE;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("OrcaRouter base URL is not a valid URL.");
  }
  if (parsed.username || parsed.password) throw new Error("OrcaRouter base URL must not contain credentials.");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) {
    throw new Error("OrcaRouter base URL must use HTTPS (HTTP is allowed only for loopback development).");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function readOrcaRouterKey(env = process.env) {
  return firstValue(env, ORCAROUTER_KEY_NAMES);
}

export function maskOrcaRouterKey(key) {
  const value = String(key || "");
  if (!value) return "";
  // Show the provider prefix only: never echo any character of the secret, so
  // screenshots, logs and support threads cannot leak part of a live key.
  return /^sk-orca-/i.test(value) ? "sk-orca-…" : "…";
}

export function orcaRouterCredentialStatus(env = process.env) {
  const key = readOrcaRouterKey(env);
  return {
    provider: ORCAROUTER_PROVIDER_ID,
    configured: Boolean(key),
    source: key ? "api_key" : "none",
    masked: maskOrcaRouterKey(key),
    keysUrl: ORCAROUTER_KEYS_URL,
    apiBase: (() => {
      try {
        return resolveOrcaRouterApiBase(env);
      } catch {
        return "";
      }
    })(),
  };
}

// Lightweight format check only: an sk-orca- prefix is not proof that a key is
// valid, so validity is established by the first real request.
export function normalizeOrcaRouterApiKey(rawKey) {
  const key = String(rawKey ?? "").trim();
  if (!key) throw new Error("Enter an OrcaRouter API key.");
  if (/\s/.test(key)) throw new Error("An OrcaRouter API key cannot contain whitespace.");
  if (key.length < 8 || key.length > 512) throw new Error("That does not look like an OrcaRouter API key.");
  return key;
}

/** Save an API key through MATKAP's existing .env secret store (mode 0600). */
export async function saveOrcaRouterApiKey(rawKey, { env = process.env, envPath } = {}) {
  const key = normalizeOrcaRouterApiKey(rawKey);
  await persistEnvValue("ORCAROUTER_API_KEY", key, envPath ? { envPath } : {});
  env.ORCAROUTER_API_KEY = key;
  return orcaRouterCredentialStatus(env);
}

/** Remove the stored key. The provider stays registered but unconfigured. */
export async function clearOrcaRouterApiKey({ env = process.env, envPath } = {}) {
  await removeEnvValue("ORCAROUTER_API_KEY", envPath ? { envPath } : {});
  delete env.ORCAROUTER_API_KEY;
  if (env.ORCA_API_KEY) {
    await removeEnvValue("ORCA_API_KEY", envPath ? { envPath } : {});
    delete env.ORCA_API_KEY;
  }
  return orcaRouterCredentialStatus(env);
}

function stringList(value, max = 16) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().toLowerCase())
    .slice(0, max);
}

export function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || !MODEL_ID_PATTERN.test(id)) return null;
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture : {};
  const endpointTypes = stringList(raw.supported_endpoint_types ?? raw.supportedEndpointTypes, 20);
  const inputModalities = stringList(architecture.input_modalities ?? raw.input_modalities, 8);
  const contextValue = Number(raw.context_length ?? raw.context_window ?? architecture.context_length);
  const reasoning = raw.reasoning && typeof raw.reasoning === "object" ? raw.reasoning : {};
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : id,
    contextLength: Number.isFinite(contextValue) && contextValue > 0 ? Math.floor(contextValue) : null,
    inputModalities,
    endpointTypes,
    reasoningEfforts: stringList(
      raw.reasoning_efforts ?? raw.supported_reasoning_efforts ?? reasoning.efforts,
      8
    ),
  };
}

export function modelSupportsCapability(model, capability) {
  const endpoints = Array.isArray(model?.endpointTypes) ? model.endpointTypes : [];
  switch (String(capability || "chat")) {
    case "chat":
      if (!endpoints.some((type) => TEXT_ENDPOINT_TYPES.has(type))) return false;
      // A model advertised only for dedicated non-text routes is not a chat model.
      return !endpoints.every((type) => NON_TEXT_ENDPOINT_TYPES.has(type));
    case "embedding":
      return endpoints.includes("embeddings");
    case "image":
      return endpoints.includes("image-generation");
    case "video":
      return endpoints.includes("openai-video");
    case "rerank":
      return endpoints.includes("jina-rerank");
    default:
      return false;
  }
}

/**
 * Filter a catalog for one entry point. `modalities` adds the input requirements
 * of a multimodal entry point; models that do not declare the modality are
 * dropped (fail closed) rather than guessed from their name.
 */
export function filterCatalogForEntry(models, { capability = "chat", modalities = [] } = {}) {
  const required = stringList(modalities, 4).filter((item) => item !== "text");
  return (Array.isArray(models) ? models : []).filter((model) => {
    if (!modelSupportsCapability(model, capability)) return false;
    if (!required.length) return true;
    const declared = Array.isArray(model?.inputModalities) ? model.inputModalities : [];
    return required.every((modality) => declared.includes(modality));
  });
}

export function findCatalogModel(models, modelId) {
  const id = String(modelId || "").trim();
  if (!id) return null;
  return (Array.isArray(models) ? models : []).find((model) => model.id === id) || null;
}

/** A model id may be sent to the gateway only if it is in the compatible list. */
export function assertCompatibleModel(models, modelId, { capability = "chat", modalities = [] } = {}) {
  const compatible = filterCatalogForEntry(models, { capability, modalities });
  const model = findCatalogModel(compatible, modelId);
  if (!model) {
    throw new Error("The selected OrcaRouter model is not available for this request. Refresh the model list and choose another model.");
  }
  return model;
}

const catalogCache = new Map();

/**
 * Gateway responses are not guaranteed to be ordered consistently. Sort them
 * deterministically so a refresh never reorders the dropdown or changes the
 * default selection.
 */
export function orderCatalogModels(models) {
  return [...(Array.isArray(models) ? models : [])].sort((left, right) => left.id.localeCompare(right.id));
}

function cachedCatalog(capability) {
  const entry = catalogCache.get(capability);
  if (!entry) return null;
  if (Date.now() - entry.at > CATALOG_TTL_MS) {
    catalogCache.delete(capability);
    return null;
  }
  return entry.value;
}

export function resetOrcaRouterCatalogCache() {
  catalogCache.clear();
}

async function readBoundedText(response, maxBytes) {
  const raw = await response.text();
  if (raw.length > maxBytes) throw new Error("The OrcaRouter model catalog response was too large.");
  return raw;
}

/**
 * Fetch the live model list for one capability. The API key never leaves the
 * server. Live results are authoritative; on any failure the caller receives
 * the verified seed plus a degraded/error marker.
 */
export async function fetchOrcaRouterCatalog({
  env = process.env,
  fetchImpl = globalThis.fetch,
  capability = "chat",
  timeoutMs = CATALOG_TIMEOUT_MS,
} = {}) {
  let base;
  try {
    base = resolveOrcaRouterApiBase(env);
  } catch (error) {
    return { source: "seed", degraded: true, models: filterCatalogForEntry(ORCAROUTER_VERIFIED_SEED, { capability }), error: error.message, fetchedAt: null };
  }
  const key = readOrcaRouterKey(env);
  if (!key) {
    return {
      source: "seed",
      degraded: true,
      models: filterCatalogForEntry(ORCAROUTER_VERIFIED_SEED, { capability }),
      error: "Add an OrcaRouter API key to load the full model list.",
      fetchedAt: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(2_000, Math.min(60_000, Number(timeoutMs) || CATALOG_TIMEOUT_MS)));
  try {
    const url = `${base}/models?capability=${encodeURIComponent(capability)}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "OrcaRouter rejected the configured API key. Update or clear it in the OrcaRouter provider settings."
        : `OrcaRouter model discovery failed (${response.status}).`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    const raw = await readBoundedText(response, CATALOG_MAX_BYTES);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("OrcaRouter returned an unreadable model catalog.");
    }
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const models = orderCatalogModels(
      filterCatalogForEntry(
        list.slice(0, CATALOG_MAX_MODELS).map(normalizeCatalogEntry).filter(Boolean),
        { capability }
      )
    );
    if (!models.length) throw new Error("OrcaRouter returned no models for this capability.");
    const value = { source: "live", degraded: false, models, error: "", fetchedAt: new Date().toISOString() };
    catalogCache.set(capability, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (error?.name === "AbortError") error = new Error("OrcaRouter model discovery timed out.");
    return {
      source: "seed",
      degraded: true,
      models: filterCatalogForEntry(ORCAROUTER_VERIFIED_SEED, { capability }),
      error: String(error?.message || error),
      fetchedAt: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Cached variant used by HTTP routes; pass `refresh` to bypass the TTL. */
export async function getOrcaRouterCatalog(options = {}) {
  const capability = String(options.capability || "chat");
  if (!options.refresh) {
    const cached = cachedCatalog(capability);
    if (cached) return { ...cached, cached: true };
  }
  const value = await fetchOrcaRouterCatalog({ ...options, capability });
  return { ...value, cached: false };
}

/**
 * Public (browser-safe) projection: minimal metadata only, never the key and
 * never provider pricing internals.
 */
export function publicCatalogPayload(catalog) {
  return {
    provider: ORCAROUTER_PROVIDER_ID,
    source: catalog?.source || "seed",
    degraded: catalog?.degraded !== false,
    error: String(catalog?.error || "").slice(0, 300),
    fetchedAt: catalog?.fetchedAt || null,
    models: (catalog?.models || []).map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.contextLength,
      inputModalities: model.inputModalities,
      endpointTypes: model.endpointTypes,
      reasoningEfforts: model.reasoningEfforts,
    })),
  };
}

/**
 * Resolve the model a scan should use. The previous selection survives only
 * while it is still compatible; otherwise it is cleared and the UI must ask the
 * user to choose again.
 */
export function resolveSelectedModel(previousModelId, models, options = {}) {
  const compatible = filterCatalogForEntry(models, options);
  const previous = findCatalogModel(compatible, previousModelId);
  if (previous) return { model: previous.id, cleared: false, reason: "" };
  if (!String(previousModelId || "").trim()) return { model: "", cleared: false, reason: "" };
  return {
    model: "",
    cleared: true,
    reason: "The previously selected model is not available for this provider and capability. Choose another model.",
  };
}
