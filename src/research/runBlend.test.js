import test from 'node:test'
import assert from 'node:assert/strict'
import { runBlend } from './runBlend.js'
import { PRECISION_FLOOR } from './loop.js'

const COLORS = ['#ffffff', '#000000', '#4a4a4a', '#757575', '#8b7e66', '#c5c5c5', '#d1d1d1', '#e7f0fd', '#0f65ef', '#083884', '#f26722']
const RESOLVED = [
  ...COLORS.map((v, i) => ({ id: `color.c${i}`, cssVar: `--color-c${i}`, value: v, tier: 'primitive', type: 'color' })),
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]

test('runBlend: reaches the site target within budget and ends feasible with 0 contrast FN', () => {
  // synthetic-only (no OSS roots) keeps the test hermetic — no filesystem deps.
  const r = runBlend(RESOLVED, { ossRoots: [], syntheticN: 400, targetSites: 2000, timeBudgetMs: 60_000 })
  assert.ok(r.stats.sites >= 2000, 'grew to the site target')
  assert.equal(r.degraded, false, 'not degraded within a generous budget')
  assert.ok(r.loop.final.precision >= PRECISION_FLOOR - 1e-9, 'final config feasible')
  assert.equal(r.loop.final.contrastFN, 0, 'contrast oracle: 0 false negatives at final config')
  assert.ok(r.loop.final.coverage >= r.loop.baseline.coverage, 'coverage never regresses')
  // the scale schedule doubled synthetic N at least once
  assert.ok(r.scaleLog.length >= 2)
})
