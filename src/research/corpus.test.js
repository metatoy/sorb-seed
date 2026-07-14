import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCorpus, corpusStats, paletteFrom } from './corpus.js'

const RESOLVED = [
  { id: 'color.white', cssVar: '--color-white', value: '#ffffff', tier: 'primitive', type: 'color' },
  { id: 'color.black', cssVar: '--color-black', value: '#000000', tier: 'primitive', type: 'color' },
  { id: 'color.blue.500', cssVar: '--color-blue-500', value: '#0f65ef', tier: 'primitive', type: 'color' },
  { id: 'color.blue.700', cssVar: '--color-blue-700', value: '#083884', tier: 'primitive', type: 'color' },
  { id: 'color.charcoal', cssVar: '--color-charcoal', value: '#4a4a4a', tier: 'semantic', type: 'color' },
  { id: 'color.grey', cssVar: '--color-grey', value: '#757575', tier: 'primitive', type: 'color' },
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]

const OPTS = { seed: 1425443, n: 40, splitSeed: 0xc0ffee, trainFrac: 0.7 }

test('buildCorpus is deterministic for a fixed seed', () => {
  const a = buildCorpus(RESOLVED, OPTS)
  const b = buildCorpus(RESOLVED, OPTS)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('split is ~70/30 and frozen by splitSeed', () => {
  const cases = buildCorpus(RESOLVED, OPTS)
  const s = corpusStats(cases)
  assert.equal(s.cases, 40)
  assert.equal(s.train, 28) // round(40*0.7)
  assert.equal(s.test, 12)
})

test('corpus carries BOTH drift and benign, and every class appears', () => {
  const s = corpusStats(buildCorpus(RESOLVED, OPTS))
  assert.ok(s.drift > 0, 'has drift sites')
  assert.ok(s.benign > 0, 'has benign sites')
  assert.ok(s.byClass['stale-value'] > 0)
  assert.ok(s.byClass['scale-violation'] > 0)
  assert.ok(s.byClass['contrast-break'] > 0)
  assert.ok(s.byClass['benign'] > 0)
  // the held-out split is not degenerate: it must contain drift to be scorable
  assert.ok(s.testDrift > 0, 'held-out split contains drift')
})

test('every contrast-break label is an oracle-verified real violation (0 injected false positives)', () => {
  const cases = buildCorpus(RESOLVED, OPTS)
  let n = 0
  for (const c of cases) {
    for (const l of c.labels) {
      if (l.class === 'contrast-break') {
        n++
        assert.equal(l.contrast.violates, true)
      }
    }
  }
  assert.ok(n > 0)
})

test('paletteFrom collects color + dimension values', () => {
  const p = paletteFrom(RESOLVED)
  assert.ok(p.colorValues.has('#0f65ef'))
  assert.ok(p.dimValues.has('4px'))
})
