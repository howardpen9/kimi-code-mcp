/**
 * Cache Manager for Kimi Code MCP
 * 
 * Phase 1 Implementation: Basic Session Caching
 * - Caches Kimi sessions per working directory
 * - Reuses sessions for subsequent queries to reduce latency and cost
 * - Auto-expires caches after configured timeout
 * - Detects file changes via git commit hash or mtime
 */

import * as fs from 'fs'
import * as path from 'path'
import { KIMI_BIN, buildKimiArgs } from './kimi-runner.js'
import { spawn } from 'child_process'
import { createHash } from 'crypto'

/** Configuration options for CacheManager */
export interface CacheManagerConfig {
  /** Maximum number of cached sessions to keep in memory (default: 10) */
  maxSize?: number
  /** Session TTL in milliseconds (default: 30 minutes) */
  maxAgeMs?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
}

/** Represents a cached Kimi session */
export interface CacheEntry {
  /** Kimi session ID (UUID) */
  sessionId: string
  /** Absolute path to working directory */
  workDir: string
  /** Hash representing codebase state when cached */
  codebaseHash: string
  /** When this cache entry was created */
  createdAt: number
  /** Last time this cache was accessed */
  lastUsedAt: number
  /** Number of times this cache has been hit */
  hitCount: number
  /** Whether this cache is currently being warmed up */
  isWarming: boolean
}

/** Statistics for monitoring cache performance */
export interface CacheStats {
  totalEntries: number
  totalHits: number
  totalMisses: number
  totalEvictions: number
  averageHitLatency: number
  averageMissLatency: number
}

/** Result of cache get operation */
export interface CacheGetResult {
  /** Whether cache was hit */
  hit: boolean
  /** Session ID if hit, undefined if miss */
  sessionId?: string
  /** Time taken to resolve in ms */
  resolveTimeMs: number
}

