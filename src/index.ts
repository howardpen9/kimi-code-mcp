#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runKimi, isKimiInstalled } from './kimi-runner.js'
import { listSessions } from './session-reader.js'

const server = new McpServer({
  name: 'kimi-code',
  version: '0.2.0',
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

// --- Tool 1: kimi_analyze ---
server.tool(
  'kimi_analyze',
  'Send a prompt to Kimi Code for codebase analysis. Kimi reads the codebase (256K context) and returns a compressed, structured report. Output is budget-controlled: Kimi reads 200K+ tokens of source but returns a 5-15K token analysis (configurable via detail_level). Use kimi_resume to drill deeper into specific areas. Takes 1-5 minutes for large codebases.',
  {
    prompt: z.string().describe('The analysis prompt for Kimi (be specific about what to analyze)'),
    work_dir: z.string().describe('Absolute path to the codebase root directory'),
    session_id: z.string().optional().describe('Resume a specific Kimi session by ID (from kimi_list_sessions)'),
    thinking: z.boolean().optional().describe('Enable thinking mode for deeper analysis (default: true)'),
    detail_level: z.enum(['summary', 'normal', 'detailed']).optional()
      .describe('Output verbosity. summary: ~2-5K tokens (file index + key findings). normal (default): ~5-15K tokens (structured analysis). detailed: ~15-40K tokens (with code snippets).'),
    max_output_tokens: z.number().optional()
      .describe('Max tokens in response (~4 chars/token). Default: 15000. Use 3000-5000 for quick scans, 30000+ for detailed analysis.'),
    include_thinking: z.boolean().optional()
      .describe('Include Kimi internal reasoning in output. Default: false (saves 10-30K tokens). Enable only for debugging.'),
  },
  async ({ prompt, work_dir, session_id, thinking, detail_level, max_output_tokens, include_thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed. Install via: uv tool install kimi-cli' }], isError: true }
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

// --- Tool 4: kimi_resume ---
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

// --- Start server ---
const transport = new StdioServerTransport()
await server.connect(transport)
