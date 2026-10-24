import crypto from "node:crypto";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { runMcpInvestigation } from "../ai/mcp-agent.js";
import { maskCredentialText } from "./lib/telegram-scanner.js";
import { connectJadxRest } from "./jadx-rest-adapter.js";

const DEFINITIONS = [
  { id: "jadx", label: "JADX MCP", prefix: "JADX" },
];

function cleanError(error) {
  return maskCredentialText(String(error?.message || error || "Unknown MCP error"))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function connectionError(config, error) {
  const message = cleanError(error);
  try {
    const url = new URL(config.url);
    if (config.id === "jadx" && url.port === "8650" && /404|not found/i.test(message)) {
      return "Port 8650 is the packaged JADX connector. Set JADX_MCP_URL=http://127.0.0.1:8650 and JADX_MCP_TRANSPORT=jadx-rest.";
    }
  } catch {
    // The original URL validation error is more useful below.
  }
  return message;
}

function loopbackUrl(value) {
  const url = new URL(String(value || ""));
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Reverse-engineering MCP URLs must use a loopback host.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("MCP URL must use HTTP or HTTPS.");
  return url;
}

function configsFromEnv(env) {
  return DEFINITIONS.map((definition) => ({
    ...definition,
    url: String(env[`${definition.prefix}_MCP_URL`] || "").trim(),
    transport: String(env[`${definition.prefix}_MCP_TRANSPORT`] || "auto").trim().toLowerCase(),
    token: String(env[`${definition.prefix}_MCP_TOKEN`] || "").trim(),
    connectTimeoutMs: Math.max(1_000, Math.min(15_000, Number(env.MATKAP_MCP_CONNECT_TIMEOUT_MS) || 3_500)),
    toolTimeoutMs: Math.max(5_000, Math.min(180_000, Number(env.MATKAP_MCP_TOOL_TIMEOUT_MS) || 45_000)),
  }));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sdkConnect(config, transportKind) {
  const url = loopbackUrl(config.url);
  const headers = config.token ? { Authorization: `Bearer ${config.token}` } : undefined;
  const authProvider = config.token ? { token: async () => config.token } : undefined;
  const options = { authProvider, requestInit: headers ? { headers } : undefined };
  const transport = transportKind === "sse"
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);
  const client = new Client({ name: "matkap-mcp-hub", version: "2.0.0" });
  try {
    await withTimeout(client.connect(transport), config.connectTimeoutMs, `${config.label} connection`);
  } catch (error) {
    try { await client.close(); } catch { /* connection did not finish */ }
    throw error;
  }
  const listed = await withTimeout(client.listTools(), config.connectTimeoutMs, `${config.label} tools/list`);
  return {
    client,
    transport,
    tools: listed.tools || [],
    async listTools() {
      return (await withTimeout(client.listTools(), config.connectTimeoutMs, `${config.label} tools/list`)).tools || [];
    },
    async callTool(name, args) {
      return withTimeout(client.callTool({ name, arguments: args }), config.toolTimeoutMs, `${config.label}/${name}`);
    },
    async close() { await client.close(); },
  };
}

async function defaultConnect(config) {
  const configuredUrl = loopbackUrl(config.url);
  if (config.id === "jadx" && (config.transport === "jadx-rest" || (config.transport === "auto" && configuredUrl.port === "8650"))) {
    return withTimeout(connectJadxRest(config), config.connectTimeoutMs, `${config.label} connection`);
  }
  const kinds = config.transport === "sse" ? ["sse"]
    : config.transport === "streamable-http" || config.transport === "http" ? ["streamable-http"]
      : ["streamable-http", "sse"];
  const errors = [];
  for (const kind of kinds) {
    try {
      const handle = await sdkConnect(config, kind);
      return { ...handle, transportKind: kind };
    } catch (error) {
      errors.push(`${kind}: ${cleanError(error)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function publicJob(job) {
  return structuredClone(job);
}

export function createToolHub({ env = process.env, connect = defaultConnect, investigate = runMcpInvestigation, publishResult } = {}) {
  if (typeof publishResult !== "function") throw new Error("publishResult callback is required.");
  const states = new Map(configsFromEnv(env).map((config) => [config.id, {
    config,
    handle: null,
    connected: false,
    connecting: null,
    tools: [],
    transport: null,
    lastSeenAt: null,
    lastError: config.url ? null : "MCP URL is not configured.",
  }]));
  const jobs = new Map();

  async function disconnect(state) {
    const handle = state.handle;
    state.handle = null;
    state.connected = false;
    state.tools = [];
    state.transport = null;
    if (handle) {
      try { await handle.close(); } catch { /* already closed */ }
    }
  }

  async function ensureConnected(state) {
    if (!state.config.url) return null;
    if (state.connecting) return state.connecting;
    state.connecting = (async () => {
      try {
        if (!state.handle) state.handle = await connect(state.config);
        state.tools = await state.handle.listTools();
        state.transport = state.handle.transportKind || state.config.transport;
        state.connected = true;
        state.lastSeenAt = new Date().toISOString();
        state.lastError = null;
        return state.handle;
      } catch (error) {
        state.lastError = connectionError(state.config, error);
        await disconnect(state);
        return null;
      } finally {
        state.connecting = null;
      }
    })();
    return state.connecting;
  }

  async function probeAll() {
    await Promise.all([...states.values()].map((state) => ensureConnected(state)));
    return listStatus();
  }

  function listStatus() {
    return [...states.values()].map((state) => ({
      name: state.config.id,
      label: state.config.label,
      configured: Boolean(state.config.url),
      connected: state.connected,
      tools: state.tools.length,
      transport: state.transport,
      lastSeenAt: state.lastSeenAt,
      error: state.lastError,
    }));
  }

  async function run(job, options) {
    job.status = "running";
    job.stage = "connecting";
    job.progress = 5;
    job.message = "Connecting to the open JADX project";
    job.updatedAt = new Date().toISOString();
    try {
      await probeAll();
      const servers = [...states.values()].filter((state) => state.connected).map((state) => ({
        id: state.config.id,
        label: state.config.label,
        tools: state.tools,
        callTool: (name, args) => state.handle.callTool(name, args),
      }));
      if (!servers.length) throw new Error("JADX MCP is not connected. Open an APK in JADX and restart JADX after installing the connector.");
      const result = await investigate({
        servers,
        provider: options.provider,
        model: options.model,
        env,
        onProgress(update) {
          job.stage = update.stage;
          job.progress = Math.max(job.progress, Number(update.progress) || 0);
          job.message = update.message;
          job.updatedAt = new Date().toISOString();
        },
      });
      const published = await publishResult(result);
      job.status = "completed";
      job.stage = "completed";
      job.progress = 100;
      job.message = "Connected MCP source investigation completed";
      job.result = {
        servers: result.servers,
        calls: result.calls.length,
        successfulCalls: result.calls.filter((item) => item.ok).length,
        findings: published.accepted || 0,
        provider: result.provider,
        model: result.model,
        summary: result.summary,
      };
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "error";
      job.stage = "error";
      job.progress = 100;
      job.message = "MCP source investigation failed";
      job.error = cleanError(error);
      job.completedAt = new Date().toISOString();
    }
    job.updatedAt = new Date().toISOString();
  }

  function startScan(options = {}) {
    const active = [...jobs.values()].find((item) => ["queued", "running"].includes(item.status));
    if (active) {
      const error = new Error("An MCP source investigation is already running.");
      error.code = "SCAN_BUSY";
      throw error;
    }
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      status: "queued",
      stage: "queued",
      progress: 0,
      message: "MCP source investigation queued",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    jobs.set(job.id, job);
    for (const old of [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(20)) jobs.delete(old.id);
    setImmediate(() => void run(job, options));
    return publicJob(job);
  }

  return {
    probeAll,
    listStatus,
    startScan,
    getJob(id) {
      const job = jobs.get(String(id));
      return job ? publicJob(job) : null;
    },
    async close() {
      await Promise.all([...states.values()].map(disconnect));
    },
  };
}
