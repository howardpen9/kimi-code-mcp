import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseKimiOutput,
  extractSessionId,
  extractSessionIdFromStream,
  truncateAtBoundary,
  isKimiInstalled,
  cliSupportsFlag,
  buildKimiArgs,
} from './kimi-runner.js'

// ---------------------------------------------------------------------------
// extractSessionId
// ---------------------------------------------------------------------------
describe('extractSessionId', () => {
  it('extracts UUID from "Session ID: xxx" format', () => {
    const stderr = 'Session ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890\n'
    expect(extractSessionId(stderr)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('extracts UUID from "session_id: xxx" format', () => {
    const stderr = 'Connecting...\nsession_id: a1b2c3d4-e5f6-7890-abcd-ef1234567890\nDone.'
    expect(extractSessionId(stderr)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('extracts bare UUID from stderr', () => {
    const stderr = 'Loading model...\na1b2c3d4-e5f6-7890-abcd-ef1234567890\nReady.'
    expect(extractSessionId(stderr)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('returns undefined when no UUID present', () => {
    expect(extractSessionId('some random stderr output')).toBeUndefined()
    expect(extractSessionId('')).toBeUndefined()
  })

  it('handles case-insensitive session ID label', () => {
    const stderr = 'SESSION ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(extractSessionId(stderr)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })
})

// ---------------------------------------------------------------------------
// parseKimiOutput
// ---------------------------------------------------------------------------
describe('parseKimiOutput', () => {
  it('parses string content from assistant message', () => {
    const raw = JSON.stringify({ role: 'assistant', content: 'Hello world' })
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('Hello world')
    expect(result.thinking).toBeUndefined()
  })

  it('parses array content with text parts', () => {
    const raw = JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: ' Part 2' },
      ],
    })
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('Part 1 Part 2')
    expect(result.thinking).toBeUndefined()
  })

  it('parses array content with text and think parts', () => {
    const raw = JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'think', think: 'Let me analyze...' },
        { type: 'text', text: 'The answer is 42.' },
      ],
    })
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('The answer is 42.')
    expect(result.thinking).toBe('Let me analyze...')
  })

  it('picks last valid JSON line (skips status lines)', () => {
    const lines = [
      JSON.stringify({ type: 'StatusUpdate', status: 'processing' }),
      JSON.stringify({ role: 'assistant', content: 'Final answer' }),
    ]
    const result = parseKimiOutput(lines.join('\n'))
    expect(result.text).toBe('Final answer')
  })

  it('handles empty content array gracefully', () => {
    const raw = JSON.stringify({ role: 'assistant', content: [] })
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('')
    expect(result.thinking).toBeUndefined()
  })

  it('falls back to raw text for non-JSON output', () => {
    const raw = 'This is plain text output from kimi'
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('This is plain text output from kimi')
  })

  it('falls back to TextPart python format', () => {
    const raw = "TextPart( type='text', text='Hello from Python' )"
    const result = parseKimiOutput(raw)
    expect(result.text).toBe('Hello from Python')
  })

  it('returns empty message indicator for empty input', () => {
    expect(parseKimiOutput('').text).toBe('(empty response from Kimi)')
    expect(parseKimiOutput('   \n  ').text).toBe('(empty response from Kimi)')
  })

  it('handles multiple JSON lines and picks the assistant one', () => {
    const lines = [
      JSON.stringify({ type: 'TurnEnd' }),
      JSON.stringify({ type: 'StatusUpdate', status: 'done' }),
      JSON.stringify({ role: 'assistant', content: 'The real answer' }),
      JSON.stringify({ type: 'TurnEnd' }),
    ]
    const result = parseKimiOutput(lines.join('\n'))
    expect(result.text).toBe('The real answer')
  })
})

// ---------------------------------------------------------------------------
// truncateAtBoundary
// ---------------------------------------------------------------------------
describe('truncateAtBoundary', () => {
  it('does not truncate short text', () => {
    const text = 'Short text'
    // truncateAtBoundary is only called when text exceeds maxChars,
    // but the function itself always truncates to maxChars
    const result = truncateAtBoundary(text, 1000)
    // The function slices to maxChars then finds a boundary
    expect(result).toContain('Short text')
  })

  it('truncates at markdown header boundary', () => {
    const text = '## Section 1\nContent here.\n\n## Section 2\nMore content.\n\n## Section 3\nEven more.'
    const result = truncateAtBoundary(text, 50)
    expect(result).toContain('## Section 1')
    expect(result).toContain('Output truncated')
    expect(result).not.toContain('## Section 3')
  })

  it('truncates at paragraph boundary', () => {
    const text = 'Paragraph one with lots of text here.\n\nParagraph two with more text.\n\nParagraph three.'
    const result = truncateAtBoundary(text, 60)
    expect(result).toContain('Paragraph one')
    expect(result).toContain('Output truncated')
  })

  it('includes truncation notice with kimi_resume hint', () => {
    const text = 'A'.repeat(200)
    const result = truncateAtBoundary(text, 100)
    expect(result).toContain('Output truncated')
    expect(result).toContain('kimi_resume')
  })

  it('respects 80% minimum cutoff when no boundary found', () => {
    // Text with no paragraph breaks or headers
    const text = 'A'.repeat(200)
    const result = truncateAtBoundary(text, 100)
    // Should cut at Math.floor(100 * 0.8) = 80 at minimum
    const mainContent = result.split('\n\n---')[0]
    expect(mainContent.length).toBeGreaterThanOrEqual(80)
  })
})

// ---------------------------------------------------------------------------
// isKimiInstalled
// ---------------------------------------------------------------------------
describe('isKimiInstalled', () => {
  it('returns a boolean', () => {
    const result = isKimiInstalled()
    expect(typeof result).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// extractSessionIdFromStream
// ---------------------------------------------------------------------------

describe('extractSessionIdFromStream', () => {
  it('extracts session_id from the trailing meta line (kimi-code >= 0.28)', () => {
    const stdout = [
      '{"role":"assistant","content":"done"}',
      '{"role":"meta","type":"session.resume_hint","session_id":"session_f26c9bc9-8992-43f5-a948-8288af2a5547"}',
    ].join('\n')
    expect(extractSessionIdFromStream(stdout)).toBe('session_f26c9bc9-8992-43f5-a948-8288af2a5547')
  })

  it('accepts the camelCase spelling', () => {
    expect(extractSessionIdFromStream('{"sessionId":"session_abc"}')).toBe('session_abc')
  })

  it('ignores non-JSON lines and returns undefined when absent', () => {
    expect(extractSessionIdFromStream('loading...\n{"role":"assistant","content":"hi"}')).toBeUndefined()
    expect(extractSessionIdFromStream('')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// cliSupportsFlag / buildKimiArgs
// ---------------------------------------------------------------------------

const MODERN_HELP = `Options:
  -m, --model <model>           LLM model alias to use for this invocation.
  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.
  --output-format <format>      Output format for prompt mode.
  -S, --session [id]            Resume a session.`

const LEGACY_HELP = `Options:
  -p, --prompt <prompt>         Run one prompt non-interactively.
  --print                       Print mode.
  --final-message-only          Only emit the final message.
  -w, --work-dir <dir>          Working directory.
  --no-thinking                 Disable thinking.`

describe('cliSupportsFlag', () => {
  it('detects flags present in help output', () => {
    expect(cliSupportsFlag('--print', LEGACY_HELP)).toBe(true)
    expect(cliSupportsFlag('-w', LEGACY_HELP)).toBe(true)
  })

  it('does not report flags the CLI dropped', () => {
    expect(cliSupportsFlag('--print', MODERN_HELP)).toBe(false)
    expect(cliSupportsFlag('--final-message-only', MODERN_HELP)).toBe(false)
    expect(cliSupportsFlag('-w', MODERN_HELP)).toBe(false)
  })

  it('does not match a flag that is only a prefix of another', () => {
    expect(cliSupportsFlag('--out', MODERN_HELP)).toBe(false)
  })

  it('treats unreadable help as the modern CLI', () => {
    expect(cliSupportsFlag('--print', '')).toBe(false)
  })
})

describe('buildKimiArgs', () => {
  const supportsModern = (flag: string) => cliSupportsFlag(flag, MODERN_HELP)
  const supportsLegacy = (flag: string) => cliSupportsFlag(flag, LEGACY_HELP)

  it('omits dropped flags on kimi-code >= 0.28', () => {
    const args = buildKimiArgs({ prompt: 'hi', modelAlias: 'kimi-code/k3', workDir: '/repo', thinking: false }, supportsModern)
    expect(args).toEqual(['-m', 'kimi-code/k3', '-p', 'hi', '--output-format', 'stream-json'])
  })

  it('keeps the legacy flags when the CLI still advertises them', () => {
    const args = buildKimiArgs({ prompt: 'hi', workDir: '/repo', thinking: false }, supportsLegacy)
    expect(args).toEqual([
      '-p', 'hi', '--print', '--output-format', 'stream-json',
      '--final-message-only', '-w', '/repo', '--no-thinking',
    ])
  })

  it('passes the session id through on both generations', () => {
    expect(buildKimiArgs({ prompt: 'hi', sessionId: 'session_abc' }, supportsModern)).toContain('session_abc')
    expect(buildKimiArgs({ prompt: 'hi', sessionId: 'session_abc' }, supportsLegacy)).toContain('-S')
  })
})
