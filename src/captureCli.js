// `sorb-seed capture` — Playwright runner that visits each Storybook story,
// injects our in-page walker, captures the rendered root, annotates tokens
// against the resolved bindable map, and writes per-component artifacts +
// a top-level index. See spec → Capture engine.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, dirname, basename, extname } from 'path'
import { getSource, resolveConnectorIds } from '@sorb/core'
import { tightenRoot } from './capture.js'
import { buildTokenIndex, annotateTree } from './annotateTokens.js'
import { closeSession, storybookUrlOf } from './sources/storybookDom.js'

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

// componentName: "Button" from "./src/.../Button.stories.jsx"
const componentNameFromImportPath = (importPath) => {
  const file = basename(importPath, extname(importPath)) // "Button.stories"
  return file.replace(/\.stories$/i, '')
}

const filterEntries = (entries, only) => {
  if (!only) return entries
  const re = new RegExp(only.replace(/[*]/g, '.*'), 'i')
  return entries.filter((e) => re.test(e.importPath) || re.test(e.title) || re.test(e.id))
}

export const runCapture = async (opts) => {
  const config = loadConfig()
  const resolved = loadResolved()
  const index = buildTokenIndex(resolved)
  // `--storybook-url=` is a capture-command flag, not a sorb.config.json key —
  // fold it into an effective config so the connector's own storybookUrlOf()
  // resolution (config.seed.storybookUrl -> localhost default) still applies
  // the same precedence the CLI used to apply inline.
  const effectiveConfig = opts.storybookUrl
    ? { ...config, seed: { ...(config.seed || {}), storybookUrl: opts.storybookUrl } }
    : config

  const connector = getSource(resolveConnectorIds(config).source)

  // 1. Discover units (source connector)
  const rawEntries = await connector.listUnits(effectiveConfig)
  const entries = filterEntries(rawEntries, opts.only)
  if (!entries.length) {
    console.error('✗ No stories matched filter:', opts.only || '(all)')
    process.exit(1)
  }
  console.log(`→ ${entries.length} stories selected`)

  // 2. Capture each unit (source connector), group by component
  const captured = new Map() // importPath -> { component, importPath, stories[] }
  const oldIndex = readOldIndex(config)

  for (const unit of entries) {
    // The whole per-unit body is wrapped so a throw in ANY step (capture,
    // tighten, annotate, hash, store) skips just that unit and continues the
    // run — matching the pre-connector behavior (a single bad story must not
    // abort the entire capture).
    try {
      const rawTree = await connector.captureGeometry(unit, effectiveConfig)
      if (!rawTree) continue // connector already logged why it skipped

      // Trim the story container down to the meaningful component BEFORE
      // annotation/storage so insert + preview get a tight, token-bound node
      // (sorb-capture-trim-spec.md). Annotation runs on the kept subtree, so
      // token bindings are unaffected.
      const tightened = tightenRoot(rawTree)
      const tree = annotateTree(tightened, index)
      const hash = 'sha256:' + sha256(JSON.stringify(tree))

      // --changed: reuse the previous artifact if hash matches
      const prevHash = oldIndex.stories[unit.id]?.hash
      if (opts.changed && prevHash === hash) {
        console.log('    = unchanged')
        continue
      }

      if (!captured.has(unit.importPath)) {
        captured.set(unit.importPath, {
          schemaVersion: 1,
          component: componentNameFromImportPath(unit.importPath),
          importPath: unit.importPath,
          capturedAt: new Date().toISOString(),
          stories: [],
        })
      }
      captured.get(unit.importPath).stories.push({
        id: unit.id,
        name: unit.name,
        title: unit.title,
        hash,
        root: tree,
      })
    } catch (e) {
      console.error('    ✗', unit.id, '—', e.message)
      continue
    }
  }
  await closeSession()

  // 3. Write artifacts next to each story file, then the index
  const indexOut = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    storybookUrl: storybookUrlOf(effectiveConfig).replace(/\/$/, ''),
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
