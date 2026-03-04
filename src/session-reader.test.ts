import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const HOME = '/mock-home'
const KIMI_DIR = path.join(HOME, '.kimi')
const SESSIONS_DIR = path.join(KIMI_DIR, 'sessions')
const KIMI_JSON = path.join(KIMI_DIR, 'kimi.json')

// Mock os.homedir BEFORE session-reader.ts imports and evaluates module-level constants
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => HOME }
})
vi.mock('fs')

// Import after mocks are set up (vitest hoists vi.mock calls)
const { listSessions } = await import('./session-reader.js')

afterEach(() => {
  vi.restoreAllMocks()
})

// Helper: compute MD5 hash for workDir (same as session-reader does)
function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

// Helper: create a mock filesystem structure
function mockFS(config: {
  kimiJson?: { work_dirs: Array<{ path: string; kaos: string; last_session_id: string | null }> }
  sessions?: Array<{
    workDir: string
    sessionId: string
    title: string
    wireMtime: number
    archived?: boolean
  }>
}) {
  const readFileSyncMock = vi.mocked(fs.readFileSync)
  const readdirSyncMock = vi.mocked(fs.readdirSync)
  const statSyncMock = vi.mocked(fs.statSync)
  const existsSyncMock = vi.mocked(fs.existsSync)

  // kimi.json
  if (config.kimiJson) {
    readFileSyncMock.mockImplementation((filePath: fs.PathOrFileDescriptor, _opts?: any) => {
      const p = String(filePath)
      if (p === KIMI_JSON) {
        return JSON.stringify(config.kimiJson)
      }
      // Session metadata
      for (const s of config.sessions ?? []) {
        const hash = md5(s.workDir)
        const metaPath = path.join(SESSIONS_DIR, hash, s.sessionId, 'metadata.json')
        if (p === metaPath) {
          return JSON.stringify({
            session_id: s.sessionId,
            title: s.title,
            wire_mtime: s.wireMtime,
            archived: s.archived ?? false,
          })
        }
      }
      throw new Error(`ENOENT: ${p}`)
    })
  } else {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
  }

  // Sessions directory listing
  const hashDirs = new Set<string>()
  const sessionsByHash = new Map<string, string[]>()

  for (const s of config.sessions ?? []) {
    const hash = md5(s.workDir)
    hashDirs.add(hash)
    if (!sessionsByHash.has(hash)) sessionsByHash.set(hash, [])
    sessionsByHash.get(hash)!.push(s.sessionId)
  }

  readdirSyncMock.mockImplementation((dirPath: fs.PathLike) => {
    const p = String(dirPath)
    if (p === SESSIONS_DIR) {
      return Array.from(hashDirs) as unknown as fs.Dirent[]
    }
    for (const [hash, sids] of sessionsByHash) {
      if (p === path.join(SESSIONS_DIR, hash)) {
        return sids as unknown as fs.Dirent[]
      }
    }
    throw new Error(`ENOENT: ${p}`)
  })

  statSyncMock.mockImplementation((filePath: fs.PathLike) => {
    return { isDirectory: () => true } as fs.Stats
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns empty array when no sessions directory exists', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('ENOENT') })

    const sessions = listSessions()
    expect(sessions).toEqual([])
  })

  it('returns sessions sorted by lastModified descending', () => {
    mockFS({
      kimiJson: {
        work_dirs: [
          { path: '/project/alpha', kaos: '', last_session_id: null },
          { path: '/project/beta', kaos: '', last_session_id: null },
        ],
      },
      sessions: [
        { workDir: '/project/alpha', sessionId: 'sid-old', title: 'Old Session', wireMtime: 1000 },
        { workDir: '/project/beta', sessionId: 'sid-new', title: 'New Session', wireMtime: 2000 },
      ],
    })

    const sessions = listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].title).toBe('New Session')
    expect(sessions[1].title).toBe('Old Session')
  })

  it('filters by workDir when provided', () => {
    mockFS({
      kimiJson: {
        work_dirs: [
          { path: '/project/alpha', kaos: '', last_session_id: null },
          { path: '/project/beta', kaos: '', last_session_id: null },
        ],
      },
      sessions: [
        { workDir: '/project/alpha', sessionId: 'sid-a', title: 'Alpha', wireMtime: 1000 },
        { workDir: '/project/beta', sessionId: 'sid-b', title: 'Beta', wireMtime: 2000 },
      ],
    })

    const sessions = listSessions({ workDir: '/project/alpha' })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('Alpha')
  })

  it('respects limit parameter', () => {
    mockFS({
      kimiJson: {
        work_dirs: [{ path: '/project/x', kaos: '', last_session_id: null }],
      },
      sessions: [
        { workDir: '/project/x', sessionId: 'sid-1', title: 'S1', wireMtime: 1000 },
        { workDir: '/project/x', sessionId: 'sid-2', title: 'S2', wireMtime: 2000 },
        { workDir: '/project/x', sessionId: 'sid-3', title: 'S3', wireMtime: 3000 },
      ],
    })

    const sessions = listSessions({ limit: 2 })
    expect(sessions).toHaveLength(2)
    expect(sessions[0].title).toBe('S3') // most recent
  })

  it('skips archived sessions', () => {
    mockFS({
      kimiJson: {
        work_dirs: [{ path: '/project/y', kaos: '', last_session_id: null }],
      },
      sessions: [
        { workDir: '/project/y', sessionId: 'sid-active', title: 'Active', wireMtime: 2000 },
        { workDir: '/project/y', sessionId: 'sid-archived', title: 'Archived', wireMtime: 1000, archived: true },
      ],
    })

    const sessions = listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('Active')
  })

  it('shows (unknown: hash) for directories not in kimi.json', () => {
    mockFS({
      kimiJson: { work_dirs: [] },
      sessions: [
        { workDir: '/project/mystery', sessionId: 'sid-m', title: 'Mystery', wireMtime: 1000 },
      ],
    })

    const sessions = listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].workDir).toContain('(unknown:')
  })

  it('uses default limit of 20', () => {
    const manyWorkDirs = Array.from({ length: 25 }, (_, i) => ({
      path: `/project/p${i}`,
      kaos: '',
      last_session_id: null,
    }))
    const manySessions = Array.from({ length: 25 }, (_, i) => ({
      workDir: `/project/p${i}`,
      sessionId: `sid-${i}`,
      title: `Session ${i}`,
      wireMtime: 1000 + i,
    }))

    mockFS({ kimiJson: { work_dirs: manyWorkDirs }, sessions: manySessions })

    const sessions = listSessions()
    expect(sessions).toHaveLength(20)
  })

  it('handles untitled sessions gracefully', () => {
    mockFS({
      kimiJson: {
        work_dirs: [{ path: '/project/z', kaos: '', last_session_id: null }],
      },
      sessions: [
        { workDir: '/project/z', sessionId: 'sid-u', title: '', wireMtime: 1000 },
      ],
    })

    const sessions = listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('(untitled)')
  })
})
