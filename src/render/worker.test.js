// Unit tests for the E3 render-worker orchestration. NO real Playwright/browser
// is used — `page`/`pool`/`cache` are all fakes injected via `deps`, so these
// tests exercise job orchestration, token-injection wiring, the diff-cache, and
// the result shape without a live browser (per the task's hard rule).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { renderJob } from './worker.js'
import { DiffCache } from './diffCache.js'

// ─── fakes ────────────────────────────────────────────────────────────────────
function makeFakePage({ resolvedVars = {} } = {}) {
  const calls = { evaluate: 0, screenshot: 0 }
  return {
    calls,
    async evaluate() {
      calls.evaluate++
      // 1st call in renderJob is injectTokenMap (no meaningful return needed);
      // 2nd is readResolvedVars, which needs the resolved-values shape back.
      if (calls.evaluate === 1) return undefined
      return resolvedVars
    },
    async screenshot() {
      calls.screenshot++
      return Buffer.from('fake-png-bytes')
    },
    async addInitScript() {},
    async setViewportSize() {},
  }
}

function makeFakePool(pagesByUrl = {}) {
  const acquireCalls = []
  const seen = new Set()
  return {
    acquireCalls,
    async acquire(url, viewport) {
      acquireCalls.push({ url, viewport })
      const reused = seen.has(url)
      seen.add(url)
      const page = pagesByUrl[url] || (pagesByUrl[url] = makeFakePage())
      return { page, reused }
    },
    async evict() {},
    async closeAll() {},
  }
}

const scratchDir = tmpdir()
const scratchPath = () => join(scratchDir, `sorb-worker-test-${randomUUID()}.png`)

// ─── basic shape + reuse ──────────────────────────────────────────────────────
test('renderJob: requires input.url', async () => {
  await assert.rejects(() => renderJob({}), /url is required/)
})

test('renderJob: returns the documented result shape and writes the screenshot file', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  const path = scratchPath()
  let captureCalls = 0
  const captureFn = async () => {
    captureCalls++
    return { type: 'FRAME', name: 'body', fills: [], children: [] }
  }

  const result = await renderJob(
    {
      url: 'https://demo.sorbcloud.com',
      tokenMap: { '--sorb-color-bg': '#fff' },
      screenshotPath: path,
    },
    { pagePool: async () => pool, cache, captureFn },
  )

  try {
    assert.equal(result.cacheHit, false)
    assert.equal(result.pageReused, false)
    assert.equal(captureCalls, 1)
    assert.equal(result.screenshot.path, path)
    assert.equal(result.screenshot.width, 1280)
    assert.equal(result.screenshot.height, 800)
    assert.ok(result.dom)
    assert.ok(result.conformance)
    assert.equal(typeof result.conformance.conformant, 'boolean')
    assert.ok(result.timings)
    for (const k of ['navigateMs', 'injectMs', 'captureMs', 'screenshotMs', 'totalMs']) {
      assert.equal(typeof result.timings[k], 'number')
    }
    assert.equal(result.diff, null) // first render for this url → no prior to diff against
    assert.ok(result.cacheKey.includes('https://demo.sorbcloud.com'))

    const written = await readFile(path)
    assert.equal(written.toString(), 'fake-png-bytes')
  } finally {
    await rm(path, { force: true })
  }
})

// ─── exact-match cache short-circuit ─────────────────────────────────────────
test('renderJob: identical (url, tokenMap) on a warm cache short-circuits the render', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  let captureCalls = 0
  const captureFn = async () => {
    captureCalls++
    return { type: 'FRAME', children: [] }
  }
  const input = {
    url: 'https://demo.sorbcloud.com',
    tokenMap: { '--x': '1px' },
    screenshotPath: scratchPath(),
  }
  const deps = { pagePool: async () => pool, cache, captureFn }

  const r1 = await renderJob(input, deps)
  const r2 = await renderJob({ ...input, screenshotPath: scratchPath() }, deps)

  assert.equal(r1.cacheHit, false)
  assert.equal(r2.cacheHit, true)
  assert.equal(captureCalls, 1) // second call never re-rendered
  assert.equal(r2.screenshot.path, r1.screenshot.path) // cached result's own screenshot ref
  await rm(r1.screenshot.path, { force: true })
})

