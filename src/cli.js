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
} else {
  console.error(`Unknown command: ${cmd}\nUsage: sorb-seed <resolve|capture> [options]\nRun \`sorb-seed --help\` for details.`)
  process.exit(1)
}
