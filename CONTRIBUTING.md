# Contributing | 貢獻指南

Thanks for your interest in contributing! This project bridges Kimi Code with Claude Code via MCP.

感謝你有興趣貢獻！本專案透過 MCP 將 Kimi Code 與 Claude Code 串接。

## Getting Started | 開始

```bash
# Clone the repo
git clone https://github.com/howardpen9/kimi-code-mcp.git
cd kimi-code-mcp

# Install dependencies
npm install

# Run in development mode (auto-recompile)
npm run dev

# Build for production
npm run build
```

## Prerequisites | 前置需求

- Node.js >= 18 (this MCP). The Kimi Code CLI npm package needs Node.js >= 22.19.0; the [install script](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html) does not.
- Kimi Code CLI installed (`curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` or `npm install -g @moonshot-ai/kimi-code`). Do not use `uv tool install kimi-cli` — that package is the archived Python CLI.
- Binary linked where this server looks: `mkdir -p "$HOME/.local/bin" && ln -sfn "$HOME/.kimi-code/bin/kimi" "$HOME/.local/bin/kimi"`
- Kimi authenticated: `kimi login`

## Project Structure | 專案結構

```
src/
├── index.ts           # MCP server + tool definitions
├── kimi-runner.ts     # CLI subprocess management
└── session-reader.ts  # Session metadata reader
```

## Development Workflow | 開發流程

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes in `src/`
3. Test locally:
   ```bash
   # Run the MCP server directly
   npm run dev

   # Or build and test with Claude Code
   npm run build
   # Then restart Claude Code to pick up changes
   ```
4. Commit with descriptive messages
5. Open a PR

## Testing with Claude Code | 用 Claude Code 測試

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "kimi-code": {
      "command": "npx",
      "args": ["tsx", "/path/to/your/clone/src/index.ts"]
    }
  }
}
```

Then in Claude Code, use `/mcp` to verify the server is connected.

## Adding New Tools | 新增工具

To add a new MCP tool:

1. Define the tool in `src/index.ts` using `server.tool()`
2. Use Zod schemas for input validation
3. Handle errors gracefully (return `isError: true` with message)
4. Add appropriate timeouts

Example:

```typescript
server.tool(
  'kimi_new_tool',
  'Description of what the tool does',
  {
    param: z.string().describe('Parameter description'),
  },
  async ({ param }) => {
    // Implementation
    return { content: [{ type: 'text' as const, text: result }] }
  }
)
```

## Code Style | 程式碼風格

- TypeScript strict mode
- ES modules (`import/export`)
- Async/await for all async operations
- Descriptive error messages

## Reporting Issues | 回報問題

Please open an issue with:
- Your Node.js version
- Kimi CLI version (`kimi --version`)
- Error output / logs
- Steps to reproduce

## License

By contributing, you agree your contributions will be licensed under MIT.
