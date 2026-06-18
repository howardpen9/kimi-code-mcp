# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`KIMI_SHARE_DIR` env var support** in `session-reader.ts` and `kimi-runner.ts` — overrides the default `~/.kimi` data root, matching the same env var the upstream Kimi CLI recognizes. Default behavior unchanged

### Documentation

- **Brand sync with current Kimi Code docs (2026-06)**: replaced "Kimi K2.5" references in `README.md`, `README_zh.md`, and `package.json` with `kimi-for-coding` (the official model ID, auto-upgraded on the backend)
- **Pricing table removed**: replaced the hardcoded Moderato/Allegretto/Allegro/Vivace table with a link to [kimi.com/code](https://www.kimi.com/code/en); subscription tiers and quotas change too often to maintain in README
- Added **CLI Invocation Reference** section to both READMEs clarifying the exact flags the MCP server uses (`--print -p`) and explicitly noting that `kimi analyze` subcommand does not exist

## [0.3.0] - 2026-03-04

### Added (Phase 1: Context Caching)

- **Session Cache Manager** — automatic caching of Kimi sessions per working directory
  - `CacheManager` class with LRU eviction, TTL expiration, and change detection
  - Git commit hash detection for automatic invalidation on code changes
  - Fallback to file mtime hashing for non-git repositories
  - Concurrent warmup deduplication (prevents duplicate session creation)
- **New MCP Tools**
  - `kimi_cache_status` — view cache statistics, hit rates, and entry details
  - `kimi_cache_invalidate` — manual cache invalidation (single or all)
- **Enhanced `kimi_analyze`**
  - `use_cache` parameter (default: true) — enable automatic session caching
  - Automatic cache hit/miss indicators in response
  - Automatic retry on invalid cached sessions
- **Enhanced `kimi_runner`**
  - `sessionId` returned in `KimiResult` for cache tracking
  - `extractSessionId()` function parses session ID from Kimi output
- **Configuration**
  - `KIMI_CACHE_DEBUG` environment variable for debug logging
  - Configurable `maxSize` (default: 10) and `maxAgeMs` (default: 30min)
- **Documentation**
  - Comprehensive test requirements in `TEST_REQUIREMENTS.md`
  - 25+ test cases covering functional and non-functional requirements

### Performance Improvements

- **Cache hit latency**: ~10s vs ~60-120s for cache miss (6-12x faster)
- **Token cost reduction**: Subsequent queries reuse cached context
- **Session reuse**: Up to 256K tokens of context retained between calls

## [0.2.0] - 2026-03-03

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

[Unreleased]: https://github.com/howardpen9/kimi-code-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/howardpen9/kimi-code-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/howardpen9/kimi-code-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/howardpen9/kimi-code-mcp/releases/tag/v0.1.0
