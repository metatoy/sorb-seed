// E3 — Playwright page lifecycle for the render worker.
//
// Reuses the SAME lazy-Playwright-import pattern as captureCli.js's
// loadChromium: `playwright` is an optional peer dep, so importing it must
// never happen at module-load time — only when a render is actually requested.
// This file is the ONLY place worker.js touches Playwright directly, so
// worker.js (and its tests) can import cleanly without the package installed.
//
// Page reuse (the "skip navigation" half of the diff-only optimization): one
// browser context is kept alive for the pool's lifetime, and one page per URL
// is kept open across calls — so a second render() for a URL we've already
// visited skips `page.goto` (the dominant chunk of the measured ~1.75s/render,
// per hosted-bridge-modes-exploration-plan.md E0) and only re-injects the token
// map + recaptures. Callers that want a fresh navigation (e.g. the app itself
// changed) should call `pool.evict(url)` first.

const loadChromium = async () => {
  const { chromium } = await import('playwright')
  return chromium
}

/**
 * @typedef {object} PagePool
 * @property {(url: string, viewport?: {width:number,height:number}) => Promise<{page: object, reused: boolean}>} acquire
 * @property {(url: string) => Promise<void>} evict
 * @property {() => Promise<void>} closeAll
 */

/**
 * Create a real, Playwright-backed page pool. Lazily launches the browser on
 * the first `acquire()` call.
 * @returns {PagePool}
 */
export function createPagePool() {
  /** @type {import('playwright').Browser|null} */
  let browser = null
  /** @type {import('playwright').BrowserContext|null} */
  let ctx = null
  /** @type {Map<string, import('playwright').Page>} */
  const pages = new Map()

  const ensureBrowser = async () => {
    if (browser) return
    const chromium = await loadChromium()
    browser = await chromium.launch()
    ctx = await browser.newContext()
  }

  return {
    async acquire(url, viewport = { width: 1280, height: 800 }) {
      await ensureBrowser()
      const existing = pages.get(url)
      if (existing) {
        await existing.setViewportSize(viewport)
        return { page: existing, reused: true }
      }
      const page = await ctx.newPage()
      await page.setViewportSize(viewport)
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      pages.set(url, page)
      return { page, reused: false }
    },

    async evict(url) {
      const page = pages.get(url)
      if (page) {
        await page.close().catch(() => {})
        pages.delete(url)
      }
    },

    async closeAll() {
      for (const page of pages.values()) await page.close().catch(() => {})
      pages.clear()
      if (ctx) await ctx.close().catch(() => {})
      if (browser) await browser.close().catch(() => {})
      browser = null
      ctx = null
    },
  }
}
