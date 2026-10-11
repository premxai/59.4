# Platform Notes for "4:37"

Researched 2026-10-10, the day before the MongoDB x Cerebral Valley hackathon (Shack15, SF, Sun Oct 11). These notes are research only. Every code snippet below is copied from the official docs cited next to it, not written for this project. Vendor pages change; re-check anything marked **VERIFY** on-site.

---

## 0. Blockers and plan conflicts (read first)

| # | Finding | Severity | What to do |
|---|---|---|---|
| B1 | **Time series collections do not support change streams or Database Triggers.** PLAN.md (line ~251) says new `telemetry` docs stream to the viewer. That can't work if `telemetry` is a time series collection. | High: plan conflict | Write live ticks to a small **regular** collection (e.g. `ticks`, or `runs`/`events`) and watch that. Keep `telemetry` as time series for history and charts. Alternatively, poll `telemetry` by `ts > last` once per second. |
| B2 | **Automated embedding works on M0 Free, but query-time embedding is rate-limited to 3 requests/min and 2,000 tokens/min on M0 clusters without a payment method.** | High for live recall | Add a credit card to the Atlas **org**. That raises the query limit to 2,000 RPM. The one-time grant of 200M free tokens per model still covers the cost. Or cache recall results. |
| B3 | **Collection-level read restriction does work on Free (M0) and Flex.** Custom roles are supported; the only documented caveat is that role changes take up to 30 s to deploy. Atlas has no "deny", so you restrict by never granting. | OK | The simplest robust option: put `locked_tests` in its **own database** and give `harness_rw` `readWrite@<simdb>` only. That needs no custom role. Needs Project Owner or Project Database Access Admin on **our own** Atlas project. You can't do this on the Modelence-provisioned DB. |
| B4 | **Raindrop "issues" have no REST read API.** You can only read them through the Raindrop **MCP server** (`list_issues`, `get_issue`, `get_issue_events`), and **Issue Detection is locked on the free Hobby plan**. Signals *are* readable via the Query API (REST and Python SDK) on every plan. | Medium | The evolver should read **signals** via the Query API (`signals.list`, `events.list(signal=...)`). Treat issues as a Pro-trial bonus via MCP. Keep our own silent-failure detectors as the fallback, as PLAN Q15 already says. |
| B5 | **Raindrop Hobby is capped at 1,000 events/month. Past that, ingestion stops for the rest of the calendar month.** Ten simulated winters of operator calls will blow past this. | High for tracing | Ask for hackathon access or the Pro 14-day free trial (support@raindrop.ai, subject "HACKATHON"). Until then, sample traces, or use the free local **Raindrop Workshop** for development. |
| B6 | **Modelence Cloud runs Node.js only.** Python projects are explicitly incompatible, even with a Node frontend. | Medium: plan conflict | Modelence hosts only the Vite viewer plus a small Node replay API. The Python sim, harness, evolver and FastAPI relay (PLAN component I) run on a laptop or AWS. |
| B7 | **Modelence credit amount and conditions are unpublished.** The hacker guide still shows the placeholders `[CREDIT AMOUNT]`, `[PRIZE CREDITS]` and `[REDEMPTION STEPS]`. I found no "$100 condition" anywhere. | Low | Ask at the Modelence table. The Free plan's instance **sleeps when idle**, so warm it before judging, or apply credits to a paid plan. |
| B8 | **Change stream budget on Free is small.** Atlas lists a maximum of **5** change streams for Free clusters. Database Triggers can't be defined on **Flex** at all, though the Flex docs contradict themselves on change streams. | Medium | Use 1–2 change streams total, e.g. one stream with a `$match` on `operationType`/`ns`, fanned out in-process. Prefer M0 or M10 over Flex if triggers are wanted. |
| B9 | Free (M0) limits: **3 search+vector indexes total**, 100 ops/s, 512 MB, 500 collections, 50-stage pipelines, `allowDiskUse` ignored. | Medium | Budget the indexes: 1 autoEmbed vector index on `manual_pages` plus 1 `$search` index for `$rankFusion` leaves 1 spare. Batch telemetry writes (`insert_many`) to stay under 100 ops/s. |

"Sandbox" note: I found no public description of a MongoDB "Atlas Sandbox" tier for this event. Historically, Atlas called its free M0 clusters "M0 Sandbox", so these notes assume **sandbox = Free (M0)** as the worst case. If the invite grants credits, an **M10** removes B2, B8 and B9. Automated embedding on M10+ requires storage auto-scaling to be enabled.

---

## 1. Raindrop

### What it tracks; signals and issues
- **Tracks** agent trajectories (tool calls, errors, recovery steps) and AI events (input/output/model). It also detects "silent failures" such as forgetting earlier context, user frustration and task failure.
- **Signals** are named behaviors that Raindrop labels on every event, with a rate over time. Sources:
  - **Presets** (all plans, free of slots): User Frustration, Task Failure, Forgetting, Refusals, Jailbreaking, NSFW, User Praise.
  - **Created signals**: you describe a behavior in plain English and Raindrop drafts a classifier, then backfills 90 days (sampled). Hobby includes 1 slot, Pro 10.
  - **Regex** signals; **Instrumented** signals, sent by our code via `track_signal` (no slot cost); **Tool errors**, derived from trace spans; **Self Diagnostics**, where the agent reports `missing_context`, `repeatedly_broken_tool`, `capability_gap` or `complete_task_failure`. Self Diagnostics is documented for TypeScript and the Vercel AI SDK only.
