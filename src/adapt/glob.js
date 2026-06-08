// Minimal dependency-free glob for the adapter's --src. Supports `**` (any
// depth), `*` (one segment), and brace alts `{a,b}`. Enough to resolve patterns
// like `src/**/*.{jsx,tsx,js,ts}` without pulling in a glob dependency.
import { readdirSync, statSync, existsSync } from 'fs'
import { join, sep } from 'path'

const IGNORE = new Set(['node_modules', '.git', '.sorb', 'dist', 'build', '.next'])

/** Expand `{a,b,c}` brace alternatives into multiple patterns. */
const expandBraces = (pattern) => {
  const m = pattern.match(/\{([^{}]+)\}/)
  if (!m) return [pattern]
  const alts = m[1].split(',')
  const out = []
  for (const alt of alts) {
    out.push(...expandBraces(pattern.replace(m[0], alt)))
  }
  return out
}

/** Compile a single glob (no braces) into a RegExp anchored to the full path. */
const toRegExp = (pattern) => {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**` → any chars incl. path separators
        re += '.*'
        i++
        if (pattern[i + 1] === '/') i++ // swallow the slash after **
      } else {
        re += '[^/]*'
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else if (c === '/') {
      re += '/'
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$')
}

/** Recursively list all files under a root (skipping IGNORE dirs). */
const walk = (root) => {
  const out = []
  const rec = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const ent of entries) {
      if (IGNORE.has(ent.name)) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) rec(full)
      else if (ent.isFile()) out.push(full)
    }
  }
  rec(root)
  return out
}

/**
 * Resolve a glob pattern (relative to cwd) to a list of matching file paths.
 * Normalizes path separators to `/` for matching. If the pattern names a single
 * existing file, returns just that file.
 * @param {string} pattern
 * @param {string} cwd
 * @returns {string[]}
 */
export function globFiles(pattern, cwd) {
  // Direct file?
  const direct = join(cwd, pattern)
  if (existsSync(direct) && statSync(direct).isFile()) return [direct]

  const patterns = expandBraces(pattern).map((p) => toRegExp(p))
  const all = walk(cwd)
  const norm = (p) => p.slice(cwd.length).replace(/^[/\\]/, '').split(sep).join('/')
  return all.filter((f) => {
    const rel = norm(f)
    return patterns.some((re) => re.test(rel))
  })
}
