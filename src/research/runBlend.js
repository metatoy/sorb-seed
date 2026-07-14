#!/usr/bin/env node
// Blend runner (M4) + artifact writer (M5). Executes the FROZEN protocol
// (PREREGISTRATION.md) at scale on synthetic + real-OSS source, under a ≤4h
// wallclock envelope, and writes a citable run artifact (clears grant gate G3).
//
// Manual-first (founder directive): invoked by hand; nightly cron added only
// after a clean run. `node src/research/runBlend.js [artifactDir]`.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
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

/** Build the blend: scaled synthetic + injected real-OSS source. Seeds default
 *  to the frozen constants; the nightly sweep overrides them per-date. */
export function buildBlend(resolved, o) {
  const seed = o.seed == null ? SEED : o.seed
  const splitSeed = o.splitSeed == null ? SPLIT_SEED : o.splitSeed
  const synth = buildCorpus(resolved, { seed, n: o.syntheticN, splitSeed })
  const oss = buildOssCorpus(o.ossRoots || [], resolved, { seed, splitSeed, maxPerFile: o.maxPerFile || 6, repeats: o.ossRepeats || 8 })
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

// Regression guard thresholds — the nightly FAILS (regression) if the frozen
// protocol stops reaching its designed outcome on a fresh independently-seeded
// corpus. These encode "the result is not a seed artifact."
export const GUARD = { coverageMin: 0.95, precisionMin: 0.99, contrastFNMax: 0 }

/** 8-digit YYYYMMDD → int, for a deterministic per-date seed. */
export const dateSeedOf = (d) => Number(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`)

/**
 * One nightly seed-robustness run: a FRESH independently-seeded corpus (derived
 * from the date), the FROZEN protocol, a regression check, a ledger row. This
 * is distinct from the canonical frozen-seed artifact — it proves the result
 * holds across corpora, it does not replace the citable number.
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{ossRoots:string[], dateSeed:number, targetSites?:number, sha?:string, stamp?:string}} o
 */
export function nightly(resolved, o) {
  const seed = (SEED ^ o.dateSeed) >>> 0
  const splitSeed = (SPLIT_SEED ^ o.dateSeed) >>> 0
  const r = runBlend(resolved, { ossRoots: o.ossRoots, targetSites: o.targetSites == null ? 3000 : o.targetSites, seed, splitSeed })
  const f = r.loop.final
  const pass = !r.degraded && f.coverage >= GUARD.coverageMin && f.precision >= GUARD.precisionMin && f.contrastFN <= GUARD.contrastFNMax
  const row = {
    date: o.dateSeed,
    stamp: o.stamp || null,
    sha: o.sha || null,
    seed,
    splitSeed,
    sites: r.stats.sites,
    baseline: { coverage: r.loop.baseline.coverage, precision: r.loop.baseline.precision },
    final: { coverage: f.coverage, precision: f.precision, contrastFN: f.contrastFN },
    accepted: Object.keys(r.loop.enabled),
    stoppedBy: r.loop.stoppedBy,
    degraded: r.degraded,
    elapsedMs: r.elapsedMs,
    pass,
  }
  return { pass, row, r }
}

/** Append a nightly row to the JSONL ledger (created if absent). */
export function appendLedger(ledgerPath, row) {
  mkdirSync(dirname(ledgerPath), { recursive: true })
  appendFileSync(ledgerPath, JSON.stringify(row) + '\n')
  return ledgerPath
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
  const ossRoots = [resolve(here, '..', '..', '..', 'sorb-demo', 'src'), resolve(here, '..', '..', '..', 'sorb-demo', 'stories')]
  const artifactDir = resolve(here, '..', '..', '..', 'spec', 'metatoy-studio', 'llc', 'funding', 'nsf-sbir-run-2026-07', 'artifacts', 'research-loop-poc')

  if (process.argv.includes('--nightly')) {
    // Seed-robustness sweep: fresh per-date corpus, frozen protocol, ledger row.
    const now = new Date()
    const dateSeed = dateSeedOf(now)
    const { pass, row } = nightly(resolved, { ossRoots, dateSeed, sha: gitSha(), stamp: now.toISOString() })
    const ledger = appendLedger(join(artifactDir, 'nightly-ledger.jsonl'), row)
    const c = (row.final.coverage * 100).toFixed(1)
    const p = (row.final.precision * 100).toFixed(1)
    console.log(`[nightly ${row.stamp}] seed=${row.seed} sites=${row.sites} final coverage ${c}% precision ${p}% contrastFN ${(row.final.contrastFN * 100).toFixed(0)}% → ${pass ? 'PASS' : 'REGRESSION'}`)
    console.log(`ledger → ${ledger}`)
    process.exit(pass ? 0 : 1)
  }

  // Canonical frozen-seed run + citable artifact.
  const r = runBlend(resolved, { ossRoots, targetSites: 3000 })
  const meta = {
    stamp: new Date().toISOString(),
    branch: (() => { try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch (e) { return 'unknown' } })(),
    sha: gitSha(),
    resolvedRef: 'sorb-demo/.sorb/resolved.json',
    tokenCount: resolved.length,
  }
  console.log(summarize(r, meta))
  const written = writeArtifact(r, resolved, meta, process.argv[2] || artifactDir)
  console.log(`\nartifact → ${written}`)
}
