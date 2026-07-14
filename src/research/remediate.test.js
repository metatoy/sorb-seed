import test from 'node:test'
import assert from 'node:assert/strict'
import { remediateEpisode, contrastOracle, scaleOracle, runRemediation } from './remediate.js'
import { buildCorpus } from './corpus.js'
import { mulberry32 } from './prng.js'

test('remediateEpisode: applies a verified fix, never a wrong one', () => {
  const bg = '#ffffff'
  const cands = [
    { value: '#eeeeee', wrong: true }, // fails AA vs white
    { value: '#000000', wrong: false }, // passes
    { value: bg, wrong: true }, // ratio 1 — plausible-but-wrong
  ]
  const e = remediateEpisode(cands, contrastOracle, { bg })
  assert.equal(e.repaired, true)
  assert.equal(e.appliedValue, '#000000')
  assert.equal(e.falseApply, 0)
  assert.equal(e.wrongApplied, 0)
  assert.equal(e.wrongPassed, 0)
})

test('remediateEpisode: no conformant candidate → nothing applied, still 0 false-apply', () => {
  const bg = '#ffffff'
  const e = remediateEpisode([{ value: '#f0f0f0', wrong: true }, { value: bg, wrong: true }], contrastOracle, { bg })
  assert.equal(e.repaired, false)
  assert.equal(e.falseApply, 0)
  assert.equal(e.wrongApplied, 0)
})

test('scaleOracle only verifies real token dimension values', () => {
  const ctx = { dimValues: new Set(['4px', '8px']) }
  assert.equal(scaleOracle('4px', ctx), true)
  assert.equal(scaleOracle('13px', ctx), false)
})

const RES = [
  ...['#ffffff', '#000000', '#4a4a4a', '#757575', '#0f65ef', '#083884', '#f26722', '#c5c5c5'].map((v, i) => ({ id: `color.c${i}`, cssVar: `--c${i}`, value: v, tier: 'primitive', type: 'color' })),
  { id: 'radius.200', cssVar: '--r2', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--r4', value: '8px', tier: 'primitive', type: 'dimension' },
]

test('runRemediation: 0 false-applies and 0 adversarial slips across the corpus', () => {
  const cases = buildCorpus(RES, { seed: 1425443, n: 300, splitSeed: 0xc0ffee })
  const pal = {
    colors: RES.filter((t) => t.type === 'color').map((t) => t.value),
    dims: RES.filter((t) => t.type === 'dimension').map((t) => t.value),
    dimValues: new Set(RES.filter((t) => t.type === 'dimension').map((t) => t.value)),
  }
  const m = runRemediation(cases, RES, mulberry32(42), pal)
  assert.ok(m.episodes >= 100, 'enough episodes')
  assert.equal(m.falseApplies, 0, 'zero false-applies (oracle is the arbiter)')
  assert.equal(m.wrongApplied, 0, 'no guaranteed-wrong candidate ever applied')
  assert.equal(m.wrongPassed, 0, 'oracle never grades a guaranteed-wrong as passing')
  assert.ok(m.repairRate > 0.5, 'oracle verifies a real fix in most episodes')
})
