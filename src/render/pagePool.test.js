// pagePool.js touches Playwright lazily (only inside acquire()); these tests
// only cover the laziness/shape contract — they never call acquire(), so they
// never launch a real browser and pass whether or not Playwright is installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPagePool } from './pagePool.js'

test('createPagePool: returns a pool without importing/launching Playwright', () => {
  const pool = createPagePool()
  assert.equal(typeof pool.acquire, 'function')
  assert.equal(typeof pool.evict, 'function')
  assert.equal(typeof pool.closeAll, 'function')
})

test('createPagePool: closeAll on a never-used pool is a safe no-op', async () => {
  const pool = createPagePool()
  await pool.closeAll() // must not throw even though nothing was ever acquired
})

test('createPagePool: evict on a url that was never acquired is a safe no-op', async () => {
  const pool = createPagePool()
  await pool.evict('https://never-acquired.example')
})
