# kimi-code-mcp

English | **[中文說明](README_zh.md)**

---

MCP server that connects [Kimi Code](https://www.kimi.com/code) (K2.5, 256K context) with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — letting Claude orchestrate while Kimi handles the heavy reading.

## Why This Exists

Claude Code is powerful but expensive. Every file it reads, every codebase scan it performs, costs tokens. Meanwhile, many tasks — pre-reviewing large codebases, scanning for patterns across hundreds of files, generating audit reports — are **high-certainty work** that doesn't need Claude's full reasoning power.

**The idea is simple: Claude Code as the conductor, Kimi Code as the specialist reader.**

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
                      edits      │              │  bulk analysis
                                 ▼              ▼
                          ┌──────────┐   ┌──────────────┐
                          │ your     │   │  Kimi Code   │
                          │ codebase │   │  (K2.5)      │
                          └──────────┘   │  - 256K ctx  │
                                         │  - reads all │
                                         │  - reports   │
                                         └──────────────┘
```

### Save Claude Code Tokens

Instead of Claude reading 50+ files to understand your architecture, delegate that to Kimi:

1. **Claude** receives your task → decides it needs codebase understanding
2. **Claude** calls `kimi_analyze` via MCP → Kimi reads the entire codebase (256K context, near-zero cost)
3. **Kimi** returns a structured analysis
4. **Claude** acts on the analysis with precise, targeted edits

Result: Claude only spends tokens on **decision-making and code writing**, not on reading files.

### Mutual Code Review with K2.5

Kimi Code is powered by K2.5 — a model designed for deep code comprehension. This enables a powerful pattern:

1. **Kimi pre-reviews** — scan the full codebase for security issues, anti-patterns, dead code, or architectural problems (256K context means it sees everything)
2. **Claude cross-examines** — reviews Kimi's findings, challenges questionable items, adds its own insights
3. **Two perspectives** — different models catch different things. What one misses, the other finds.

This isn't just delegation — it's **AI pair review**. Two models with different strengths auditing the same code from different angles.

## Use Kimi as a Code Reviewer

Beyond ad-hoc analysis, you can use Kimi Code as a **dedicated code reviewer** in your workflow:

### PR Review Workflow

```
┌──────────────┐   diff    ┌──────────────┐  structured  ┌──────────────┐
│   Your PR    │ ────────► │  Kimi Code   │  findings    │  Claude Code │
│  (changes)   │           │  (reviewer)  │ ────────────►│  (decision)  │
└──────────────┘           └──────────────┘              └──────────────┘
```

Ask Claude to delegate the review:
> "Use kimi_analyze to review the changes in this PR — focus on security, correctness, and edge cases"

Kimi reads the full context (not just the diff, but surrounding code too), then Claude synthesizes the findings into actionable review comments.

### Continuous Audit Pattern

For ongoing projects, establish a review rhythm:

1. **Before merging** — Kimi scans the diff + affected modules for regressions
2. **Weekly audit** — Kimi does a full codebase sweep for accumulated tech debt
3. **Pre-release** — Kimi performs a security-focused audit of the entire codebase

Each review session can be **resumed** (`kimi_resume`) — Kimi retains up to 256K tokens of context from previous sessions, so it builds understanding over time.

### What Kimi Reviews Well

| Review Type | Why Kimi Excels |
|-------------|----------------|
| Security audit | 256K context sees full attack surface, not just isolated files |
| Dead code detection | Can trace imports/exports across entire codebase |
| API consistency | Compares patterns across all endpoints simultaneously |
| Dependency analysis | Maps full dependency graph in one pass |
| Architecture review | Sees the forest and the trees at the same time |

## Features

| Tool | Description | Timeout |
|------|-------------|---------|
| `kimi_analyze` | Deep codebase analysis (architecture, audit, refactoring) | 10 min |
| `kimi_query` | Quick programming questions, no codebase context | 2 min |
| `kimi_list_sessions` | List existing Kimi sessions with metadata | instant |
| `kimi_resume` | Resume a previous session (up to 256K token context) | 10 min |

## Prerequisites

1. **Kimi CLI** — install via [uv](https://docs.astral.sh/uv/):
   ```bash
   uv tool install kimi-cli
   ```
2. **Authenticate Kimi**:
   ```bash
   kimi login
   ```
3. **Node.js** >= 18

## Installation

```bash
git clone https://github.com/howardpen9/kimi-code-mcp.git
cd kimi-code-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to your project's `.mcp.json` (or `~/.claude/mcp.json` for global):

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

For development (auto-recompile):

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

### Verify

In Claude Code, run `/mcp` to check the server is connected. You should see `kimi-code` with 4 tools.

## Example Workflows

**Delegate bulk analysis (save tokens):**
> "Use kimi_analyze to review this codebase's architecture, then tell me what needs refactoring"

**Mutual security audit:**
> "Have Kimi scan the codebase for security vulnerabilities, then review its findings and add anything it missed"

**Code review before merge:**
> "Use kimi_analyze to review the recent changes — check for regressions, security issues, and edge cases"

**Pre-review before refactoring:**
> "Ask Kimi to map all dependencies of the auth module, then plan the refactoring based on its analysis"

**Resume context-heavy sessions:**
> "List Kimi sessions for this project, then resume the last one to ask about the auth flow"

## How It Works

```
┌──────────────┐  stdio/MCP   ┌──────────────┐  subprocess   ┌──────────────┐
│  Claude Code │ ◄──────────► │ kimi-code-mcp│ ────────────► │ Kimi CLI     │
│  (conductor) │              │ (MCP server) │               │ (K2.5, 256K) │
└──────────────┘              └──────────────┘               └──────────────┘
```

1. Claude Code calls an MCP tool (e.g., `kimi_analyze`)
2. This server spawns the `kimi` CLI with the prompt and codebase path
3. Kimi autonomously reads files, analyzes the code (up to 256K tokens)
4. The result is parsed from Kimi's JSON output and returned to Claude Code
5. Claude acts on the structured results — edits, plans, or further analysis

## Project Structure

```
src/
├── index.ts           # MCP server setup, tool definitions
├── kimi-runner.ts     # Spawns kimi CLI, parses output, handles timeouts
└── session-reader.ts  # Reads Kimi session metadata from ~/.kimi/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
