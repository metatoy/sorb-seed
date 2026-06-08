// P0 — detectHardcoded: find hardcoded color/dimension style literals in
// consumer React source via the Babel AST.
//
// Reuses the SAME normalizers as the capture binder (annotateTokens.js) so a
// value the matcher would bind is exactly a value we flag — no drift.
//
// Detects three shapes:
//   (a) JSX inline  style={{ backgroundColor: '#0F65EF', borderRadius: 4 }}
//   (b) styled-components / template-literal CSS  styled.button`background:#0F65EF; border-radius:4px;`
//   (c) CSS-Module-style string literals          const s = { background: '#0F65EF' }  (plain object props)
//
// A value already written as `var(--…)` is NOT hardcoded → skipped.

import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import { normalizeColor, normalizeDimension } from '../annotateTokens.js'

// @babel/traverse ships as CJS with a `.default` interop under ESM.
const traverse = /** @type {any} */ (_traverse).default || _traverse

/**
 * Map a CSS/JSX property name → matcher role. Accepts both kebab-case (CSS,
 * styled-components) and camelCase (JSX inline style). Non-roled props → null
 * (still detected, matched tier-only).
 * @param {string} prop
 * @returns {import('./types.js').AdaptRole}
 */
export const propToRole = (prop) => {
  const p = String(prop).trim().toLowerCase()
  switch (p) {
    case 'background':
    case 'background-color':
    case 'backgroundcolor':
      return 'bg'
    case 'color':
      return 'text'
    case 'border-color':
    case 'bordercolor':
      return 'border'
    case 'border-radius':
    case 'borderradius':
      return 'radius'
    default:
      return null
  }
}

// Properties whose values we even bother to inspect. Keep this generous: any
// prop that can carry a color or a dimension. We still only FLAG values that
// normalize to a color or dimension, so a non-style prop with a stray string
// won't false-positive (it won't normalize).
const STYLE_PROP_RE = /(color|background|border|radius|width|height|margin|padding|gap|top|left|right|bottom|fill|stroke|shadow|outline|size|spacing|inset)/i

const isVarRef = (raw) => /^var\(\s*--/i.test(String(raw).trim())

/**
 * Is this raw literal a hardcoded color or dimension we should flag?
 * Returns false for var(--…), non-color/non-dimension strings, etc.
 * @param {string} raw
 */
const isHardcodedValue = (raw) => {
  if (raw == null) return false
  const s = String(raw).trim()
  if (s === '') return false
  if (isVarRef(s)) return false
  return normalizeColor(s) != null || normalizeDimension(s) != null
}

/**
 * Parse source into a Babel AST. `jsx` + `typescript` plugins so .jsx AND .tsx
 * both parse (we parse a consumer's TS source; we never emit TS).
 * @param {string} source
 */
export const parseSource = (source) =>
  parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  })

/**
 * Pull `{line, column}` from a Babel node, 1-based line / 0-based column.
 * @param {any} node
 */
const locOf = (node) =>
  node && node.loc
    ? { line: node.loc.start.line, column: node.loc.start.column }
    : { line: 0, column: 0 }

/**
 * Detect hardcoded color/dimension style sites in `source`.
 * @param {string} source   The file's source text.
 * @param {string} filename The file path (recorded on each site).
 * @returns {import('./types.js').AdaptSite[]}
 */
export function detectHardcoded(source, filename) {
  /** @type {import('./types.js').AdaptSite[]} */
  const sites = []
  const push = (prop, raw, node) => {
    if (!isHardcodedValue(raw)) return
    sites.push({
      file: filename,
      loc: locOf(node),
      prop,
      raw: String(raw),
      role: propToRole(prop),
    })
  }

  let ast
  try {
    ast = parseSource(source)
  } catch (e) {
    // A file we can't parse yields no sites rather than throwing — the adapter
    // is a best-effort detector over a whole codebase. (catch (e), never {}.)
    return sites
  }

  traverse(ast, {
    // (a) JSX inline style={{ ... }} — ObjectProperty inside a JSXAttribute
    // named "style". We detect object props anywhere named like a style prop,
    // which also covers (c) plain CSS-Module-style style objects.
    ObjectProperty(path) {
      const keyNode = path.node.key
      const prop =
        keyNode.type === 'Identifier'
          ? keyNode.name
          : keyNode.type === 'StringLiteral'
            ? keyNode.value
            : null
      if (!prop) return
      if (!STYLE_PROP_RE.test(prop)) return
      const v = path.node.value
      if (v.type === 'StringLiteral') push(prop, v.value, v)
      else if (v.type === 'NumericLiteral') push(prop, String(v.value), v)
    },

    // (b) styled-components / any tagged or untagged CSS template literal.
    // Scan the static (quasi) chunks for `prop: value;` declarations and flag
    // hardcoded color/dimension values. Interpolations (${...}) are skipped —
    // they're already dynamic.
    TemplateLiteral(path) {
      for (const quasi of path.node.quasis) {
        const text = quasi.value.cooked != null ? quasi.value.cooked : quasi.value.raw
        if (!text) continue
        // Match `prop: value` declarations (value up to ; or end of chunk).
        const declRe = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g
        let m
        while ((m = declRe.exec(text)) !== null) {
          const prop = m[1].trim()
          if (!STYLE_PROP_RE.test(prop)) continue
          // A declaration value can be multi-token (e.g. `1px solid #0F65EF`);
          // inspect each whitespace-separated token for a color/dimension.
          const value = m[2].trim()
          const tokens = value.split(/\s+/)
          for (const tok of tokens) {
            if (isHardcodedValue(tok)) push(prop, tok, quasi)
          }
        }
      }
    },
  })

  return sites
}
