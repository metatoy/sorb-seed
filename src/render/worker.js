// E3 — hosted-capture render worker (Mode B).
// hosted-bridge-modes-exploration-plan.md §3 E3.
//
// Wraps the EXISTING sorb-seed Playwright capture machinery as a single-job,
// on-demand render: given an app URL + a token map, navigate, inject the
// tokens as CSS custom properties, and capture a screenshot + the rendered DOM
// (via the SAME walker `capture.js`/`captureCli.js` already use) + a
// conformance snapshot. This is deliberately generic-URL, not Storybook-only
// (Mode B's reachable target class per E0 is public Storybook/DS-docs/staging
// URLs, but the walker itself works against any rendered page — Storybook is
// just where E0 found "public and reachable" apps living).
//
// Target class / auth wall (per E0, do not build here): only public URLs are
// supported. There is no credential-handling path — an auth-walled URL will
// simply fail to render the real app (login page instead), which is the
// documented, deferred follow-up, not a bug to fix in this phase.
//
// Playwright stays OPTIONAL and LAZY: this module never imports `playwright`
// itself. It only reaches Playwright through `pagePool.js`'s `createPagePool`,
// which is dynamically imported on first use — so `renderJob` (and this whole
// module) import cleanly with Playwright absent, and only throw (with the same
// actionable message as `captureCli.js`) once a render actually happens.

import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { injectTokenMap, readResolvedVars, buildConformance } from './tokenInject.js'
import { DiffCache, makeCacheKey } from './diffCache.js'

/**
 * @typedef {Object.<string,string>} TokenMap cssVar -> value
 *
 * @typedef {object} RenderJobInput
 * @property {string} url app URL to render (public/staging — see module doc)
 * @property {TokenMap} [tokenMap] cssVars to inject as :root custom properties
 * @property {{width:number,height:number}} [viewport] default 1280x800; call
 *   once per viewport for multi-viewport token maps
 * @property {string} [selector] root selector to capture (default 'body')
 * @property {boolean} [diffOnly] enable the diff-cache spike (default true)
 * @property {string} [screenshotDir] dir to write the PNG into (default os.tmpdir())
 * @property {string} [screenshotPath] exact PNG path (overrides screenshotDir)
 *
 * @typedef {object} RenderJobDeps injectable seams (tests supply fakes)
 * @property {() => Promise<import('./pagePool.js').PagePool>} [pagePool]
 * @property {DiffCache} [cache]
 * @property {(page: object, selector: string) => Promise<object>} [captureFn]
 * @property {() => number} [now]
 *
 * @typedef {{path:string, width:number, height:number}} ScreenshotRef
 *   A REFERENCE to the written screenshot file — never the image bytes inline
 *   (so logs/NDJSON stay small; callers read the file themselves).
 *
 * @typedef {object} ConformanceRow
 * @property {string} cssVar
 * @property {string} expected
 * @property {string} actual
 * @property {boolean} match
 *
 * @typedef {object} ConformanceSnapshot
 * @property {ConformanceRow[]} rows
 * @property {boolean} conformant
 * @property {number} mismatchCount
 *
 * @typedef {object} RenderJobTimings ms, for cloud throttle/telemetry metering
 * @property {number} navigateMs
 * @property {number} injectMs
 * @property {number} captureMs
 * @property {number} screenshotMs
 * @property {number} totalMs
 *
 * @typedef {object} RenderJobDiff node-path diff vs this URL's last render
 * @property {string[]} changed
 * @property {string[]} added
 * @property {string[]} removed
 *
 * @typedef {object} RenderJobResult
 * @property {ScreenshotRef} screenshot
 * @property {object} dom captured LayerNode tree (root)
 * @property {ConformanceSnapshot} conformance
 * @property {RenderJobTimings} timings
 * @property {boolean} cacheHit exact (url,tokenMap) match — render skipped entirely
 * @property {boolean} pageReused navigation skipped (page already open for this url)
 * @property {RenderJobDiff|null} diff null if diffOnly=false or first render for the url
 * @property {string} cacheKey
 */

