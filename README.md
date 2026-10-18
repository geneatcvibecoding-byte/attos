<p align="center"><img src="design/brand/aos-mark.png" alt="AttentionOS logo" width="120" height="120"></p>

# AttentionOS

A self-hosted, agent-driven content pipeline for short-form video: research → strategy → scripting → editing → publishing → engagement → measurement, with a feedback loop into the next cycle. Agents run on Claude Code (your own Claude plan) or the Anthropic API. Every public action is gated by deterministic validators and per-agent autonomy levels.

- **License:** MIT
- **Status:** v0.1, under active development. Expect frequent updates, and breaking changes to config and schema until 1.0
- **Stack:** TypeScript (Node 22.18+, ESM, strict), Postgres 16+ with pgvector (17 in the Docker stack), Python 3.12 media sidecar, Docker Compose, MCP

> **Why we're sharing it now.** The workflows in AttentionOS have already generated millions of views, and they're useful today, so we're opening them up rather than waiting for a polished 1.0. The repo gets frequent updates: new modules, providers, fixes and docs land often. Run `./aos update` to stay current, watch the repo for releases, and see [Report an issue](#report-an-issue) if something doesn't work for you.

---

## Architecture

```
              ┌──────────────────────────── learn ◄─────────────────────────────┐
              ▼                                                                 │
 research ─► strategy ─► scripting ─► (human films) ─► editing ─► publishing ─► community ─► analytics
```

```
┌──────────── docker compose ──────────────────────────────────────────────────────────────┐
│                                                                                          │
│  attentionos (one image)                                    postgres (pgvector/pg17)     │
│  ├─ studio      Next.js dashboard  :4747  ◄──┐              ├─ facts, queues, metrics    │
│  ├─ worker      jobs, schedules, webhooks    ├── SQL ──────►├─ knowledge_chunks (RAG)    │
│  ├─ mcp         MCP data server              │              └─ not published to host     │
│  ├─ runner      claude -p | Anthropic API ───┘                                           │
│  └─ media-py    ASR, cuts, render, QC                                                    │
│                                                                                          │
│  /workspace ◄── bind mount: Brand Kit + config (plain files, yours, git-friendly)        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **State split.** Taste and policy live in the workspace as plain files (the Brand Kit: `brand/voice.md`, audience, offers, lanes, proof, house style, lessons). Facts and queues live in Postgres, always scoped by `workspace_id`.
- **Code holds the gates.** Script, caption, keyword and payload validators in `packages/guardrails` are deterministic and can't be edited by the LLM at runtime. A claim ledger rejects numbers that aren't backed by the proof inventory or a cited source.
- **Untrusted input isolation.** Extraction and classification jobs marked `toolless` run without tools or MCP access, and structured outputs are schema-validated (Zod v4). Other agents can read web content and workspace files; this is not a sandbox against every prompt-injection attack. Run the supplied container with only your intended workspace mounted and review public actions.
- **Provider interfaces.** Modules depend on `packages/core/src/providers.ts`, never on vendor SDKs. Each vendor is its own adapter package.
- **Outlier scoring.** Every post, yours or a competitor's, is scored as `x` against that account's rolling median. Remixes record their source; structure is reused, wording isn't.
- **Autonomy.** Each agent runs at `review_all`, `review_key` or `autopilot`. Nothing public ships above the configured level.
- **Lessons.** A correction becomes a dated rule in `brand/lessons.md` that every agent loads.

Deeper: [docs/architecture.md](docs/architecture.md) · [ADRs](docs/adr/README.md)

## Requirements

| | |
|---|---|
| Host | macOS or Linux (Debian/Ubuntu tested). Windows via WSL 2 ([notes](docs/install.md#windows-wsl-2)). 4 GB RAM minimum, 8 GB recommended; ~10 GB disk |
| Docker | Engine 24+ with Compose v2 (OrbStack or Docker Desktop on macOS) |
| LLM | Claude Pro/Max plus a `claude setup-token` OAuth token (default), or `ANTHROPIC_API_KEY` with `runner.engine: "api"` |
| Data providers | Apify (competitor/own-post scraping) and/or Zernio (publishing, inbox, first-party analytics). Optional at boot |
| Optional | Telegram or Discord bot (notifications, approvals, chat) |

## Install

This gets a working stack in about 30 minutes, most of it the first image build. The full guide, with servers, backups, Windows and troubleshooting, is **[docs/install.md](docs/install.md)**.

**Prerequisites:** Docker with Compose v2 (`docker compose version`), `git`, `openssl`, and a Claude Pro or Max plan. On Windows, do everything inside WSL 2: [docs/install.md#windows-wsl-2](docs/install.md#windows-wsl-2).

```bash
# 1. Source and stack folder
export AOS=~/AttentionOS     # Linux server: /opt/attentionos (sudo mkdir -p $AOS && sudo chown $USER $AOS)
mkdir -p "$AOS"/{workspace,backups} && chmod 700 "$AOS/backups"
git clone --depth 1 https://github.com/evanbaker315/AttentionOS "$AOS/src"
cd "$AOS"
cp src/deploy/{docker-compose.yml,aos,uninstall.sh} .
cp src/deploy/.env.example .env && chmod 600 .env

