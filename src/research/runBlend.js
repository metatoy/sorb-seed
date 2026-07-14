#!/usr/bin/env node
// Blend runner (M4) + artifact writer (M5). Executes the FROZEN protocol
// (PREREGISTRATION.md) at scale on synthetic + real-OSS source, under a ≤4h
// wallclock envelope, and writes a citable run artifact (clears grant gate G3).
//
// Manual-first (founder directive): invoked by hand; nightly cron added only
// after a clean run. `node src/research/runBlend.js [artifactDir]`.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { buildCorpus, corpusStats } from './corpus.js'
import { buildOssCorpus } from './ossInject.js'
import { buildTokenIndex } from '../annotateTokens.js'
import { runLoop, formatLoop } from './loop.js'
import { scoreCorpus, fmtSplit } from './score.js'

const here = dirname(fileURLToPath(import.meta.url))
const FOUR_HOURS = 4 * 3600 * 1000

/** Frozen reproducibility constants (PREREGISTRATION Amendment 1 §5). */
export const SEED = 1425443
export const SPLIT_SEED = 0xc0ffee

/** Build the blend: scaled synthetic + injected real-OSS source. */
export function buildBlend(resolved, o) {
  const synth = buildCorpus(resolved, { seed: SEED, n: o.syntheticN, splitSeed: SPLIT_SEED })
  const oss = buildOssCorpus(o.ossRoots, resolved, { seed: SEED, splitSeed: SPLIT_SEED, maxPerFile: o.maxPerFile || 6, repeats: o.ossRepeats || 8 })
  return synth.concat(oss)
}

/**
 * Run the frozen protocol at scale, honoring a wallclock budget: grow the
 * synthetic corpus on a fixed schedule until the instance target is met OR the
 * time budget's safety fraction is hit — then log the (possibly degraded) N.
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{ossRoots:string[], syntheticN?:number, targetSites?:number, timeBudgetMs?:number, ossRepeats?:number, maxPerFile?:number}} o
 */
export function runBlend(resolved, o) {
  const t0 = Date.now()
  const index = buildTokenIndex(resolved)
  const budget = o.timeBudgetMs == null ? FOUR_HOURS : o.timeBudgetMs
  const target = o.targetSites == null ? 3000 : o.targetSites

  let n = o.syntheticN == null ? 400 : o.syntheticN
  const scaleLog = []
  let cases = buildBlend(resolved, { ...o, syntheticN: n })
  scaleLog.push({ syntheticN: n, sites: corpusStats(cases).sites, elapsedMs: Date.now() - t0 })
  let degraded = false
  while (corpusStats(cases).sites < target) {
    if (Date.now() - t0 >= budget * 0.5) { degraded = true; break } // honest degrade — never fake completion
    n *= 2
    cases = buildBlend(resolved, { ...o, syntheticN: n })
    scaleLog.push({ syntheticN: n, sites: corpusStats(cases).sites, elapsedMs: Date.now() - t0 })
  }

  const stats = corpusStats(cases)
  const synthCases = cases.filter((c) => c.sourceKind === 'synthetic')
  const ossCases = cases.filter((c) => c.sourceKind === 'oss')
  const loop = runLoop(cases, index, resolved)
  const perSource = {
    synthetic: { n: synthCases.length, baseline: scoreCorpus(synthCases, index, resolved, {}).test, final: scoreCorpus(synthCases, index, resolved, loop.enabled).test },
    oss: { n: ossCases.length, baseline: scoreCorpus(ossCases, index, resolved, {}).test, final: scoreCorpus(ossCases, index, resolved, loop.enabled).test },
  }
  return { stats, loop, perSource, scaleLog, elapsedMs: Date.now() - t0, finalSyntheticN: n, degraded, target, budget }
}

/** Best-effort short git SHA for provenance. */
function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch (e) {
    return 'unknown'
  }
}

