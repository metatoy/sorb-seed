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
 * Line/column of a char offset INSIDE a template quasi: the quasi's start line
 * plus the newlines before the offset (fixes the shared-line bug where every
 * declaration in a styled block reported the quasi's first line).
 * @param {any} quasi
 * @param {string} text
 * @param {number} offset
 */
const quasiOffsetLoc = (quasi, text, offset) => {
  const base = locOf(quasi)
  let line = base.line
  let lastNl = -1
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastNl = i
    }
  }
  const column = lastNl === -1 ? base.column + 1 + offset : offset - lastNl - 1
  return { line, column }
}

/**
 * Block identity for an object property: the enclosing ObjectExpression's
 * source start (`obj@N`), its own enclosing object as `parent`, and the key
 * that owns the object (`style`, `'&:hover'`, …) as a label when derivable.
 * @param {any} path  Babel path of the ObjectProperty
 */
const objectGroup = (path) => {
  const obj = path.parentPath
  if (!obj || obj.node.type !== 'ObjectExpression') return null
  const owner = obj.parentPath
  let label
  let parent
  if (owner) {
    const o = owner.node
    if (o.type === 'ObjectProperty') {
      label = o.key.type === 'Identifier' ? o.key.name : o.key.type === 'StringLiteral' ? o.key.value : undefined
      const outer = owner.parentPath
      if (outer && outer.node.type === 'ObjectExpression') parent = 'obj@' + outer.node.start
    } else if (o.type === 'JSXExpressionContainer') {
      const attr = owner.parentPath && owner.parentPath.node
      if (attr && attr.type === 'JSXAttribute' && attr.name && attr.name.type === 'JSXIdentifier') label = attr.name.name
    } else if (o.type === 'VariableDeclarator' && o.id && o.id.type === 'Identifier') {
      label = o.id.name
    }
  }
  return { id: 'obj@' + obj.node.start, parent, label }
}

/**
 * A readable label for a template literal's top-level block: the tag source
 * for tagged templates (`styled.button`, `css`), else the declarator name.
 * @param {any} path  Babel path of the TemplateLiteral
 */
const templateTagLabel = (path) => {
  const p = path.parentPath
  if (p && p.node.type === 'TaggedTemplateExpression') {
    const tag = p.node.tag
    if (tag.type === 'Identifier') return tag.name
    if (tag.type === 'MemberExpression' && tag.object.type === 'Identifier' && tag.property.type === 'Identifier') {
      return tag.object.name + '.' + tag.property.name
    }
    if (tag.type === 'CallExpression' && tag.callee.type === 'Identifier') return tag.callee.name + '()'
    return 'template'
  }
  if (p && p.node.type === 'VariableDeclarator' && p.node.id.type === 'Identifier') return p.node.id.name
  return 'template'
}

/**
 * Detect hardcoded color/dimension style sites in `source`.
 * @param {string} source   The file's source text.
 * @param {string} filename The file path (recorded on each site).
 * @returns {import('./types.js').AdaptSite[]}
 */
export function detectHardcoded(source, filename) {
  /** @type {import('./types.js').AdaptSite[]} */
  const sites = []
  const push = (prop, raw, node, group, extra) => {
    if (!isHardcodedValue(raw)) return
    /** @type {import('./types.js').AdaptSite} */
    const site = {
      file: filename,
      loc: (extra && extra.loc) || locOf(node),
      prop,
      raw: String(raw),
      role: propToRole(prop),
    }
    if (group) {
      site.group = group.id
      if (group.parent) site.parent = group.parent
      if (group.label) site.label = group.label
    }
    sites.push(site)
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
      const group = objectGroup(path)
      if (v.type === 'StringLiteral') push(prop, v.value, v, group)
      else if (v.type === 'NumericLiteral') push(prop, String(v.value), v, group)
    },

    // (b) styled-components / any tagged or untagged CSS template literal.
    // Scan the static (quasi) chunks for `prop: value;` declarations and flag
    // hardcoded color/dimension values. Interpolations (${...}) are skipped —
    // they're already dynamic.
    TemplateLiteral(path) {
      // Block identity across the WHOLE template: a brace counter that
      // persists across quasis (an interpolation never closes a block).
      // Block 0 = the template's top level; nested `&:hover { … }` blocks get
      // monotonic ids with `parent` linkage. Ids are keyed by the template's
      // source start so they are stable + unique per file.
      const tplStart = path.node.start
      const tagLabel = templateTagLabel(path)
      /** @type {{ id: number, label: string, parent?: number }[]} */
      const stack = [{ id: 0, label: tagLabel }]
      let nextBlock = 1
      const groupAt = () => {
        const top = stack[stack.length - 1]
        const parent = stack.length > 1 ? stack[stack.length - 2] : null
        return {
          id: 'tpl@' + tplStart + ':b' + top.id,
          parent: parent ? 'tpl@' + tplStart + ':b' + parent.id : undefined,
          label: top.label,
        }
      }
      for (const quasi of path.node.quasis) {
        const text = quasi.value.cooked != null ? quasi.value.cooked : quasi.value.raw
        if (!text) continue
        // Match `prop: value` declarations (value up to ; or end of chunk).
        const declRe = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g
        let m
        // Brace cursor: every `{`/`}` before a match is applied first so the
        // match sees the block it actually sits in.
        let cursor = 0
        let runStart = 0
        const advance = (to) => {
          for (; cursor < to; cursor++) {
            const ch = text[cursor]
            if (ch === '{') {
              const label = text.slice(runStart, cursor).replace(/\s+/g, ' ').trim().slice(0, 80)
              const parent = stack[stack.length - 1]
              stack.push({ id: nextBlock++, label: label || parent.label, parent: parent.id })
              runStart = cursor + 1
            } else if (ch === '}') {
              if (stack.length > 1) stack.pop()
              runStart = cursor + 1
            } else if (ch === ';') {
              runStart = cursor + 1
            }
          }
        }
        while ((m = declRe.exec(text)) !== null) {
          const prop = m[1].trim()
          if (!STYLE_PROP_RE.test(prop)) continue
          // Where the value starts inside this quasi → the TRUE line (the quasi
          // start line + newlines before the value), not the quasi's line.
          const valueStart = m.index + m[0].length - m[2].length
          advance(valueStart)
          const group = groupAt()
          const loc = quasiOffsetLoc(quasi, text, valueStart)
          // A declaration value can be multi-token (e.g. `1px solid #0F65EF`);
          // inspect each whitespace-separated token for a color/dimension.
          const value = m[2].trim()
          const tokens = value.split(/\s+/)
          for (const tok of tokens) {
            if (isHardcodedValue(tok)) push(prop, tok, quasi, group, { loc })
          }
        }
        advance(text.length)
      }
    },
  })

  return sites
}
