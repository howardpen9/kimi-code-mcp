import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn, execFileSync } from 'child_process'
import { runKimi } from './kimi-runner.js'
import { CacheManager } from './cache-manager.js'

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}))

const modernHelp = `Options:
  -m, --model <model>
  -p, --prompt <prompt>
  --output-format <format>
  -S, --session [id]
  --plan
`
const legacyHelp = `${modernHelp}
  --print
  --final-message-only
  --no-thinking
  -w, --work-dir TEXT
`

function fakeProcess(stdout: string, stderr = '', code = 0) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  })
  vi.mocked(spawn).mockImplementationOnce((() => {
    queueMicrotask(() => {
      proc.stdout.emit('data', Buffer.from(stdout))
      proc.stderr.emit('data', Buffer.from(stderr))
      proc.emit('close', code)
    })
    return proc
  }) as typeof spawn)
}

describe('CLI generation compatibility', () => {
  beforeEach(() => { vi.resetAllMocks() })
  afterEach(() => { vi.unstubAllEnvs() })

  it('runs 2.x with cwd and parses an answer after metadata/tool messages', async () => {
    vi.mocked(execFileSync).mockReturnValue(modernHelp)
    fakeProcess([
      { role: 'meta', type: 'system.version', version: '2.1.1' },
      { role: 'meta', session_id: 'owned-session' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'read-1' }] },
      { role: 'tool', content: 'file contents' },
      { role: 'assistant', content: 'Final answer' },
    ].map(x => JSON.stringify(x)).join('\n'))
    const result = await runKimi({ prompt: 'Review', workDir: '/selected/repo', thinking: false })
    expect(result).toMatchObject({ ok: true, text: 'Final answer', sessionId: 'owned-session' })
    const [, args, options] = vi.mocked(spawn).mock.calls[0]
    expect(options).toMatchObject({ cwd: '/selected/repo' })
    expect(args).toContain('-p')
    for (const removed of ['--print', '--final-message-only', '--no-thinking', '-w', '--plan']) {
      expect(args).not.toContain(removed)
    }
  })

  it('preserves legacy print/final/thinking flags and resumed session identity', async () => {
    vi.mocked(execFileSync).mockReturnValue(legacyHelp)
    fakeProcess(JSON.stringify({ role: 'assistant', content: 'Follow-up' }))
    const result = await runKimi({ prompt: 'Continue', sessionId: 'known-session', thinking: false })
    const args = vi.mocked(spawn).mock.calls[0][1]
    expect(args).toEqual(expect.arrayContaining(['--print', '--final-message-only', '--no-thinking', '-S', 'known-session']))
    expect(result).toMatchObject({ ok: true, sessionId: 'known-session' })
  })

  it('reports re-login rather than treating metadata-only output as an answer', async () => {
    vi.mocked(execFileSync).mockReturnValue(modernHelp)
    fakeProcess('{"role":"meta","type":"system.version","version":"2.1.1"}',
      'error: Stored token was rejected; re-login required.', 1)
    expect(await runKimi({ prompt: 'OK' })).toMatchObject({ ok: false, error: expect.stringContaining('kimi login') })
  })

  it('warms cache through the compatible runner and reuses its session', async () => {
    vi.mocked(execFileSync).mockReturnValue(modernHelp)
    fakeProcess('{"session_id":"cache-session"}\n{"role":"assistant","content":"Indexed"}')
    const cache = new CacheManager()
    vi.spyOn(cache as any, 'computeCodebaseHash').mockResolvedValue('unchanged')
    const first = await cache.getOrCreateSession('/selected/repo')
    const second = await cache.getOrCreateSession('/selected/repo')
    expect(first).toMatchObject({ hit: false, sessionId: 'cache-session' })
    expect(second).toMatchObject({ hit: true, sessionId: 'cache-session' })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain('--print')
  })
})
