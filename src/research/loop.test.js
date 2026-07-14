import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCorpus } from './corpus.js'
import { buildTokenIndex } from '../annotateTokens.js'
import { scoreCorpus } from './score.js'
import { runLoop, PRECISION_FLOOR } from './loop.js'

// A palette rich enough that a token color failing AA exists for most bgs, so
// contrast-breaks are token-valued (they bind → baseline misses them).
const COLORS = ['#ffffff', '#000000', '#111111', '#222222', '#4a4a4a', '#757575', '#8b7e66', '#a0a0a0', '#c5c5c5', '#d1d1d1', '#e7f0fd', '#0f65ef', '#083884', '#f26722']
const RESOLVED = [
  ...COLORS.map((v, i) => ({ id: `color.c${i}`, cssVar: `--color-c${i}`, value: v, tier: i < 4 ? 'primitive' : 'semantic', type: 'color' })),
  { id: 'radius.100', cssVar: '--radius-100', value: '2px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]
const OPTS = { seed: 1425443, n: 160, splitSeed: 0xc0ffee }

test('runLoop: ends feasible, never loses coverage, and the contrast oracle zeroes false negatives', () => {
  const index = buildTokenIndex(RESOLVED)
  const cases = buildCorpus(RESOLVED, OPTS)
  const r = runLoop(cases, index, resolved(cases) || RESOLVED)

  assert.equal(r.history[0].attempt, 'baseline')
  // The loop must end at or above baseline coverage and satisfy the precision floor.
  assert.ok(r.final.coverage >= r.baseline.coverage - 1e-9, 'coverage never regresses below baseline')
  assert.ok(r.final.precision >= PRECISION_FLOOR - 1e-9, 'final config is feasible')
  // The contrast-oracle attempt, wherever evaluated, drives injected-contrast FN to 0.
  const co = r.history.find((h) => h.attempt === 'contrast-oracle')
  assert.ok(co, 'contrast-oracle attempt was evaluated')
  assert.equal(co.test.contrastFN, 0, 'oracle catches every injected contrast-break (0 FN)')
  // stop reason is recorded
  assert.equal(typeof r.stoppedBy, 'string')
})

test('runLoop: the two good signals are accepted; a bad signal is rejected', () => {
  const index = buildTokenIndex(RESOLVED)
  const cases = buildCorpus(RESOLVED, OPTS)
  const r = runLoop(cases, index, RESOLVED)
  const byName = Object.fromEntries(r.history.map((h) => [h.attempt, h]))
  // allowlist repairs precision, contrast closes the coverage gap → both accepted
  assert.equal(byName['literal-allowlist'].accepted, true)
  assert.equal(byName['contrast-oracle'].accepted, true)
  // role-aware hurts precision on this corpus → rejected for precision<floor
  assert.equal(byName['role-aware'].accepted, false)
})

// helper: no-op that keeps the resolved reference explicit in the first test
function resolved() { return null }
