# kimi-code-mcp

English | **[中文說明](README_zh.md)**

---

**Delegate codebase analysis from Claude to Kimi Code (`kimi-for-coding`, 256K) — cut token cost ~90%.**

| Task                         | Claude only | Claude + kimi-code-mcp | Savings |
|------------------------------|-------------|------------------------|---------|
| Analyze 200-file monorepo    | ~250K tok   | ~25K tok               | 90%     |
| Summarize 50-page RFC PDF    | ~60K tok    | ~6K tok                | 90%     |
| Cross-reference 100 commits  | ~80K tok    | ~8K tok                | 90%     |

<sub>*Illustrative — actual savings depend on task.</sub>

## Quick start

```bash
# 1. Install Kimi CLI and log in
curl -L code.kimi.com/install.sh | bash
kimi login

# 2. Install via npm
npm install -g kimi-mcp-server
```

Add to `.mcp.json` (project-level or `~/.claude/mcp.json` for global):

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "npx",
      "args": ["-y", "kimi-mcp-server"]
    }
  }
}
```

Run `/mcp` in Claude Code to verify — you should see `kimi-code` with 8 tools.

> [!TIP]
> **You don't need the CLI for the common case.** `kimi_query` and `kimi_verify` call the Kimi Code API directly — no Python CLI install or `kimi login` required. Just provide an API key via `$KIMICODE_API_KEY` or `~/.kimi/config.toml` (see [Kimi Code API Setup](#kimi-code-api-setup)). Only the codebase-reading tools (`kimi_analyze`, `kimi_resume`) need the CLI. See [Two backends: API vs CLI](#two-backends-api-vs-cli) for the full split.

## How it works

1. **Claude calls the `kimi_analyze` tool** when a task needs bulk codebase reading.
2. **MCP routes the request to Kimi Code** (`kimi-for-coding`, 256K context) — Kimi reads the entire codebase in one pass.
3. **The result is piped back as a structured response** — Claude acts on it with precise, targeted edits.

```
┌──────────────┐  stdio/MCP   ┌──────────────┐  subprocess   ┌──────────────┐
│  Claude Code │ ◄──────────► │ kimi-code-mcp│ ────────────► │ Kimi CLI     │
│  (conductor) │              │ (MCP server) │               │ (256K ctx)   │
└──────────────┘              └──────────────┘               └──────────────┘
```

## Two backends: API vs CLI

The server reaches Kimi two different ways, and **each tool uses the one that fits its job**. Knowing which is which tells you what you need to set up.

| Backend | How it talks to Kimi | What it needs | Sees your codebase? |
|---------|----------------------|---------------|---------------------|
| **Direct API** | HTTPS to `api.kimi.com/coding/v1` | An API key only (`$KIMICODE_API_KEY` or `~/.kimi/config.toml`) | ❌ No — you paste in the context |
| **Local CLI** | Spawns the `kimi` binary as a subprocess | CLI installed **and** `kimi login` done | ✅ Yes — reads files from disk |

| Tool | Backend | Why |
|------|---------|-----|
| `kimi_query` | **API** (CLI only if no key configured) | Contextless Q&A — no codebase needed, so the API is simpler and has no login dependency |
| `kimi_verify` | **API** | You pass the code/diff/claim inline; Kimi judges it as an independent third party |
| `kimi_analyze` | **CLI** | Must read your whole codebase (256K ctx) from disk |
| `kimi_resume` | **CLI** | Continues a stateful CLI session that holds prior codebase context |
| `kimi_list_sessions`, `kimi_cache_*`, `kimi_status` | local | Read local session/cache metadata |

> [!IMPORTANT]
> **Most users only need the API key.** If you just want a second opinion / verification (`kimi_query`, `kimi_verify`), set the API key and you're done — skip the CLI entirely. Install + `kimi login` only when you want Kimi to read your codebase via `kimi_analyze` / `kimi_resume`.

Run **`kimi_status`** any time to see which backends are live — it reports the API-configured state and the CLI install/auth state separately.

## Guidelines for agents

If you are an AI agent (Claude Code, a subagent, etc.) deciding when to call these tools:

- **Cross-check your own work before committing → `kimi_verify`.** Paste the actual diff/code/claim **plus the surrounding context** (goal, constraints, signatures). Kimi sees *only* the `context` string — no repo, no session history. Vague context → useless review.
- **Quick model-agnostic programming question → `kimi_query`.** No codebase needed. Returns a different model's opinion.
- **Need to understand a large/unfamiliar codebase → `kimi_analyze`** with `work_dir`. Prefer this over reading 50 files yourself; it's ~10× cheaper in Claude tokens. Requires the CLI to be installed and logged in.
- **Drill deeper after an analyze → `kimi_resume`** with the returned `session_id` (retains up to 256K tokens of prior context).
- **Don't know why a Kimi call failed → `kimi_status` first.** "Not authenticated" on the CLI does **not** affect `kimi_query`/`kimi_verify` (those use the API).
- **Keep outputs lean.** Default `detail_level: summary` for orientation; raise to `normal`/`detailed` only when you need code snippets. Bigger output = more Claude tokens, defeating the purpose.
- **Skip Kimi for small/single-file work** — Claude reading directly is faster under ~10 files.

---

MCP server that connects [Kimi Code](https://www.kimi.com/code) (model `kimi-for-coding`, 256K context, auto-upgraded) with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — letting Claude orchestrate while Kimi handles the heavy reading.

<div align="center">
  <img src="assets/llm-cost-vs-intelligence.png" alt="LLM Cost vs Intelligence — Kimi Code delivers frontier-level intelligence at a fraction of the cost" width="720" />
  <br />
  <sub>Kimi Code sits on the efficiency frontier — near-Claude intelligence at 10x lower cost. <a href="https://www.kimi.com/code">kimi.com/code</a></sub>
</div>

> [!TIP]
> **Stop paying Claude to read files.** Kimi Code delivers frontier-class code intelligence at a fraction of the cost (see chart above). Delegate bulk codebase scanning to Kimi (256K context, near-zero cost) and let Claude focus on what it does best — reasoning, decisions, and precise code edits. One `kimi_analyze` call can replace 50+ file reads.

## What is Kimi Code?

[**Kimi Code**](https://www.kimi.com/code/en) is an AI code agent by Moonshot AI. The model ID `kimi-for-coding` (1T MoE, 256K context) automatically receives backend upgrades — no version pinning required. It works across Terminal, IDE, and CLI — writing, debugging, refactoring, and analyzing code autonomously.

Key specs:
- **256K token context** — reads entire codebases in one pass
- **Parallel agent spawning** — handles concurrent tasks
- **Shell, file, and web access** — full developer toolchain
- **Install**: `curl -L code.kimi.com/install.sh | bash`

> [!WARNING]
> **Kimi Code membership required.** All tools ultimately hit Kimi Code, which needs an active [Kimi Code plan](https://www.kimi.com/code/en). The API tools (`kimi_query`, `kimi_verify`) authenticate with an **API key**; the codebase tools (`kimi_analyze`, `kimi_resume`) additionally need the **CLI installed + `kimi login`**. See [kimi.com/code](https://www.kimi.com/code/en) for pricing tiers and quotas.

## Install from source

If you prefer to build locally instead of using the npm package:

```bash
git clone https://github.com/howardpen9/kimi-code-mcp.git
cd kimi-code-mcp && npm install && npm run build
```

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "node",
      "args": ["/absolute/path/to/kimi-code-mcp/dist/index.js"]
    }
  }
}
```

