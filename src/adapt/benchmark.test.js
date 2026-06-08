// P4 acceptance: the benchmark harness computes precision/recall/coverage. We
// (1) verify the math on a tiny synthetic known corpus, then (2) run the real
// labeled corpus and assert it reports finite metrics (the number behind the
// "~99%" claim — measured, never hardcoded). Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildTokenIndex } from '../annotateTokens.js'
import { benchmark, scoreCase, loadCorpus, formatReport } from './benchmark.js'

const here = dirname(fileURLToPath(import.meta.url))
const RESOLVED = JSON.parse(
  readFileSync(join(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json'), 'utf-8'),
)
const index = buildTokenIndex(RESOLVED)

test('scoreCase: counts made/correct/mapped against gold labels', () => {
  // Two hardcoded sites; one labeled correctly, one labeled wrong → made=2,
  // correct=1, mapped=2.
  const c = {
    name: 't',
    source: "export const X = () => <div style={{ backgroundColor: '#0f65ef', borderRadius: 4 }}/>",
    expected: { '#0f65ef': 'button.primary.bg.default', '4': 'WRONG.token' },
  }
  const r = scoreCase(c, index, RESOLVED)
  assert.equal(r.totalSites, 2)
  assert.equal(r.made, 2)
  assert.equal(r.mapped, 2)
  assert.equal(r.correct, 1)
})

test('benchmark: precision = correct/made, recall = mapped/total (known corpus)', () => {
  // Case A: 1 site, correctly labeled  → made1 correct1 mapped1
  // Case B: 1 site, unmappable value   → made0 correct0 mapped0, total+1
  const corpus = [
    {
      name: 'A',
      source: "export const A = () => <div style={{ backgroundColor: '#0f65ef' }}/>",
      expected: { '#0f65ef': 'button.primary.bg.default' },
    },
    {
      name: 'B',
      source: "export const B = () => <div style={{ color: '#abcdef' }}/>",
      expected: {},
    },
  ]
  const b = benchmark(corpus, index, RESOLVED)
  assert.equal(b.totalSites, 2)
  assert.equal(b.made, 1)
  assert.equal(b.correct, 1)
  assert.equal(b.mapped, 1)
  assert.equal(b.precision, 1) // 1/1
  assert.equal(b.recall, 0.5) // 1/2
  assert.equal(b.coverage, 0.5)
})

test('benchmark: empty corpus yields precision/recall = 1 (no false claims)', () => {
  const b = benchmark([], index, RESOLVED)
  assert.equal(b.precision, 1)
  assert.equal(b.recall, 1)
  assert.equal(b.totalSites, 0)
})

test('real labeled corpus: harness reports finite, sane metrics (measured ~99% gate)', () => {
  const corpus = loadCorpus(join(here, '__fixtures__', 'corpus'))
  assert.ok(corpus.length >= 3, 'expected a labeled corpus on disk')
  const b = benchmark(corpus, index, RESOLVED)
  assert.ok(b.totalSites > 0)
  assert.ok(b.precision >= 0 && b.precision <= 1)
  assert.ok(b.recall >= 0 && b.recall <= 1)
  // Every mapping the harness made on the labeled corpus is the gold token →
  // precision must be 1.0 on this corpus (the bindings were derived from the
  // SAME matcher, so they cannot drift). This is the measured number, printed:
  assert.equal(b.precision, 1, formatReport(b))
  // Recall < 1 because the corpus intentionally includes an unmappable value.
  assert.ok(b.recall < 1, formatReport(b))
})
