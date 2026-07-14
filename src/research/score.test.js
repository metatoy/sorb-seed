import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCorpus } from './corpus.js'
import { buildTokenIndex } from '../annotateTokens.js'
import { scoreCorpus, isLegitLiteral } from './score.js'

const COLORS = ['#ffffff', '#000000', '#4a4a4a', '#757575', '#8b7e66', '#c5c5c5', '#d1d1d1', '#e7f0fd', '#0f65ef', '#083884', '#f26722']
const RESOLVED = [
  ...COLORS.map((v, i) => ({ id: `color.c${i}`, cssVar: `--color-c${i}`, value: v, tier: 'primitive', type: 'color' })),
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]
const OPTS = { seed: 1425443, n: 160, splitSeed: 0xc0ffee }

test('isLegitLiteral: zero and keywords, not arbitrary values', () => {
  assert.equal(isLegitLiteral('0'), true)
  assert.equal(isLegitLiteral('transparent'), true)
  assert.equal(isLegitLiteral('#123456'), false)
  assert.equal(isLegitLiteral('5px'), false)
})

test('metrics are valid probabilities and the splits are non-empty', () => {
  const index = buildTokenIndex(RESOLVED)
  const cases = buildCorpus(RESOLVED, OPTS)
  const b = scoreCorpus(cases, index, RESOLVED, {})
  for (const s of [b.train, b.test]) {
    assert.ok(s.coverage >= 0 && s.coverage <= 1)
    assert.ok(s.precision >= 0 && s.precision <= 1)
    assert.ok(s.drift > 0)
  }
})

test('allowlist raises precision; contrast oracle raises coverage + zeroes contrast FN', () => {
  const index = buildTokenIndex(RESOLVED)
  const cases = buildCorpus(RESOLVED, OPTS)
  const base = scoreCorpus(cases, index, RESOLVED, {}).test
  const allow = scoreCorpus(cases, index, RESOLVED, { literalAllowlist: true }).test
  const contrast = scoreCorpus(cases, index, RESOLVED, { contrastAware: true }).test

  assert.ok(allow.precision >= base.precision, 'allowlist does not lower precision')
  assert.ok(contrast.coverage >= base.coverage, 'contrast does not lower coverage')
  assert.equal(contrast.contrastFN, 0, 'contrast oracle catches every injected break')
  // baseline misses contrast-breaks because they bind → real coverage gap exists
  assert.ok(base.contrastFN > 0, 'baseline (no oracle) misses injected contrast-breaks')
})
