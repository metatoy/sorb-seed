#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { execSync } from 'child_process'

// sorb-seed — Storybook → Figma capture tooling.
//
// `resolve` is now a thin wrapper around Style Dictionary: the DTCG token sets
// (primitive/semantic/component) are the source of truth, and SD's
// `sorb/resolved-map` format produces `.sorb/resolved.json` directly —
// the schema { id, cssVar, value, tier, type }. This retires the old
// esbuild-bundle-and-eval resolver (and its theme.js scraping). The app build
// owns SD; the bridge and `capture` are pure consumers of its output.

const cwd = process.cwd()

const loadConfig = () => {
  const p = resolve(cwd, 'sorb.config.json')
  if (!existsSync(p)) {
    console.error('✗ No sorb.config.json in', cwd)
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf-8'))
}

const cmd = process.argv[2] || 'resolve'

const pkgVersion = () => {
  try {
    const pkgPath = resolve(dirname(new URL(import.meta.url).pathname), '..', 'package.json')
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version
  } catch (e) {
    return '0.0.0'
  }
}

const HELP = `sorb-seed — Storybook → Figma token capture for Sorb.

Usage: sorb-seed <command> [options]

Commands:
  resolve            Build .sorb/resolved.json from your DTCG token sets via
                     Style Dictionary (the default when no command is given).
  capture            Visit each Storybook story with Playwright, capture the
                     rendered tree, and annotate it against the resolved token
                     map → per-component *.sorb.json + .sorb/index.json.
  variant <add|deprecate>
                     Add or deprecate a component variant in the DTCG source,
                     bump $version, and rebuild. See \`variant\` usage below.

variant options:
  variant add <id> --from <base> [--tokens-dir <dir>] [--sd-dir <dir>]
  variant deprecate <id> --replaced-by <replacement> [--tokens-dir <dir>] [--sd-dir <dir>]

capture options:
  --changed          Only re-capture stories whose rendered hash changed.
  --only=<pattern>   Capture only stories matching the glob/regex (matched
                     against importPath, title, and id).
  --storybook-url=<url>
                     Storybook base URL (default: sorb.config.json seed.storybookUrl
                     or http://localhost:6006).

Global:
  -h, --help         Show this help and exit.
  -v, --version      Print the sorb-seed version and exit.

capture needs Playwright + its Chromium browser:
  npm install playwright && npx playwright install chromium`

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(HELP)
  process.exit(0)
} else if (cmd === '--version' || cmd === '-v') {
  console.log(pkgVersion())
  process.exit(0)
} else if (cmd === 'resolve') {
  const config = loadConfig()
  const sdConfig = config.styleDictionaryConfig || 'sd.config.js'
  const abs = resolve(cwd, sdConfig)
  if (!existsSync(abs)) {
    console.error(
      '✗ Style Dictionary config not found:', sdConfig,
      '\n  Set "styleDictionaryConfig" in sorb.config.json (default: sd.config.js).',
    )
    process.exit(1)
  }
  try {
    console.log('→ Running Style Dictionary:', sdConfig)
    execSync(`npx style-dictionary build --config ${abs}`, { stdio: 'inherit', cwd })
    console.log('✓ Built .sorb/resolved.json (and CSS vars + theme) from DTCG sources')
  } catch (e) {
    console.error('✗ Style Dictionary build failed')
    process.exit(1)
  }
} else if (cmd === 'capture') {
  const { runCapture } = await import('./captureCli.js')
  const opts = {}
  for (const a of process.argv.slice(3)) {
    if (a === '--changed') opts.changed = true
    else if (a.startsWith('--only=')) opts.only = a.slice('--only='.length)
    else if (a.startsWith('--storybook-url=')) opts.storybookUrl = a.slice('--storybook-url='.length)
  }
  await runCapture(opts)
} else if (cmd === 'variant') {
  const sub = process.argv[3]

  // ── shared arg parser ──────────────────────────────────────────────────────
  const args = process.argv.slice(4)
  const flag = (name) => {
    const prefix = `--${name}=`
    const eq = args.find((a) => a.startsWith(prefix))
    if (eq) return eq.slice(prefix.length)
    const idx = args.indexOf(`--${name}`)
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1]
    return null
  }

  // ── auto-detect sorb-demo paths ────────────────────────────────────────────
  // Walks up from cwd looking for sorb-demo/tokens/component.json and
  // sorb-demo/sd.config.js. Falls back to cwd-relative guesses.
  const autoDetect = () => {
    // Try workspace-sibling layout: cwd may be sorb-seed or any sibling
    const candidates = [
      resolve(cwd, '../sorb-demo'),
      resolve(cwd, 'sorb-demo'),
      cwd,
    ]
    for (const base of candidates) {
      const tokens = resolve(base, 'tokens/component.json')
      const sd = resolve(base, 'sd.config.js')
      if (existsSync(tokens) && existsSync(sd)) return { tokensDir: resolve(base, 'tokens'), sdDir: base }
    }
    return null
  }

  if (sub === 'add') {
    const variantId = args[0] && !args[0].startsWith('--') ? args[0] : null
    const fromRaw   = flag('from')
    const tokensDirFlag = flag('tokens-dir')
    const sdDirFlag     = flag('sd-dir')

    if (!variantId) {
      console.error('✗ Usage: sorb-seed variant add <variantId> --from <fromVariant> [--tokens-dir <dir>] [--sd-dir <dir>]')
      process.exit(1)
    }
    if (!fromRaw) {
      console.error('✗ --from is required (e.g. --from primary or --from button.primary)')
      process.exit(1)
    }

    // Normalise --from: if it has no dot, prepend the component from variantId
    const componentId = variantId.split('.')[0]
    const fromVariant = fromRaw.includes('.') ? fromRaw : `${componentId}.${fromRaw}`

    // Resolve paths
    let tokensDir = tokensDirFlag ? resolve(cwd, tokensDirFlag) : null
    let sdDir     = sdDirFlag     ? resolve(cwd, sdDirFlag)     : null
    if (!tokensDir || !sdDir) {
      const detected = autoDetect()
      if (!tokensDir) tokensDir = detected ? detected.tokensDir : resolve(cwd, 'tokens')
      if (!sdDir)     sdDir     = detected ? detected.sdDir     : cwd
    }
    const componentJsonPath = resolve(tokensDir, 'component.json')

    if (!existsSync(componentJsonPath)) {
      console.error(`✗ component.json not found at ${componentJsonPath}`)
      console.error('  Use --tokens-dir to point at your tokens directory.')
      process.exit(1)
    }

    const { addVariant } = await import('./variants.js')
    try {
      const changeset = await addVariant({ componentJsonPath, variantId, fromVariant, sdConfigDir: sdDir })
      console.log(`✓ Added variant ${changeset.variantId} (${changeset.tokenIds.length} tokens) — $version bumped to ${changeset.newVersion}`)
    } catch (e) {
      console.error('✗', e.message)
      process.exit(1)
    }

  } else if (sub === 'deprecate') {
    const variantId   = args[0] && !args[0].startsWith('--') ? args[0] : null
    const replacedBy  = flag('replaced-by')
    const tokensDirFlag = flag('tokens-dir')
    const sdDirFlag     = flag('sd-dir')

    if (!variantId) {
      console.error('✗ Usage: sorb-seed variant deprecate <variantId> --replaced-by <replacedBy> [--tokens-dir <dir>] [--sd-dir <dir>]')
      process.exit(1)
    }
    if (!replacedBy) {
      console.error('✗ --replaced-by is required (e.g. --replaced-by button.error)')
      process.exit(1)
    }

    // Resolve paths
    let tokensDir = tokensDirFlag ? resolve(cwd, tokensDirFlag) : null
    let sdDir     = sdDirFlag     ? resolve(cwd, sdDirFlag)     : null
    if (!tokensDir || !sdDir) {
      const detected = autoDetect()
      if (!tokensDir) tokensDir = detected ? detected.tokensDir : resolve(cwd, 'tokens')
      if (!sdDir)     sdDir     = detected ? detected.sdDir     : cwd
    }
    const componentJsonPath = resolve(tokensDir, 'component.json')

    if (!existsSync(componentJsonPath)) {
      console.error(`✗ component.json not found at ${componentJsonPath}`)
      console.error('  Use --tokens-dir to point at your tokens directory.')
      process.exit(1)
    }

    // Normalise replacedBy: if no dot, prepend the component from variantId
    const componentId = variantId.split('.')[0]
    const replacedByFull = replacedBy.includes('.') ? replacedBy : `${componentId}.${replacedBy}`

    const { deprecateVariant } = await import('./variants.js')
    try {
      const changeset = await deprecateVariant({ componentJsonPath, variantId, replacedBy: replacedByFull, sdConfigDir: sdDir })
      console.log(`✓ Deprecated variant ${changeset.variantId} → ${replacedByFull} (${changeset.tokenIds.length} tokens marked)`)
    } catch (e) {
      console.error('✗', e.message)
      process.exit(1)
    }

  } else {
    console.error(`✗ Unknown variant subcommand: ${sub || '(none)'}`)
    console.error('  Usage: sorb-seed variant <add|deprecate> ...')
    process.exit(1)
  }

} else {
  console.error(`Unknown command: ${cmd}\nUsage: sorb-seed <resolve|capture|variant> [options]\nRun \`sorb-seed --help\` for details.`)
  process.exit(1)
}
