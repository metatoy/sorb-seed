// `sorb-seed adapt` runner — detect → map → score → report (report mode), or
// drive the codemod (codemod mode). Flags (spec §5):
//   --src <glob>            source files to scan (default: src/**/*.{jsx,tsx,js,ts})
//   --resolved <path>       resolved token map (default: .sorb/resolved.json)
//   --mode report|shim|codemod   (default: report)
//   --write                 codemod only: actually rewrite source (else dry-run)
import { readFileSync, existsSync } from 'fs'
import { resolve, relative } from 'path'
import { buildTokenIndex } from '../annotateTokens.js'
import { detectHardcoded } from './detectHardcoded.js'
import { buildReport, summarize, writeReport } from './report.js'
import { globFiles } from './glob.js'
import { runCodemod } from './codemod.js'

const DEFAULT_SRC = 'src/**/*.{jsx,tsx,js,ts}'
const DEFAULT_RESOLVED = '.sorb/resolved.json'

/** Parse the adapt subcommand argv (everything after `adapt`). */
export function parseAdaptArgs(argv) {
  const opts = { src: DEFAULT_SRC, resolved: DEFAULT_RESOLVED, mode: 'report', write: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') opts.src = argv[++i]
    else if (a.startsWith('--src=')) opts.src = a.slice('--src='.length)
    else if (a === '--resolved') opts.resolved = argv[++i]
    else if (a.startsWith('--resolved=')) opts.resolved = a.slice('--resolved='.length)
    else if (a === '--mode') opts.mode = argv[++i]
    else if (a.startsWith('--mode=')) opts.mode = a.slice('--mode='.length)
    else if (a === '--write') opts.write = true
  }
  return opts
}

/**
 * Collect detected sites across all source files matching the glob.
 * @returns {{sites: import('./types.js').AdaptSite[], files: string[]}}
 */
export function collectSites(srcGlob, cwd) {
  const files = globFiles(srcGlob, cwd)
  const sites = []
  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    const rel = relative(cwd, file)
    sites.push(...detectHardcoded(source, rel))
  }
  return { sites, files }
}

/**
 * Run the adapter end to end. Returns a result object (for tests); the CLI
 * wrapper prints the summary.
 * @param {ReturnType<typeof parseAdaptArgs>} opts
 * @param {string} cwd
 */
export async function runAdapt(opts, cwd) {
  const resolvedPath = resolve(cwd, opts.resolved)
  if (!existsSync(resolvedPath)) {
    return { ok: false, error: `resolved map not found: ${opts.resolved} (run \`sorb-seed resolve\` first)` }
  }
  const resolved = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
  const index = buildTokenIndex(resolved)
  const { sites, files } = collectSites(opts.src, cwd)
  const rows = buildReport(sites, index, resolved)
  const summary = summarize(rows)

  if (opts.mode === 'codemod') {
    const cm = await runCodemod(rows, { cwd, write: opts.write })
    return { ok: true, mode: 'codemod', rows, summary, files: files.length, codemod: cm }
  }

  if (opts.mode === 'shim') {
    // The runtime shim lives in @sorb/leaf (P2, separate track). Here we emit
    // the `auto` legacyMap payload the SorbProvider consumes, plus the report.
    const reportPath = writeReport(rows, cwd)
    const legacyMap = rows
      .filter((r) => r.status === 'auto')
      .map((r) => ({ raw: r.raw, prop: r.prop, cssVar: r.cssVar, tokenId: r.tokenId }))
    return { ok: true, mode: 'shim', rows, summary, files: files.length, reportPath, legacyMap }
  }

  // report mode (default)
  const reportPath = writeReport(rows, cwd)
  return { ok: true, mode: 'report', rows, summary, files: files.length, reportPath }
}

/** CLI entrypoint: parse argv, run, print, set exit code. */
export async function runAdaptCli(argv, cwd) {
  const opts = parseAdaptArgs(argv)
  const res = await runAdapt(opts, cwd)
  if (!res.ok) {
    console.error('✗', res.error)
    process.exit(1)
  }
  const { summary } = res
  console.log(`→ adapt (${res.mode}): scanned ${res.files} file(s), ${summary.total} hardcoded site(s)`)
  console.log(`  auto: ${summary.auto}   review: ${summary.review}   unmapped: ${summary.unmapped}`)
  if (res.reportPath) console.log(`✓ wrote ${relative(cwd, res.reportPath)}`)
  if (res.mode === 'shim') console.log(`  legacyMap: ${res.legacyMap.length} auto mapping(s) for SorbProvider`)
  if (res.mode === 'codemod') {
    if (res.codemod.refused) {
      console.error('✗', res.codemod.reason)
      process.exit(1)
    }
    console.log(res.codemod.written
      ? `✓ rewrote ${res.codemod.changedFiles} file(s); backups + diff under .sorb/`
      : `  dry-run: ${res.codemod.changedFiles} file(s) would change — re-run with --write to apply`)
    console.log(res.codemod.diff)
  }
  return res
}
