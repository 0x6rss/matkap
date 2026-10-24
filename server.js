import express from "express";
import fetch from "node-fetch";
import telegramPkg from "telegram";
import dotenv from "dotenv";
import readline from "readline";
import crypto from "crypto";
import session from "express-session";
import helmet from "helmet";
import { body, validationResult } from "express-validator";
import {
  dbEnabled,
  initDatabase,
  saveLog,
  saveCapturedMessage,
  saveFeedCache,
  getFeedCache,
} from "./database.js";
import { SOURCES, listSources } from "./sources/index.js";
import { extractTelegramIOCs } from "./ioc.js";
import { fetchTelegramThreats } from "./tweetfeed.js";
import { NEWS_SOURCES, runNewsHunt } from "./news.js";
import { checkHashes, fetchRecentTelegramMalware } from "./malwarebazaar.js";
import { buildThreatStatistics, filterSamplesByDays } from "./statistics.js";
import { persistEnvValue } from "./env-session.js";
import { resolveProviders } from "./ai/model-router.js";
import { listProviderStatus } from "./ai/providers.js";
import {
  ORCAROUTER_PROVIDER_ID,
  assertCompatibleModel,
  clearOrcaRouterApiKey,
  getOrcaRouterCatalog,
  orcaRouterCredentialStatus,
  publicCatalogPayload,
  saveOrcaRouterApiKey,
} from "./ai/orcarouter.js";
import { createToolHub } from "./mcp/tool-hub.js";
import {
  clearFindings,
  ingestFindings,
  listPublicFindings,
  revealFinding,
} from "./mcp/findings-store.js";

dotenv.config();

const { TelegramClient, sessions, Api } = telegramPkg;
const { StringSession } = sessions;

const debugMode = process.env.NODE_ENV !== "production";

const app = express();
app.disable("etag");
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MALWAREBAZAAR_REFRESH_MS = 3 * 60 * 60 * 1000;

let malwareBazaarTelegramCache = null;
let malwareBazaarTelegramRefresh = null;
const feedMemoryCache = new Map();

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://cdnjs.cloudflare.com",
    "https://cdn.jsdelivr.net",
  ],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
};

if (process.env.NODE_ENV === "production") {
  cspDirectives.upgradeInsecureRequests = [];
}

app.use((req, res, next) => {
  const hostHeader = String(req.headers.host || "").toLowerCase();
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : hostHeader.split(":")[0];
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    return res.status(403).send("MATKAP is a local-only service.");
  }
  next();
});

app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));
app.use(express.json({ limit: "4mb" }));
app.use(express.static("public", { index: false }));

// Anonymous session: every browser gets a session id which keys its own
// isolated state. No login, no account hash - open access.
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

function userKeyOf(req) {
  return req.sessionID;
}

// =====================================================================
// Per-user (per-session) state
// =====================================================================
const userStates = new Map();

function getUserState(key) {
  if (!userStates.has(key)) {
    userStates.set(key, {
      botToken: null,
      botUsername: null,
      myChatId: null,
      lastMessageId: null,
      stopFlag: false,
      stoppedId: 0,
      maxOlderAttempts: 200,
      logs: [],
      capturedMessages: [],
      isOperationRunning: false,
      client: null,
      accountIndex: 0,
    });
  }
  return userStates.get(key);
}

// =====================================================================
// Telegram controller account pool
// =====================================================================
const clients = []; // { label, client, apiId, apiHash }
let roundRobin = 0;

function loadAccounts() {
  let accs = [];
  if (process.env.TELEGRAM_ACCOUNTS) {
    try {
      accs = JSON.parse(process.env.TELEGRAM_ACCOUNTS);
    } catch (e) {
      console.error("TELEGRAM_ACCOUNTS parse error:", e);
    }
  }
  if (!accs.length) {
    accs = [
      {
        label: "default",
        apiId: process.env.TELEGRAM_API_ID,
        apiHash: process.env.TELEGRAM_API_HASH,
        stringSession: process.env.TELEGRAM_STRING_SESSION || "",
        phone: process.env.TELEGRAM_PHONE,
      },
    ];
  }
  return accs;
}

function askTerminal(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let muteOutput = false;
    if (hidden && process.stdin.isTTY && process.stdout.isTTY) {
      const writeToOutput = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (text) => {
        if (!muteOutput) writeToOutput(text);
      };
    }
    rl.question(question, (answer) => {
      if (muteOutput) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    muteOutput = hidden;
  });
}

async function interactiveLogin(client, acc, label) {
  if (!acc.phone) throw new Error("TELEGRAM_PHONE is required for the first login.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The first Telegram login must be completed in an interactive terminal.");
  }
  await client.start({
    phoneNumber: acc.phone,
    phoneCode: async (isCodeViaApp) => askTerminal(
      `[${label}] Enter the Telegram code${isCodeViaApp ? " from the Telegram app" : ""}: `
    ),
    password: async (hint) => askTerminal(
      `[${label}] Enter Telegram 2FA password${hint ? ` (${hint})` : ""} (input hidden): `,
      { hidden: true }
    ),
    onError: async (error) => {
      console.error(`[${label}] Telegram login error: ${error?.message || error}`);
      return false;
    },
  });
  if (!(await client.checkAuthorization())) throw new Error("Telegram authorization did not complete.");
  return String(client.session.save());
}

