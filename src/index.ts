#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runKimi, isKimiInstalled } from './kimi-runner.js'
import { listSessions } from './session-reader.js'

const server = new McpServer({
  name: 'kimi-code',
  version: '0.1.0',
})

// --- Tool 1: kimi_analyze ---
server.tool(
  'kimi_analyze',
  'Send a prompt to Kimi Code for codebase analysis. Kimi has 256K context and can read entire codebases autonomously. Use for: architecture review, cross-file audit, large refactoring plans, dead code detection. Takes 1-5 minutes for large codebases. The result is Kimi\'s complete analysis text.',
  {
    prompt: z.string().describe('The analysis prompt for Kimi (be specific about what to analyze and where to write output)'),
    work_dir: z.string().describe('Absolute path to the codebase root directory'),
    session_id: z.string().optional().describe('Resume a specific Kimi session by ID (from kimi_list_sessions)'),
    thinking: z.boolean().optional().describe('Enable thinking mode for deeper analysis (default: true)'),
  },
  async ({ prompt, work_dir, session_id, thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed. Install via: uv tool install kimi-cli' }], isError: true }
    }

    const result = await runKimi({
      prompt,
      workDir: work_dir,
      sessionId: session_id,
      thinking: thinking ?? true,
      timeoutMs: 600_000,
    })

    if (!result.ok) {
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    let response = result.text
    if (result.thinking) {
      response = `<kimi-thinking>\n${result.thinking}\n</kimi-thinking>\n\n${result.text}`
    }

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
  },
  async ({ prompt, thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed.' }], isError: true }
    }

    const result = await runKimi({
      prompt,
      thinking: thinking ?? false,
      timeoutMs: 120_000,
    })

    if (!result.ok) {
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    return { content: [{ type: 'text' as const, text: result.text }] }
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
  'Resume an existing Kimi Code session with a new prompt. The session retains all previous context (up to 256K tokens). Use kimi_list_sessions to find session IDs first.',
  {
    session_id: z.string().describe('Session ID to resume (UUID format)'),
    prompt: z.string().describe('New prompt to send in the resumed session'),
    work_dir: z.string().describe('Working directory (must match the original session)'),
    thinking: z.boolean().optional().describe('Enable thinking mode (default: true)'),
  },
  async ({ session_id, prompt, work_dir, thinking }) => {
    if (!isKimiInstalled()) {
      return { content: [{ type: 'text' as const, text: 'Error: kimi CLI not installed.' }], isError: true }
    }

    const result = await runKimi({
      prompt,
      workDir: work_dir,
      sessionId: session_id,
      thinking: thinking ?? true,
      timeoutMs: 600_000,
    })

    if (!result.ok) {
      return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true }
    }

    let response = result.text
    if (result.thinking) {
      response = `<kimi-thinking>\n${result.thinking}\n</kimi-thinking>\n\n${result.text}`
    }

    return { content: [{ type: 'text' as const, text: response }] }
  }
)

// --- Start server ---
const transport = new StdioServerTransport()
await server.connect(transport)
