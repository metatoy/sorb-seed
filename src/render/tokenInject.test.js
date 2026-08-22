import { test } from 'node:test'
import assert from 'node:assert/strict'
import { injectTokenMap, readResolvedVars, buildConformance } from './tokenInject.js'

// ─── buildConformance (pure) ─────────────────────────────────────────────────
test('buildConformance: all match → conformant true, no mismatches', () => {
  const snap = buildConformance(
    { '--sorb-color-bg': '#fff', '--sorb-radius': '4px' },
    { '--sorb-color-bg': '#fff', '--sorb-radius': '4px' },
  )
  assert.equal(snap.conformant, true)
  assert.equal(snap.mismatchCount, 0)
  assert.equal(snap.rows.length, 2)
  assert.ok(snap.rows.every((r) => r.match))
})

test('buildConformance: a resolved value differing from requested is a mismatch', () => {
  const snap = buildConformance({ '--x': '4px' }, { '--x': '8px' })
  assert.equal(snap.conformant, false)
  assert.equal(snap.mismatchCount, 1)
  assert.deepEqual(snap.rows[0], { cssVar: '--x', expected: '4px', actual: '8px', match: false })
})

test('buildConformance: a missing resolved var counts as a mismatch (actual = "")', () => {
  const snap = buildConformance({ '--x': '4px' }, {})
  assert.equal(snap.mismatchCount, 1)
  assert.equal(snap.rows[0].actual, '')
})

test('buildConformance: whitespace is trimmed before comparing', () => {
  const snap = buildConformance({ '--x': ' 4px ' }, { '--x': '4px' })
  assert.equal(snap.rows[0].match, true)
})

// ─── injectTokenMap / readResolvedVars (thin page.evaluate wrappers) ────────
test('injectTokenMap: calls page.evaluate once with the token map as the arg', async () => {
  const calls = []
  const page = { evaluate: async (fn, arg) => calls.push({ fn, arg }) }
  await injectTokenMap(page, { '--x': '1px' })
  assert.equal(calls.length, 1)
  assert.equal(typeof calls[0].fn, 'function')
  assert.deepEqual(calls[0].arg, { '--x': '1px' })
})

test('readResolvedVars: passes the var names through and returns page.evaluate result', async () => {
  const page = {
    evaluate: async (fn, names) => Object.fromEntries(names.map((n) => [n, 'resolved:' + n])),
  }
  const out = await readResolvedVars(page, ['--a', '--b'])
  assert.deepEqual(out, { '--a': 'resolved:--a', '--b': 'resolved:--b' })
})

test('readResolvedVars: short-circuits to {} for an empty var list (no page.evaluate call)', async () => {
  let called = false
  const page = { evaluate: async () => { called = true } }
  const out = await readResolvedVars(page, [])
  assert.deepEqual(out, {})
  assert.equal(called, false)
})