async function persistAccountSession(accounts, accountIndex, newSession) {
  if (process.env.TELEGRAM_ACCOUNTS) {
    const updated = accounts.map((account, index) => index === accountIndex
      ? { ...account, stringSession: newSession }
      : account);
    await persistEnvValue("TELEGRAM_ACCOUNTS", JSON.stringify(updated));
    return;
  }
  await persistEnvValue("TELEGRAM_STRING_SESSION", newSession);
}

async function connectAccounts() {
  const accs = loadAccounts();
  for (let i = 0; i < accs.length; i++) {
    const a = accs[i];
    const label = a.label || `account${i + 1}`;
    const apiId = parseInt(a.apiId, 10);
    const apiHash = a.apiHash;
    if (!apiId || !apiHash) {
      console.warn(`[${label}] missing apiId/apiHash - skipping.`);
      continue;
    }
    let client = new TelegramClient(new StringSession(a.stringSession || ""), apiId, apiHash, {
      connectionRetries: 5,
    });
    if (a.stringSession) {
      try {
        await client.connect();
        if (!(await client.checkAuthorization())) throw new Error("Saved Telegram session is no longer authorized.");
        clients.push({ label, client, apiId, apiHash });
        console.log(`Connected Telegram account: ${label}`);
      } catch (err) {
        console.error(`[${label}] connect error: ${err}`);
        try { await client.disconnect(); } catch { /* connection may already be closed */ }
        if (process.env.NODE_ENV === "production") continue;
        try {
          client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
          const newSession = await interactiveLogin(client, a, label);
          await persistAccountSession(accs, i, newSession);
          a.stringSession = newSession;
          clients.push({ label, client, apiId, apiHash });
          console.log(`[${label}] Login OK. String session saved to .env for future starts.`);
        } catch (loginError) {
          console.error(`[${label}] session recovery failed: ${loginError}`);
        }
      }
    } else {
      if (process.env.NODE_ENV === "production") {
        console.error(`[${label}] no string session in production - skipping.`);
        continue;
      }
      try {
        const newSession = await interactiveLogin(client, a, label);
        await persistAccountSession(accs, i, newSession);
        a.stringSession = newSession;
        clients.push({ label, client, apiId, apiHash });
        console.log(`[${label}] Login OK. String session saved to .env for future starts.`);
      } catch (err) {
        console.error(`[${label}] interactive login failed: ${err}`);
      }
    }
  }
  if (!clients.length) {
    console.warn("No Telegram controller account connected. Fill in .env before hunting.");
  }
}

function pickClient(requestedIndex) {
  if (!clients.length) return null;
  let idx;
  if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < clients.length) {
    idx = requestedIndex;
  } else {
    idx = roundRobin % clients.length;
    roundRobin++;
  }
  return { idx, entry: clients[idx] };
}

// =====================================================================
// Telegram Bot API helpers
// =====================================================================
const TELEGRAM_API_URL = "https://api.telegram.org/bot";

async function getMe(botToken) {
  try {
    const resp = await fetch(`${TELEGRAM_API_URL}${botToken}/getMe`);
    const data = await resp.json();
    if (data.ok) return data.result;
    console.log(`[getMe] error => ${JSON.stringify(data)}`);
    return null;
  } catch (err) {
    console.log(`[getMe] exc => ${err}`);
    return null;
  }
}

// Read-only enrichment: validate a token (getMe) and try to recover a chat id
// from pending updates (getUpdates). Does NOT delete webhooks or consume updates.
async function enrichToken(token) {
  const out = { valid: false, username: null, chatId: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const me = await (await fetch(`${TELEGRAM_API_URL}${token}/getMe`, { signal: controller.signal })).json();
    if (me && me.ok) {
      out.valid = true;
      out.username = me.result.username || null;
      // Drop any webhook (keeping pending updates) so getUpdates can return them.
      await deleteWebhookSilent(token);
      const upd = await (await fetch(`${TELEGRAM_API_URL}${token}/getUpdates?limit=10&timeout=0`, { signal: controller.signal })).json();
      if (upd && upd.ok && Array.isArray(upd.result)) {
        for (const u of upd.result) {
          const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
          const chat = m && (m.chat || (m.message && m.message.chat));
          if (chat && chat.id != null) {
            out.chatId = String(chat.id);
            break;
          }
        }
      }
    }
    clearTimeout(timer);
  } catch (e) {
    /* token dead / unreachable */
  }
  return out;
}

