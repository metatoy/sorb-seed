// P3 — codemod: rewrite each `auto` site to `var(--<cssVar>, <original raw>)`,
// fallback preserved (so the rewritten component renders byte-identical until a
// token is actually applied). Babel parse → mutate → generate.
//
// Safety (spec §6-P3 / AGENTS §5):
//   - refuses to run on `main` (or whatever the default branch is),
//   - requires an explicit `--write` flag — without it, dry-run (diff only),
//   - writes a `.bak` of each changed file + a unified-ish diff under `.sorb/`,
//   - never mutates source without `--write`.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { execSync } from 'child_process'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import _generate from '@babel/generator'

const traverse = /** @type {any} */ (_traverse).default || _traverse
const generate = /** @type {any} */ (_generate).default || _generate

/** Build the `var(--x, fallback)` replacement string for a raw value. */
export const varExpr = (cssVar, raw) => `var(${cssVar}, ${raw})`

/** Current git branch for `cwd`, or null if not a repo / git unavailable. */
export function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch (e) {
    return null
  }
}

const DEFAULT_BRANCHES = new Set(['main', 'master'])

/**
 * Rewrite the `auto` sites in a single source string. Returns the new source
 * (or the original if nothing changed) + the count of edits applied.
 * Matches sites by {line, column} against AST node locs.
 * @param {string} source
 * @param {import('./types.js').AdaptRow[]} fileRows  auto rows for THIS file
 * @returns {{code: string, edits: number}}
 */
export function rewriteSource(source, fileRows) {
  if (!fileRows.length) return { code: source, edits: 0 }
  const wanted = new Map() // "line:col" → row
  for (const r of fileRows) wanted.set(`${r.loc.line}:${r.loc.column}`, r)

  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], tokens: false })
  let edits = 0
  const keyOf = (node) => node.loc ? `${node.loc.start.line}:${node.loc.start.column}` : null
  const already = (node) => node._sorbRewritten

  const replaceWith = (node, row) => {
    if (already(node)) return
    // Replace the literal node with a string literal carrying the var() expr.
    // For inline-style JSX/object values this yields  backgroundColor: 'var(--x, #0F65EF)'.
    const raw = node.type === 'NumericLiteral' ? String(node.value) : node.value
    node.type = 'StringLiteral'
    node.value = varExpr(row.cssVar, raw)
    delete node.extra // drop the original raw quoting so generator re-quotes value
    node._sorbRewritten = true
    edits++
  }

  traverse(ast, {
    StringLiteral(path) {
      const k = keyOf(path.node)
      if (k && wanted.has(k)) replaceWith(path.node, wanted.get(k))
    },
    NumericLiteral(path) {
      const k = keyOf(path.node)
      if (k && wanted.has(k)) replaceWith(path.node, wanted.get(k))
    },
    // Styled-components template quasis: rewrite the literal substring in-place.
    TemplateElement(path) {
      const k = keyOf(path.node)
      if (!k) return
      // A quasi can host several sites (multiple declarations); match all rows
      // whose loc points at this quasi.
      const rows = fileRows.filter((r) => `${r.loc.line}:${r.loc.column}` === k)
      if (!rows.length) return
      let cooked = path.node.value.cooked != null ? path.node.value.cooked : path.node.value.raw
      let raw = path.node.value.raw
      for (const row of rows) {
        const replacement = varExpr(row.cssVar, row.raw)
        // Replace the first verbatim occurrence of the raw value.
        if (cooked.includes(row.raw)) cooked = cooked.replace(row.raw, replacement)
        if (raw.includes(row.raw)) raw = raw.replace(row.raw, replacement)
        edits++
      }
      path.node.value = { cooked, raw }
    },
  })

  if (!edits) return { code: source, edits: 0 }
  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source)
  return { code: out.code, edits }
}

/**
 * Run the codemod over the auto rows. Groups rows by file. Dry-run by default;
 * writes only with `write: true`. Refuses on default branch.
 * @param {import('./types.js').AdaptRow[]} rows  full report rows
 * @param {{cwd: string, write?: boolean, allowBranch?: boolean}} o
 */
export async function runCodemod(rows, o) {
  const { cwd, write = false } = o
  const branch = currentBranch(cwd)
  if (!o.allowBranch && branch && DEFAULT_BRANCHES.has(branch)) {
    return { refused: true, reason: `refusing to codemod on default branch '${branch}' — branch first`, branch }
  }

  const auto = rows.filter((r) => r.status === 'auto')
  const byFile = new Map()
  for (const r of auto) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }

  const sorbDir = join(cwd, '.sorb')
  const diffs = []
  let changedFiles = 0
  for (const [file, fileRows] of byFile) {
    const abs = resolve(cwd, file)
    const source = readFileSync(abs, 'utf-8')
    const { code, edits } = rewriteSource(source, fileRows)
    if (!edits || code === source) continue
    changedFiles++
    diffs.push(makeDiff(file, source, code))
    if (write) {
      // .bak under .sorb/ mirroring the file path, then write the rewrite.
      const bak = join(sorbDir, 'bak', file + '.bak')
      mkdirSync(dirname(bak), { recursive: true })
      writeFileSync(bak, source, 'utf-8')
      writeFileSync(abs, code, 'utf-8')
    }
  }

  const diff = diffs.join('\n')
  if (write && diff) {
    mkdirSync(sorbDir, { recursive: true })
    writeFileSync(join(sorbDir, 'adapt-codemod.diff'), diff + '\n', 'utf-8')
  }
  return { refused: false, written: write, changedFiles, diff, branch }
}

/** A minimal line-level unified-ish diff (no external dep). */
export function makeDiff(file, before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const out = [`--- a/${file}`, `+++ b/${file}`]
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`-${a[i]}`)
    if (b[i] !== undefined) out.push(`+${b[i]}`)
  }
  return out.join('\n')
}