- **Issues** ("Issue Detection") flag *distribution shifts*: a failure mode spreading, a new breakage pattern, a regression after a deploy. Each has a severity (critical/high/medium/low), counts, a trend and a report. Statuses are unresolved, resolved and ignored. **Pro plan only; locked on Hobby.**
- **Stumbles** are one-off failures (Pro).

### SDKs
- **Python**: `pip install raindrop-ai` (v0.0.75 on PyPI, published 2026-10-09; Python >= 3.10). Import: `import raindrop.analytics as raindrop`.
- Also available: TypeScript, Go, Rust (beta), Java (beta), Browser JS, raw HTTP API, and OpenTelemetry (OTLP/HTTP).
- Integrations include the Claude Agent SDK (beta), AWS Bedrock (beta), Vercel AI SDK, LangChain, Pydantic AI, OpenAI Agents and more.

Minimal Python, quoted from the docs (https://raindrop.ai/docs/sdk/python):

```python
import os
import raindrop.analytics as raindrop

raindrop.init(os.getenv("RAINDROP_WRITE_KEY"), tracing_enabled=True)

@raindrop.tool("get_weather")
def get_weather(city: str):
    return {"city": city, "temp_c": 22}

@raindrop.interaction("weather_agent")
def run():
    interaction = raindrop.begin(user_id="user1", event="weather_query", input="Weather in Boston?")
    result = get_weather("Boston")
    interaction.finish(output=str(result))

run()
```

Other documented calls:
- `raindrop.track_ai(user_id=..., event=..., model=..., input=..., output=...)`: a single AI event.
- `raindrop.track_signal(event_id="evt_abc123", name="thumbs_up", sentiment="POSITIVE")`.
- `interaction.track_tool(name=..., input=..., output=..., duration_ms=...)`.
- `with raindrop.tool_span("name") as tool:`.
- `raindrop.identify(...)`.
- `raindrop.flush()` and `raindrop.shutdown()` **before exit**, or buffered events are lost.

Tracing only creates spans. Wrap each request in `begin()`/`finish()` so its spans attach to an event.

HTTP ingest (https://raindrop.ai/docs/sdk/http-api):
- `POST https://api.raindrop.ai/v1/events/track` and `POST https://api.raindrop.ai/v1/signals/track`.
- Auth header: `Authorization: Bearer <WRITE_KEY>`. Both return 204.
- The optional `X-Raindrop-Project-Id` header routes to a project.

### Can issues and signals be read back by API?
- **Signals and events: yes, on all plans.** Use the **Query API**. Base URL `https://query.raindrop.ai`, auth `Authorization: Bearer <QUERY_API_KEY>`. This key is *different* from the write key.
  - Endpoints: `GET /v1/events`, `/v1/events/search`, `/v1/events/count`, `/v1/events/timeseries`, `/v1/events/facets`, `/v1/events/{id}`, `GET /v1/traces`, `GET /v1/signals`, `/v1/signals/{id}`, `/v1/users`, `/v1/conversations`.
  - Python SDK: `pip install raindrop-query` (v0.1.14, published 2026-09-22). Quoted from https://raindrop.ai/docs/query-api/sdk:
    ```python
    from raindrop_query import RaindropQuery
    client = RaindropQuery(api_key=os.environ["RAINDROP_QUERY_API_KEY"])
    ```
    Documented methods are `client.signals.list`, `client.events.list`, `client.events.count`, `client.events.search` and `client.events.timeseries`. The docs show filtering by signal in TypeScript only:
    ```typescript
    const response = await client.signals.list({ limit: 10 });
    const events = await client.events.list({ signal: signal.id, limit: 100 });
    ```
    The PyPI README for `raindrop-query` shows a Python form, quoted below:
    ```python
    with RaindropQuery(project_id="default", api_key=os.getenv("RAINDROP_API_KEY", "")) as rq_client:
        res = rq_client.signals.list(limit=50, order_by="-timestamp")
    ```
    The README also lists `signals.get`, `signal_groups.list` and `signal_groups.list_signals`. The Python keyword form for filtering events (`events.list(signal=...)`) is **VERIFY**. The only Python events example in the docs is `events.search(query=..., mode="semantic", search_in="user_input")`.
- **Issues: no REST endpoint.** They are readable through the **Raindrop MCP server** only.
  - Server: `https://mcp.raindrop.ai/mcp`, Streamable HTTP.
  - Auth: OAuth, or `Authorization: Bearer <API key>` from Settings → API Keys. The docs say API keys suit non-interactive or CI use.
  - Issue tools: `list_issues`, `get_issue`, `get_issue_events`, `get_issue_timeseries`, and `update_issue` (write scope `write:issues`).
  - Other useful tools: `list_signals`, `search_stumbles`, `run_rql` (read-only RQL), `get_trace`.
  - A Python evolver could call these with any MCP client library. **But the issue catalog is locked on Hobby.**
- **No push channel.** Alerts go to Slack only. There are no webhooks. The "self-healing loop" cookbook has a human forward a Slack alert to a coding agent, which then pulls evidence via MCP. An automated loop has to **poll**.

### Free tier and hackathon access
- **Hobby (free, no card)**:
  - 1,000 events/month, after which ingestion stops until next month.
  - 1 custom signal, 15 Triage Agent messages/month.
  - Tracing, search, alerts, preset signals, MCP and the Query SDK are included.
  - Issue Detection, Stumbles and Experiments are preview-only.
- **Pro**: $299/mo, metered at $0.003/event, **14-day free trial**. Includes Issue Detection.
- **Workshop**: a free, open-source local debugger, installed with `curl -fsSL https://raindrop.sh/install | bash` and started with `raindrop workshop`. When `RAINDROP_LOCAL_DEBUGGER` is set, the SDKs mirror traces to it. Good for development without spending events.
- **Hackathon**: support@raindrop.ai is the real support address (listed on https://raindrop.ai/docs/support). The "HACKATHON" subject-line offer comes from our event guide; it is not published on Raindrop's site. Ask for a Pro trial or a higher event cap.

Sources: https://raindrop.ai/docs/introduction · https://raindrop.ai/docs/llms.txt · https://raindrop.ai/docs/sdk/python · https://raindrop.ai/docs/sdk/http-api · https://raindrop.ai/docs/platform/signals · https://raindrop.ai/docs/platform/issues · https://raindrop.ai/docs/platform/alerts · https://raindrop.ai/docs/platform/plans · https://raindrop.ai/docs/platform/self-diagnostics · https://raindrop.ai/docs/query-api/api-reference · https://raindrop.ai/docs/query-api/sdk · https://raindrop.ai/docs/mcp/overview · https://raindrop.ai/docs/cookbooks/self-healing-loop · https://raindrop.ai/docs/workshop/overview · https://howtoeval.com · https://pypi.org/project/raindrop-ai/ · https://pypi.org/project/raindrop-query/

**Implication for our plan:** Trace with `begin`/`finish` plus `@raindrop.tool`. The evolver polls **signals** via `raindrop-query` (instrumented signals such as `reserve_misread`, plus the presets). Read issues via MCP only if we get Pro. Email Raindrop early to get past the 1,000-event Hobby cap.

---

## 2. Modelence

### What it is and what stack it expects
- Modelence is "a platform for building and hosting apps". The open-source framework (`modelence` on npm, v0.26.3, Node >= 22) is **TypeScript + React + MongoDB**. Modelence Cloud hosts apps, and each environment gets a provisioned **MongoDB Atlas** database.
- Modelence Cloud also hosts **any existing Node.js app**, described by a `modelence.config.json`:
  - Frontends: Vite, CRA, Angular, Astro (static).
  - Backends: Express, Fastify, Koa, Hono, NestJS, or a framework's own server, as **one** process.
  - **Python, Java, Go, PHP, Ruby and .NET are not compatible, even with a Node.js frontend.**

### Deploying, and hosting a Vite three.js frontend plus a small backend
Yes. A Vite static build is served by the platform, with unmatched paths falling back to `index.html`, plus one Node web process for the API. Example, quoted from https://docs.modelence.com/deploy/setup.md:

```json
{
  "$schema": "https://cloud.modelence.com/schema/modelence.config.json?version=1",
  "resources": {
    "api": {
      "type": "service",
      "image": "node-22-slim",
      "build": {
        "commands": ["npm ci", "npm ci --prefix client", "npm run build --prefix client"]
      },
      "start": { "commands": ["node server.js"] },
      "static": [{ "path": "/", "dir": "client/dist" }]
    }
  },
  "env": {
    "VITE_API_URL": { "value": "/api", "scopes": ["build", "runtime"] },
    "STRIPE_SECRET_KEY": { "type": "secret" }
  }
}
```

- A static-only variant omits `start`.
- Deploy with `npx modelence@latest deploy`. It opens a browser to sign in, pick the app and environment, and enter required variables, then uploads and builds.
- New framework apps: `npx create-modelence-app@latest my-app && cd my-app && npx modelence@latest setup && npm run dev`.
- Rules:
  - The server must listen on `process.env.PORT` and bind all interfaces.
  - Only npm is preinstalled; pnpm and Yarn need `corepack enable`.
  - `VITE_*` variables need the `"build"` scope, because Vite inlines them at build time.

### MongoDB connection
- **Injected env vars**: `MONGODB_URI` and `MONGO_URL` (the same provisioned Atlas DB per environment), `SITE_URL`/`ROOT_URL`, and `PORT`.
- **Custom env vars**: defined in the dashboard or in the `env` section, with `"type": "secret"` for secrets. Names starting with `MODELENCE_`, and `PORT`, are reserved.
- **Undocumented**: the tier of the provisioned Atlas DB, and whether we get Atlas project access (needed for custom roles, Search index UI, triggers).
- **Framework features**:
  - `Store` collections.
  - Live queries built on change streams (`dbTodos.watch()`).
  - `searchIndexes` with `Store.vectorIndex(...)`.
  - A Voyage example that embeds manually with `voyage-3.5`; it does **not** use Atlas autoEmbed.

### Credits and limits
- **$100 credit condition: not published.** The guide literally reads "Every participant gets **[CREDIT AMOUNT]**…" with "[REDEMPTION STEPS]" (fetched raw on 2026-10-10). Redemption is via an account at cloud.modelence.com. One plausible reading of "$100" is the Pro plan, which costs $100/mo and includes $100 of usage; **VERIFY at the Modelence table**.
- **Plans**:
  - Free: $0, 1 instance that **sleeps when idle**, shared resources, 1 region, Modelence subdomain.
  - Starter: $20/mo, includes $20 usage.
  - Pro: $100/mo, includes $100 usage.
  - Compute starts around $0.013/hour (0.25 vCPU).
- **Limits**:
  - One service per app.
  - **One web process**: no workers, queue consumers or schedulers.
  - No Docker Compose or custom Dockerfiles.
  - Up to 5 managed resources (Postgres/Redis, paid plans).
  - Don't put migrations in `start.commands`.
- **WebSockets** are documented only through the framework's Socket.IO-based `ServerChannel`/`ClientChannel` (`/websockets.md`). Framework live queries run over WebSockets on Cloud, so upgrades are probably proxied, but nothing says so for generic `service` apps. **VERIFY**, and fall back to SSE or 1 s polling.

Sources: https://docs.modelence.com/hackathon/mongodb-2026 · https://docs.modelence.com/deploy/setup.md · https://docs.modelence.com/index.md · https://docs.modelence.com/live-queries.md · https://docs.modelence.com/voyage-ai.md · https://docs.modelence.com/indexes.md · https://docs.modelence.com/websockets.md · https://docs.modelence.com/llms.txt · https://modelence.com/pricing · https://registry.npmjs.org/modelence/latest

**Implication for our plan:** Deploy only `viewer/` (Vite static) plus a tiny Node replay/live API (Express or Hono) on Modelence. Point it at **our** Atlas cluster with a custom secret env var, e.g. `ATLAS_URI_VIEWER`, a read-only user. Keep all Python (sim, harness, evolver, FastAPI relay) off Modelence.

---

## 3. MongoDB Atlas features

Atlas Free (formerly M0) runs **MongoDB 8.0**; Flex runs 8.0 or later.

| Feature | Free (M0) | Flex | M10+ | Key caveat |
|---|---|---|---|---|
| Change streams | Yes | Docs conflict (VERIFY) | Yes | Free: max 5 streams; `ns` db filters must be strings or regex; **no change streams on time series** |
| Time series collections | Yes (the official quick start uses M0) | Yes (not listed as unsupported) | Yes | No change streams, no triggers, no Atlas Search; `timeField` must be a BSON date |
| Vector Search + autoEmbed (Voyage) | **Yes, GA (Aug 12, 2026)** | Yes | Yes (storage auto-scaling required) | M0 without a card: **3 RPM / 2,000 TPM** query embedding; Free index cap 3 |
| `$rankFusion` | Yes (8.0+) | Yes | Yes | Inputs must be "selection + ranked" pipelines; needs a `$search` index for hybrid |
| `$graphLookup` | Yes | Yes | Yes | 100 MB memory cap with no disk spill on Free/Flex; `from` must be in the same DB |
| Custom roles, collection-scoped | **Yes** | **Yes** | Yes | Changes take ≤30 s to deploy on Free/Flex; additive only, no deny |
| Atlas Triggers (database) | Yes | **No** | Yes | Not on time series; Triggers and Functions survived the 2025 App Services EOL |
| MongoDB MCP server | Yes (any cluster) | Yes | Yes | Use `--readOnly` with a limited user |

### 3a. Change streams
- Available on replica sets and sharded clusters, so all Atlas tiers.
- **Free and Flex**: "you can use only strings and regular expressions in filters on database names (namespace `ns` fields)"; `$in` on db names is not allowed. The Atlas Triggers limits table lists **5** change streams for Free, **10** for Flex and **100** for M10/M20.
- **Not supported on time series collections.**
- **Access control**: a collection-level stream needs `changeStream` + `find` on that collection. A **database-level** `db.watch()` needs them on *all* non-system collections in the DB. So a harness user locked out of `locked_tests` can't open a db-level stream on that DB. That's another reason to put `locked_tests` in its own DB.
- PyMongo, quoted from https://www.mongodb.com/docs/manual/changestreams/:
  ```python
  pipeline = [
      {"$match": {"fullDocument.username": "alice"}},
      {"$addFields": {"newField": "this is an added field!"}},
  ]
  cursor = db.inventory.watch(pipeline=pipeline)
  next(cursor)
  ```
  and `cursor = db.inventory.watch(full_document="updateLookup")`.

**Implication:** Run one stream on `runs` (failures trigger the evolver) and one on a regular `ticks` collection (feeds the viewer). That stays within the 5-stream Free cap and avoids watching the time series `telemetry`.

### 3b. Time series collections
- **Supported on Free.** MongoDB's own Time Series Quick Start tells you to create a free M0 cluster first (https://www.mongodb.com/docs/v8.0/core/timeseries/timeseries-quick-start/), and the Free limits page doesn't list time series as unsupported.
- **Limitations**:
  - No change streams, Database Triggers, MongoDB Search or schema validation.
  - Updates can only match and modify `metaField`.
  - No writes inside transactions.
  - 4 MB max document size.
  - No unique or text indexes.
  - `$merge` *into* a time series collection isn't allowed; use `$out`.
- **The `timeField` value must be a BSON date.** Map "sim hour" to a synthetic `datetime`, e.g. epoch + hours.
- PyMongo, quoted from https://www.mongodb.com/docs/manual/core/timeseries/timeseries-procedures/:
  ```python
  time_series_options = {
      "timeField": "time",
      "metaField": "sensor",
      "bucketMaxSpanSeconds": 3600,
      "bucketRoundingSeconds": 3600
  }
  timeseries_db = client["timeseries"]
  timeseries_db.create_collection("weather", timeseries=time_series_options, expireAfterSeconds=expire_after_seconds)
  ```
  Or set `"granularity"` in place of the bucket fields.

**Implication:** Keep `telemetry` as time series (meta: `{run_id, region}`, time: a synthetic datetime). Don't rely on it for live push.

### 3c. Atlas Vector Search with automated embedding (Voyage)
- **Status**:
  - Community Edition public preview: Jan 2026.
  - Atlas public preview: May 2026.
  - **Atlas GA: Aug 12, 2026.** The GA release added editable index definitions, nested fields, token metrics and backpressure.
  - Note: the docs page itself still carries a "Preview" banner in one view.
- **Tiers**:
  - The rate-limit table explicitly covers "M0 clusters without a payment method", "M0 clusters with payment method, Flex clusters, and Dedicated clusters".
  - On dedicated M10+, **storage auto-scaling must be enabled**. If the disk fills up, embedding pauses and the index goes **Stale**.
- **Models and prices per 1M tokens**:

  | Model | Price | Note |
  |---|---|---|
  | `voyage-4-lite` | $0.02 | |
  | `voyage-4` | $0.06 | recommended |
  | `voyage-4-large` | $0.12 | |
  | `voyage-code-4` | $0.12 | |
  | `voyage-code-3` | $0.18 | legacy |

  All have a 32k-token context window. **Atlas includes a one-time 200M free tokens per model per org**, and billing goes to the Atlas org.
- **Rate limits**:
  - Query embedding, M0 without a card: **3 RPM / 2,000 TPM** (all models).
  - Query embedding, with a card, Flex or dedicated: 2,000 RPM / 8M TPM for `voyage-4`.
  - Insert/update embedding: 2,000 RPM.
  - First-time index build: uses a separate, unbounded mechanism. The docs recommend **prepopulating before creating the index**.
- **Storage**: embeddings land in the internal DB `__mdb_internal_search`, one collection per index. Don't touch it. Note that this extra storage counts against the 512 MB Free limit.
- Index definition, quoted from https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/:
  ```json
  {
    "fields": [
      { "type": "autoEmbed", "modality": "text", "path": "<field-to-index>", "model": "<embedding-model>" },
      { "type": "filter", "path": "<field-to-index>" }
    ]
  }
  ```
- Query, from the same page:
  ```json
  [
    { "$vectorSearch": { "index": "<index-name>", "path": "<field-to-index>", "query": "<query-text>", "model": "<embedding-model>" } },
    { "$project": { "_id": 0, "<field-to-index>": 1, "score": { "$meta": "vectorSearchScore" } } }
  ]
  ```
  `model` is optional and must be compatible with the model used at index time. The self-managed tab refers to `query.text`, while the Atlas example uses a plain `query` string. **VERIFY** with one test query.

**Implication:** Do 3 things before the evolution loop runs:
1. Add a payment method to the Atlas org (B2).
2. Seed `manual_pages` before creating the autoEmbed index.
3. Filter on `sensor_state` and similar fields with `filter` entries.

### 3d. `$rankFusion`
- "Only available for deployments that use MongoDB 8.0 or higher", which includes Free. It uses Reciprocal Rank Fusion (k = 60), with optional `combination.weights` and `scoreDetails`.
- Each input pipeline must be a **selection** pipeline (`$match`, `$search`, `$vectorSearch`, `$sample`, `$geoNear`, `$sort`, `$skip`, `$limit`; no document modification). It must also be **ranked**: it begins with `$search`/`$vectorSearch`/`$geoNear` or has an explicit `$sort`.
- `$rankFusion` on Views needs 8.2+.
- Syntax, quoted from https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankfusion/:
  ```javascript
  { $rankFusion: {
      input: { pipelines: { <myPipeline1>: <expression>, <myPipeline2>: <expression> } },
      combination: { weights: { <myPipeline1>: <numeric expression>, <myPipeline2>: <numeric expression> } },
      scoreDetails: <bool>
  } }
  ```

**Implication:** Hybrid recall = `$vectorSearch` (autoEmbed) + `$search` (text), or + `$match`/`$sort` on helpful counts. A `$search` index uses the 2nd of the 3 Free index slots.

### 3e. `$graphLookup`
- Available on all tiers.
- Syntax, from https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphlookup/:
  ```javascript
  { $graphLookup: { from: <collection>, startWith: <expression>, connectFromField: <string>,
      connectToField: <string>, as: <string>, maxDepth: <number>, depthField: <string>,
      restrictSearchWithMatch: <document> } }
  ```
- `from` must be in the same database. Results are unsorted (use `$sortArray`).
- Past 100 MB it spills to disk only if `allowDiskUse` is true. **Free and Flex ignore `allowDiskUse` and can't write temp files**, so a traversal over 100 MB errors there.

**Implication:** Fine for `harness_versions` lineage (`parent_id` → `_id`) and rule provenance. Keep those collections in the same DB as the harness data.

### 3f. Custom roles with collection-level read restriction (the locked-test question)
- **Works on Free and Flex.** Both limit pages say only: "Changes to custom roles might take up to 30 seconds to deploy in Free clusters" (and the same for Flex).
- Privileges take a Database **and** a Collection.
- Collection actions include `FIND`, `INSERT`, `UPDATE`, `REMOVE`, `CHANGE_STREAM`, `CREATE_INDEX` and more. The available actions are "a subset" of the built-in privilege actions.
- Roles are **additive**: "Atlas honors the highest permissions within any role". There is no explicit deny.
- **Limits**: 100 custom roles per project; 20 custom roles per user; 100 DB users per project.
- **Required access**: Org Owner, Project Owner or Project Database Access Admin.
- Changes made outside the Atlas UI/CLI/API (e.g. `db.createRole`) are **rolled back**.
- CLI, quoted from https://www.mongodb.com/docs/atlas/cli/current/command/atlas-customDbRoles-create/:
  ```
  atlas customDbRoles create customRole --privilege FIND@databaseName,UPDATE@databaseName.collectionName
  ```
- The `atlas dbusers create` `--role` format is `roleName[@dbName[.collection]]`. Built-in roles can therefore be scoped to a single collection: https://www.mongodb.com/docs/atlas/cli/current/command/atlas-dbusers-create/

**Implication:**
- Recommended layout:
  - DB `sim` holds everything the harness may touch; `harness_rw` gets `readWrite@sim`.
  - DB `eval` holds `locked_tests`; `evaluator` gets `read@eval` + `readWrite@sim`.
- Optional **append-only** `test_runs`: a custom role with `INSERT@sim.test_runs,FIND@sim.test_runs` and no UPDATE/REMOVE. This is a strong anti-cherry-picking proof for judges.
- Prove it live: `harness_rw` running `find` on `eval.locked_tests` returns **Unauthorized (code 13)**.
- None of this is possible on Modelence's provisioned DB (no project access).

### 3g. Atlas Triggers
- **Still supported.** MongoDB's App Services deprecation page says Triggers are not deprecated, and Functions remain available for use with Triggers. Only the Data API and HTTPS Endpoints were removed on 2025-09-30. Triggers now live in the Atlas UI.
- Database Triggers run on change streams:
  - **Not allowed on Flex**: "Flex Clusters don't support change streams", which contradicts the Flex limits page.
  - **Not allowed on time series collections.**
  - Each triggered collection opens one change stream and counts against the 5-stream Free cap.
- Other limits: trigger queries return at most 50,000 docs; 10,000 concurrent requests.
- Function shape, quoted from the docs:
  ```javascript
  exports = async function (changeEvent) {
    const { updateDescription, fullDocument } = changeEvent;
    // ...
  };
  ```

**Implication:** Optional. A Python `watch()` in the evolver is simpler and doesn't spend extra stream slots. Use a trigger only if we want an "Atlas-native" moment, e.g. stamping a hash on `test_runs` inserts.

### 3h. MongoDB MCP server
- **Package and transport**: `mongodb-mcp-server`, v3.0.5 on npm. Node `^20.19.0 || ^22.13.0 || >= 24.0.0`. Transport is stdio (default) or HTTP.
- **Config**, quoted from https://github.com/mongodb-js/mongodb-mcp-server:
  ```json
  { "mcpServers": { "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": { "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase" } } } }
  ```
- **Env vars**:

  | Variable | Purpose |
  |---|---|
  | `MDB_MCP_CONNECTION_STRING` | Connection string |
  | `MDB_MCP_API_CLIENT_ID` / `MDB_MCP_API_CLIENT_SECRET` | Atlas service account, needed for Atlas tools |
  | `MDB_MCP_READ_ONLY` | Read-only mode |
  | `MDB_MCP_DISABLED_TOOLS` | Disable specific tools |
  | `MDB_MCP_MAX_DOCUMENTS_PER_QUERY` | Cap on returned documents |
  | `MDB_MCP_INDEX_CHECK` | Index checking |

- **Tools**:
  - DB: `find`, `aggregate`, `count`, `insert-many`, `update-many`, `create-index`, `collection-schema`, `explain`, …
  - Atlas: `atlas-list-clusters`, `atlas-create-db-user`, `atlas-create-free-cluster`, `atlas-inspect-cluster`, …
  - Atlas Local tools.
  - `search-knowledge` (MongoDB Assistant).
- MongoDB also runs an Atlas-managed **remote** MCP server (OAuth) through the `mongodb-atlas` plugin.
- Docs note it is unsupported on "Atlas Infinite clusters" during preview, which doesn't apply to us.

**Implication:** Use it for development only, with `--readOnly` and the `harness_rw` (or a read-only) URI. Never give it evaluator credentials, because that would leak `locked_tests` into an agent's context.

Sources (section 3): https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/ · https://www.mongodb.com/docs/atlas/reference/flex-limitations/ · https://www.mongodb.com/docs/manual/changestreams/ · https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/ · https://www.mongodb.com/docs/manual/core/timeseries/timeseries-procedures/ · https://www.mongodb.com/docs/v8.0/core/timeseries/timeseries-quick-start/ · https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/ · https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/overview/ · https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/ · https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/ · https://www.mongodb.com/products/updates/now-ga-automated-embedding-in-atlas-vector-search/ · https://www.mongodb.com/docs/vector-search/deployment/compatibility-limitations/ · https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankfusion/ · https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphlookup/ · https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/ · https://www.mongodb.com/docs/atlas/reference/custom-role-actions/ · https://www.mongodb.com/docs/atlas/cli/current/command/atlas-customDbRoles-create/ · https://www.mongodb.com/docs/atlas/cli/current/command/atlas-dbusers-create/ · https://www.mongodb.com/docs/atlas/atlas-ui/triggers/database-triggers/ · https://www.mongodb.com/docs/atlas/atlas-ui/triggers/limitations/ · https://www.mongodb.com/docs/atlas/app-services/deprecation · https://github.com/mongodb-js/mongodb-mcp-server · https://registry.npmjs.org/mongodb-mcp-server/latest

---

## 4. 3D stack and CC0 assets

Versions are taken from the npm registry (`dist-tags.latest`, publish date, `peerDependencies`) on 2026-10-10.

| Package | Latest | Published | Peer deps (latest) | Notes |
|---|---|---|---|---|
| `three` | 0.186.1 | 2026-09-24 | none | |
| `@react-three/fiber` | 9.8.1 | 2026-09-24 | `react >=19 <19.4`, `react-dom >=19 <19.4`, `three >=0.156` | `alpha` tag is 10.0.0-alpha.5 (R3F v10, not stable) |
| `@react-three/drei` | 10.7.9 | 2026-09-25 | `react ^19`, `@react-three/fiber ^9.0.0`, `three >=0.159` | `alpha` tag is 11.0.0-alpha.7 |
| `@react-three/postprocessing` | 3.2.0 | 2026-10-10 | `react ^19`, `@react-three/fiber >=9.7.0`, `postprocessing ^6.36.0` | |
| `postprocessing` | 6.39.5 | 2026-09-09 | **`three >=0.168.0 <0.187.0`** | Pin `three` to 0.186.x |
| `react` / `react-dom` | 19.3.0 | 2026-09-09 | none | Within R3F's `<19.4` range |
| `vite` | 8.3.4 | 2026-10-08 | none required | **Node `^20.19.0 \|\| >=22.12.0`** |
| `@vitejs/plugin-react` | 6.1.2 | 2026-10-05 | `vite ^8.0.0` | |
| `@theatre/core` / `@theatre/studio` / `@theatre/r3f` | 0.7.2 | **2024-05-19** | `@theatre/r3f`: **`@react-three/fiber ^8.13.6`** | See below |

**Compatibility:** `three@0.186` + R3F 9.8 + drei 10.7 + `@react-three/postprocessing` 3.2 + React 19.3 + Vite 8 is a consistent set. The only tight constraint is `postprocessing`'s `three <0.187`. Modelence's default image is `node-22-slim`, which meets Vite 8's Node requirement.

**Theatre.js:**
- No npm release since 0.7.2 (May 2024).
- `@theatre/r3f` declares a peer dependency on **R3F v8** (`^8.13.6`), so it conflicts with R3F 9 / React 19. Installing it would need `--legacy-peer-deps`, and runtime behavior is unverified.
- I did not finish checking GitHub activity or open issues.

**Recommendation:** Treat Theatre.js as **high risk**. Script the camera instead with drei `CameraControls` (or `useFrame` + `maath` easing / GSAP) on keyframes. PLAN already lists Theatre.js as the second item on the cut list.

**CC0 assets:** NOT VERIFIED. The background research pass did not return before handoff.
- Kenney.nl assets are widely published as CC0, and Poly Pizza licenses are per model (CC0 or CC-BY, where CC-BY needs attribution). Re-check both license pages.
- Searching for wind turbines, smokestacks, cooling towers, pumpjacks, pylons and city buildings is also still to do: Kenney City Kit (Commercial/Industrial/Suburban), Kenney Factory Kit, and `https://poly.pizza/search/<term>`.
- Fallback: procedural geometry, already in PLAN.

Sources: https://registry.npmjs.org/three · https://registry.npmjs.org/@react-three/fiber · https://registry.npmjs.org/@react-three/drei · https://registry.npmjs.org/@react-three/postprocessing · https://registry.npmjs.org/postprocessing · https://registry.npmjs.org/@theatre/r3f · https://registry.npmjs.org/@theatre/core · https://registry.npmjs.org/vite · https://registry.npmjs.org/@vitejs/plugin-react · https://registry.npmjs.org/react

**Implication for our plan:** Pin `three@0.186.x`. Use R3F 9 / drei 10 / postprocessing 3.2 / React 19.3 / Vite 8. Replace Theatre.js with a scripted CameraControls path unless someone proves `@theatre/r3f` works with R3F 9 in the first hour.

---

## 5. Anthropic API on AWS Bedrock

**Claude Opus 5.5 and Claude Haiku 5.5 are both listed on Amazon Bedrock.**
- They are served by the "Claude in Amazon Bedrock" Messages-API endpoint (`https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages`, standard SSE). The model IDs are **`anthropic.claude-opus-5-5`** and **`anthropic.claude-haiku-5-5`**; `anthropic.claude-sonnet-5-5` is also available.
- Both have the **global** endpoint, which carries no premium; regional endpoints cost 10% more. Both models are also reachable through legacy `InvokeModel` on `bedrock-runtime`, but they have no ARN-versioned IDs.
- **Access** is listed as "See Access", not "Open". Opus 5.5 and Haiku 5.5 aren't in the open-to-all group (Fable 5.1, Fable 5, Opus 4.8, Sonnet 5, Opus 4.7, Haiku 4.5), so check **Bedrock → Model access** in the console first.
- **Quota**: the default is 2M input tokens/min.
- **Client**: use the Mantle client (`pip install -U "anthropic[bedrock]"`). Quoted from the docs:
  ```python
  from anthropic import AnthropicBedrockMantle
  client = AnthropicBedrockMantle(aws_region="us-east-1")
  message = client.messages.create(model="anthropic.claude-opus-5-5", max_tokens=1024,
      messages=[{"role": "user", "content": "Hello, Claude"}])
  ```
- **Not supported on this endpoint**:
  - Server tools (web search/fetch, code execution).
  - Batches, Files API, Models API.
  - MCP connector, Managed Agents.
  - Server-side `fallbacks` (use the client-side fallback pattern).
  - Structured outputs (the live page lists this as unsupported; Anthropic's SDK skill reference table says supported, so **VERIFY**).
- **Alternative**: Claude Platform on AWS is Anthropic-operated, billed through AWS Marketplace, and has same-day feature parity.
- **Raindrop** has a Bedrock integration (beta).

Sources: https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock · https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy · https://raindrop.ai/docs/integrations/bedrock

**Implication for our plan:** Hide the LLM client behind a one-line factory: `ANTHROPIC_API_KEY` selects the first-party API, AWS creds select `AnthropicBedrockMantle` with `anthropic.`-prefixed IDs. Use strict tool use or plain JSON prompting rather than `output_config.format`, so the same code runs on both paths for the AWS judge.

---

## Addendum (Sat 2026-10-10): 3D stack and asset licenses, verified

**Compatible set (npm latest, peers checked):** three 0.186.1, @types/three 0.186.0, react/react-dom 19.3.0, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, @react-three/postprocessing 3.1.3 (conservative; 3.2.0 shipped today), postprocessing 6.39.5 (peer `three <0.187`), vite 8.3.4, @vitejs/plugin-react 6.1.2. Node 22.
- Stay on R3F v9; v10 is alpha and has no compatible postprocessing release.
- **No Theatre.js** (dormant since May 2024, peer R3F v8). For camera choreography use drei `<CameraControls>` (promise-chained `setLookAt` shots) or `<MotionPathControls>`; GSAP 3.15 + @gsap/react for keyframed timelines (all plugins free under the standard license).

**Assets.** Kenney packs are CC0, no attribution needed. Poly Pizza models are CC0 or CC-BY 3.0, marked per model; CC-BY models need a credits overlay.

| Need | Pick | License |
|---|---|---|
| Wind turbine, factory with stacks, solar panels, possible cooling tower | Kenney City Kit (Industrial) v2.0, https://kenney.nl/assets/city-kit-industrial | CC0 |
| City buildings | Kenney City Kit (Commercial) v2.1, https://kenney.nl/assets/city-kit-commercial | CC0 |
| Transmission tower | iPoly3D "Transmission Tower", https://poly.pizza/m/Xfb0lAPvnh (2.5k tris) | CC0 |
| Solar panel | Quaternius "Solar Panel Ground", https://poly.pizza/m/LbGiYP5iJu | CC0 |
| Cooling towers (nuclear) | Jarlan Perez "Smokestacks" (actually 2 hyperboloid towers), https://poly.pizza/m/8U1WTzxTmfA | CC-BY 3.0 |
| Oil pumpjack | Poly by Google "Oil pump", https://poly.pizza/m/fZykGFywa5D | CC-BY 3.0 |
| Gas plant alternative | Poly by Google "Factory" (twin stacks), https://poly.pizza/m/fiTYyyiZXqF | CC-BY 3.0 |

**Open:**
- Confirm Kenney file names and whether the turbine rotors are separate nodes (needed to spin the blades) in a glTF viewer.
- CC-BY credit format: `{Title} by {Creator} [CC-BY] (https://creativecommons.org/licenses/by/3.0/) via Poly Pizza (https://poly.pizza/m/{id})`.