test('renderJob: different tokenMap for the same url is NOT a cache hit', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  let captureCalls = 0
  const captureFn = async () => {
    captureCalls++
    return { type: 'FRAME', children: [] }
  }
  const deps = { pagePool: async () => pool, cache, captureFn }

  const p1 = scratchPath()
  const p2 = scratchPath()
  const r1 = await renderJob({ url: 'https://a', tokenMap: { '--x': '1px' }, screenshotPath: p1 }, deps)
  const r2 = await renderJob({ url: 'https://a', tokenMap: { '--x': '2px' }, screenshotPath: p2 }, deps)

  assert.equal(r1.cacheHit, false)
  assert.equal(r2.cacheHit, false)
  assert.equal(captureCalls, 2)
  await rm(p1, { force: true })
  await rm(p2, { force: true })
})

// ─── page reuse (navigation-skip) ────────────────────────────────────────────
test('renderJob: a second render of the same url reuses the page (pageReused=true)', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  const captureFn = async () => ({ type: 'FRAME', children: [] })
  const deps = { pagePool: async () => pool, cache, captureFn }

  const p1 = scratchPath()
  const p2 = scratchPath()
  const r1 = await renderJob({ url: 'https://a', tokenMap: { '--x': '1px' }, screenshotPath: p1 }, deps)
  const r2 = await renderJob({ url: 'https://a', tokenMap: { '--x': '2px' }, screenshotPath: p2 }, deps)

  assert.equal(r1.pageReused, false)
  assert.equal(r2.pageReused, true)
  assert.equal(pool.acquireCalls.length, 2)
  await rm(p1, { force: true })
  await rm(p2, { force: true })
})

// ─── diff-cache reporting ─────────────────────────────────────────────────────
test('renderJob: diffOnly=true reports which dom subtree changed on a re-render', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  let call = 0
  const captureFn = async () => {
    call++
    // second capture differs from the first (a changed fill on the same shape)
    return {
      type: 'FRAME',
      children: [{ type: 'FRAME', fills: call === 1 ? [] : [{ raw: '#fff' }], children: [] }],
    }
  }
  const deps = { pagePool: async () => pool, cache, captureFn }

  const p1 = scratchPath()
  const p2 = scratchPath()
  const r1 = await renderJob({ url: 'https://a', tokenMap: { '--x': '1' }, screenshotPath: p1, diffOnly: true }, deps)
  const r2 = await renderJob({ url: 'https://a', tokenMap: { '--x': '2' }, screenshotPath: p2, diffOnly: true }, deps)

  assert.equal(r1.diff, null)
  assert.ok(r2.diff)
  assert.ok(r2.diff.changed.length > 0)
  await rm(p1, { force: true })
  await rm(p2, { force: true })
})

test('renderJob: diffOnly=false skips the diff computation entirely', async () => {
  const pool = makeFakePool()
  const cache = new DiffCache()
  const captureFn = async () => ({ type: 'FRAME', children: [] })
  const deps = { pagePool: async () => pool, cache, captureFn }

  const p1 = scratchPath()
  const p2 = scratchPath()
  await renderJob({ url: 'https://a', tokenMap: { '--x': '1' }, screenshotPath: p1, diffOnly: false }, deps)
  const r2 = await renderJob({ url: 'https://a', tokenMap: { '--x': '2' }, screenshotPath: p2, diffOnly: false }, deps)

  assert.equal(r2.diff, null)
  await rm(p1, { force: true })
  await rm(p2, { force: true })
})

// ─── conformance wiring end-to-end (with the captureFn/page fakes) ──────────
test('renderJob: conformance reflects the resolved vs requested token values', async () => {
  const page = makeFakePage({ resolvedVars: { '--sorb-color-bg': '#000' } }) // mismatch on purpose
  const pool = { async acquire() { return { page, reused: false } }, async evict() {}, async closeAll() {} }
  const cache = new DiffCache()
  const captureFn = async () => ({ type: 'FRAME', children: [] })
  const path = scratchPath()

  const result = await renderJob(
    { url: 'https://a', tokenMap: { '--sorb-color-bg': '#fff' }, screenshotPath: path },
    { pagePool: async () => pool, cache, captureFn },
  )

  assert.equal(result.conformance.conformant, false)
  assert.equal(result.conformance.mismatchCount, 1)
  assert.equal(result.conformance.rows[0].expected, '#fff')
  assert.equal(result.conformance.rows[0].actual, '#000')
  await rm(path, { force: true })
})
