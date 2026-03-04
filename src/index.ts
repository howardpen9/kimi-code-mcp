#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runKimi, isKimiInstalled, getKimiStatus } from './kimi-runner.js'
import { listSessions } from './session-reader.js'
import { CacheManager, getGlobalCacheManager } from './cache-manager.js'

// Initialize global cache manager with debug enabled for development
const cacheManager = getGlobalCacheManager({ debug: process.env.KIMI_CACHE_DEBUG === '1' })

const server = new McpServer({
  name: 'kimi-code',
  version: '0.3.0',
})

// --- Output format instructions per detail level ---
const FORMAT_INSTRUCTIONS: Record<string, string> = {
  summary: `
OUTPUT FORMAT CONSTRAINTS:
- Maximum ~2000 words. Be extremely concise.
- Use bullet points, not paragraphs.
- List file paths and one-line descriptions only.
- No code snippets. No function bodies.
- Structure: ## Overview (2-3 sentences) → ## Key Findings → ## File Index`,

  normal: `
OUTPUT FORMAT CONSTRAINTS:
- Maximum ~5000 words. Be concise but thorough.
- Use structured sections with markdown headers.
- Include function/class signatures (name + params + return type), NOT full implementations.
- Include file paths with brief purpose descriptions.
- No full code blocks over 10 lines. Reference line numbers instead.
- Structure: ## Overview → ## Architecture → ## Key Findings → ## File Details`,

  detailed: `
OUTPUT FORMAT CONSTRAINTS:
- Maximum ~15000 words.
- Include relevant code snippets (keep each under 30 lines).
- Full function signatures with parameter documentation.
- Include dependency relationships and data flow descriptions.`,
}

const AI_CONSUMER_NOTICE = `
IMPORTANT: Your response will be consumed by another AI model (Claude) with limited context window. Prioritize information density over completeness. Use structured markdown. Omit boilerplate, pleasantries, and obvious observations. Put the most critical findings first.`

function wrapPromptWithFormat(prompt: string, detailLevel: string): string {
  const formatBlock = FORMAT_INSTRUCTIONS[detailLevel] || FORMAT_INSTRUCTIONS.normal
  return `${prompt}\n${formatBlock}\n${AI_CONSUMER_NOTICE}`
}

/** Build MCP response, optionally including thinking blocks */
function buildResponse(text: string, thinking: string | undefined, includeThinking: boolean): string {
  if (thinking && includeThinking) {
    return `<kimi-thinking>\n${thinking}\n</kimi-thinking>\n\n${text}`
  }
  return text
}

// Default token budget (~15K tokens × 4 chars/token)
const DEFAULT_MAX_OUTPUT_CHARS = 60_000

// Cache warming timeout (2 minutes)
const CACHE_WARMUP_TIMEOUT_MS = 120_000

// --- Tool 1: kimi_analyze ---
server.tool(
  'kimi_analyze',
  `Send a prompt to Kimi Code for codebase analysis. Kimi reads the codebase (256K context) and returns a compressed, structured report. 

CACHE BEHAVIOR: If session_id is not provided, the MCP server will automatically use cached sessions when available. 
- First call: Creates cache (may take 60-120s for large codebases)
- Subsequent calls: Reuses cached session (faster, ~10s)
- Cache auto-expires after 30 minutes or when files change
- Use kimi_cache_status to view cache statistics

Output is budget-controlled: Kimi reads 200K+ tokens of source but returns a 5-15K token analysis (configurable via detail_level). Use kimi_resume to drill deeper into specific areas. Takes 1-5 minutes for large codebases.`,
  {
    prompt: z.string().describe('The analysis prompt for Kimi (be specific about what to analyze)'),
    work_dir: z.string().describe('Absolute path to the codebase root directory'),
    session_id: z.string().optional().describe('Resume a specific Kimi session by ID (from kimi_list_sessions). If not provided, cached session will be used when available.'),
    thinking: z.boolean().optional().describe('Enable thinking mode for deeper analysis (default: true)'),
    detail_level: z.enum(['summary', 'normal', 'detailed']).optional()
      .describe('Output verbosity. summary: ~2-5K tokens (file index + key findings). normal (default): ~5-15K tokens (structured analysis). detailed: ~15-40K tokens (with code snippets).'),
    max_output_tokens: z.number().optional()
      .describe('Max tokens in response (~4 chars/token). Default: 15000. Use 3000-5000 for quick scans, 30000+ for detailed analysis.'),
    include_thinking: z.boolean().optional()
      .describe('Include Kimi internal reasoning in output. Default: false (saves 10-30K tokens). Enable only for debugging.'),
    use_cache: z.boolean().optional()
      .describe('Enable automatic session caching (default: true). Set to false to bypass cache and create fresh session.'),
  },
  async ({ prompt, work_dir, session_id, thinking, detail_level, max_output_tokens, include_thinking, use_cache }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed. Install via: uv tool install kimi-cli' }], isError: true }
    }

    const wrappedPrompt = wrapPromptWithFormat(prompt, detail_level ?? 'normal')
    const maxChars = max_output_tokens ? max_output_tokens * 4 : DEFAULT_MAX_OUTPUT_CHARS
    const enableCache = use_cache !== false  // default to true

    let effectiveSessionId = session_id
    let cacheInfo = ''

    // Try to use cache if no explicit session_id provided and caching is enabled
    if (!effectiveSessionId && enableCache && work_dir) {
      try {
        const cacheResult = await cacheManager.getOrCreateSession(work_dir, {
          timeoutMs: CACHE_WARMUP_TIMEOUT_MS,
          thinking: thinking ?? true,
        })
        
        if (cacheResult.sessionId) {
          effectiveSessionId = cacheResult.sessionId
          cacheInfo = cacheResult.hit 
            ? `\n\n[Cache HIT: Reused session ${effectiveSessionId.slice(0, 8)}... in ${cacheResult.resolveTimeMs}ms]`
            : `\n\n[Cache MISS: Created new session ${effectiveSessionId.slice(0, 8)}... in ${cacheResult.resolveTimeMs}ms]`
        }
      } catch (error) {
        // Cache failure is non-fatal, continue without cache
        cacheInfo = `\n\n[Cache warning: ${error instanceof Error ? error.message : String(error)}]`
      }
    }

    const result = await runKimi({
      prompt: wrappedPrompt,
      workDir: work_dir,
      sessionId: effectiveSessionId,
      thinking: thinking ?? true,
      timeoutMs: 600_000,
      maxOutputChars: maxChars,
    })

    if (!result.ok) {
      // If the cached session failed, invalidate it and retry once
      if (effectiveSessionId && !session_id && enableCache && work_dir) {
        cacheManager.invalidate(work_dir)
        return { 
          content: [{ 
            type: 'text' as const, 
            text: `Error (cached session invalidated, retry may succeed): ${result.error}` 
          }], 
          isError: true 
        }
      }
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    // Update cache with new session ID if returned
    if (result.sessionId && enableCache && work_dir && !session_id) {
      // The cache manager will update its entry on next getOrCreateSession call
    }

    const response = buildResponse(result.text, result.thinking, include_thinking ?? false)
    return { content: [{ type: 'text' as const, text: response + cacheInfo }] }
  }
)

