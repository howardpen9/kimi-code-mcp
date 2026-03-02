import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

const KIMI_DIR = path.join(os.homedir(), '.kimi')
const SESSIONS_DIR = path.join(KIMI_DIR, 'sessions')
const KIMI_JSON = path.join(KIMI_DIR, 'kimi.json')

export interface KimiSession {
  sessionId: string
  title: string
  workDir: string
  workDirHash: string
  lastModified: string
  archived: boolean
}

interface WorkDirEntry {
  path: string
  kaos: string
  last_session_id: string | null
}

interface SessionMetadata {
  session_id: string
  title: string
  wire_mtime: number
  archived: boolean
}

/** Build hash → workDir mapping from kimi.json */
function buildWorkDirMap(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const raw = fs.readFileSync(KIMI_JSON, 'utf-8')
    const data = JSON.parse(raw) as { work_dirs?: WorkDirEntry[] }
    for (const wd of data.work_dirs || []) {
      const hash = crypto.createHash('md5').update(wd.path).digest('hex')
      map.set(hash, wd.path)
    }
  } catch { /* kimi.json not found or invalid */ }
  return map
}

export function listSessions(opts?: { workDir?: string; limit?: number }): KimiSession[] {
  const limit = opts?.limit ?? 20
  const workDirMap = buildWorkDirMap()
  const sessions: KimiSession[] = []

  // Optionally filter by workDir hash
  let targetHash: string | undefined
  if (opts?.workDir) {
    targetHash = crypto.createHash('md5').update(opts.workDir).digest('hex')
  }

  let hashDirs: string[]
  try {
    hashDirs = fs.readdirSync(SESSIONS_DIR)
  } catch {
    return []
  }

  for (const hashDir of hashDirs) {
    if (targetHash && hashDir !== targetHash) continue

    const hashPath = path.join(SESSIONS_DIR, hashDir)
    if (!fs.statSync(hashPath).isDirectory()) continue

    const workDir = workDirMap.get(hashDir) || `(unknown: ${hashDir})`

    let sessionDirs: string[]
    try {
      sessionDirs = fs.readdirSync(hashPath)
    } catch { continue }

    for (const sessionDir of sessionDirs) {
      const metaPath = path.join(hashPath, sessionDir, 'metadata.json')
      try {
        const raw = fs.readFileSync(metaPath, 'utf-8')
        const meta = JSON.parse(raw) as SessionMetadata

        if (meta.archived) continue

        sessions.push({
          sessionId: meta.session_id,
          title: meta.title || '(untitled)',
          workDir,
          workDirHash: hashDir,
          lastModified: new Date(meta.wire_mtime * 1000).toISOString(),
          archived: meta.archived,
        })
      } catch { /* skip invalid sessions */ }
    }
  }

  // Sort by last modified descending
  sessions.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
  return sessions.slice(0, limit)
}