## Kimi Code API Setup

> [!NOTE]
> **Kimi Code API and Moonshot API are separate providers** — their API keys are not interchangeable.

There are two ways to configure the Kimi Code API for the CLI:

### Option 1: OAuth Login (Recommended)

In the Kimi Code CLI shell, run:

```bash
kimi
```

Then use the `/login` (or `/setup`) command:

```
/login
```

1. Select **Kimi Code** as the platform
2. Your browser opens for OAuth authorization
3. Config is saved automatically to `~/.kimi/config.toml`

> [!NOTE]
> **`zsh: command not found: kimi` after install?** The installer puts the binary at `~/.local/bin/kimi`, which may not be on your `PATH`. Add it (then restart your shell or open a new tab):
> ```bash
> echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
> ```
> The MCP server calls the binary by absolute path, so this only affects running `kimi` yourself in a terminal (e.g. for `kimi login`).

### Option 2: Manual API Key Configuration

#### Get your API Key

1. Visit [code.kimi.com](https://code.kimi.com)
2. Sign in → **Settings** → **API Keys**
3. Create a new key (starts with `sk-`, shown only once)

#### Edit config file

```bash
nano ~/.kimi/config.toml
```

Add:

```toml
[providers.kimi-code]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "sk-your-api-key"

[models.kimi-for-coding]
provider = "kimi-code"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = ["thinking"]

[defaults]
model = "kimi-for-coding"
```

#### Using environment variables (recommended for security)

```bash
# Add to ~/.zshrc (macOS) or ~/.bashrc (Linux)
export KIMICODE_API_KEY="sk-your-api-key"
```

Then reference it in `config.toml`:

```toml
[providers.kimi-code]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "${KIMICODE_API_KEY}"
```

### Multi-provider config example

You can configure both Kimi Code and Moonshot side by side:

```toml
[providers.kimi-code]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "${KIMICODE_API_KEY}"

[providers.moonshot-cn]
type = "kimi"
base_url = "https://api.moonshot.cn/v1"
api_key = "${MOONSHOT_API_KEY}"

[models.kimi-for-coding]
provider = "kimi-code"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = ["thinking"]

[models.kimi-k2]
provider = "moonshot-cn"
model = "kimi-k2-0905-preview"
max_context_size = 256000
capabilities = ["thinking"]

[defaults]
model = "kimi-for-coding"
```

Switch models at any time with `/model` or `/model kimi-k2` in the CLI.

### Kimi Code vs Moonshot

| Feature | Kimi Code | Moonshot |
|---------|-----------|----------|
| Focus | Optimized for coding | General-purpose chat |
| Endpoint | `api.kimi.com/coding/v1` | `api.moonshot.cn/v1` |
| API Key | Separate — apply at [code.kimi.com](https://code.kimi.com) | Separate |
| SearchWeb / FetchURL | Built-in | Not available |
| Context | 262K | 256K |

## What You Can Do

Just tell Claude what you need. It will delegate to Kimi automatically:

| Prompt | What happens |
|--------|-------------|
| "Analyze this codebase's architecture" | Kimi reads all files (256K ctx), Claude acts on the report |
| "Scan for security vulnerabilities, then review Kimi's findings" | Kimi audits, Claude cross-examines — AI pair review |
| "Map all dependencies of the auth module, then plan the refactoring" | Kimi builds the dependency graph, Claude plans the changes |
| "Review the recent changes for regressions and edge cases" | Kimi reviews full context (not just the diff), Claude synthesizes |
| "Resume the last Kimi session and ask about the API design" | Kimi retains 256K tokens of context across sessions |

## Why This Exists

Claude Code is powerful but expensive. Every file it reads costs tokens. Meanwhile, many tasks — pre-reviewing large codebases, scanning for patterns, generating audit reports — are **high-certainty work** that doesn't need Claude's full reasoning power.

> [!IMPORTANT]
> **The cost equation:** Claude reads 50 files to understand your architecture = expensive. Kimi reads 50 files via `kimi_analyze` = near-zero cost. Claude then acts on Kimi's structured report = minimal tokens. **Total savings: 60-80% fewer Claude tokens on analysis-heavy tasks.**

### How It Saves Tokens

```
                          ┌─────────────────────────────┐
                          │   You (the developer)       │
                          └──────────┬──────────────────┘
                                     │ prompt
                                     ▼
                          ┌─────────────────────────────┐
                          │   Claude Code (conductor)   │
                          │   - orchestrates workflow    │
                          │   - makes decisions          │
                          │   - writes & edits code      │
                          └──────┬──────────────┬───────┘
                      precise    │              │  delegate
                      edits      │              │  bulk reading
                      (tokens)   │              │  (FREE)
                                 ▼              ▼
                          ┌──────────┐   ┌──────────────┐
                          │ your     │   │  Kimi Code   │
                          │ codebase │   │  - 256K ctx  │
                          └──────────┘   │  - reads all │
                                         │  - reports   │
                                         └──────────────┘
```

1. **Claude** receives your task → decides it needs codebase understanding
2. **Claude** calls `kimi_analyze` via MCP → Kimi reads the entire codebase (256K context, near-zero cost)
3. **Kimi** returns a structured analysis
4. **Claude** acts on the analysis with precise, targeted edits

**Result: Claude only spends tokens on decision-making and code writing, not on reading files.**

### Mutual Code Review with Kimi Code

`kimi-for-coding` is a 1T MoE model designed for deep code comprehension. This enables **AI pair review**:

1. **Kimi pre-reviews** — 256K context means it sees the entire codebase at once: security issues, anti-patterns, dead code, architectural problems
2. **Claude cross-examines** — reviews Kimi's findings, challenges questionable items, adds its own insights
3. **Two perspectives** — different models catch different things. What one misses, the other finds

## Use Kimi as a Code Reviewer

Beyond ad-hoc analysis, you can use Kimi as a **dedicated reviewer** in your workflow:

### PR Review Workflow

```
┌──────────────┐   diff    ┌──────────────┐  structured  ┌──────────────┐
│   Your PR    │ ────────► │  Kimi Code   │  findings    │  Claude Code │
│  (changes)   │           │  (reviewer)  │ ────────────►│  (decision)  │
└──────────────┘           └──────────────┘              └──────────────┘
```

### Continuous Audit Pattern

| When | What | Why |
|------|------|-----|
| Before merging | Kimi scans diff + affected modules | Catch regressions early |
| Weekly | Full codebase sweep | Accumulated tech debt |
| Pre-release | Security-focused audit | Ship with confidence |

Each review session can be **resumed** (`kimi_resume`) — Kimi retains up to 256K tokens of context from previous sessions, building understanding over time.

### What Kimi Reviews Well

| Review Type | Why Kimi Excels |
|-------------|----------------|
| Security audit | 256K context sees full attack surface, not just isolated files |
| Dead code detection | Can trace imports/exports across entire codebase |
| API consistency | Compares patterns across all endpoints simultaneously |
| Dependency analysis | Maps full dependency graph in one pass |
| Architecture review | Sees the forest and the trees at the same time |

## Tools

| Tool | Description | Timeout |
|------|-------------|---------|
| `kimi_analyze` | **CLI** — deep codebase analysis (architecture, audit, refactoring) | 10 min |
| `kimi_query` | **API** — quick programming questions, no codebase context (CLI only if no key configured) | 2 min |
| `kimi_verify` | **API** — independent third-party verification of code/diffs/claims; no CLI required, context-driven | 5 min |
| `kimi_list_sessions` | List existing Kimi sessions with metadata | instant |
| `kimi_resume` | **CLI** — resume a previous session (up to 256K token context) | 10 min |
| `kimi_status` | Report API-configured state + CLI install/version/auth status | instant |
| `kimi_cache_status` | View session cache statistics and performance metrics | instant |
| `kimi_cache_invalidate` | Manually invalidate cached sessions (by dir or all) | instant |

### Output Control Parameters

`kimi_analyze` and `kimi_resume` support these parameters to control output size:

| Parameter | Values | Default | Effect |
|-----------|--------|---------|--------|
| `detail_level` | `summary` / `normal` / `detailed` | `normal` | Controls prompt-side verbosity instructions |
| `max_output_tokens` | number | `15000` | Hard ceiling — output truncated at clean boundary if exceeded |
| `include_thinking` | boolean | `false` | Include Kimi's internal reasoning chain (10-30K extra tokens) |

`kimi_query` also supports `max_output_tokens` and `include_thinking`.

## Token Economics

> [!NOTE]
> The savings come from **compression ratio**, not from free reading. Kimi's subscription cost still applies, but the key benefit is reducing expensive Claude Code token consumption.

```
                    Without kimi-code-mcp        With kimi-code-mcp (normal)
                    ─────────────────────        ───────────────────────────
Raw source:         50 files × ~4K = 200K        Kimi reads (subscription cost)
Claude reads:       200K tokens                  5-15K token report
Claude token cost:  $$$                          $
```

**Compression ratio by `detail_level`:**

| Level | Compression | Output Size | Equivalent Source | Best For |
|-------|------------|-------------|-------------------|----------|
| `summary` | 40-100x | ~2-5K tokens | ~8-20K chars / ~200-500 lines of code | Quick orientation, file inventory |
| `normal` | 15-40x | ~5-15K tokens | ~20-60K chars / ~500-1500 lines of code | Architecture review, dependency mapping |
| `detailed` | 5-15x | ~15-40K tokens | ~60-160K chars / ~1500-4000 lines of code | Security audit with code snippets |

**When savings happen:**
- Large codebases (50+ files) — architecture understanding, cross-file scanning
- Security audits, dead code detection, API consistency checks
- Pre-review before targeted edits (scan first → edit specific files)

**When to skip and let Claude read directly:**
- Small codebases (<10 files) — direct reading is faster
- Single-file modifications — Claude's built-in file reading is sufficient
- When you need every line of code — `detailed` output approaches raw reading cost

## Implementation details

Under the hood:

1. Claude Code calls an MCP tool (e.g., `kimi_analyze`)
2. This server spawns the `kimi` CLI with the prompt and codebase path
3. Kimi autonomously reads files, analyzes the code (up to 256K tokens)
4. The result is parsed from Kimi's JSON output and returned to Claude Code
5. Claude acts on the structured results — edits, plans, or further analysis

### CLI Invocation Reference

The MCP server calls the Kimi CLI in non-interactive (print) mode:

```bash
kimi --work-dir <path> --print -p "<prompt>"
```

| Flag | Purpose |
|------|---------|
| `--print` | Non-interactive mode — outputs result and exits (required for subprocess use) |
| `-p` / `--prompt` | Pass prompt directly (bypasses interactive shell) |
| `--work-dir` / `-w` | Set codebase root directory |
| `-S <id>` | Resume a specific session by ID |
| `--no-thinking` | Disable thinking mode |

> [!NOTE]
> There is no `kimi analyze` subcommand. The MCP tool is named `kimi_analyze`, but the underlying CLI uses the flags above. Use this syntax to call Kimi directly for debugging or scripting.

## Advanced Setup

For development (auto-recompile on changes):

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/kimi-code-mcp/src/index.ts"]
    }
  }
}
```

## npm

Published as [`kimi-mcp-server`](https://www.npmjs.com/package/kimi-mcp-server) on npm.

```bash
npx kimi-mcp-server          # run directly
npm install -g kimi-mcp-server # install globally
```

## Project Structure

```
src/
├── index.ts           # MCP server setup, tool definitions, API-vs-CLI routing
├── kimi-api.ts        # Direct Kimi Code API client (kimi_query / kimi_verify)
├── kimi-runner.ts     # Spawns kimi CLI, parses output, handles timeouts
├── cache-manager.ts   # Session cache (warmup, reuse, invalidation)
└── session-reader.ts  # Reads Kimi session metadata from ~/.kimi/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
