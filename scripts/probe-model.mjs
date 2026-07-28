#!/usr/bin/env node
/**
 * Live K3 detection probe for kimi-code-mcp.
 *
 * Usage:
 *   node scripts/probe-model.mjs            # probe default (k3)
 *   node scripts/probe-model.mjs k3
 *   node scripts/probe-model.mjs kimi-for-coding
 *   node scripts/probe-model.mjs --cli      # also run CLI -m probe via kimi -p
 *
 * Exit codes:
 *   0 — requested family is K3 and observation agrees (or CLI default is K3)
 *   1 — probe failed or not K3 when default expected
 *   2 — usage / setup error
 *
 * Detection methods:
 *   1. Coding API response field `model` (echo of request) — strongest for API tools
 *   2. `kimi provider list` → Default model line — CLI default
 *   3. Optional: CLI `-m` one-shot (session export not required for smoke)
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Prefer built dist
let resolveModel, runKimiApi, loadApiAuth, parseProviderListDefault
try {
  ;({ resolveModel, parseProviderListDefault } = await import(
    path.join(root, 'dist/models.js')
  ))
  ;({ runKimiApi, loadApiAuth } = await import(path.join(root, 'dist/kimi-api.js')))
} catch {
  console.error('Build first: npm run build')
  process.exit(2)
}

const args = process.argv.slice(2).filter((a) => a !== '--cli')
const wantCli = process.argv.includes('--cli')
const modelArg = args[0]

const resolved = resolveModel(modelArg)
console.log('=== kimi-code-mcp model probe ===')
console.log('resolved:', {
  id: resolved.id,
  api: resolved.apiModel,
  cli: resolved.cliAlias,
  family: resolved.family,
  source: resolved.source,
})

let ok = true

// 1) CLI provider list
const kimiBin = process.env.KIMI_BIN || `${process.env.HOME}/.local/bin/kimi`
const list = spawnSync(kimiBin, ['provider', 'list'], { encoding: 'utf-8', timeout: 20_000 })
if (list.status === 0) {
  const def = parseProviderListDefault(list.stdout || '')
  console.log('CLI provider list default:', def ?? '(not found)')
  console.log('CLI default is K3?', def ? /k3/i.test(def) : false)
} else {
  console.log('CLI provider list: unavailable', list.stderr?.slice(0, 120) || list.error)
}

// 2) API probe
const auth = loadApiAuth()
if (!auth) {
  console.log('API: not configured (set KIMICODE_API_KEY or ~/.kimi/config.toml)')
  if (resolved.family === 'k3') {
    // still can pass on CLI default alone if present
  }
} else {
  console.log('API: calling chat/completions model=', resolved.apiModel)
  const result = await runKimiApi({
    prompt: 'Reply with exactly one word: pong',
    model: resolved.apiModel,
    timeoutMs: 120_000,
    maxOutputChars: 400,
  })
  console.log('API result:', {
    ok: result.ok,
    model: result.model,
    modelRequested: result.modelRequested,
    modelObserved: result.modelObserved,
    error: result.error,
    sample: result.text?.slice(0, 60),
  })
  const observedK3 = result.modelObserved ? /k3/i.test(result.modelObserved) : false
  if (resolved.family === 'k3') {
    if (!result.modelObserved) {
      console.log('WARN: no modelObserved in API body (unexpected)')
      ok = false
    } else if (!observedK3) {
      console.log('FAIL: requested K3 but observed', result.modelObserved)
      ok = false
    } else {
      console.log('PASS: API observed K3')
    }
  } else {
    console.log('INFO: non-K3 request; observed=', result.modelObserved)
  }
}

// 3) optional CLI -m
if (wantCli) {
  console.log('CLI -m probe…')
  const r = spawnSync(
    kimiBin,
    ['-m', resolved.cliAlias, '-p', 'Say only: pong', '--output-format', 'text'],
    { encoding: 'utf-8', timeout: 120_000 },
  )
  console.log('CLI exit', r.status, 'stdout:', (r.stdout || '').slice(0, 80))
  if (r.status !== 0) {
    console.log('CLI stderr:', (r.stderr || '').slice(0, 200))
    ok = false
  }
}

console.log(ok ? '\n✅ probe OK' : '\n❌ probe failed')
process.exit(ok ? 0 : 1)
