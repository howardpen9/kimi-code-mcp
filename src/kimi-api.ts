import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type { KimiResult } from './kimi-runner.js'
import { truncateAtBoundary } from './kimi-runner.js'

// The Kimi Code coding endpoint only serves recognized coding-agent User-Agents;
// a valid key with an unrecognized UA is rejected with HTTP 403. This UA is accepted.
const KIMI_USER_AGENT = 'KimiCLI/1.0'
const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1'
const DEFAULT_MODEL = 'kimi-for-coding'

export interface KimiApiAuth {
  apiKey: string
  baseUrl: string
}

/** Resolve ${VAR} references against the environment. */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '')
}

/**
 * Load the Kimi Code API key + base URL.
 * Priority: env (KIMICODE_API_KEY / KIMI_BASE_URL) → ~/.kimi/config.toml.
 * The TOML parse is section-aware and prefers the provider whose base_url points
 * at the coding endpoint, falling back to the first key/url found.
 */
export function loadApiAuth(): KimiApiAuth | null {
  let apiKey = process.env.KIMICODE_API_KEY || ''
  let baseUrl = process.env.KIMI_BASE_URL || ''

  if (!apiKey || !baseUrl) {
    const kimiDir = process.env.KIMI_SHARE_DIR || path.join(os.homedir(), '.kimi')
    const cfgPath = path.join(kimiDir, 'config.toml')
    try {
      const raw = fs.readFileSync(cfgPath, 'utf-8')
      const providers: Array<{ apiKey?: string; baseUrl?: string }> = []
      let current: { apiKey?: string; baseUrl?: string } | null = null
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('#') || !trimmed) continue
        const section = trimmed.match(/^\[(.+?)\]/)
        if (section) {
          current = section[1].startsWith('providers.') ? {} : null
          if (current) providers.push(current)
          continue
        }
        if (!current) continue
        const kv = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"/)
        if (!kv) continue
        if (kv[1] === 'api_key') current.apiKey = kv[2]
        else if (kv[1] === 'base_url') current.baseUrl = kv[2]
      }
      const coding = providers.find(p => p.baseUrl?.includes('/coding'))
      const chosen = coding || providers.find(p => p.apiKey) || providers[0]
      if (chosen) {
        if (!apiKey && chosen.apiKey) apiKey = chosen.apiKey
        if (!baseUrl && chosen.baseUrl) baseUrl = chosen.baseUrl
      }
    } catch {
      // config optional when env vars are set
    }
  }

  apiKey = interpolateEnv(apiKey).trim()
  baseUrl = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, '')
  if (!apiKey) return null
  return { apiKey, baseUrl }
}

export function isApiConfigured(): boolean {
  return loadApiAuth() !== null
}

export interface KimiApiConfig {
  /** The user prompt / material to send */
  prompt: string
  /** Optional system instruction to steer Kimi (e.g. "you are an independent verifier") */
  system?: string
  /** Model id (default: kimi-for-coding) */
  model?: string
  /** Timeout in milliseconds (default: 300000) */
  timeoutMs?: number
  /** Max characters of answer text to keep; truncated at a clean boundary if exceeded. Default: 60000 */
  maxOutputChars?: number
}

/**
 * Call the Kimi Code API directly (no CLI). Returns the same KimiResult shape as runKimi.
 * Note: kimi-for-coding is thinking-only, so the model always produces reasoning_content;
 * the token budget is sized to leave headroom for it so the answer is not starved.
 */
export async function runKimiApi(config: KimiApiConfig): Promise<KimiResult> {
  const auth = loadApiAuth()
  if (!auth) {
    return {
      ok: false,
      text: '',
      error: 'Kimi Code API key not found. Set $KIMICODE_API_KEY or add api_key to ~/.kimi/config.toml.',
    }
  }

  const { prompt, system, model = DEFAULT_MODEL, timeoutMs = 300_000 } = config
  const maxOutputChars = config.maxOutputChars ?? 60_000
  // ~4 chars/token for the answer, plus headroom for the always-on reasoning pass.
  const maxTokens = Math.ceil(maxOutputChars / 4) + 4_000

  const messages: Array<{ role: string; content: string }> = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${auth.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': KIMI_USER_AGENT,
      },
      body: JSON.stringify({ model, messages, temperature: 1, max_tokens: maxTokens }),
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, text: '', error: `Kimi API timed out after ${Math.round(timeoutMs / 1000)}s` }
    }
    return { ok: false, text: '', error: `Kimi API network error: ${err instanceof Error ? err.message : String(err)}` }
  }
  clearTimeout(timer)

  const bodyText = await res.text()
  if (!res.ok) {
    let msg = bodyText.slice(0, 400)
    try {
      const parsed = JSON.parse(bodyText)
      if (parsed?.error?.message) msg = parsed.error.message
    } catch { /* keep raw slice */ }
    return { ok: false, text: '', error: `Kimi API HTTP ${res.status}: ${msg}` }
  }

  let data: any
  try {
    data = JSON.parse(bodyText)
  } catch {
    return { ok: false, text: '', error: `Kimi API returned non-JSON: ${bodyText.slice(0, 200)}` }
  }

  const message = data?.choices?.[0]?.message ?? {}
  let text: string = (message.content || '').trim()
  const thinking: string | undefined = message.reasoning_content || undefined

  if (!text) {
    if (thinking) {
      return { ok: false, text: '', thinking, error: 'Kimi API returned only reasoning (no answer). Raise max_output_tokens.' }
    }
    return { ok: false, text: '', error: `Kimi API returned an empty message: ${bodyText.slice(0, 200)}` }
  }

  if (text.length > maxOutputChars) {
    text = truncateAtBoundary(text, maxOutputChars)
  }

  return { ok: true, text, thinking }
}
