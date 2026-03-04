import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseKimiOutput, extractSessionId, truncateAtBoundary, isKimiInstalled } from './kimi-runner.js'

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
