# Monorepo note

This package lives in the **coding-agent-mcps** workspace for local development next to `grok-peer` and `grok-build-media`.

| Item | Value |
| --- | --- |
| Public publish remote | https://github.com/howardpen9/kimi-code-mcp |
| npm package | `kimi-mcp-server` |
| Role in monorepo | Host → Kimi MCP (bulk CLI analyze + API query/verify) |

**Publish workflow:** develop here (or keep a checkout of the public repo in sync), then push to `howardpen9/kimi-code-mcp` for releases. Do not treat this monorepo git remote as the npm/GitHub source of truth unless you explicitly rewire remotes.

See monorepo root `README.md` § *Kimi stack*.