async function deleteWebhookSilent(botToken) {
  try {
    await fetch(`${TELEGRAM_API_URL}${botToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
  } catch (err) {
    /* silent */
  }
}

async function getUpdates(botToken) {
  try {
    await deleteWebhookSilent(botToken);
    const resp = await fetch(`${TELEGRAM_API_URL}${botToken}/getUpdates`);
    const data = await resp.json();
    if (data.ok && data.result && data.result.length > 0) {
      const lastUpd = data.result[data.result.length - 1];
      const msg = lastUpd.message;
      return { chatId: msg.chat.id, msgId: msg.message_id };
    }
    console.log(`[getUpdates] no result => ${JSON.stringify(data)}`);
    return { chatId: null, msgId: null };
  } catch (err) {
    console.log(`[getUpdates] exc => ${err}`);
    return { chatId: null, msgId: null };
  }
}

async function forwardMsg(botToken, fromChatId, toChatId, messageId, logger, addCaptured, userInfo = null) {
  try {
    const resp = await fetch(`${TELEGRAM_API_URL}${botToken}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_chat_id: fromChatId, chat_id: toChatId, message_id: messageId }),
    });
    const data = await resp.json();
    if (!data.ok) {
      logger(`[warn] forward fail => ${JSON.stringify(data)}`);
      return false;
    }

    logger(`[ok] forwarded msg ID=${messageId}`);
    const fm = data.result;
    let messageContent = "";
    let fileId = null;
    let fileType = null;

    if (fm.text) {
      messageContent = fm.text;
    } else if (fm.photo) {
      const p = fm.photo[fm.photo.length - 1];
      messageContent = `[Photo] file_id: ${p.file_id}, size: ${p.file_size}`;
      fileId = p.file_id;
      fileType = "photo";
    } else if (fm.document) {
      messageContent = `[Document] name: ${fm.document.file_name}, mime: ${fm.document.mime_type}`;
      fileId = fm.document.file_id;
      fileType = "document";
    } else if (fm.audio) {
      messageContent = `[Audio] title: ${fm.audio.title || "unknown"}, performer: ${fm.audio.performer || "unknown"}`;
      fileId = fm.audio.file_id;
      fileType = "audio";
    } else if (fm.video) {
      messageContent = `[Video] duration: ${fm.video.duration}s`;
      fileId = fm.video.file_id;
      fileType = "video";
    } else if (fm.voice) {
      messageContent = `[Voice] duration: ${fm.voice.duration}s`;
      fileId = fm.voice.file_id;
      fileType = "voice";
    } else {
      messageContent = "[Unsupported content]";
    }

    const timestamp = fm.date ? new Date(fm.date * 1000).toISOString() : new Date().toISOString();
    const userState = userInfo?.userKey ? getUserState(userInfo.userKey) : null;
    const currentBotToken = userState?.botToken || botToken;

    const capturedMsg = {
      messageId: fm.message_id,
      fromChatId,
      toChatId,
      timestamp,
      content: messageContent,
      fileId,
      token: currentBotToken,
    };
    addCaptured(capturedMsg);

    if (userInfo) {
      try {
        await saveCapturedMessage({
          userKey: userInfo.userKey,
          botToken: currentBotToken,
          botUsername: userState?.botUsername,
          messageId: fm.message_id,
          fromId: fm.from?.id?.toString(),
          chatId: fromChatId?.toString(),
          messageText: messageContent,
          fileId,
          fileType,
          rawData: fm,
        });
      } catch (dbErr) {
        console.error("DB save error:", dbErr);
      }
    }
    return true;
  } catch (err) {
    logger(`[fail] forwardMsg err => ${err}`);
    return false;
  }
}

async function infiltrationProcess(attackerId, logger, addCaptured, userInfo) {
  const userState = getUserState(userInfo.userKey);
  const lastId = userState.lastMessageId || 0;
  const stopId = Math.max(1, lastId - userState.maxOlderAttempts);
  logger(`Trying older IDs from ${lastId} down to ${stopId}`);

  let foundAny = false;
  for (let testId = lastId; testId >= stopId; testId--) {
    if (userState.stopFlag) {
      logger("[stop] infiltration older ID => stopped by user");
      return;
    }
    const ok = await forwardMsg(userState.botToken, attackerId, userState.myChatId, testId, logger, addCaptured, userInfo);
    if (ok) {
      logger(`[ok] found older msg => ID=${testId}`);
      foundAny = true;
      break;
    } else {
      logger(`Try next => ${testId - 1}`);
    }
  }
  if (!foundAny) logger("No older ID found or limit insufficient.");
}

async function forwardContinuation(attackerId, startId, logger, addCaptured, userInfo) {
  const userState = getUserState(userInfo.userKey);
  const maxId = userState.lastMessageId || 0;
  let successCount = 0;
  let attemptCount = 0;

  for (let msgId = startId; msgId <= maxId; msgId++) {
    if (userState.stopFlag) {
      userState.stoppedId = msgId;
      logger(`[stop] stopped at ID=${msgId}`);
      break;
    }
    attemptCount++;
    const ok = await forwardMsg(userState.botToken, attackerId, userState.myChatId, msgId, logger, addCaptured, userInfo);
    if (ok) successCount++;
  }

  if (!userState.stopFlag) {
    logger(`[result] forwarded up to ID ${maxId}, success=${successCount}`);
  } else {
    logger(`[result] stopped at ID=${userState.stoppedId}, success=${successCount} => resume if needed.`);
  }
}

// =====================================================================
// Routes
// =====================================================================
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "./public" });
});

app.get("/api/accounts", (req, res) => {
  res.json({ accounts: clients.map((c, i) => ({ index: i, label: c.label })) });
});

app.get("/api/status", (req, res) => {
  const userState = getUserState(userKeyOf(req));
  res.json({
    db: dbEnabled,
    accounts: clients.length,
    operation: {
      isRunning: userState.isOperationRunning,
      hasBotToken: !!userState.botToken,
      botUsername: userState.botUsername || null,
    },
  });
});

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || "";
  if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return true;
  return process.env.MATKAP_TRUST_LOCAL_PROXY === "true"
    && ["127.0.0.1", "localhost", "::1"].includes(String(req.hostname || "").toLowerCase());
}

function requireLoopback(req, res, next) {
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: "MCP ingestion is local-only." });
  next();
}