let sharedPoolPromise = null
async function defaultPagePool() {
  if (!sharedPoolPromise) {
    sharedPoolPromise = import('./pagePool.js').then((m) => m.createPagePool())
  }
  return sharedPoolPromise
}

const defaultCache = new DiffCache()

let sharedWalkerBundle = null
async function defaultCaptureFn(page, selector) {
  const { buildWalkerBundle } = await import('./walkerBundle.js')
  if (!sharedWalkerBundle) sharedWalkerBundle = await buildWalkerBundle()
  // addInitScript covers future navigations on this page; evaluating the
  // bundle directly also installs it on the CURRENT document — required on
  // the page-reuse path, where no new navigation happens.
  await page.addInitScript({ content: sharedWalkerBundle })
  await page.evaluate(sharedWalkerBundle)
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) || document.body
    return window.__sorbCapture(root)
  }, selector)
}

/**
 * Render one job: navigate (or reuse) `url`, inject `tokenMap`, capture a
 * screenshot + DOM + conformance snapshot. Reuses sorb-seed's existing
 * Playwright capture machinery — this function does not reimplement it.
 * @param {RenderJobInput} input
 * @param {RenderJobDeps} [deps]
 * @returns {Promise<RenderJobResult>}
 */
export async function renderJob(input, deps = {}) {
  if (!input || !input.url) throw new Error('renderJob: input.url is required')
  const {
    url,
    tokenMap = {},
    viewport = { width: 1280, height: 800 },
    selector = 'body',
    diffOnly = true,
    screenshotDir = tmpdir(),
    screenshotPath,
  } = input

  const cache = deps.cache || defaultCache
  const now = deps.now || (() => Date.now())
  const t0 = now()

  // 1. Exact-match short-circuit — same url + byte-identical token map.
  const cacheKey = makeCacheKey(url, tokenMap)
  const cached = cache.getExact(url, tokenMap)
  if (cached) {
    return { ...cached, cacheHit: true, timings: { ...cached.timings, totalMs: now() - t0 } }
  }

  // 2. Acquire a page — reused (nav skipped) if we already rendered this url.
  const getPool = deps.pagePool || defaultPagePool
  const pool = await getPool()
  const tNav = now()
  const { page, reused } = await pool.acquire(url, viewport)
  const navigateMs = now() - tNav

  // 3. Inject the token map.
  const tInject = now()
  await injectTokenMap(page, tokenMap)
  const injectMs = now() - tInject

  // 4. Capture DOM (reused walker) + conformance.
  const tCapture = now()
  const captureFn = deps.captureFn || defaultCaptureFn
  const dom = await captureFn(page, selector)
  const resolvedVars = await readResolvedVars(page, Object.keys(tokenMap))
  const conformance = buildConformance(tokenMap, resolvedVars)
  const captureMs = now() - tCapture

  // 5. Screenshot → file ref (never returned inline).
  const tShot = now()
  const path = screenshotPath || resolve(screenshotDir, `sorb-render-${randomUUID()}.png`)
  const shot = await page.screenshot()
  await writeFile(path, shot)
  const screenshotMs = now() - tShot

  const timings = { navigateMs, injectMs, captureMs, screenshotMs, totalMs: now() - t0 }
  const diff = diffOnly ? cache.diffAgainstLastForUrl(url, tokenMap, dom) : null

  const result = {
    screenshot: { path, width: viewport.width, height: viewport.height },
    dom,
    conformance,
    timings,
    cacheHit: false,
    pageReused: reused,
    diff,
    cacheKey,
  }

  cache.putExact(url, tokenMap, result)
  return result
}

/** Reset the module-level default cache (test helper). */
export function __resetDefaultCache() {
  defaultCache.clear()
}
