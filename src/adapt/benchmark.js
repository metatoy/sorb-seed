// P4 — benchmark harness: measure the adapter against a labeled fixture corpus
// to put a real number behind the "~99%" claim (we PRINT the measured value, we
// do not hardcode 99%).
//
// Metrics:
//   precision = correct mappings ÷ mappings made
//               (of the sites we DID bind a token to, how many bound the right one)
//   recall (a.k.a. coverage) = sites mapped ÷ total hardcoded sites
//               (of every hardcoded site, how many we bound a token to at all)
//   coverage is reported as a synonym for recall here (every detected hardcoded
//   site is a site that "should" map; an unmapped one is a miss).
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { buildTokenIndex } from '../annotateTokens.js'
import { detectHardcoded } from './detectHardcoded.js'
import { mapToToken } from './mapToToken.js'

/**
 * @typedef {Object} CorpusCase
 * @property {string} name
 * @property {string} source     consumer source to scan
 * @property {Object<string,string>} expected   raw-value → expected tokenId
 *           (the gold label for each hardcoded site; a value not present is
 *           treated as "expected to be unmapped").
 */

/**
 * Score a single case. A mapping is "made" when a token is bound; it's
 * "correct" when the bound token equals the labeled expectation for that raw.
 * @param {CorpusCase} c
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 */
export function scoreCase(c, index, resolved) {
  const sites = detectHardcoded(c.source, c.name)
  let made = 0
  let correct = 0
  let mapped = 0
  const detail = []
  for (const s of sites) {
    const m = mapToToken(s, index, resolved)
    const expected = c.expected[s.raw]
    const bound = m.tokenId
    if (bound) {
      made++
      mapped++
      // role-aware label: the expected map may key by raw only; if the
      // expectation is a single string we compare directly.
      const ok = expected != null && bound === expected
      if (ok) correct++
      detail.push({ raw: s.raw, role: s.role, bound, expected, ok })
    } else {
      detail.push({ raw: s.raw, role: s.role, bound: null, expected, ok: expected == null })
    }
  }
  return { name: c.name, totalSites: sites.length, made, correct, mapped, detail }
}

/**
 * Aggregate metrics across the whole corpus.
 * @param {CorpusCase[]} corpus
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 */
export function benchmark(corpus, index, resolved) {
  let totalSites = 0
  let made = 0
  let correct = 0
  let mapped = 0
  const cases = []
  for (const c of corpus) {
    const r = scoreCase(c, index, resolved)
    cases.push(r)
    totalSites += r.totalSites
    made += r.made
    correct += r.correct
    mapped += r.mapped
  }
  const precision = made === 0 ? 1 : correct / made
  const recall = totalSites === 0 ? 1 : mapped / totalSites
  const coverage = recall // synonym in this harness
  return { totalSites, made, correct, mapped, precision, recall, coverage, cases }
}

/** Load a corpus directory: each `*.case.json` is `{name, source, expected}`. */
export function loadCorpus(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.case.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')))
}

const pct = (n) => (n * 100).toFixed(1) + '%'

/** Pretty-print a benchmark result. */
export function formatReport(b) {
  const lines = []
  lines.push(`Sorb legacy-adapter benchmark — ${b.cases.length} case(s), ${b.totalSites} hardcoded site(s)`)
  lines.push(`  precision (correct ÷ made)      : ${pct(b.precision)}  (${b.correct}/${b.made})`)
  lines.push(`  recall    (mapped ÷ total sites): ${pct(b.recall)}  (${b.mapped}/${b.totalSites})`)
  lines.push(`  coverage                        : ${pct(b.coverage)}`)
  return lines.join('\n')
}

/** CLI-ish runner over the default corpus dir. */
export function runBenchmark(corpusDir, resolvedPath) {
  const resolved = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
  const index = buildTokenIndex(resolved)
  const corpus = loadCorpus(corpusDir)
  const b = benchmark(corpus, index, resolved)
  console.log(formatReport(b))
  return b
}
