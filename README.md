# Matkap Web

Hunt down malicious Telegram bots used as malware command-and-control (C2).

Matkap is the web version of [0x6rss/matkap](https://github.com/0x6rss/matkap).
A lot of commodity malware (stealers, RATs) exfiltrates stolen data to a
Telegram **bot** and reads it from a private chat. If you recover that bot's
token, Matkap lets you validate it, recover the operator's data, monitor the
bot live, and discover more leaked tokens from threat-intel sources.

This is a defensive Telegram threat-hunting tool, not a malware-analysis
engine. Use it only on projects and tokens you are authorized to investigate.

## Features

- **Hunt** — with a bot token (and the operator's chat id) forward the operator's
  messages/files into your own chat via `forwardMessage`.
- **IOC Discovery** — find leaked bot tokens across ThreatFox / urlscan / ZoomEye;
  optionally validate them (`getMe`) and resolve chat ids (`getUpdates`).
- **Monitor** — hijack a live bot's incoming update stream (10 min / 1 h / 12 h)
  to capture new exfil messages + chat ids in real time.
- **Threat Feeds** — TweetFeed (Twitter/X) and TI-report dorking of vendor blogs.
- **MalwareBazaar** — automatically track the last 14 days of samples matching
  the `telegram_bot_api` YARA rule, plus manually check report hashes.
- **JADX MCP connector** — inspect the Android project already open in JADX
  through local, read-only tools. Ghidra and Binary Ninja support is coming soon.
- **Multi-model AI investigation** — use OpenAI, Claude, Gemini, Grok, Kimi,
  DeepSeek, or [OrcaRouter](https://www.orcarouter.ai); only exact,
  format-validated Telegram credentials enter the findings view.
- **Threat statistics** — use the sidebar tab directly below MCP Lab to combine
  MalwareBazaar YARA metadata, TweetFeed, and dated TI reports into 7/14/30-day
  type, family, filename, campaign, source, and daily-activity charts.
- Feeds auto-refresh every 10 minutes and are cached in the database.

## Interface

The screenshots below show MATKAP's main workspaces. Any indicators or expired
credentials visible in these examples are historical test data; `.env` values,
provider API keys, Telegram string sessions, and personal account details are
not included.

### Hunt workspace

![MATKAP Hunt workspace](docs/screenshots/hunt.png)

Validate an authorized bot token, start or pause an investigation, forward
messages, and review operation logs and captured content from one workspace.

### IOC Discovery

![MATKAP IOC Discovery](docs/screenshots/ioc-discovery.png)

Search supported intelligence sources for exposed Telegram bot artifacts,
optionally validate results, resolve chat IDs, and send a result to Hunt.

### Telegram C2 Threat Feed

![MATKAP Telegram C2 Threat Feed](docs/screenshots/threat-feed.png)

Review community-reported Telegram C2 indicators, related infrastructure,
malware tags, and links back to the original public reports.

### TI Report Dorking

![MATKAP TI Report Dorking](docs/screenshots/ti-report-dorking.png)

Search selected threat-intelligence publishers and rank reports by Telegram C2
signals such as bot API endpoints, bot references, chat IDs, and send methods.

### MalwareBazaar

![MATKAP MalwareBazaar feed](docs/screenshots/malwarebazaar.png)

Track metadata for recent samples matched by MalwareBazaar's
`telegram_bot_api` YARA rule without downloading malware files.

### MCP Lab

![MATKAP MCP Lab](docs/screenshots/mcp-lab.png)

Connect to the packaged read-only JADX MCP connector, scan the project already
open in JADX, and optionally use a configured AI provider as a fallback.

### Threat Statistics

![MATKAP Threat Statistics](docs/screenshots/threat-statistics.png)

Explore 7, 14, or 30-day malware, feed, family, campaign, and daily-activity
statistics assembled from cached MATKAP data sources.

## How the hunt works

1. You provide a **bot token** (recovered from a malware sample or IOC Discovery).
2. Matkap validates it (`getMe`) and, using a Telegram **user account** you
   control, sends `/start` to the bot to trigger an update.
3. `getUpdates` reveals the operator's chat id and the latest message id.
4. Using the bot token's `forwardMessage` privilege, Matkap forwards the
   operator's messages into your own chat, capturing text and files.

## Requirements

- Node.js 20+
- PostgreSQL is optional. Without `DATABASE_URL`, MCP findings run in memory.
- Docker Desktop is needed only when using the included PostgreSQL container or
  running the complete Docker Compose stack.
- A Telegram **user account** (not a bot) to act as the controller, plus its
  `api_id` / `api_hash` from https://my.telegram.org

## Quick start on Windows

```powershell
git clone https://github.com/0x6rss/matkap.git
cd matkap
npm install
Copy-Item .env.example .env
```

On Linux or macOS, use `cp .env.example .env` instead of `Copy-Item`.

### 1. Database (optional)

A ready-to-use PostgreSQL database is provided through Docker. Skip this entire
step if persistence is not needed; MATKAP will still run, but captured logs and
feed caches will exist only in memory and are lost when the server stops.

To start only PostgreSQL on local port 5433:

```powershell
docker compose up -d db
```

Then set in `.env`:

```
DATABASE_URL=postgres://matkap:matkap@localhost:5433/matkap
```

The database is reachable only from this computer. Any other reachable
PostgreSQL instance can be used; MATKAP creates its required tables on start.

### 2. Telegram API credentials

Log in at https://my.telegram.org -> API development tools, and copy your
`api_id` and `api_hash` into `.env`:

```
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1555...
```

### 3. Log in to Telegram (one time)

Leave `TELEGRAM_STRING_SESSION` empty and start the app in a local terminal
with `NODE_ENV=development` (the provided default). MATKAP asks for the login
code sent by Telegram and, if enabled on the account, the 2FA password:

```bash
npm start
# Enter the Telegram login code: 12345
# Enter Telegram 2FA password (if requested)
# [default] Login OK. String session saved to .env for future starts.
```

MATKAP writes the generated `TELEGRAM_STRING_SESSION` directly to `.env`
without printing it. Later `npm start` runs reuse that session and do not ask
for a code. If Telegram invalidates the saved session, development mode asks
you to log in again and replaces it automatically. Keep `.env` private and
never commit or share it.

### 4. Single account vs. multiple accounts

**Single account** — just fill the fields above.

**Multiple accounts** — set `TELEGRAM_ACCOUNTS` to a JSON array (this overrides
the single-account fields). On first login, include `phone` and leave
`stringSession` empty for each account. MATKAP saves each generated session back
into the JSON value in `.env`. The UI shows an account selector; the server
round-robins if you do not pick one:

```
TELEGRAM_ACCOUNTS=[{"label":"acc1","apiId":"111","apiHash":"aaa","phone":"+15550000001","stringSession":""},{"label":"acc2","apiId":"222","apiHash":"bbb","phone":"+15550000002","stringSession":""}]
```

## Run

```powershell
npm start
# open http://localhost:3000
```

For the complete Docker stack, first complete the one-time Telegram login above
with `npm start`, then stop it with `Ctrl+C`. The generated session is now in
`.env`, so the container will not need an interactive login. Start the app and
database with:

```powershell
docker compose up --build
```

Open http://localhost:3000. Both the web application and PostgreSQL published
ports are restricted to `127.0.0.1` by the provided Compose configuration.

## JADX connector

The current release supports **JADX only**. Ghidra and Binary Ninja connectors
are shown as **SOON** and will be added later. MATKAP does not execute or upload
the APK; it reads the project already open in JADX through a local connector.

### End-user installation on Windows

1. Download `MATKAP-JADX-Connector-6.4.1.zip` from GitHub Releases or from
   [`connectors/jadx/dist`](connectors/jadx/dist/MATKAP-JADX-Connector-6.4.1.zip)
   in the cloned repository.
2. Extract the ZIP and close JADX if it is open.
3. Open PowerShell in the extracted folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

4. Reopen JADX and load the APK.
5. In MATKAP, open **MCP Lab**, click **Connect JADX**, then click
   **Scan open JADX project**.

That is the entire connector setup. End users do not compile anything and do
not install Maven, Python, Node.js, or a separate MCP bridge for the connector.
The ZIP contains the ready JAR, installer, SHA-256 checksum, license, and notice.

When running directly from this repository, the same installer is available at:

```powershell
powershell -ExecutionPolicy Bypass -File .\connectors\jadx\install.ps1
```

MATKAP's default connector configuration is:

```env
JADX_MCP_URL=http://127.0.0.1:8650
JADX_MCP_TRANSPORT=jadx-rest
```

The installer verifies the packaged JAR's SHA-256 and backs up an existing
`jadx-ai-mcp.jar` before replacing it. The endpoint listens only on the local
machine. APK resources are size-limited, treated as data, and never executed.
MATKAP first scans likely text resources locally; enable **Use AI fallback after
local scan** only when deeper source analysis is wanted.

### AI provider

Add at least one provider key to `.env` (choose whichever provider you use):

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
KIMI_API_KEY=
DEEPSEEK_API_KEY=
ORCAROUTER_API_KEY=
```

An AI key is optional for the local deterministic MCP preflight. It is used only
when **Use AI fallback after local scan** is explicitly enabled and the preflight
cannot recover an exact token and chat ID.

The bundled adapters use each provider's REST API. Every default model and
endpoint can be overridden with `<PROVIDER>_MODEL` and `<PROVIDER>_BASE_URL`;
see `.env.example` for the complete list. Choose one configured provider in
**MCP Lab**, enable the AI fallback checkbox, and click **Scan open JADX project**.

#### OrcaRouter

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible AI gateway that
routes many providers behind one endpoint. MATKAP registers it as its own named
provider (`orcarouter`), separate from every direct provider above:

- Inference and model discovery use `https://api.orcarouter.ai/v1`.
  `ORCAROUTER_BASE_URL` (or `ORCAROUTER_API_BASE_URL` / the shared
  `ORCA_BASE_URL`) overrides it for self-hosted gateways; remote origins must be
  HTTPS and plain HTTP is accepted only for loopback development.
- Add `ORCAROUTER_API_KEY` to `.env`, or open **MCP Lab → AI Provider →
  OrcaRouter** and use the **API key** field. The key is stored in `.env`
  (mode `0600`) by the same helper that persists the Telegram session; it never
  reaches the browser, logs, or error messages. **Clear** removes it.
- Selecting OrcaRouter loads the live `GET /v1/models?capability=chat` list from
  the gateway and renders it as a model dropdown on the server side of the key
  boundary. Only models that advertise an OpenAI/Anthropic/Gemini/Responses
  endpoint are listed, and models dedicated to image, video, rerank, or embedding
  routes are excluded. The selected model is re-validated by the server before a
  scan starts. If discovery fails, MATKAP marks the list as degraded and falls
  back to a small verified seed (`openai/gpt-5.5`, `anthropic/claude-opus-4.8`,
  `google/gemini-3.5-flash`, `deepseek/deepseek-v4-pro`, `orcarouter/auto`)
  instead of falling back to free-text model entry.
- A rejected key (`401`) produces an actionable "update or clear the key"
  message; it is never retried in a loop and the key is not echoed.

Provider output is treated as untrusted: candidates must match MATKAP's exact
Telegram token/chat-id formats before storage. Dashboard bot tokens stay masked
until the local user clicks **Reveal**.

For a lightweight MCP-only launch, set:

```env
MATKAP_DISABLE_DATABASE=true
MATKAP_DISABLE_TELEGRAM=true
MATKAP_DISABLE_FEEDS=true
```

Run the MCP and mocked provider-adapter tests with `npm test`.

## Dashboard

The UI is organised into tabs:

- **Hunt** — the control panel + operation logs + captured messages.
- **IOC Discovery** — find leaked tokens (see below).
- **Threat Feeds** — TweetFeed + TI Report Dorking.
- **MalwareBazaar** — check report hashes on abuse.ch.

### Hunt

1. (If multiple accounts) pick a controller account.
2. Paste the **bot token** and your own **chat id** (message
   [@userinfobot](https://t.me/userinfobot) to get it).
3. **Start** validates + connects, **Forward All** captures the operator's
   messages, **Stop**/**Resume** control long runs, **Export** downloads the
   captured messages as JSON.

## IOC discovery (find leaked bot tokens)

The **IOC Discovery** panel searches threat-intel sources for Telegram bot
credentials and parses out bot tokens + chat ids. **Use** auto-fills the hunt.

| Source | Env key | Default query | Notes |
|---|---|---|---|
| ThreatFox | `ABUSECH_AUTH_KEY` | `api.telegram.org` | abuse.ch IOC DB; values are often full `bot<token>` URLs; malware family attached. Best free source. Also `tag:telegram-c2` / `malware:...` |
| urlscan | `URLSCAN_KEY` | `domain:api.telegram.org` | Free tier; pulls each scan's request URLs + DOM (capped at 50) |
| ZoomEye | `ZOOMEYE_KEY` | `http.body="api.telegram.org"` | `body` needs a Business plan; free tier works with "Fetch pages directly" |

Options in the panel:

- **Fetch pages directly** — for sources that only return a `link` on the free
  tier (ZoomEye), the server fetches each discovered link and parses it locally.
  Trade-off: your server connects to those (often malicious) hosts, revealing its
  IP. Off by default.
- **Resolve chat_id & validate** — queries each bot (`getMe` + deletes any
  webhook + `getUpdates`) to mark it **live @username** / **dead** and fill the
  chat id when a pending update exists (works for idle bots; active bots consume
  their own updates).
- **Monitor** (on live tokens) — starts a live monitor for the selected duration
  (10 min / 1 h / 12 h). Captured messages appear in the **Hunt** tab and persist
  to the DB. Stop early with the Hunt **Stop** button.

Adding a source is one file: create `sources/<name>.js` exporting
`search({ key, query, size })` that returns `[{host, ip, port, link, title, date, body}]`,
then register it in `sources/index.js`. The token/chat-id parser (`ioc.js`) is
shared across all sources.

## Threat feeds

Both feeds are refreshed every 10 minutes and cached in the DB; the panels load
the cache instantly and show "updated X ago".

- **TweetFeed** — community IOCs from Twitter/X ([tweetfeed.live](https://tweetfeed.live)),
  no key. The server groups IOCs by tweet, fetches each tweet's text via X's
  public syndication endpoint, and lists tweets mentioning a Telegram bot.
- **TI Report Dorking** — no key. Generates `site:<source> "telegram bot"`-style
  dorks across reputable TI publishers and scores each article on Telegram-bot
  signals; only hits at/above the min score are shown. Uses DuckDuckGo by
  default (which rate-limits scraping); set `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`
  (free Google Programmable Search, 100/day) for reliable results.

## MalwareBazaar

The **MalwareBazaar** tab automatically queries the `telegram_bot_api` YARA rule,
keeps samples first seen during the last 14 days, and displays their SHA-256,
other hashes, family, file metadata, tags, detections, reporter, and abuse.ch
sample page. Metadata refreshes on server startup and every 3 hours; MATKAP does
not download malware files. This feed uses the YARA rule only and does not merge
the broader `Telegram` tag results.

The manual hash checker remains available below the feed. Run a TI Report
Dorking hunt, click **Load from reports**, then **Check MalwareBazaar** to query
those hashes individually. Both features require a free abuse.ch **Auth-Key**
(`ABUSECH_AUTH_KEY`).

## Threat statistics

Open the standalone **Threat Statistics** sidebar tab directly below **MCP Lab**.
Select 7, 14, or 30 days to combine the cached `telegram_bot_api`
MalwareBazaar results, TweetFeed signals, and dated TI reports. It includes a
malware-type pie chart, a three-source daily activity chart, and ranked charts
for filenames, malware families, explicit campaign metadata, and report
publishers.

Statistics use only fields present in the source data. Reports without a
publication date are counted in coverage but excluded from time-window charts;
campaign names are shown only when the upstream metadata explicitly identifies
them. MATKAP does not infer a campaign from a report title or arbitrary tag.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | no | PostgreSQL URL; without it, MATKAP runs in memory-only mode |
| `HOST` | no | Bind address; defaults to local-only `127.0.0.1` |
| `JADX_MCP_URL` | no | Packaged JADX connector URL; default `http://127.0.0.1:8650` |
| `JADX_MCP_TRANSPORT` | no | Keep `jadx-rest` for the packaged JADX connector |
| `JADX_MCP_TOKEN` | no | Optional bearer token if configured in the JADX connector |
| `MATKAP_MCP_CONNECT_TIMEOUT_MS` | no | Per-connection timeout (default 3500 ms) |
| `MATKAP_MCP_TOOL_TIMEOUT_MS` | no | Per-tool-call timeout (default 45000 ms) |
| `MATKAP_MCP_AGENT_MAX_STEPS` | no | Maximum AI planning rounds (default 6, hard cap 12) |
| `MATKAP_MCP_AGENT_MAX_CALLS` | no | Maximum MCP tool calls per scan (default 24, hard cap 60) |
| `MATKAP_MCP_PREFLIGHT_MAX_FILES` | no | Likely APK text resources read locally before any AI request (default 120, hard cap 500) |
| `MATKAP_AI_ENABLED` | no | Enables AI-driven MCP investigation (default `true`) |
| `MATKAP_AI_PRIMARY` | AI | Default provider: `openai`, `anthropic`, `gemini`, `xai`, `kimi`, or `deepseek` |
| `MATKAP_AI_TIMEOUT_MS` | no | Per-provider request timeout (default 90000 ms) |
| `OPENAI_API_KEY` | no | OpenAI Responses API key |
| `ANTHROPIC_API_KEY` | no | Claude Messages API key |
| `GEMINI_API_KEY` | no | Gemini API key |
| `XAI_API_KEY` | no | xAI/Grok API key |
| `KIMI_API_KEY` | no | Kimi API key (`MOONSHOT_API_KEY` is also accepted) |
| `DEEPSEEK_API_KEY` | no | DeepSeek API key |
| `ORCAROUTER_API_KEY` | no | OrcaRouter API key (`ORCA_API_KEY` is also accepted) |
| `ORCAROUTER_MODEL` | no | OrcaRouter default model; the MCP Lab dropdown overrides it per scan (default `orcarouter/auto`) |
| `ORCAROUTER_BASE_URL` | no | OrcaRouter inference/model base (default `https://api.orcarouter.ai/v1`; `ORCA_BASE_URL` is the shared self-hosted fallback) |
| `TELEGRAM_API_ID` | yes* | Controller account api_id |
| `TELEGRAM_API_HASH` | yes* | Controller account api_hash |
| `TELEGRAM_PHONE` | first run | Phone used for the first login or session recovery |
| `TELEGRAM_STRING_SESSION` | yes* | Controller session; automatically written after the first local login |
| `TELEGRAM_ACCOUNTS` | no | JSON array of accounts; generated sessions are written back automatically |
| `PORT` | no | Listen port (default 3000) |
| `NODE_ENV` | no | `production` or `development` (default) |
| `SESSION_SECRET` | no | Session cookie secret (random if empty) |
| `ABUSECH_AUTH_KEY` | no | abuse.ch Auth-Key ([auth.abuse.ch](https://auth.abuse.ch)) — ThreatFox source + MalwareBazaar tab |
| `URLSCAN_KEY` | no | urlscan.io API key — IOC Discovery |
| `ZOOMEYE_KEY` | no | ZoomEye API key — IOC Discovery |
| `GOOGLE_CSE_KEY` | no | Google Programmable Search key — reliable TI dorking |
| `GOOGLE_CSE_CX` | no | Google Programmable Search engine id |

\* Required unless you configure `TELEGRAM_ACCOUNTS` instead.

## Notes

- No login and no rate limits: this is a self-hosted, open tool. Each browser
  session gets its own isolated workspace; captured data persists to the DB.
- Anyone with the URL can use the instance. Do not expose it publicly without
  putting your own access control (reverse proxy / auth) in front of it.
- Monitor and "resolve" query live bots and delete their webhooks — an active,
  intrusive step against the C2. Use only within an authorized investigation.

## Disclaimer

Matkap is intended for educational and research purposes only. It helps
cybersecurity professionals analyze Telegram bots that pose security risks. Do
not use it for illegal purposes. You are fully responsible for your actions and
must follow Telegram's API Terms and your local laws. The developers are not
liable for any misuse.

## Legacy desktop version

The previous Python desktop implementation is preserved in
[`matkap-old/`](matkap-old/README.md). It is included for reference and is not
required by the current web application.