// --- Tool 2: kimi_query ---
server.tool(
  'kimi_query',
  'Ask Kimi Code a question without codebase context. Use for general programming questions, algorithm explanations, or getting a second opinion from Kimi\'s model.',
  {
    prompt: z.string().describe('The question to ask Kimi'),
    thinking: z.boolean().optional().describe('Enable thinking mode (default: false for speed)'),
    max_output_tokens: z.number().optional()
      .describe('Max tokens in response (~4 chars/token). Default: 15000.'),
    include_thinking: z.boolean().optional()
      .describe('Include Kimi internal reasoning. Default: false.'),
  },
  async ({ prompt, thinking, max_output_tokens, include_thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed.' }], isError: true }
    }

    const maxChars = max_output_tokens ? max_output_tokens * 4 : DEFAULT_MAX_OUTPUT_CHARS

    const result = await runKimi({
      prompt,
      thinking: thinking ?? false,
      timeoutMs: 120_000,
      maxOutputChars: maxChars,
    })

    if (!result.ok) {
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    const response = buildResponse(result.text, result.thinking, include_thinking ?? false)
    return { content: [{ type: 'text' as const, text: response }] }
  }
)

// --- Tool 3: kimi_list_sessions ---
server.tool(
  'kimi_list_sessions',
  'List existing Kimi Code sessions with titles, working directories, and timestamps. Use to find session IDs for kimi_resume.',
  {
    work_dir: z.string().optional().describe('Filter sessions by working directory path'),
    limit: z.number().optional().describe('Max sessions to return (default: 20)'),
  },
  async ({ work_dir, limit }) => {
    const sessions = listSessions({ workDir: work_dir, limit: limit ?? 20 })
    if (sessions.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No Kimi sessions found.' }] }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }] }
  }
)

// --- Tool 4: kimi_cache_status ---
server.tool(
  'kimi_cache_status',
  'View session cache statistics and status. Shows cache hits/misses, active sessions, and performance metrics. Use this to monitor cache effectiveness and troubleshoot issues.',
  {
    detail: z.boolean().optional().describe('Show detailed cache entry information (default: false)'),
  },
  async ({ detail }) => {
    const stats = cacheManager.getStats()
    const entries = detail ? cacheManager.listEntries() : []

    const summary = {
      statistics: {
        totalCachedSessions: stats.totalEntries,
        totalCacheHits: stats.totalHits,
        totalCacheMisses: stats.totalMisses,
        cacheHitRate: stats.totalHits + stats.totalMisses > 0
          ? `${((stats.totalHits / (stats.totalHits + stats.totalMisses)) * 100).toFixed(1)}%`
          : 'N/A',
        totalEvictions: stats.totalEvictions,
        averageHitLatencyMs: Math.round(stats.averageHitLatency),
        averageMissLatencyMs: Math.round(stats.averageMissLatency),
      },
      entries: detail ? entries.map(e => ({
        workDir: e.workDir,
        sessionId: `${e.sessionId.slice(0, 8)}...`,
        hitCount: e.hitCount,
        lastUsed: new Date(e.lastUsedAt).toISOString(),
      })) : undefined,
    }

    return { 
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify(summary, null, 2) 
      }] 
    }
  }
)

