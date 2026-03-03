# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `detail_level` parameter for `kimi_analyze` and `kimi_resume` (summary/normal/detailed)
- `max_output_tokens` parameter for all tools (default: 15000, hard truncation safety net)
- `include_thinking` parameter (default: false — saves 10-30K tokens per call)
- Structured output prompt engineering — Kimi returns concise markdown reports
- Token Economics documentation section in both READMEs
- Kimi Code reviewer documentation and workflow examples

### Changed
- Thinking blocks now excluded by default (previously always included)
- Output truncated at clean markdown boundaries when exceeding budget
- Tool descriptions updated to reflect budget-controlled output

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
