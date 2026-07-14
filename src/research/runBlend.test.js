import test from 'node:test'
import assert from 'node:assert/strict'
import { runBlend, nightly, dateSeedOf } from './runBlend.js'
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

test('nightly: fresh per-date seed holds the loop invariants and is deterministic per date', () => {
  const opts = { ossRoots: [], dateSeed: 20260714, targetSites: 2000 }
  const a = nightly(RESOLVED, opts)
  const b = nightly(RESOLVED, opts)
  assert.equal(JSON.stringify(a.row.final), JSON.stringify(b.row.final), 'same date → identical result')
  // a different date rotates the seed → an independent corpus
  const c = nightly(RESOLVED, { ossRoots: [], dateSeed: 20261225, targetSites: 2000 })
  assert.notEqual(c.row.seed, a.row.seed, 'date rotates the seed')
  // invariants hold on every independent corpus (the production 0.95 guard is
  // validated on the full token map, not this minimal fixture)
  for (const r of [a, c]) {
    assert.ok(r.row.final.precision >= PRECISION_FLOOR - 1e-9, 'final feasible')
    assert.ok(r.row.final.coverage >= r.row.baseline.coverage - 1e-9, 'coverage never regresses')
    assert.ok(typeof r.pass === 'boolean')
  }
})

test('dateSeedOf: UTC YYYYMMDD integer', () => {
  assert.equal(dateSeedOf(new Date('2026-07-14T09:00:00Z')), 20260714)
})