// --- Tool 5: kimi_cache_invalidate ---
server.tool(
  'kimi_cache_invalidate',
  'Manually invalidate session cache entries. Use when you want to force fresh analysis or if you suspect cached sessions are stale.',
  {
    work_dir: z.string().optional().describe('Specific working directory to invalidate. If not provided, ALL caches are cleared.'),
  },
  async ({ work_dir }) => {
    if (work_dir) {
      const existed = cacheManager.invalidate(work_dir)
      return { 
        content: [{ 
          type: 'text' as const, 
          text: existed 
            ? `Cache invalidated for: ${work_dir}` 
            : `No cache found for: ${work_dir}` 
        }] 
      }
    } else {
      const count = cacheManager.invalidateAll()
      return { 
        content: [{ 
          type: 'text' as const, 
          text: `All ${count} cache entries invalidated.` 
        }] 
      }
    }
  }
)

// --- Tool 6: kimi_resume ---
server.tool(
  'kimi_resume',
  'Resume an existing Kimi Code session with a new prompt. The session retains all previous context (up to 256K tokens). Use kimi_list_sessions to find session IDs first. Ideal for drilling deeper after an initial kimi_analyze scan.',
  {
    session_id: z.string().describe('Session ID to resume (UUID format)'),
    prompt: z.string().describe('New prompt to send in the resumed session'),
    work_dir: z.string().describe('Working directory (must match the original session)'),
    thinking: z.boolean().optional().describe('Enable thinking mode (default: true)'),
    detail_level: z.enum(['summary', 'normal', 'detailed']).optional()
      .describe('Output verbosity. summary: ~2-5K tokens. normal (default): ~5-15K tokens. detailed: ~15-40K tokens.'),
    max_output_tokens: z.number().optional()
      .describe('Max tokens in response (~4 chars/token). Default: 15000.'),
    include_thinking: z.boolean().optional()
      .describe('Include Kimi internal reasoning. Default: false.'),
  },
  async ({ session_id, prompt, work_dir, thinking, detail_level, max_output_tokens, include_thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed.' }], isError: true }
    }

    const wrappedPrompt = wrapPromptWithFormat(prompt, detail_level ?? 'normal')
    const maxChars = max_output_tokens ? max_output_tokens * 4 : DEFAULT_MAX_OUTPUT_CHARS

    const result = await runKimi({
      prompt: wrappedPrompt,
      workDir: work_dir,
      sessionId: session_id,
      thinking: thinking ?? true,
      timeoutMs: 600_000,
      maxOutputChars: maxChars,
    })

    if (!result.ok) {
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    const response = buildResponse(result.text, result.thinking, include_thinking ?? false)
    return { content: [{ type: 'text' as const, text: response }] }
  }
)

// --- Tool 7: kimi_status ---
server.tool(
  'kimi_status',
  'Check Kimi CLI installation status, version, and authentication. Use this to diagnose issues before running analysis.',
  {},
  async () => {
    const status = await getKimiStatus()

    const lines: string[] = []
    lines.push(`## Kimi CLI Status`)
    lines.push(`- **Installed**: ${status.installed ? 'Yes' : 'No'}`)
    lines.push(`- **Binary**: \`${status.binPath}\``)
    if (status.version) lines.push(`- **Version**: ${status.version}`)
    if (status.authenticated !== undefined) {
      lines.push(`- **Authenticated**: ${status.authenticated ? 'Yes' : 'No'}`)
    }
    if (status.error) lines.push(`\n**Action required**: ${status.error}`)

    if (!status.installed) {
      lines.push(`\n### Installation`)
      lines.push(`\`\`\`bash`)
      lines.push(`# Install via uv (recommended)`)
      lines.push(`uv tool install kimi-cli`)
      lines.push(``)
      lines.push(`# Then authenticate`)
      lines.push(`kimi login`)
      lines.push(`\`\`\``)
    }

    // Include cache stats
    const cacheStats = cacheManager.getStats()
    lines.push(`\n## Cache Status`)
    lines.push(`- **Active sessions**: ${cacheStats.totalEntries}`)
    lines.push(`- **Cache hits**: ${cacheStats.totalHits}`)
    lines.push(`- **Cache misses**: ${cacheStats.totalMisses}`)
    if (cacheStats.totalHits + cacheStats.totalMisses > 0) {
      const hitRate = ((cacheStats.totalHits / (cacheStats.totalHits + cacheStats.totalMisses)) * 100).toFixed(1)
      lines.push(`- **Hit rate**: ${hitRate}%`)
    }

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      isError: !status.installed,
    }
  }
)

// --- Start server ---
const transport = new StdioServerTransport()
await server.connect(transport)