function aiEnabled() {
  return process.env.MATKAP_AI_ENABLED !== "false";
}

const toolHub = createToolHub({
  async publishResult(result) {
    const grouped = new Map();
    for (const finding of result.findings || []) {
      const source = String(finding.source || "mcp-tool-hub");
      const list = grouped.get(source) || [];
      list.push(finding);
      grouped.set(source, list);
    }

    let accepted = 0;
    for (const [source, findings] of grouped) {
      const stored = ingestFindings({
        source,
        artifact: result.servers?.join(",") || "connected-mcp-projects",
        findings,
        metadata: { provider: result.provider, model: result.model, calls: result.calls?.length || 0 },
      });
      accepted += stored.accepted;
    }

    return { accepted };
  },
});

app.post("/api/mcp/probe", requireLoopback, async (req, res) => {
  try {
    res.json({ connections: await toolHub.probeAll() });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error).slice(0, 500) });
  }
});

app.post("/api/mcp/scan", requireLoopback, async (req, res) => {
  const requested = String(req.body?.provider || "").trim().toLowerCase();
  const provider = aiEnabled() && requested ? (resolveProviders([requested], "single")[0] || null) : null;
  try {
    let model = "";
    if (provider === ORCAROUTER_PROVIDER_ID) {
      const requestedModel = String(req.body?.model || "").trim();
      if (requestedModel) {
        // The dropdown is the source of truth; re-validate server-side so an
        // arbitrary model string can never reach the gateway.
        const catalog = await getOrcaRouterCatalog({ capability: "chat" });
        model = assertCompatibleModel(catalog.models, requestedModel, { capability: "chat" }).id;
      }
    }
    res.status(202).json({ job: toolHub.startScan({ provider, model }) });
  } catch (error) {
    res.status(error.code === "SCAN_BUSY" ? 409 : 400).json({ error: String(error.message || error).slice(0, 500) });
  }
});

app.get("/api/mcp/scans/:id", requireLoopback, (req, res) => {
  const job = toolHub.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "MCP investigation job not found." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ job });
});

app.get("/api/mcp/status", requireLoopback, (req, res) => {
  const currentFindings = listPublicFindings();
  void toolHub.probeAll();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    localOnly: true,
    connections: toolHub.listStatus(),
    findings: currentFindings.length,
    tokens: currentFindings.filter((item) => item.kind === "bot_token").length,
    chatIds: currentFindings.filter((item) => item.kind === "chat_id").length,
  });
});

app.get("/api/mcp/findings", requireLoopback, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ findings: listPublicFindings() });
});

app.get("/api/ai/providers", requireLoopback, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    enabled: aiEnabled(),
    primary: process.env.MATKAP_AI_PRIMARY || "openai",
    providers: listProviderStatus(),
  });
});

const ORCAROUTER_CAPABILITIES = new Set(["chat", "embedding", "image", "video", "rerank"]);

// Server-side model discovery: the browser receives minimal metadata only, never
// the OrcaRouter API key.
app.get("/api/ai/models", requireLoopback, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const provider = String(req.query.provider || ORCAROUTER_PROVIDER_ID).trim().toLowerCase();
  if (provider !== ORCAROUTER_PROVIDER_ID) {
    return res.status(400).json({ error: "Model discovery is only available for OrcaRouter." });
  }
  const capability = String(req.query.capability || "chat").trim().toLowerCase();
  if (!ORCAROUTER_CAPABILITIES.has(capability)) {
    return res.status(400).json({ error: "Unsupported capability." });
  }
  try {
    const catalog = await getOrcaRouterCatalog({ capability, refresh: req.query.refresh === "1" });
    res.json(publicCatalogPayload(catalog));
  } catch (error) {
    res.status(502).json({ error: String(error?.message || error).slice(0, 300) });
  }
});

app.get("/api/orcarouter/credential", requireLoopback, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(orcaRouterCredentialStatus(process.env));
});

app.post("/api/orcarouter/credential", requireLoopback, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const status = await saveOrcaRouterApiKey(req.body?.apiKey);
    res.json({ ...status, saved: true });
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error).slice(0, 300) });
  }
});

app.delete("/api/orcarouter/credential", requireLoopback, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const status = await clearOrcaRouterApiKey();
    res.json({ ...status, cleared: true });
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 300) });
  }
});

app.post("/api/mcp/findings/:id/reveal", requireLoopback, (req, res) => {
  const finding = revealFinding(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ finding });
});

app.delete("/api/mcp/findings", requireLoopback, (req, res) => {
  res.json({ ok: true, removed: clearFindings() });
});

app.get("/logs", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ logs: getUserState(userKeyOf(req)).logs });
});

app.get("/messages", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const messages = getUserState(userKeyOf(req)).capturedMessages.map(({ toChatId, ...rest }) => rest);
  res.json({ messages });
});

app.post("/clearLogs", (req, res) => {
  getUserState(userKeyOf(req)).logs.length = 0;
  res.json({ ok: true });
});

app.post("/clearMessages", (req, res) => {
  getUserState(userKeyOf(req)).capturedMessages.length = 0;
  res.json({ ok: true });
});

app.post("/stop", (req, res) => {
  const userState = getUserState(userKeyOf(req));
  userState.stopFlag = true;
  userState.isOperationRunning = false;
  userState.logs.push("[stop] user request");
  res.json({ success: true });
});

