/**
 * Model resolution for Kimi Code MCP.
 *
 * Defaults to K3 (CLI runtime default as of 2026-07). Callers may override via:
 * - tool arg `model`
 * - env `KIMICODE_MODEL` or `KIMI_MODEL`
 *
 * API vs CLI need slightly different id forms:
 * - API chat/completions: raw id works (`k3`, `kimi-for-coding`)
 * - CLI `-m`: prefers alias (`kimi-code/k3`)
 */

/** Preferred default — matches `kimi provider list` → Default model: kimi-code/k3 */
export const DEFAULT_MODEL = 'k3'

/** Env keys checked for a global override (first non-empty wins). */
export const MODEL_ENV_KEYS = ['KIMICODE_MODEL', 'KIMI_MODEL'] as const

export type ModelFamily = 'k3' | 'kimi-for-coding' | 'other'

export interface ResolvedModel {
  /** Canonical short id used for comparison / detection (e.g. `k3`) */
  id: string
  /** Value sent to Coding API `model` field */
  apiModel: string
  /** Value passed to CLI `-m` */
  cliAlias: string
  /** Coarse family for isK3() checks */
  family: ModelFamily
  /** Human label */
  displayName: string
  /** Where this resolution came from */
  source: 'arg' | 'env' | 'default'
}

const TABLE: Record<
  string,
  Omit<ResolvedModel, 'source'>
> = {
  k3: {
    id: 'k3',
    apiModel: 'k3',
    cliAlias: 'kimi-code/k3',
    family: 'k3',
    displayName: 'K3',
  },
  'kimi-code/k3': {
    id: 'k3',
    apiModel: 'k3',
    cliAlias: 'kimi-code/k3',
    family: 'k3',
    displayName: 'K3',
  },
  'kimi-k3': {
    id: 'k3',
    apiModel: 'k3',
    cliAlias: 'kimi-code/k3',
    family: 'k3',
    displayName: 'K3',
  },
  'kimi-for-coding': {
    id: 'kimi-for-coding',
    apiModel: 'kimi-for-coding',
    cliAlias: 'kimi-code/kimi-for-coding',
    family: 'kimi-for-coding',
    displayName: 'K2.7 Code (kimi-for-coding)',
  },
  'kimi-code/kimi-for-coding': {
    id: 'kimi-for-coding',
    apiModel: 'kimi-for-coding',
    cliAlias: 'kimi-code/kimi-for-coding',
    family: 'kimi-for-coding',
    displayName: 'K2.7 Code (kimi-for-coding)',
  },
  'k2.7': {
    id: 'kimi-for-coding',
    apiModel: 'kimi-for-coding',
    cliAlias: 'kimi-code/kimi-for-coding',
    family: 'kimi-for-coding',
    displayName: 'K2.7 Code (kimi-for-coding)',
  },
}

function normalizeKey(raw: string): string {
  return raw.trim()
}

/**
 * Resolve a model string (or env/default) into API + CLI forms.
 */
export function resolveModel(input?: string | null): ResolvedModel {
  const fromArg = input?.trim()
  if (fromArg) {
    return finalize(fromArg, 'arg')
  }

  for (const key of MODEL_ENV_KEYS) {
    const v = process.env[key]?.trim()
    if (v) return finalize(v, 'env')
  }

  return finalize(DEFAULT_MODEL, 'default')
}

function finalize(raw: string, source: ResolvedModel['source']): ResolvedModel {
  const key = normalizeKey(raw)
  const lower = key.toLowerCase()
  const known = TABLE[key] || TABLE[lower]
  if (known) {
    return { ...known, source }
  }

  // Unknown id: pass through as-is for both paths.
  return {
    id: key,
    apiModel: key,
    cliAlias: key,
    family: isK3Id(key) ? 'k3' : 'other',
    displayName: key,
    source,
  }
}

function isK3Id(id: string): boolean {
  const s = id.toLowerCase()
  return s === 'k3' || s.endsWith('/k3') || s.includes('kimi-k3') || /(^|[^a-z])k3([^a-z]|$)/i.test(s)
}

/** True when resolved model is in the K3 family. */
export function isK3Model(model?: string | null | ResolvedModel): boolean {
  if (!model) return false
  if (typeof model === 'object') return model.family === 'k3'
  return resolveModel(model).family === 'k3'
}

/**
 * Footer line for tool responses so callers can detect which model ran
 * without relying on the model self-identifying in prose.
 *
 * Example: `[kimi-model requested=k3 api=k3 cli=kimi-code/k3 family=k3 source=default observed=k3]`
 */
export function modelDetectionFooter(
  resolved: ResolvedModel,
  observed?: string | null,
): string {
  const parts = [
    `requested=${resolved.id}`,
    `api=${resolved.apiModel}`,
    `cli=${resolved.cliAlias}`,
    `family=${resolved.family}`,
    `source=${resolved.source}`,
  ]
  if (observed) parts.push(`observed=${observed}`)
  const k3ok = isK3Model(resolved) && (!observed || isK3Id(observed))
  parts.push(`k3=${k3ok ? 'yes' : 'no'}`)
  return `\n\n[kimi-model ${parts.join(' ')}]`
}

/**
 * Best-effort parse of `kimi provider list` stdout for the default model line:
 *   Default model: kimi-code/k3
 */
export function parseProviderListDefault(stdout: string): string | undefined {
  const m = stdout.match(/Default model:\s*(\S+)/i)
  return m?.[1]
}

/**
 * Classify an observed API/CLI model id into a family for detection reports.
 */
export function classifyObservedModel(observed: string | undefined | null): {
  observed?: string
  family: ModelFamily
  isK3: boolean
} {
  if (!observed) return { family: 'other', isK3: false }
  const r = resolveModel(observed)
  return { observed, family: r.family, isK3: r.family === 'k3' }
}
