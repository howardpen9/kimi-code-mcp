import { spawn } from 'child_process'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

/** Configuration for running a Kimi CLI session */
export interface KimiRunConfig {
  /** The analysis prompt to send to Kimi */
  prompt: string
  /** Absolute path to the codebase root directory */
  workDir?: string
  /** Resume a specific session by ID */
  sessionId?: string
  /** Enable thinking mode for deeper analysis */
  thinking?: boolean
  /** Timeout in milliseconds (default: 600000) */
  timeoutMs?: number
  /** Maximum characters in output. Truncated at clean boundary if exceeded. Default: 60000 (~15K tokens) */
  maxOutputChars?: number
}

export interface KimiResult {
  ok: boolean
  text: string
  thinking?: string
  error?: string
  /** Session ID if available (for caching) */
  sessionId?: string
}

const KIMI_BIN = path.join(os.homedir(), '.local/bin/kimi')

export function isKimiInstalled(): boolean {
  return fs.existsSync(KIMI_BIN)
}

export interface KimiStatus {
  installed: boolean
  binPath: string
  version?: string
  authenticated?: boolean
  error?: string
}

export async function getKimiStatus(): Promise<KimiStatus> {
  const status: KimiStatus = { installed: false, binPath: KIMI_BIN }

  if (!fs.existsSync(KIMI_BIN)) {
    status.error = 'Kimi CLI not found. Install via: uv tool install kimi-cli'
    return status
  }
  status.installed = true

  // Check version
  try {
    const { execSync } = await import('child_process')
    const env = { ...process.env }
    const localBin = path.join(os.homedir(), '.local/bin')
    if (!env.PATH?.includes(localBin)) {
      env.PATH = `${localBin}:${env.PATH || ''}`
    }
    status.version = execSync(`${KIMI_BIN} --version`, { encoding: 'utf-8', timeout: 5000, env }).trim()
  } catch {
    status.version = '(unable to detect)'
  }

  // Check authentication by looking for config
  try {
    const kimiConfigPath = path.join(os.homedir(), '.kimi', 'kimi.json')
    if (fs.existsSync(kimiConfigPath)) {
      const raw = fs.readFileSync(kimiConfigPath, 'utf-8')
      const config = JSON.parse(raw)
      status.authenticated = !!(config.access_token || config.auth_token || config.api_key)
    } else {
      status.authenticated = false
      status.error = 'Not authenticated. Run: kimi login'
    }
  } catch {
    status.authenticated = undefined
  }

  return status
}

/**
 * Extract session ID from Kimi's stderr output.
 * Kimi outputs session info to stderr in formats like:
 * - "Session ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 * - "session_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 */
export function extractSessionId(stderr: string): string | undefined {
  // Match various session ID formats
  const patterns = [
    /Session ID:\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
    /session[_-]?id[:\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/,
  ]

  for (const pattern of patterns) {
    const match = stderr.match(pattern)
    if (match) return match[1]
  }

  return undefined
}

/**
 * Parse Kimi's stream-json output with --final-message-only.
 * The output is one JSON line: {"role":"assistant","content":...}
 * content can be a string or an array of {type, text/think} objects.
 */
export function parseKimiOutput(raw: string): { text: string; thinking?: string } {
  // Find the last valid JSON line (skip StatusUpdate/TurnEnd lines)
  const lines = raw.trim().split('\n').filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue

    try {
      const parsed = JSON.parse(line)

      // Direct message format: {"role":"assistant","content":...}
      if (parsed.role === 'assistant' && parsed.content !== undefined) {
        if (typeof parsed.content === 'string') {
          return { text: parsed.content }
        }
        if (Array.isArray(parsed.content)) {
          let text = ''
          let thinking = ''
          for (const part of parsed.content) {
            if (part.type === 'text' && part.text) text += part.text
            if (part.type === 'think' && part.think) thinking += part.think
          }
          return { text, thinking: thinking || undefined }
        }
      }
    } catch { /* not valid JSON, skip */ }
  }

  // Fallback: try to extract text from Python-style TextPart output
  const textMatch = raw.match(/TextPart\(\s*type='text',\s*text='([\s\S]*?)'\s*\)/)
  if (textMatch) {
    return { text: textMatch[1].replace(/\\n/g, '\n').replace(/\\'/g, "'") }
  }

  return { text: raw.trim() || '(empty response from Kimi)' }
}

/**
 * Truncate text at a clean markdown boundary (section header or paragraph break)
 * to avoid cutting mid-sentence. Appends a notice directing to kimi_resume.
 */
export function truncateAtBoundary(text: string, maxChars: number): string {
  const slice = text.slice(0, maxChars)
  const lastHeader = slice.lastIndexOf('\n## ')
  const lastParagraph = slice.lastIndexOf('\n\n')
  const cutPoint = Math.max(lastHeader, lastParagraph, Math.floor(maxChars * 0.8))

  return slice.slice(0, cutPoint) +
    `\n\n---\n⚠️ **Output truncated** (${text.length.toLocaleString()} chars exceeded ${maxChars.toLocaleString()} char budget). ` +
    `Use \`kimi_resume\` with the same session to ask follow-up questions about specific sections.`
}

export function runKimi(config: KimiRunConfig): Promise<KimiResult> {
  const { prompt, workDir, sessionId, thinking, timeoutMs = 300_000 } = config

  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      '--print',
      '--output-format', 'stream-json',
      '--final-message-only',
    ]

    if (workDir) args.push('-w', workDir)
    if (sessionId) args.push('-S', sessionId)
    if (thinking === false) args.push('--no-thinking')

    const env = { ...process.env }
    // Ensure ~/.local/bin is in PATH
    const localBin = path.join(os.homedir(), '.local/bin')
    if (!env.PATH?.includes(localBin)) {
      env.PATH = `${localBin}:${env.PATH || ''}`
    }

    const proc = spawn(KIMI_BIN, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(workDir ? { cwd: workDir } : {}),
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 5000)
      resolve({ ok: false, text: '', error: `Kimi timed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)

    proc.on('close', (code) => {
      clearTimeout(timer)

      if (code !== 0) {
        // Check for common errors
        if (stderr.includes('login') || stderr.includes('authenticate')) {
          resolve({ ok: false, text: '', error: 'Kimi not authenticated. Run: kimi login' })
          return
        }
        resolve({ ok: false, text: '', error: stderr.trim() || `kimi exited with code ${code}` })
        return
      }

      const parsed = parseKimiOutput(stdout)
      const sessionId = extractSessionId(stderr)
      const maxChars = config.maxOutputChars ?? 60_000

      if (parsed.text.length > maxChars) {
        parsed.text = truncateAtBoundary(parsed.text, maxChars)
      }
      if (parsed.thinking && parsed.thinking.length > maxChars) {
        parsed.thinking = parsed.thinking.slice(0, Math.floor(maxChars / 2)) + '\n[THINKING TRUNCATED]'
      }

      resolve({ ok: true, ...parsed, sessionId })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ ok: false, text: '', error: 'kimi CLI not found. Install via: uv tool install kimi-cli' })
      } else {
        resolve({ ok: false, text: '', error: String(err) })
      }
    })
  })
}
