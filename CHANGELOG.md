# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Kimi Code reviewer documentation and workflow examples

## [0.1.0] - 2026-03-03

### Added
- Initial MCP server with 4 tools:
  - `kimi_analyze` — deep codebase analysis (architecture, audit, refactoring)
  - `kimi_query` — quick programming questions without codebase context
  - `kimi_list_sessions` — list existing Kimi sessions with metadata
  - `kimi_resume` — resume previous sessions (up to 256K token context)
- Kimi CLI subprocess management with stream-json parsing
- Session metadata reader for `~/.kimi/sessions/`
- Configurable timeouts (10 min for analysis, 2 min for queries)
- Thinking mode support (`--thinking` flag)
- Bilingual documentation (English + 繁體中文)
- CONTRIBUTING.md with development workflow guide

[Unreleased]: https://github.com/howardpen9/kimi-code-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/howardpen9/kimi-code-mcp/releases/tag/v0.1.0