/** Human-readable summary for the artifact + the outline §4 seed. */
export function summarize(r, meta) {
  const L = []
  L.push(`# SORB Learning-Loop POC — Run Summary`)
  L.push('')
  L.push(`- **Run (UTC):** ${meta.stamp}`)
  L.push(`- **Code:** sorb-seed \`${meta.branch}\` @ \`${meta.sha}\` (frozen protocol: PREREGISTRATION.md)`)
  L.push(`- **Token map:** ${meta.resolvedRef} (${meta.tokenCount} tokens)`)
  L.push(`- **Wallclock:** ${(r.elapsedMs / 1000).toFixed(1)}s (budget ${(r.budget / 3600000).toFixed(0)}h; ${r.degraded ? '**DEGRADED** — target not reached in budget' : 'target met, well under budget'})`)
  L.push('')
  L.push(`## Corpus (blend)`)
  L.push(`- ${r.stats.cases} components, **${r.stats.sites} labeled sites** (${r.stats.drift} drift / ${r.stats.benign} benign); held-out test ${r.stats.test} components`)
  L.push(`- classes: ${JSON.stringify(r.stats.byClass)}`)
  L.push(`- synthetic ${r.perSource.synthetic.n} cases · real-OSS ${r.perSource.oss.n} cases (sorb-demo app source)`)
  L.push('')
  L.push(`## Loop trajectory (held-out, blend)`)
  L.push('```')
  L.push(formatLoop(r.loop))
  L.push('```')
  L.push('')
  L.push(`## Per-source held-out (baseline → final config \`{${Object.keys(r.loop.enabled).join(', ') || 'baseline'}}\`)`)
  L.push(`- **synthetic:** ${fmtSplit(r.perSource.synthetic.baseline)}  →  ${fmtSplit(r.perSource.synthetic.final)}`)
  L.push(`- **real-OSS :** ${fmtSplit(r.perSource.oss.baseline)}  →  ${fmtSplit(r.perSource.oss.final)}`)
  L.push('')
  L.push(`> Preliminary; synthetic + own-app source. Deterministic + reproducible (\`node src/research/runBlend.js\`).`)
  return L.join('\n')
}

/** Write the citable artifact (M5). Returns the dir written. */
export function writeArtifact(r, resolved, meta, outDir) {
  mkdirSync(outDir, { recursive: true })
  const log = { meta, stats: r.stats, elapsedMs: r.elapsedMs, degraded: r.degraded, target: r.target, scaleLog: r.scaleLog, loop: r.loop, perSource: r.perSource }
  writeFileSync(join(outDir, 'run-log.json'), JSON.stringify(log, null, 2) + '\n')
  writeFileSync(join(outDir, 'run-summary.md'), summarize(r, meta) + '\n')
  writeFileSync(join(outDir, 'resolved.snapshot.json'), JSON.stringify(resolved, null, 0) + '\n')
  return outDir
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const resolvedRef = '../sorb-demo/.sorb/resolved.json'
  const resolvedPath = resolve(here, '..', '..', resolvedRef)
  const resolved = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
  const r = runBlend(resolved, { ossRoots: [resolve(here, '..', '..', '..', 'sorb-demo', 'src'), resolve(here, '..', '..', '..', 'sorb-demo', 'stories')], targetSites: 3000 })
  const meta = {
    stamp: new Date().toISOString(),
    branch: (() => { try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch (e) { return 'unknown' } })(),
    sha: gitSha(),
    resolvedRef: 'sorb-demo/.sorb/resolved.json',
    tokenCount: resolved.length,
  }
  console.log(summarize(r, meta))
  const outDir = process.argv[2] || resolve(here, '..', '..', '..', 'spec', 'metatoy-studio', 'llc', 'funding', 'nsf-sbir-run-2026-07', 'artifacts', 'research-loop-poc')
  const written = writeArtifact(r, resolved, meta, outDir)
  console.log(`\nartifact → ${written}`)
}
