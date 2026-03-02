# kimi-code-mcp

MCP server that bridges [Kimi Code](https://kimi.ai/) (256K context AI coding assistant) with Claude Code and other MCP clients.

## Features

- **`kimi_analyze`** — Send a codebase to Kimi for deep analysis (architecture review, cross-file audit, refactoring plans)
- **`kimi_query`** — Ask Kimi general programming questions without codebase context
- **`kimi_list_sessions`** — List existing Kimi sessions with metadata
- **`kimi_resume`** — Resume a previous session with full context preserved (up to 256K tokens)

## Prerequisites

- [Kimi CLI](https://github.com/anthropics/kimi-cli) installed via `uv tool install kimi-cli`
- Kimi authenticated: `kimi login`

## Setup

```bash
npm install
npm run build
```

## Usage with Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "node",
      "args": ["/path/to/kimi-code-mcp/dist/index.js"]
    }
  }
}
```

Or for development:

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "npx",
      "args": ["tsx", "/path/to/kimi-code-mcp/src/index.ts"]
    }
  }
}
```

## Tools

| Tool | Description | Timeout |
|------|-------------|---------|
| `kimi_analyze` | Codebase analysis with optional thinking mode | 10 min |
| `kimi_query` | Quick questions, no codebase context | 2 min |
| `kimi_list_sessions` | List sessions, filter by work directory | instant |
| `kimi_resume` | Continue a previous session | 10 min |

## How It Works

1. MCP client (Claude Code) calls a tool via stdio
2. This server spawns the `kimi` CLI with appropriate flags
3. Kimi reads the codebase autonomously (up to 256K context)
4. The result is parsed and returned to the MCP client

## License

MIT
