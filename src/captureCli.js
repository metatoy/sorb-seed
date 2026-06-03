// `sorb-seed capture` — Playwright runner that visits each Storybook story,
// injects our in-page walker, captures the rendered root, annotates tokens
// against the resolved bindable map, and writes per-component artifacts +
// a top-level index. See spec → Capture engine.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, resolve, basename, extname } from 'path'
import { build } from 'esbuild'
import { buildTokenIndex, annotateTree } from './annotateTokens.js'

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

const cwd = process.cwd()

const loadConfig = () => {
  const p = resolve(cwd, 'sorb.config.json')
  if (!existsSync(p)) {
    console.error('✗ No sorb.config.json in', cwd)
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf-8'))
}

const loadResolved = () => {
  const p = resolve(cwd, '.sorb/resolved.json')
  if (!existsSync(p)) {
    console.error('✗ No .sorb/resolved.json — run `sorb-seed resolve` first.')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(p, 'utf-8'))
  return Array.isArray(data) ? data : data.tokens
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// Bundle the walker into a single IIFE string we can addInitScript() into
// every page. Playwright can't pass functions across the boundary directly,
// and our walker has cross-file imports → bundling is the clean answer.
const buildWalkerBundle = async () => {
  const here = dirname(new URL(import.meta.url).pathname)
  const out = await build({
    entryPoints: [resolve(here, 'capture.js')],
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

// Group story entries by their component (importPath) and pick the directory
// of the story file as the artifact output dir (co-located).
const groupByComponent = (entries) => {
  const groups = new Map()
  for (const e of entries) {
    if (!groups.has(e.importPath)) groups.set(e.importPath, [])
    groups.get(e.importPath).push(e)
  }
  return groups
}

// componentName: "Button" from "./src/.../Button.stories.jsx"
const componentNameFromImportPath = (importPath) => {
  const file = basename(importPath, extname(importPath)) // "Button.stories"
  return file.replace(/\.stories$/i, '')
}

// sorb.config.json may set seed.storybookUrl. Fall back to localhost.
const storybookUrlOf = (config) =>
  (config.seed && config.seed.storybookUrl) || 'http://localhost:6006'

const filterEntries = (entries, only) => {
  if (!only) return entries
  const re = new RegExp(only.replace(/[*]/g, '.*'), 'i')
  return entries.filter((e) => re.test(e.importPath) || re.test(e.title) || re.test(e.id))
}

export const runCapture = async (opts) => {
  const config = loadConfig()
  const resolved = loadResolved()
  const index = buildTokenIndex(resolved)
  const sbUrl = (opts.storybookUrl || storybookUrlOf(config)).replace(/\/$/, '')

  // 1. Discover stories
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
  const entries = filterEntries(
    Object.values(sbIndex.entries || sbIndex.stories || {}).filter(isStoryEntry),
    opts.only,
  )
  if (!entries.length) {
    console.error('✗ No stories matched filter:', opts.only || '(all)')
    process.exit(1)
  }
  console.log(`→ ${entries.length} stories selected`)

  // 2. Browser setup + walker injection
  const chromium = await loadChromium()
  const walker = await buildWalkerBundle()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript({ content: walker })

  // 3. Capture each story, group by component
  const captured = new Map() // importPath -> { component, importPath, stories[] }
  const oldIndex = readOldIndex(config)

  for (const entry of entries) {
    const url = `${sbUrl}/iframe.html?id=${entry.id}&viewMode=story`
    const page = await ctx.newPage()
    try {
      console.log(`  · ${entry.id}`)
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
        await page.close()
        continue
      }
      const tree = annotateTree(rawTree, index)
      const hash = 'sha256:' + sha256(JSON.stringify(tree))

      // --changed: reuse the previous artifact if hash matches
      const prevHash = oldIndex.stories[entry.id]?.hash
      if (opts.changed && prevHash === hash) {
        console.log('    = unchanged')
        await page.close()
        continue
      }

      if (!captured.has(entry.importPath)) {
        captured.set(entry.importPath, {
          schemaVersion: 1,
          component: componentNameFromImportPath(entry.importPath),
          importPath: entry.importPath,
          capturedAt: new Date().toISOString(),
          stories: [],
        })
      }
      captured.get(entry.importPath).stories.push({
        id: entry.id,
        name: entry.name,
        title: entry.title,
        hash,
        root: tree,
      })
    } catch (e) {
      console.error('    ✗', entry.id, '—', e.message)
    } finally {
      await page.close()
    }
  }
  await browser.close()

  // 4. Write artifacts next to each story file, then the index
  const indexOut = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    storybookUrl: sbUrl,
    components: [],
    stories: { ...oldIndex.stories }, // preserves entries we didn't recapture
  }
  for (const [importPath, art] of captured) {
    const absStoryFile = resolve(cwd, importPath)
    const outDir = dirname(absStoryFile)
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    const outPath = resolve(outDir, `${art.component}.sorb.json`)
    writeFileSync(outPath, JSON.stringify(art, null, 2) + '\n')
    const rel = relativeFromCwd(outPath)
    console.log(`✓ ${rel}  (${art.stories.length} stor${art.stories.length === 1 ? 'y' : 'ies'})`)
    indexOut.components.push({ component: art.component, importPath, artifact: rel })
    for (const s of art.stories) {
      indexOut.stories[s.id] = {
        component: art.component,
        importPath,
        artifact: rel,
        title: s.title,
        name: s.name,
        hash: s.hash,
      }
    }
  }

  const indexDir = resolve(cwd, '.sorb')
  mkdirSync(indexDir, { recursive: true })
  writeFileSync(
    resolve(indexDir, 'index.json'),
    JSON.stringify(indexOut, null, 2) + '\n',
  )
  console.log('→ .sorb/index.json')
}

const relativeFromCwd = (abs) => {
  const c = cwd.endsWith('/') ? cwd : cwd + '/'
  return abs.startsWith(c) ? abs.slice(c.length) : abs
}

const readOldIndex = (config) => {
  const p = resolve(cwd, '.sorb/index.json')
  if (!existsSync(p)) return { stories: {} }
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return { stories: {} } }
}

// Allow running as `node captureCli.js [--only=...] [--changed]` for testing;
// the package bin (`sorb-seed capture`) routes here via cli.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = {}
  for (const a of process.argv.slice(2)) {
    if (a === '--changed') opts.changed = true
    else if (a.startsWith('--only=')) opts.only = a.slice('--only='.length)
    else if (a.startsWith('--storybook-url=')) opts.storybookUrl = a.slice('--storybook-url='.length)
  }
  runCapture(opts).catch((e) => { console.error(e); process.exit(1) })
}
