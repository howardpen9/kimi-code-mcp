import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_MODEL,
  resolveModel,
  isK3Model,
  modelDetectionFooter,
  parseProviderListDefault,
  classifyObservedModel,
} from './models.js'

const SAVED = { ...process.env }

describe('resolveModel', () => {
  beforeEach(() => {
    delete process.env.KIMICODE_MODEL
    delete process.env.KIMI_MODEL
  })

  afterEach(() => {
    process.env = { ...SAVED }
  })

  it('defaults to k3', () => {
    const r = resolveModel()
    expect(r.id).toBe('k3')
    expect(r.apiModel).toBe('k3')
    expect(r.cliAlias).toBe('kimi-code/k3')
    expect(r.family).toBe('k3')
    expect(r.source).toBe('default')
    expect(DEFAULT_MODEL).toBe('k3')
  })

  it('accepts k3 aliases', () => {
    for (const input of ['k3', 'K3', 'kimi-code/k3', 'kimi-k3']) {
      const r = resolveModel(input)
      expect(r.family).toBe('k3')
      expect(r.apiModel).toBe('k3')
      expect(r.cliAlias).toBe('kimi-code/k3')
    }
  })

  it('accepts kimi-for-coding aliases', () => {
    for (const input of ['kimi-for-coding', 'kimi-code/kimi-for-coding', 'k2.7']) {
      const r = resolveModel(input)
      expect(r.family).toBe('kimi-for-coding')
      expect(r.apiModel).toBe('kimi-for-coding')
    }
  })

  it('prefers arg over env', () => {
    process.env.KIMICODE_MODEL = 'kimi-for-coding'
    const r = resolveModel('k3')
    expect(r.id).toBe('k3')
    expect(r.source).toBe('arg')
  })

  it('uses env when no arg', () => {
    process.env.KIMICODE_MODEL = 'kimi-for-coding'
    const r = resolveModel()
    expect(r.family).toBe('kimi-for-coding')
    expect(r.source).toBe('env')
  })

  it('KIMI_MODEL works as fallback env', () => {
    process.env.KIMI_MODEL = 'k3'
    const r = resolveModel()
    expect(r.family).toBe('k3')
    expect(r.source).toBe('env')
  })

  it('passes through unknown models', () => {
    const r = resolveModel('custom-model-x')
    expect(r.apiModel).toBe('custom-model-x')
    expect(r.cliAlias).toBe('custom-model-x')
    expect(r.family).toBe('other')
  })
})

describe('isK3Model / footer / parse', () => {
  it('isK3Model on strings and resolved', () => {
    expect(isK3Model('k3')).toBe(true)
    expect(isK3Model('kimi-code/k3')).toBe(true)
    expect(isK3Model('kimi-for-coding')).toBe(false)
    expect(isK3Model(resolveModel('k3'))).toBe(true)
  })

  it('modelDetectionFooter includes k3 flag and observed', () => {
    const footer = modelDetectionFooter(resolveModel('k3'), 'k3')
    expect(footer).toContain('[kimi-model')
    expect(footer).toContain('requested=k3')
    expect(footer).toContain('observed=k3')
    expect(footer).toContain('k3=yes')
  })

  it('footer marks k3=no when observed is different family', () => {
    const footer = modelDetectionFooter(resolveModel('k3'), 'kimi-for-coding')
    expect(footer).toContain('k3=no')
  })

  it('parseProviderListDefault', () => {
    const out = 'managed:kimi-code  type=kimi  models=3\n\nDefault model: kimi-code/k3\n'
    expect(parseProviderListDefault(out)).toBe('kimi-code/k3')
  })

  it('classifyObservedModel', () => {
    expect(classifyObservedModel('kimi-code/k3').isK3).toBe(true)
    expect(classifyObservedModel('kimi-for-coding').isK3).toBe(false)
    expect(classifyObservedModel(undefined).isK3).toBe(false)
  })
})
