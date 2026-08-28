// `storybook-dom` SourceConnector — the default SOURCE connector (registered
// under `@sorb/core`'s DEFAULT_SOURCE_ID = 'storybook-dom'). Extracted from
// captureCli.js verbatim (spec/sorb/connectors-architecture.md §3.1, C1) — a
// pure refactor, no behavior change. Owns everything source-specific:
// discovering Storybook story entries (`listUnits`), running Playwright +
// the `capture.js` walker to capture one entry's raw geometry
// (`captureGeometry`), and reading the DTCG/Style-Dictionary resolved token
// map (`readTokens`). The generic pipeline (tightenRoot -> annotateTree ->
// hash -> write) stays in captureCli.js and is fed by this connector.

import { basename, extname, dirname, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { build } from 'esbuild'
import { registerSource } from '@sorb/core'

// Playwright is an OPTIONAL peer dep — only `capture` needs it, and it pulls a
// ~150 MB browser. Lazy-load it so plain installs and `resolve` stay lean.
const loadChromium = async () => {
  try {
    const { chromium } = await import('playwright')
    return chromium
  } catch {
    console.error(
      '✗ `sorb-seed capture` needs Playwright (it is an optional peer dep).\n' +
        '  Install it where you run capture:\n' +
        '    npm install playwright            # its postinstall fetches Chromium\n' +
        '  (or: npm install playwright && npx playwright install chromium)',
    )
    process.exit(1)
  }
}

// The `playwright` PACKAGE can be installed while its Chromium BROWSER binary is
// not (that's a separate `npx playwright install chromium` step). Launching then
// throws a raw "Executable doesn't exist" error — turn it into the same
// actionable guidance the missing-package path already gives.
export const launchChromium = async (chromium) => {
  try {
    return await chromium.launch()
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(msg)) {
      console.error(
        '✗ `sorb-seed capture` found Playwright but its Chromium browser is not installed.\n' +
          '  Install the browser where you run capture:\n' +
          '    npx playwright install chromium',
      )
      process.exit(1)
    }
    throw e
  }
}

// Bundle the walker into a single IIFE string we can addInitScript() into
// every page. Playwright can't pass functions across the boundary directly,
// and our walker has cross-file imports → bundling is the clean answer.
const buildWalkerBundle = async () => {
  const here = dirname(new URL(import.meta.url).pathname)
  const out = await build({
    entryPoints: [resolve(here, '..', 'capture.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    target: 'es2020',
  })
  return out.outputFiles[0].text
}

const isStoryEntry = (e) =>
  e && (e.type === 'story' || (e.type === undefined && e.importPath)) // SB7/8: type:'story'

// componentName: "Button" from "./src/.../Button.stories.jsx"
const componentNameFromImportPath = (importPath) => {
  const file = basename(importPath, extname(importPath)) // "Button.stories"
  return file.replace(/\.stories$/i, '')
}

// sorb.config.json may set seed.storybookUrl. Fall back to localhost.
export const storybookUrlOf = (config) =>
  (config.seed && config.seed.storybookUrl) || 'http://localhost:6006'

// ─── Playwright session (browser + context + walker init script) ──────────
// Lazily launched on the first captureGeometry() call and reused across every
// unit in a run — exactly today's single-launch/many-pages lifecycle. Not
// part of the shared SourceConnector contract (that's just listUnits /
// captureGeometry / readTokens); captureCli.js calls closeSession() once
// after it has processed every unit, mirroring today's single browser.close().
let session = null // { browser, ctx, sbUrl }

const ensureSession = async (sbUrl) => {
  if (session && session.sbUrl === sbUrl) return session
  if (session) await closeSession()
  const chromium = await loadChromium()
  const walker = await buildWalkerBundle()
  const browser = await launchChromium(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript({ content: walker })
  session = { browser, ctx, sbUrl }
  return session
}

export const closeSession = async () => {
  if (session) {
    await session.browser.close()
    session = null
  }
}

// ─── SourceConnector implementation ────────────────────────────────────────

const listUnits = async (config) => {
  const sbUrl = storybookUrlOf(config).replace(/\/$/, '')
  console.log(`→ Storybook: ${sbUrl}`)
  let sbIndex
  try {
    const res = await fetch(`${sbUrl}/index.json`)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    sbIndex = await res.json()
  } catch (e) {
    console.error('✗ Could not fetch Storybook index:', e.message)
    process.exit(1)
  }
  const entries = Object.values(sbIndex.entries || sbIndex.stories || {}).filter(isStoryEntry)
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    importPath: e.importPath,
  }))
}

const captureGeometry = async (unit, config) => {
  const sbUrl = storybookUrlOf(config).replace(/\/$/, '')
  const { ctx } = await ensureSession(sbUrl)
  const url = `${sbUrl}/iframe.html?id=${unit.id}&viewMode=story`
  const page = await ctx.newPage()
  try {
    console.log(`  · ${unit.id}`)
    await page.goto(url, { waitUntil: 'load' })
    // Wait for Storybook to actually render the story.
    await page
      .waitForFunction(
        () => !!document.querySelector('#storybook-root *'),
        { timeout: 15000 },
      )
      .catch(() => {})
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    const rawTree = await page.evaluate(() => {
      const root = document.querySelector('#storybook-root')
      return root ? window.__sorbCapture(root) : null
    })
    if (!rawTree) {
      console.warn('    ⚠ no #storybook-root content; skipped')
      return null
    }
    return rawTree
  } finally {
    await page.close()
  }
}

// Thin wrapper over the resolved bindable token map produced by `sorb-seed
// resolve` (Style Dictionary build against the DTCG sources). Capture's own
// generic pipeline still reads `.sorb/resolved.json` directly (unchanged) —
// this exists so the connector satisfies the SOURCE contract for other
// consumers. Does not move the SD internals (those stay owned by `resolve`).
const readTokens = async (config) => {
  const cwd = process.cwd()
  const p = resolve(cwd, '.sorb/resolved.json')
  if (!existsSync(p)) {
    throw new Error('No .sorb/resolved.json — run `sorb-seed resolve` first.')
  }
  const data = JSON.parse(readFileSync(p, 'utf-8'))
  return Array.isArray(data) ? data : data.tokens
}

export const storybookDomConnector = {
  id: 'storybook-dom',
  listUnits,
  captureGeometry,
  readTokens,
}

registerSource(storybookDomConnector)
