import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stableStringify,
  hashTokenMap,
  makeCacheKey,
  hashNodePaths,
  diffNodeHashes,
  DiffCache,
} from './diffCache.js'

test('stableStringify: key order does not affect the result', () => {
  const a = stableStringify({ b: 1, a: 2 })
  const b = stableStringify({ a: 2, b: 1 })
  assert.equal(a, b)
})

test('hashTokenMap: order-independent, sensitive to values', () => {
  const h1 = hashTokenMap({ '--x': '1', '--y': '2' })
  const h2 = hashTokenMap({ '--y': '2', '--x': '1' })
  const h3 = hashTokenMap({ '--y': '3', '--x': '1' })
  assert.equal(h1, h2)
  assert.notEqual(h1, h3)
})

test('hashTokenMap: empty/undefined map is stable', () => {
  assert.equal(hashTokenMap(undefined), hashTokenMap({}))
})

test('makeCacheKey: combines url + token-map hash', () => {
  const k1 = makeCacheKey('https://a.example', { '--x': '1' })
  const k2 = makeCacheKey('https://b.example', { '--x': '1' })
  const k3 = makeCacheKey('https://a.example', { '--x': '2' })
  assert.notEqual(k1, k2)
  assert.notEqual(k1, k3)
  assert.equal(k1, makeCacheKey('https://a.example', { '--x': '1' }))
})

// ─── node-path hashing / diffing ─────────────────────────────────────────────
const tree = (fill, children = []) => ({ type: 'FRAME', fills: fill ? [{ raw: fill }] : [], children })

test('hashNodePaths: identical trees produce identical hashes at every path', () => {
  const t1 = tree('#fff', [tree('#000'), tree('#111')])
  const t2 = tree('#fff', [tree('#000'), tree('#111')])
  const h1 = hashNodePaths(t1)
  const h2 = hashNodePaths(t2)
  assert.deepEqual([...h1.keys()].sort(), [...h2.keys()].sort())
  for (const [path, hash] of h1) assert.equal(hash, h2.get(path))
})

test('diffNodeHashes: a leaf change bubbles up to its ancestors, siblings unaffected', () => {
  const before = tree('#fff', [tree('#000'), tree('#111')])
  const after = tree('#fff', [tree('#000'), tree('#222')]) // child 1 changed
  const diff = diffNodeHashes(hashNodePaths(before), hashNodePaths(after))
  // root (path "0") and the changed child ("0.1") both bubble; the unchanged
  // sibling ("0.0") must NOT appear.
  assert.ok(diff.changed.includes('0'))
  assert.ok(diff.changed.includes('0.1'))
  assert.ok(!diff.changed.includes('0.0'))
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
})

test('diffNodeHashes: added/removed children are reported', () => {
  const before = tree('#fff', [tree('#000')])
  const after = tree('#fff', [tree('#000'), tree('#111')])
  const diff = diffNodeHashes(hashNodePaths(before), hashNodePaths(after))
  assert.ok(diff.added.includes('0.1'))
  assert.ok(diff.changed.includes('0')) // root's own hash bubbled (child count changed)
})

// ─── DiffCache ────────────────────────────────────────────────────────────────
test('DiffCache: exact getExact/putExact round-trips on (url, tokenMap)', () => {
  const cache = new DiffCache()
  assert.equal(cache.getExact('https://a', { x: '1' }), undefined)
  cache.putExact('https://a', { x: '1' }, { some: 'result' })
  assert.deepEqual(cache.getExact('https://a', { x: '1' }), { some: 'result' })
  // different token map → different key → no hit
  assert.equal(cache.getExact('https://a', { x: '2' }), undefined)
})

test('DiffCache: diffAgainstLastForUrl returns null on first render, a diff on the second', () => {
  const cache = new DiffCache()
  const first = tree('#fff', [tree('#000')])
  const d1 = cache.diffAgainstLastForUrl('https://a', { x: '1' }, first)
  assert.equal(d1, null)

  const second = tree('#fff', [tree('#111')]) // changed
  const d2 = cache.diffAgainstLastForUrl('https://a', { x: '2' }, second)
  assert.ok(d2)
  assert.ok(d2.changed.length > 0)
})

test('DiffCache: capacity eviction bounds memory (oldest-first)', () => {
  const cache = new DiffCache({ capacity: 2 })
  cache.putExact('https://a', {}, { n: 1 })
  cache.putExact('https://b', {}, { n: 2 })
  cache.putExact('https://c', {}, { n: 3 }) // evicts https://a
  assert.equal(cache.getExact('https://a', {}), undefined)
  assert.deepEqual(cache.getExact('https://c', {}), { n: 3 })
})

test('DiffCache: clear() wipes both maps', () => {
  const cache = new DiffCache()
  cache.putExact('https://a', {}, { n: 1 })
  cache.diffAgainstLastForUrl('https://a', {}, tree('#fff'))
  cache.clear()
  assert.equal(cache.getExact('https://a', {}), undefined)
  assert.equal(cache.diffAgainstLastForUrl('https://a', {}, tree('#fff')), null)
})