export class CacheManager {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private maxAgeMs: number
  private debug: boolean
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    hitLatencies: [] as number[],
    missLatencies: [] as number[],
  }

  constructor(config: CacheManagerConfig = {}) {
    this.maxSize = config.maxSize ?? 10
    this.maxAgeMs = config.maxAgeMs ?? 30 * 60 * 1000  // 30 minutes
    this.debug = config.debug ?? false
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.error(`[CacheManager] ${message}`, ...args)
    }
  }

  /**
   * Get or create a cached session for the given working directory.
   * 
   * Flow:
   * 1. Check if valid cache exists (not expired, files unchanged)
   * 2. If hit: update lastUsedAt, increment hitCount, return sessionId
   * 3. If miss: create new session via cache warming, store in cache
   * 
   * @param workDir - Absolute path to codebase directory
   * @param warmupOptions - Options for cache warming if miss
   * @returns Promise resolving to CacheGetResult
   */
  async getOrCreateSession(
    workDir: string,
    warmupOptions?: {
      timeoutMs?: number
      thinking?: boolean
    }
  ): Promise<CacheGetResult> {
    const startTime = Date.now()
    const cacheKey = this.normalizePath(workDir)

    this.log(`Getting session for: ${cacheKey}`)

    // Check for existing valid cache
    const existing = this.cache.get(cacheKey)
    if (existing && await this.isValid(existing)) {
      existing.lastUsedAt = Date.now()
      existing.hitCount++
      this.stats.hits++
      const resolveTime = Date.now() - startTime
      this.stats.hitLatencies.push(resolveTime)
      this.log(`Cache HIT: ${existing.sessionId} (hits: ${existing.hitCount})`)
      return { hit: true, sessionId: existing.sessionId, resolveTimeMs: resolveTime }
    }

    // Cache miss - need to create new session
    this.stats.misses++
    this.log(`Cache MISS for: ${cacheKey}`)

    // If another request is already warming this cache, wait for it
    if (existing?.isWarming) {
      this.log(`Cache is warming, waiting...`)
      const sessionId = await this.waitForWarmup(cacheKey)
      const resolveTime = Date.now() - startTime
      this.stats.missLatencies.push(resolveTime)
      return { hit: false, sessionId, resolveTimeMs: resolveTime }
    }

    // Mark as warming to prevent duplicate warmups
    if (existing) {
      existing.isWarming = true
    }

    try {
      const sessionId = await this.warmupCache(workDir, warmupOptions)
      
      if (sessionId) {
        const codebaseHash = await this.computeCodebaseHash(workDir)
        const entry: CacheEntry = {
          sessionId,
          workDir: cacheKey,
          codebaseHash,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          hitCount: 0,
          isWarming: false,
        }
        this.cache.set(cacheKey, entry)
        this.evictIfNeeded()
        this.log(`Cache created: ${sessionId}`)
      }

      const resolveTime = Date.now() - startTime
      this.stats.missLatencies.push(resolveTime)
      return { hit: false, sessionId, resolveTimeMs: resolveTime }
    } catch (error) {
      // Clean up warming state on error
      if (existing) {
        existing.isWarming = false
      }
      throw error
    }
  }

  /**
   * Check if a cache entry is still valid.
   * Valid means: not expired AND codebase hasn't changed
   */
  private async isValid(entry: CacheEntry): Promise<boolean> {
    // Check expiration
    if (Date.now() - entry.createdAt > this.maxAgeMs) {
      this.log(`Cache expired: ${entry.sessionId}`)
      return false
    }

    // Check if codebase changed
    const currentHash = await this.computeCodebaseHash(entry.workDir)
    if (currentHash !== entry.codebaseHash) {
      this.log(`Codebase changed, invalidating cache: ${entry.sessionId}`)
      return false
    }

    // Try to verify session still exists in Kimi
    // Note: This is a lightweight check, actual validation happens on use
    return true
  }

  /**
   * Warm up cache by creating a new Kimi session.
   * This reads the codebase into Kimi's 256K context for reuse.
   */
  private async warmupCache(
    workDir: string,
    options?: { timeoutMs?: number; thinking?: boolean }
  ): Promise<string | undefined> {
    const timeoutMs = options?.timeoutMs ?? 120_000
    const thinking = options?.thinking ?? false

    this.log(`Warming cache for: ${workDir}`)

    
    // Use a lightweight warmup prompt that loads context without heavy processing
    const warmupPrompt = `Please read and index this codebase structure for efficient querying.
This is a cache warming request - focus on loading files into context.
Acknowledge when you've loaded the main files (no detailed analysis needed).`

    // Flags are probed per CLI version — see buildKimiArgs.
    const args = buildKimiArgs({ prompt: warmupPrompt, workDir, thinking })

    return new Promise((resolve, reject) => {
      const env = { ...process.env }
      const localBin = path.dirname(KIMI_BIN)
      if (!env.PATH?.includes(localBin)) {
        env.PATH = `${localBin}:${env.PATH || ''}`
      }

      const proc = spawn(KIMI_BIN, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: workDir,
      })

      let stdout = ''
      let stderr = ''
      let sessionId: string | undefined

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 5000)
        reject(new Error(`Cache warmup timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.on('close', (code) => {
        clearTimeout(timer)

        if (code !== 0) {
          reject(new Error(`Cache warmup failed: ${stderr || `exit code ${code}`}`))
          return
        }

        // Extract session ID from stdout (Kimi outputs it in the JSON)
        sessionId = this.extractSessionId(stdout)
        this.log(`Warmup complete, session: ${sessionId}`)
        resolve(sessionId)
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /**
   * Extract session ID from Kimi's output.
   * The session ID is typically in the JSON response or can be parsed from logs.
   */
  private extractSessionId(stdout: string): string | undefined {
    // Try to find session ID in JSON output
    const lines = stdout.trim().split('\n').filter(Boolean)
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        // Check various possible locations for session ID
        if (parsed.session_id) return parsed.session_id
        if (parsed.metadata?.session_id) return parsed.metadata.session_id
      } catch { /* not JSON, skip */ }
    }

    // Fallback: Kimi may output session ID in a specific format
    const sessionMatch = stdout.match(/session[_-]?id[":\s]+([a-f0-9-]{36})/i)
    if (sessionMatch) return sessionMatch[1]

    // If we can't extract session ID, we'll need to list sessions to find it
    // This is a fallback mechanism
    return undefined
  }

  /**
   * Compute a hash representing the current state of the codebase.
   * Uses git commit hash if available, otherwise falls back to file mtimes.
   */
  private async computeCodebaseHash(workDir: string): Promise<string> {
    // First try: use git commit hash (most reliable)
    try {
      const { execSync } = await import('child_process')
      const gitHash = execSync('git rev-parse HEAD', {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      return `git:${gitHash}`
    } catch { /* not a git repo or git not available */ }

    // Second try: hash of key file metadata
    try {
      const files = await this.getKeyFiles(workDir)
      const hash = createHash('md5')
      
      for (const file of files.sort()) {
        try {
          const stat = fs.statSync(file)
          hash.update(`${file}:${stat.mtimeMs}:${stat.size}`)
        } catch { /* skip inaccessible files */ }
      }
      
      return `mtime:${hash.digest('hex')}`
    } catch {
      // Last resort: timestamp
      return `ts:${Date.now()}`
    }
  }

  /**
   * Get key files for hashing (config files, main source files)
   */
  private async getKeyFiles(workDir: string): Promise<string[]> {
    const keyFiles: string[] = []
    const patterns = [
      'package.json',
      'tsconfig.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pyproject.toml',
      'Makefile',
    ]

    for (const pattern of patterns) {
      const fullPath = path.join(workDir, pattern)
      if (fs.existsSync(fullPath)) {
        keyFiles.push(fullPath)
      }
    }

    return keyFiles
  }

  /**
   * Wait for an in-progress cache warmup to complete.
   */
  private async waitForWarmup(cacheKey: string, maxWaitMs = 60000): Promise<string | undefined> {
    const checkInterval = 100
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      const entry = this.cache.get(cacheKey)
      
      if (!entry) return undefined  // Entry was removed
      if (!entry.isWarming) return entry.sessionId  // Warming complete
      
      await this.sleep(checkInterval)
    }

    throw new Error(`Timeout waiting for cache warmup: ${cacheKey}`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Evict oldest entries if cache exceeds max size.
   * Uses LRU (Least Recently Used) eviction policy.
   */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxSize) return

    // Sort by lastUsedAt (oldest first)
    const entries = Array.from(this.cache.entries())
    entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)

    // Remove oldest entries until we're at maxSize
    const toRemove = entries.slice(0, entries.length - this.maxSize)
    for (const [key] of toRemove) {
      this.cache.delete(key)
      this.stats.evictions++
      this.log(`Evicted cache: ${key}`)
    }
  }

  /**
   * Manually invalidate a cache entry.
   */
  invalidate(workDir: string): boolean {
    const cacheKey = this.normalizePath(workDir)
    const existed = this.cache.delete(cacheKey)
    if (existed) {
      this.log(`Manually invalidated: ${cacheKey}`)
    }
    return existed
  }

  /**
   * Invalidate all cache entries.
   */
  invalidateAll(): number {
    const count = this.cache.size
    this.cache.clear()
    this.log(`Invalidated all ${count} caches`)
    return count
  }

  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats {
    const hitLatencies = this.stats.hitLatencies
    const missLatencies = this.stats.missLatencies

    return {
      totalEntries: this.cache.size,
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      totalEvictions: this.stats.evictions,
      averageHitLatency: hitLatencies.length > 0
        ? hitLatencies.reduce((a, b) => a + b, 0) / hitLatencies.length
        : 0,
      averageMissLatency: missLatencies.length > 0
        ? missLatencies.reduce((a, b) => a + b, 0) / missLatencies.length
        : 0,
    }
  }

  /**
   * List all current cache entries (for debugging).
   */
  listEntries(): Array<Pick<CacheEntry, 'workDir' | 'sessionId' | 'hitCount' | 'lastUsedAt'>> {
    return Array.from(this.cache.values()).map(entry => ({
      workDir: entry.workDir,
      sessionId: entry.sessionId,
      hitCount: entry.hitCount,
      lastUsedAt: entry.lastUsedAt,
    }))
  }

  /**
   * Normalize path for consistent cache key usage.
   */
  private normalizePath(workDir: string): string {
    return path.resolve(workDir)
  }
}

/** Singleton instance for global use */
let globalCacheManager: CacheManager | undefined

export function getGlobalCacheManager(config?: CacheManagerConfig): CacheManager {
  if (!globalCacheManager) {
    globalCacheManager = new CacheManager(config)
  }
  return globalCacheManager
}

export function resetGlobalCacheManager(): void {
  globalCacheManager = undefined
}