# 2. Settings: generate the two secrets and set the paths (works on macOS and Linux)
perl -pi -e "
  s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 20)#;
  s#^ATTENTIONOS_STUDIO_TOKEN=.*#ATTENTIONOS_STUDIO_TOKEN=$(openssl rand -hex 24)#;
  s#^AOS_SRC_DIR=.*#AOS_SRC_DIR=./src#;
  s#^AOS_STACK_DIR=.*#AOS_STACK_DIR=$AOS#;
" .env
# Optional: set TZ in .env to your timezone (default America/New_York).
# Linux only: the container runs as uid 1000 and must own the workspace.
#   sudo chown -R 1000:1000 "$AOS/workspace"

# 3. Build and start (first build: 5-15 minutes)
docker compose build --pull attentionos
docker compose up -d --remove-orphans --wait --wait-timeout 900
./aos status                 # Studio: healthy · worker online

# 4. Connect Claude (opens a browser, or prints a link on a headless machine)
./aos claude-login
```

Then open <http://localhost:4747>. Studio starts on onboarding: your website and handles, provider keys (Apify, Zernio), competitors. It drafts your Brand Kit from your site and transcribed videos for you to approve. Nothing about your business ships with the repo; it all comes from your own setup.

Stuck? `./aos doctor` checks the setup and says how to fix what's off, and [docs/install.md#troubleshooting](docs/install.md#troubleshooting) covers the common errors.

## Operations

From the stack dir:

| | |
|---|---|
| `./aos status` | Container state + Studio/worker health + URL |
| `./aos open` | Open Studio in the browser |
| `./aos access-key` | Print Studio's access key (for signing in from another device) |
| `./aos logs [svc]` | Follow logs (`attentionos`, `postgres`) |
| `./aos update` | Re-clone source, rebuild, restart. Migrations apply on start |
| `./aos backup` | `pg_dump -Fc` + workspace tarball into `backups/`, 14-day retention. Schedule it yourself: [cron, launchd or Task Scheduler](docs/install.md#backups) |
| `./aos doctor` | `attentionos doctor` in the container |
| `./aos claude-login` | Mint and store a new `CLAUDE_CODE_OAUTH_TOKEN` (works headless) |
| `./aos cli <args>` | Any `attentionos` command inside the container, e.g. `./aos cli run knowledge.index-workspace` |
| `./aos shell` · `./aos claude` | Shell or Claude Code inside the app container |
| `./aos start` · `stop` · `restart` | Lifecycle |
| `./aos uninstall [--purge]` | Remove containers, image, backup job; `--purge` offers to drop data |

| Path | Contents |
|---|---|
| `$AOS/workspace` | Brand Kit, `config/attentionos.config.ts`, lessons, media. Keep it in a private git repo |
| `$AOS/.env` | Stack config and secrets (Claude token, Studio access key, DB password). Mode 600; never commit |
| `attentionos_postgres-data` | Postgres volume, internal network only |
| `attentionos_attentionos-data` | Model caches (ASR, embeddings), Claude Code settings |
| `$AOS/backups` | Backup output |

## Agents and runtime

| Agent | Modules | Output |
|---|---|---|
| Analyst | `research`, `learn`, `knowledge` | Competitor outliers, trend radar, teardowns, post-mortems, weekly report |
| Strategist | `strategy` | Daily "Film today" brief, batch plans, lane/funnel balance |
| Copywriter | `scripting` | Scripts, hooks, per-platform captions, lead-magnet guides |
| Art Director | `production`, `editing`, `carousels` (planned) | Cuts, captions, QC, thumbnails; carousels in v0.4 |
| Publisher | `publishing`, `trial-reels` | Scheduling, cross-posting, tracked links, Instagram trial-reel variations |
| Community | `community` | Keyword DMs, reply drafts, lead handoff |
| Chief of Staff | `onboarding`, `ops` | Morning brief, approvals, Telegram/Discord chat |

The worker runs agents headless via `claude -p` against the workspace, with the AttentionOS MCP server attached. Two modes are set in `config/attentionos.config.ts`:

| | `mode: "copilot"` | `mode: "autopilot"` |
|---|---|---|
| Triggers | On request: Studio chat, Run now, approvals, Claude Code, Telegram | Same, plus cron schedules (overnight research, morning brief, DM triage) |
| Needs | Stack running, Claude token | Same, on a host that stays up |

Engine: `runner: { engine: "claude-code" }` (default, bills your Claude plan) or `"api"` (metered, `ANTHROPIC_API_KEY`). Same skills, MCP server and DB either way. See [docs/copilot-vs-autopilot.md](docs/copilot-vs-autopilot.md).

### Claude Code

The workspace ships with `.mcp.json` (pointing into the stack via `docker compose exec`) and `.claude/settings.json` (enables the `attentionos` plugin):

```bash
cd "$AOS/workspace" && claude
```

| Command | |
|---|---|
| `/attention:init` | Brand Kit interview |
| `/attention:brief` | Morning brief |
| `/attention:research` | Niche scan |
| `/attention:script <idea>` | Validated script |
| `/attention:edit <file>` | Footage → post-ready reel |
| `/attention:publish` | Schedule approved content |
| `/attention:inbox` | Triage DMs/comments with reply drafts |
| `/attention:approvals` | Pending approvals |
| `/attention:learn` | Post-mortem |
| `/attention:lesson <correction>` | Persist a rule to `brand/lessons.md` |
| `/attention:doctor` | Setup check |

## Modules

Toggled in `config/attentionos.config.ts`. Each is `modules/<id>/` with a `module.json`, jobs, tools, skills and tests.

| Module | Tier | Level | Docs |
|---|---|---|---|
| `onboarding` | core | 1 | [docs/modules/onboarding.md](docs/modules/onboarding.md) |
| `research` | core | 1 | [docs/modules/research.md](docs/modules/research.md) |
| `strategy` | core | 1 | [docs/modules/strategy.md](docs/modules/strategy.md) |
| `scripting` | core | 1 | [docs/modules/scripting.md](docs/modules/scripting.md) |
| `ops` | core | 1 | [docs/modules/ops.md](docs/modules/ops.md) |
| `learn` | core | 1 | [docs/modules/learn.md](docs/modules/learn.md) |
| `knowledge` | core | 1 | [docs/modules/knowledge.md](docs/modules/knowledge.md) |
| `production` | default | 2 | [docs/modules/production.md](docs/modules/production.md) |
| `editing` | default | 2 | [docs/modules/editing.md](docs/modules/editing.md) |
| `publishing` | default | 3 | [docs/modules/publishing.md](docs/modules/publishing.md) |
| `community` | default | 3 | [docs/modules/community.md](docs/modules/community.md) |
| `trial-reels` | default | 3 | [docs/modules/trial-reels.md](docs/modules/trial-reels.md) |
| `carousels` | opt-in, planned (v0.4) | 2 | [docs/modules/carousels.md](docs/modules/carousels.md) |

Levels: [1](docs/setup/level-1.md) onboarding + scripts · [2](docs/setup/level-2.md) editing · [3](docs/setup/level-3.md) publishing + engagement · [4](docs/setup/level-4.md) autopilot, server, Telegram.

## Providers

Adapters in `packages/providers/<kind>-<vendor>`. Guides: [docs/providers/README.md](docs/providers/README.md).

| Kind | Default | Alternatives |
|---|---|---|
| Publishing and inbox | Zernio | Blotato, manual (export and notify) |
| Own analytics | Zernio | Blotato, Instagram Graph API, CSV import |
| Competitor research | Apify | Instagram Graph API, yt-dlp |
| Trends | RSS, Google News, Hacker News, Reddit, GitHub | X via Apify (planned) |
| ASR | whisper.cpp | Parakeet (planned), cloud Whisper (planned) |
| Rendering | Cut engine | Motion engine with Remotion (planned; opt-in, Remotion license required for companies over 3 people) |
| Notifications / chat | Telegram | Discord, console, email (planned) |
| CRM | Built-in contacts | Webhook, Google Sheets, GoHighLevel, HubSpot |
| Images | Templates only | OpenAI (planned), Gemini (planned) |
| Storage | Local disk | S3 or R2 (planned) |
| Embeddings | Local (no key) | OpenAI, Voyage |

Running cost is whatever you connect: Claude plan ($20+) or API usage, optional VPS ($10–20), Zernio ($0–24), Apify ($0–29). See [docs/costs.md](docs/costs.md).

## Repository layout

```
attentionOS/
├─ .claude-plugin/        Marketplace manifest for the Claude Code plugin
├─ plugin-src/            Plugin sources: commands, agents, hooks (built into plugin/)
├─ apps/
│  ├─ cli/                `attentionos` CLI (runs inside the Docker stack)
│  ├─ studio/             Studio (dashboard)
│  └─ worker/             Background worker (schedules, queue, webhooks)
├─ packages/
│  ├─ core/               Types, config + Brand Kit schemas, module/job/tool/provider contracts, Postgres client
│  ├─ db/                 Migrations (schema v1), migration runner, seed loader for tests
│  ├─ mcp/                MCP data server
│  ├─ runner/             LLM runner with budgets
│  ├─ scoring/            Outlier, heat and attribution
│  ├─ guardrails/         Deterministic validators
│  ├─ knowledge/          Local RAG over pgvector
│  ├─ media/ · runtime/   Media sidecar client, job runtime
│  ├─ render-motion/      Remotion render engine (opt-in, stub in v0.1)
│  └─ providers/          One package per vendor adapter
├─ modules/               research, strategy, scripting, editing, publishing, community, ops, learn, …
├─ media-py/              Python 3.12 (uv): ASR, cuts, rendering, QC, local embeddings
├─ templates/workspace/   What `attentionos create` copies into a new workspace
├─ presets/               Starting points per business type
├─ deploy/                Dockerfile, compose stack, entrypoint, `aos`, backup and uninstall scripts
├─ design/DESIGN.md       Design system
└─ docs/                  Install, setup levels, modules, providers, FAQ, architecture, ADRs
```

## Development

```bash
corepack enable           # pnpm version pinned in package.json
pnpm install
pnpm db:start             # Postgres + pgvector in Docker on 127.0.0.1:55433 (DATABASE_URL in .env.example)
pnpm check                # typecheck + brand-literal guard + tests
pnpm attentionos <cmd>    # CLI from source, e.g. pnpm attentionos doctor
pnpm plugin:build         # assemble plugin/ from plugin-src/ + module skills
docker build -f deploy/Dockerfile -t attentionos:local .
```

Copy `.env.example` to `.env` for local dev. Without Docker, `pnpm attentionos studio` (Studio on 127.0.0.1) and `pnpm attentionos up` (Studio + worker) run straight from source; see [docs/studio.md](docs/studio.md). Conventions: TypeScript strict, ESM with explicit `.ts` imports, Zod v4 at every boundary, postgres.js, Vitest with recorded provider fixtures (no network in tests), pytest + ruff for `media-py`. Repo rules: [CLAUDE.md](CLAUDE.md), [CONTRIBUTING.md](CONTRIBUTING.md).

## Docs

- [Install](docs/install.md) · [Server](docs/deploy/server.md) · [Claude sign-in](docs/claude-sign-in.md)
- Setup levels: [1](docs/setup/level-1.md) · [2](docs/setup/level-2.md) · [3](docs/setup/level-3.md) · [4](docs/setup/level-4.md)
- [Studio](docs/studio.md) · [Daily workflow](docs/daily-workflow.md) · [Analytics](docs/analytics.md)
- [Architecture](docs/architecture.md) · [ADRs](docs/adr/README.md) · [Design system](design/DESIGN.md)
- [Hermes Agent integration status and compatibility contract](docs/integrations/hermes-agent.md)
- [Providers](docs/providers/README.md) · [Costs](docs/costs.md) · [FAQ](docs/faq.md)

## Report an issue

- **Bugs:** [open an issue](https://github.com/evanbaker315/AttentionOS/issues/new/choose) with the bug report form. Include the output of `./aos doctor`, your OS and how you installed, what you did, what you expected, and what happened (`./aos logs` helps). Never paste API keys, tokens or anyone's personal data.
- **Feature or provider requests:** use the feature request or provider request form on the same page.
- **Questions and ideas:** [Discussions](https://github.com/evanbaker315/AttentionOS/discussions).
- **Security vulnerabilities:** never in a public issue. Report privately via [GitHub security advisories](https://github.com/evanbaker315/AttentionOS/security/advisories/new); see [SECURITY.md](SECURITY.md).

Search existing issues first. Since the project updates often, check that you're on the latest version (`./aos update`) before reporting.

## Contributing

Contributions are welcome: providers, presets, format templates, skills, docs and fixes. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The rules that matter most:

- **`main` is protected.** Nobody pushes to it directly; every change goes through a pull request.
- **Only the maintainer approves and merges PRs** ([CODEOWNERS](.github/CODEOWNERS)). CI must pass: typecheck, brand-literal guard, tests, media-py checks, gitleaks and DCO.
- **Sign off every commit** (`git commit -s`, [DCO](https://developercertificate.org/)).
- **No personal, client or third-party data**, no real brand or creator names, and no copied third-party media. Use obvious placeholders (`Examplebrand Studio`, `@demo_creator_a`, `*.example`).
- **No brand words in engine code or skills.** Reference Brand Kit files by path. Deterministic validators stay code, never prompts.
- **Open an issue first** for anything bigger than a fix, so we can agree on the approach before you build it.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately via [GitHub security advisories](https://github.com/evanbaker315/AttentionOS/security/advisories/new). See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party notices in [NOTICE](NOTICE).

AttentionOS is an independent open-source project. It's powered by Claude and isn't affiliated with or endorsed by Anthropic. Platform names belong to their owners.
