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
}

export interface KimiResult {
  ok: boolean
  text: string
  thinking?: string
  error?: string
}

const KIMI_BIN = path.join(os.homedir(), '.local/bin/kimi')

export function isKimiInstalled(): boolean {
  return fs.existsSync(KIMI_BIN)
}

/**
 * Parse Kimi's stream-json output with --final-message-only.
 * The output is one JSON line: {"role":"assistant","content":...}
 * content can be a string or an array of {type, text/think} objects.
 */
function parseKimiOutput(raw: string): { text: string; thinking?: string } {
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
      resolve({ ok: true, ...parsed })
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
