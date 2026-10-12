import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadApiAuth, isApiConfigured } from './kimi-api.js'

const SAVED_ENV = { ...process.env }

// Credential discovery must never read the developer's real home in a test.
vi.mock('os', async (importOriginal) => ({
  ...await importOriginal<typeof import('os')>(),
  homedir: vi.fn(() => '/tmp/kimi-test-home'),
}))

function clearKimiEnv() {
  delete process.env.KIMICODE_API_KEY
  delete process.env.KIMI_CODE_API_KEY
  delete process.env.KIMI_API_KEY
  delete process.env.KIMI_BASE_URL
  delete process.env.KIMI_SHARE_DIR
}

describe('loadApiAuth', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-api-test-'))
    vi.mocked(os.homedir).mockReturnValue(tmpDir)
    clearKimiEnv()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    process.env = { ...SAVED_ENV }
  })

  it('returns null when no key is available', () => {
    process.env.KIMI_SHARE_DIR = tmpDir // empty dir, no config.toml
    expect(loadApiAuth()).toBeNull()
    expect(isApiConfigured()).toBe(false)
  })

  it('prefers environment variables over config file', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'),
      '[providers.kimi-code]\nbase_url = "https://file.example/coding/v1"\napi_key = "sk-from-file"\n')
    process.env.KIMI_SHARE_DIR = tmpDir
    process.env.KIMICODE_API_KEY = 'sk-from-env'
    process.env.KIMI_BASE_URL = 'https://env.example/v1'
    const auth = loadApiAuth()
    expect(auth?.apiKey).toBe('sk-from-env')
    expect(auth?.baseUrl).toBe('https://env.example/v1')
  })

  it.each(['KIMI_CODE_API_KEY', 'KIMI_API_KEY'])('accepts the %s environment alias', (key) => {
    process.env[key] = 'sk-env-alias'
    expect(loadApiAuth()).toEqual({ apiKey: 'sk-env-alias', baseUrl: 'https://api.kimi.com/coding/v1' })
    process.env.KIMICODE_API_KEY = 'sk-preferred'
    expect(loadApiAuth()?.apiKey).toBe('sk-preferred')
  })

  it('reads the modern ~/.kimi-code config when the legacy config is absent', () => {
    const modernDir = path.join(tmpDir, '.kimi-code')
    fs.mkdirSync(modernDir)
    fs.writeFileSync(path.join(modernDir, 'config.toml'),
      '[providers.kimi-code]\nbase_url = "https://api.kimi.com/coding/v1"\napi_key = "sk-modern"\n')
    expect(loadApiAuth()).toEqual({ apiKey: 'sk-modern', baseUrl: 'https://api.kimi.com/coding/v1' })
  })

  it('does not pair a modern key with a keyless legacy provider endpoint', () => {
    fs.mkdirSync(path.join(tmpDir, '.kimi'))
    fs.mkdirSync(path.join(tmpDir, '.kimi-code'))
    fs.writeFileSync(path.join(tmpDir, '.kimi', 'config.toml'),
      '[providers.old]\nbase_url = "https://old.example/v1"\n')
    fs.writeFileSync(path.join(tmpDir, '.kimi-code', 'config.toml'),
      '[providers.kimi-code]\nbase_url = "https://api.kimi.com/coding/v1"\napi_key = "sk-modern"\n')
    expect(loadApiAuth()).toEqual({ apiKey: 'sk-modern', baseUrl: 'https://api.kimi.com/coding/v1' })
  })

  it('reads api_key and base_url from config.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'),
      '[providers.kimi-code]\ntype = "kimi"\nbase_url = "https://api.kimi.com/coding/v1"\napi_key = "sk-kimi-abc"\n')
    process.env.KIMI_SHARE_DIR = tmpDir
    const auth = loadApiAuth()
    expect(auth?.apiKey).toBe('sk-kimi-abc')
    expect(auth?.baseUrl).toBe('https://api.kimi.com/coding/v1')
  })

  it('prefers the coding provider when multiple providers exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'), [
      '[providers.moonshot-cn]',
      'base_url = "https://api.moonshot.cn/v1"',
      'api_key = "sk-moonshot"',
      '',
      '[providers.kimi-code]',
      'base_url = "https://api.kimi.com/coding/v1"',
      'api_key = "sk-kimi-coding"',
    ].join('\n'))
    process.env.KIMI_SHARE_DIR = tmpDir
    const auth = loadApiAuth()
    expect(auth?.apiKey).toBe('sk-kimi-coding')
    expect(auth?.baseUrl).toBe('https://api.kimi.com/coding/v1')
  })

  it('interpolates ${VAR} references in the api_key', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'),
      '[providers.kimi-code]\nbase_url = "https://api.kimi.com/coding/v1"\napi_key = "${MY_KEY}"\n')
    process.env.KIMI_SHARE_DIR = tmpDir
    process.env.MY_KEY = 'sk-interpolated'
    expect(loadApiAuth()?.apiKey).toBe('sk-interpolated')
  })

  it('strips a trailing slash from the base_url', () => {
    process.env.KIMICODE_API_KEY = 'sk-x'
    process.env.KIMI_BASE_URL = 'https://api.kimi.com/coding/v1/'
    expect(loadApiAuth()?.baseUrl).toBe('https://api.kimi.com/coding/v1')
  })
})