app.get("/download", async (req, res) => {
  const fileId = req.query.fileId;
  const userState = getUserState(userKeyOf(req));
  if (!fileId) return res.status(400).send("fileId is required.");
  const botToken = userState.botToken;
  if (!botToken) return res.status(400).send("No bot token. Run a hunt first.");

  try {
    const fileResp = await fetch(`${TELEGRAM_API_URL}${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResp.json();
    if (!fileData.ok) return res.status(400).send("Could not fetch file info.");
    const filePath = fileData.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const fileFetchResp = await fetch(downloadUrl);
    res.setHeader("Content-Type", fileFetchResp.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=" + filePath.split("/").pop());
    fileFetchResp.body.pipe(res);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Download error.");
  }
});

app.post(
  "/startInfiltration",
  [
    body("botTokenRaw").isString().notEmpty().trim(),
    body("attackerChatId").optional({ nullable: true }),
    body("accountIndex").optional({ nullable: true }).isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });

    const userKey = userKeyOf(req);
    const userState = getUserState(userKey);

    if (userState.isOperationRunning) {
      return res.status(409).json({ error: "An operation is already running. Stop it first." });
    }

    const { botTokenRaw, attackerChatId, accountIndex } = req.body;

    const picked = pickClient(typeof accountIndex === "number" ? accountIndex : parseInt(accountIndex, 10));
    if (!picked) return res.status(400).json({ error: "No Telegram controller account configured." });
    userState.client = picked.entry.client;
    userState.accountIndex = picked.idx;

    userState.isOperationRunning = true;
    const logs = userState.logs;
    const captured = userState.capturedMessages;

    try {
      let parsed = botTokenRaw.trim();
      if (parsed.toLowerCase().startsWith("bot")) parsed = parsed.slice(3);

      const info = await getMe(parsed);
      if (!info) {
        logs.push("[fail] getMe => invalid token");
        return res.status(400).json({ error: "getMe failed - invalid token" });
      }
      let botUser = info.username;
      if (!botUser) {
        logs.push("[fail] no username in getMe");
        return res.status(400).json({ error: "No username" });
      }

      userState.botToken = parsed;
      userState.botUsername = botUser;
      logs.push(`[ok] getMe => @${botUser} (account: ${picked.entry.label})`);

      await saveLog({
        userKey,
        botToken: parsed,
        botUsername: botUser,
        chatId: attackerChatId,
        logType: "hunting_start",
        message: `Started hunting bot @${botUser}`,
      });

      try {
        if (!botUser.startsWith("@")) botUser = "@" + botUser;
        await picked.entry.client.sendMessage(botUser, { message: "/start" });
        logs.push("[ok] '/start' sent");
      } catch (err) {
        logs.push(`[fail] send /start error => ${err}`);
      }

      const { chatId, msgId } = await getUpdates(parsed);
      if (!chatId || !msgId) {
        logs.push("[fail] no valid getUpdates result");
        return res.status(400).json({ error: "No getUpdates result" });
      }

      userState.myChatId = chatId;
      userState.lastMessageId = msgId;
      logs.push(`[info] infiltration ready, lastMsgId=${msgId}`);

      if (attackerChatId) {
        userState.stopFlag = false;
        const userInfo = { userKey };
        infiltrationProcess(attackerChatId, (m) => logs.push(m), (c) => captured.push(c), userInfo);
      } else {
        logs.push("No attackerChatId provided => skipping older ID check");
      }

      res.json({ success: true, botUser, myChatId: chatId, lastMessageId: msgId, account: picked.entry.label });
    } finally {
      userState.isOperationRunning = false;
    }
  }
);

app.post(
  "/forwardAll",
  [body("attackerChatId").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });

    const userKey = userKeyOf(req);
    const userState = getUserState(userKey);

    if (userState.isOperationRunning) {
      return res.status(409).json({ error: "An operation is already running. Stop it first." });
    }

    const { attackerChatId } = req.body;
    const logs = userState.logs;
    const captured = userState.capturedMessages;

    if (!userState.botToken || !userState.botUsername || !userState.myChatId || !userState.lastMessageId) {
      logs.push("Need infiltration first!");
      return res.status(400).json({ error: "Run Start first" });
    }
    if (!attackerChatId) return res.status(400).json({ error: "Empty attackerChatId" });

    userState.isOperationRunning = true;
    try {
      await saveLog({
        userKey,
        botToken: userState.botToken,
        botUsername: userState.botUsername,
        chatId: attackerChatId,
        logType: "forward_all",
        message: `Forward all messages to ${attackerChatId}`,
      });

      userState.stopFlag = false;
      userState.stoppedId = 0;
      forwardContinuation(attackerChatId, 1, (m) => logs.push(m), (c) => captured.push(c), { userKey });
      res.json({ success: true });
    } finally {
      userState.isOperationRunning = false;
    }
  }
);

app.post("/resume", [body("attackerChatId").notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });

  const userKey = userKeyOf(req);
  const userState = getUserState(userKey);

  if (userState.isOperationRunning) {
    return res.status(409).json({ error: "An operation is already running. Stop it first." });
  }

  const { attackerChatId } = req.body;
  const logs = userState.logs;
  const captured = userState.capturedMessages;

  if (!userState.botToken || !attackerChatId) {
    logs.push("Need Start and attackerChatId first!");
    return res.status(400).json({ error: "Missing botToken or attackerChatId" });
  }

  userState.isOperationRunning = true;
  try {
    logs.push(`[resume] from ID=${userState.stoppedId + 1}`);
    userState.stopFlag = false;
    forwardContinuation(attackerChatId, userState.stoppedId + 1, (m) => logs.push(m), (c) => captured.push(c), { userKey });
    res.json({ success: true });
  } finally {
    userState.isOperationRunning = false;
  }
});

// =====================================================================
// IOC discovery (threat-intel sources -> Telegram bot token / chat id)
// =====================================================================

// Optional: fetch a discovered URL directly and return its text so the parser
// can run on it. This makes FOFA/ZoomEye usable on free tiers (which withhold
// the body field) but reveals THIS server's IP to the (often malicious) host.
async function fetchBody(url) {
  if (!/^https?:\/\//i.test(url || "")) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MatkapIOC/1.0)" },
    });
    clearTimeout(timer);
    if (!resp.ok) return "";
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.slice(0, 512 * 1024).toString("utf8");
  } catch (e) {
    return "";
  }
}

app.get("/api/ioc/sources", (req, res) => {
  res.json({ sources: listSources() });
});

// TweetFeed: potential Telegram-bot C2 threats reported on Twitter/X (free).
app.get("/api/tweetfeed", async (req, res) => {
  const time = req.query.time || "week";
  try {
    const data = await fetchTelegramThreats({ time });
    res.json(data);
  } catch (err) {
    console.error("[tweetfeed] error:", err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

// MalwareBazaar: which of the given file hashes have a sample on abuse.ch.
app.post("/api/malwarebazaar/check", [body("hashes").isArray()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });
  try {
    const data = await checkHashes(req.body.hashes || []);
    res.json(data);
  } catch (err) {
    console.error("[malwarebazaar] error:", err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

async function readMalwareBazaarTelegramCache() {
  if (malwareBazaarTelegramCache) return malwareBazaarTelegramCache;
  const stored = await getFeedCache("malwarebazaar_telegram_yara");
  if (!stored) return null;
  malwareBazaarTelegramCache = {
    data: stored.data,
    updatedAt: new Date(stored.updated_at).toISOString(),
  };
  return malwareBazaarTelegramCache;
}

async function refreshMalwareBazaarTelegramFeed() {
  if (malwareBazaarTelegramRefresh) return malwareBazaarTelegramRefresh;
  malwareBazaarTelegramRefresh = (async () => {
    const data = await fetchRecentTelegramMalware({ days: 30 });
    const updatedAt = new Date().toISOString();
    malwareBazaarTelegramCache = { data, updatedAt };
    await saveFeedCache("malwarebazaar_telegram_yara", data);
    console.log(`[malwarebazaar] telegram_bot_api YARA feed cached (${data.count} samples)`);
    return malwareBazaarTelegramCache;
  })();
  try {
    return await malwareBazaarTelegramRefresh;
  } finally {
    malwareBazaarTelegramRefresh = null;
  }
}

// Metadata only: recent samples matching MalwareBazaar's telegram_bot_api YARA rule.
app.get("/api/malwarebazaar/telegram", async (req, res) => {
  const configured = Boolean(process.env.ABUSECH_AUTH_KEY);
  let cache = await readMalwareBazaarTelegramCache();
  const stale = !cache
    || Number(cache.data?.window_days || 0) < 30
    || Date.now() - new Date(cache.updatedAt).getTime() >= MALWAREBAZAAR_REFRESH_MS;
  let refreshError = null;
  if (stale && configured) {
    try {
      cache = await refreshMalwareBazaarTelegramFeed();
    } catch (err) {
      console.error("[malwarebazaar] telegram YARA feed error:", err);
      refreshError = String(err.message || err);
      if (!cache) return res.status(502).json({ configured, cached: false, error: refreshError, results: [] });
    }
  }
  if (!cache) {
    return res.json({
      configured,
      cached: false,
      updated_at: null,
      refresh_interval_hours: 3,
      window_days: 14,
      yara_rule: "telegram_bot_api",
      count: 0,
      results: [],
    });
  }
  const nextUpdate = new Date(new Date(cache.updatedAt).getTime() + MALWAREBAZAAR_REFRESH_MS).toISOString();
  const results = filterSamplesByDays(cache.data.results, 14);
  res.json({
    configured,
    cached: true,
    stale: Boolean(refreshError),
    refresh_error: refreshError,
    updated_at: cache.updatedAt,
    next_update_at: nextUpdate,
    refresh_interval_hours: 3,
    ...cache.data,
    count: results.length,
    window_days: 14,
    results,
  });
});

app.get("/api/statistics/threats", async (req, res) => {
  const days = Number(req.query.days);
  if (![7, 14, 30].includes(days)) return res.status(400).json({ error: "days must be 7, 14, or 30" });
  let malwareCache = await readMalwareBazaarTelegramCache();
  const malwareStale = !malwareCache
    || Number(malwareCache.data?.window_days || 0) < 30
    || Date.now() - new Date(malwareCache.updatedAt).getTime() >= MALWAREBAZAAR_REFRESH_MS;
  if (malwareStale && process.env.ABUSECH_AUTH_KEY) {
    try {
      malwareCache = await refreshMalwareBazaarTelegramFeed();
    } catch (err) {
      console.error("[statistics] MalwareBazaar refresh error:", err.message);
    }
  }
  const [newsCache, tweetCache] = await Promise.all([
    readCachedFeed("news"),
    readCachedFeed("tweetfeed"),
  ]);
  const statistics = buildThreatStatistics({
    days,
    malwareSamples: malwareCache?.data?.results || [],
    reports: newsCache?.data?.results || [],
    feedItems: tweetCache?.data?.results || [],
  });
  res.json({
    ...statistics,
    sources: {
      malwarebazaar: { updated_at: malwareCache?.updatedAt || null, yara_rule: "telegram_bot_api" },
      reports: { updated_at: newsCache?.updated_at || null },
      feed: { updated_at: tweetCache?.updated_at || null, window: tweetCache?.data?.window || null },
    },
  });
});

// TI-report dorking: hunt Telegram-bot C2 write-ups in news/vendor blogs (free).
app.get("/api/news/sources", (req, res) => {
  res.json({ sources: NEWS_SOURCES });
});

app.post(
  "/api/news/search",
  [
    body("sources").optional({ nullable: true }).isArray(),
    body("minScore").optional({ nullable: true }).isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });
    try {
      const data = await runNewsHunt({
        sources: req.body.sources,
        minScore: req.body.minScore || undefined,
      });
      res.json(data);
    } catch (err) {
      console.error("[news] error:", err);
      res.status(502).json({ error: String(err.message || err) });
    }
  }
);

app.post(
  "/api/ioc/search",
  [
    body("source").isString().notEmpty(),
    body("query").optional({ nullable: true }).isString(),
    body("size").optional({ nullable: true }).isInt({ min: 1, max: 500 }),
    body("fetchLinks").optional({ nullable: true }).isBoolean(),
    body("resolveTokens").optional({ nullable: true }).isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });

    const { source, query, size } = req.body;
    const fetchLinks = req.body.fetchLinks === true;
    const resolveTokens = req.body.resolveTokens === true;
    const src = SOURCES[source];
    if (!src) return res.status(400).json({ error: `Unknown source: ${source}` });

    const key = process.env[src.keyEnv];
    if (!key) return res.status(400).json({ error: `${src.label} is not configured (set ${src.keyEnv} in .env).` });

    try {
      const rows = await src.search({
        key,
        query: query || src.defaultQuery,
        size: size || 100,
      });

      const FETCH_CAP = 60;
      let fetchedCount = 0;
      const results = [];
      let tokenCount = 0;
      for (const row of rows) {
        let combined = row.body || "";
        let iocs = extractTelegramIOCs(combined);

        // Free-tier fallback: if the source gave no body/token but a link, and
        // the user opted in, fetch the page ourselves and parse that.
        if (!iocs.tokens.length && fetchLinks && row.link && fetchedCount < FETCH_CAP) {
          fetchedCount++;
          const extra = await fetchBody(row.link);
          if (extra) {
            combined = combined + "\n" + extra;
            iocs = extractTelegramIOCs(combined);
          }
        }

        if (!iocs.tokens.length) continue;
        tokenCount += iocs.tokens.length;
        results.push({
          host: row.host,
          ip: row.ip,
          port: row.port,
          link: row.link,
          title: row.title,
          date: row.date || null,
          tokens: iocs.tokens,
          chatIds: iocs.chatIds,
          pairs: iocs.pairs,
        });
      }

      // Optional: query each bot (getMe + getUpdates) to validate it and recover
      // a chat id when the source did not carry one (e.g. ThreatFox).
      if (resolveTokens && results.length) {
        const uniq = new Map();
        for (const r of results) for (const p of r.pairs) if (p.token && !uniq.has(p.token)) uniq.set(p.token, null);
        const tokens = [...uniq.keys()].slice(0, 50);
        let i = 0;
        const CONC = 5;
        await Promise.all(
          Array.from({ length: Math.min(CONC, tokens.length) }, async () => {
            while (i < tokens.length) {
              const t = tokens[i++];
              uniq.set(t, await enrichToken(t));
            }
          })
        );
        for (const r of results)
          for (const p of r.pairs) {
            const info = uniq.get(p.token);
            if (info) {
              p.valid = info.valid;
              p.botUsername = info.username;
              if (!p.chatId && info.chatId) p.chatId = info.chatId;
            }
          }
      }

      res.json({
        source,
        scanned: rows.length,
        fetched: fetchedCount,
        resolved: resolveTokens,
        withTokens: results.length,
        tokenCount,
        results,
      });
    } catch (err) {
      console.error(`[ioc/${source}] error:`, err);
      res.status(502).json({ error: String(err.message || err) });
    }
  }
);

// =====================================================================
// Monitor: hijack a live bot's incoming update stream for N seconds, capturing
// every message (chat_id + text/file) into the session's captured list + DB.
// =====================================================================
async function monitorToken(userKey, token, seconds) {
  const userState = getUserState(userKey);
  userState.botToken = token;
  userState.monitorRunning = true;
  userState.stopFlag = false;
  const logs = userState.logs;
  const captured = userState.capturedMessages;
  logs.push(`[monitor] started for ${seconds}s`);
  await deleteWebhookSilent(token);

  let offset = 0;
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline && userState.monitorRunning && !userState.stopFlag) {
    try {
      const resp = await fetch(`${TELEGRAM_API_URL}${token}/getUpdates?offset=${offset}&timeout=15&limit=50`);
      const data = await resp.json();
      if (data.ok && Array.isArray(data.result) && data.result.length) {
        for (const u of data.result) {
          offset = u.update_id + 1;
          const m = u.message || u.edited_message || u.channel_post;
          if (!m) continue;
          const chatId = m.chat && m.chat.id;
          let content = m.text || m.caption || "";
          let fileId = null;
          let fileType = null;
          if (m.document) { content = `[Document] ${m.document.file_name || ""}`.trim(); fileId = m.document.file_id; fileType = "document"; }
          else if (m.photo) { const p = m.photo[m.photo.length - 1]; content = `[Photo] ${p.file_size || ""}`.trim(); fileId = p.file_id; fileType = "photo"; }
          else if (m.video) { content = `[Video] ${m.video.duration || ""}s`; fileId = m.video.file_id; fileType = "video"; }
          else if (m.audio) { content = `[Audio] ${m.audio.title || ""}`.trim(); fileId = m.audio.file_id; fileType = "audio"; }
          else if (m.voice) { content = `[Voice] ${m.voice.duration || ""}s`; fileId = m.voice.file_id; fileType = "voice"; }
          else if (!content) content = "[non-text update]";
          captured.push({
            messageId: m.message_id,
            fromChatId: chatId,
            timestamp: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(),
            content,
            fileId,
          });
          logs.push(`[monitor] captured chat_id=${chatId} from ${m.from ? "@" + (m.from.username || m.from.id) : "?"} => ${content.slice(0, 60)}`);
          try {
            await saveCapturedMessage({
              userKey, botToken: token, messageId: m.message_id,
              fromId: m.from && String(m.from.id), chatId: chatId != null ? String(chatId) : null,
              messageText: content, fileId, fileType, rawData: u,
            });
          } catch (e) { /* db best-effort */ }
        }
      } else if (data.error_code === 409) {
        await deleteWebhookSilent(token);
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  userState.monitorRunning = false;
  logs.push("[monitor] finished");
}

app.post(
  "/api/monitor/start",
  [body("token").isString().notEmpty().trim(), body("seconds").optional({ nullable: true }).isInt({ min: 5, max: 43200 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input", details: errors.array() });
    const userKey = userKeyOf(req);
    const userState = getUserState(userKey);
    if (userState.monitorRunning) return res.status(409).json({ error: "A monitor is already running." });
    let token = req.body.token.trim();
    if (token.toLowerCase().startsWith("bot")) token = token.slice(3);
    const seconds = Math.min(43200, Math.max(5, parseInt(req.body.seconds, 10) || 600));
    const info = await getMe(token);
    if (!info) return res.status(400).json({ error: "Invalid or dead bot token." });
    monitorToken(userKey, token, seconds);
    res.json({ success: true, botUsername: info.username, seconds });
  }
);

app.post("/api/monitor/stop", (req, res) => {
  const userState = getUserState(userKeyOf(req));
  userState.monitorRunning = false;
  userState.logs.push("[monitor] stop requested");
  res.json({ success: true });
});

async function writeCachedFeed(key, data) {
  const updated_at = new Date().toISOString();
  feedMemoryCache.set(key, { data, updated_at });
  await saveFeedCache(key, data);
  return feedMemoryCache.get(key);
}

async function readCachedFeed(key) {
  if (feedMemoryCache.has(key)) return feedMemoryCache.get(key);
  const stored = await getFeedCache(key);
  if (stored) feedMemoryCache.set(key, stored);
  return stored;
}

// Cached feeds (refreshed every 10 minutes, stored in memory and optionally DB).
app.get("/api/feeds/:key", async (req, res) => {
  const key = req.params.key;
  if (!["tweetfeed", "news"].includes(key)) return res.status(400).json({ error: "unknown feed" });
  const c = await readCachedFeed(key);
  if (!c) return res.json({ cached: false, updated_at: null });
  res.json({ cached: true, updated_at: c.updated_at, ...c.data });
});

async function refreshFeeds() {
  try {
    const tf = await fetchTelegramThreats({ time: "month" });
    await writeCachedFeed("tweetfeed", tf);
    console.log(`[feeds] tweetfeed cached (${tf.count} matches)`);
  } catch (e) {
    console.error("[feeds] tweetfeed refresh error:", e.message);
  }
  try {
    const nw = await runNewsHunt({});
    await writeCachedFeed("news", nw);
    console.log(`[feeds] news cached (${nw.count} reports)`);
  } catch (e) {
    console.error("[feeds] news refresh error:", e.message);
  }
}

// =====================================================================
async function startServer() {
  await initDatabase();
  if (process.env.MATKAP_DISABLE_TELEGRAM !== "true") await connectAccounts();
  else console.log("Telegram controller disabled for local MCP mode.");
  app.listen(PORT, HOST, () => {
    console.log(`Matkap web running on http://${HOST}:${PORT}`);
  });
  if (process.env.MATKAP_DISABLE_FEEDS !== "true") {
    refreshFeeds();
    setInterval(refreshFeeds, 10 * 60 * 1000);
    if (process.env.ABUSECH_AUTH_KEY) {
      refreshMalwareBazaarTelegramFeed().catch((e) => {
        console.error("[malwarebazaar] telegram YARA refresh error:", e.message);
      });
      setInterval(() => {
        refreshMalwareBazaarTelegramFeed().catch((e) => {
          console.error("[malwarebazaar] telegram YARA refresh error:", e.message);
        });
      }, MALWAREBAZAAR_REFRESH_MS);
    }
  }
}

startServer();
