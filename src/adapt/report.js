// P1 — report emitter: detect → map → score → AdaptRow[], and write it to
// `.sorb/adapt-report.json` (gitignored generated output).
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mapToToken, statusFor } from './mapToToken.js'

/**
 * Score a list of detected sites into report rows.
 * @param {import('./types.js').AdaptSite[]} sites
 * @param {{colors:Map, dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} [resolved]  to fill cssVar
 * @returns {import('./types.js').AdaptRow[]}
 */
export function buildReport(sites, index, resolved) {
  return sites.map((site) => {
    const m = mapToToken(site, index, resolved)
    return {
      file: site.file,
      loc: site.loc,
      prop: site.prop,
      raw: site.raw,
      tokenId: m.tokenId,
      cssVar: m.cssVar,
      confidence: m.confidence,
      candidates: m.candidates,
      status: statusFor(m),
    }
  })
}

/**
 * Summary counts by status.
 * @param {import('./types.js').AdaptRow[]} rows
 */
export function summarize(rows) {
  const out = { total: rows.length, auto: 0, review: 0, unmapped: 0 }
  for (const r of rows) out[r.status]++
  return out
}

/**
 * Write the report to `<cwd>/.sorb/adapt-report.json`.
 * @param {import('./types.js').AdaptRow[]} rows
 * @param {string} cwd
 * @returns {string} the absolute path written
 */
export function writeReport(rows, cwd) {
  const dir = join(cwd, '.sorb')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'adapt-report.json')
  writeFileSync(path, JSON.stringify(rows, null, 2) + '\n', 'utf-8')
  return path
}
