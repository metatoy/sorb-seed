import { TIER_RANK } from '@sorb/core'

// Dev-gated warn(): no-op in production / unless SORB_DEBUG is set, so serve-time
// isn't noisy but local capture/dev surfaces drops loudly. (Diagnostics contract §4.)
const warn = (...args) => {
  const env = (typeof process !== 'undefined' && process.env) || {}
  if (env.SORB_DEBUG || env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[sorb-seed]', ...args)
  }
}

// Token annotation for captured layer values.
//
// Exact, normalized matching against the resolved bindable token map
// (Style Dictionary's `sorb/resolved-map`: { id, cssVar, value, tier, type }):
//   colors → canonical #rrggbbaa (lowercase); dimensions → px number.
// On collision, best-guess prefers the most specific tier
// (component > semantic > primitive), then resolved order; ALL matches are kept
// as `candidates` so the plugin can offer a switch.
// (Phase 4 adds property affinity — fill→bg, stroke→border, etc.)

const expandHex = (h) => {
  h = h.toLowerCase()
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length === 6) h += 'ff'
  return '#' + h
}
const toHex2 = (n) =>
  Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const alphaHex = (a) => toHex2(Math.max(0, Math.min(1, a)) * 255)

// A minimal CSS named-color table (the common names). Keeps `normalizeColor`
// dependency-free while covering values that show up in captured design tokens.
// (REC-6 — class-5 exotic/unicode-color improvement.)
export const CSS_NAMED_COLORS = {
  black: '#000000ff',
  white: '#ffffffff',
  red: '#ff0000ff',
  green: '#008000ff',
  blue: '#0000ffff',
  yellow: '#ffff00ff',
  cyan: '#00ffffff',
  aqua: '#00ffffff',
  magenta: '#ff00ffff',
  fuchsia: '#ff00ffff',
  gray: '#808080ff',
  grey: '#808080ff',
  silver: '#c0c0c0ff',
  maroon: '#800000ff',
  olive: '#808000ff',
  lime: '#00ff00ff',
  teal: '#008080ff',
  navy: '#000080ff',
  purple: '#800080ff',
  orange: '#ffa500ff',
  pink: '#ffc0cbff',
  brown: '#a52a2aff',
  gold: '#ffd700ff',
  indigo: '#4b0082ff',
  violet: '#ee82eeff',
  coral: '#ff7f50ff',
  salmon: '#fa8072ff',
  khaki: '#f0e68cff',
  crimson: '#dc143cff',
  turquoise: '#40e0d0ff',
}

// Sentinel marker (REC-6): distinguishes a value we *recognized as a color* but
// couldn't parse ('unparseable') from a value that simply isn't a color
// ('no-match'). `normalizeColor` still returns a hex string or null for callers;
// `classifyColor` exposes the richer outcome so REC-1's `dropped[]` can record
// *why* a value vanished.
const NBSP = /[   ]/g

/**
 * Classify a value as a color.
 * @returns {{ hex: string|null, status: 'ok'|'no-match'|'unparseable' }}
 *   - ok: parsed → canonical hex
 *   - no-match: a clean value that just isn't a color (e.g. '4px', a dimension)
 *   - unparseable: looks color-ish (a `#…` / `rgb(…)` / named shape) but is malformed
 */
export const classifyColor = (value) => {
  if (value == null) return { hex: null, status: 'no-match' }
  // Normalize exotic whitespace (NBSP etc.) that silently breaks matches.
  const s = String(value).replace(NBSP, ' ').trim().toLowerCase()
  if (s === '') return { hex: null, status: 'no-match' }
  if (s === 'transparent') return { hex: '#00000000', status: 'ok' }
  if (Object.prototype.hasOwnProperty.call(CSS_NAMED_COLORS, s)) {
    return { hex: CSS_NAMED_COLORS[s], status: 'ok' }
  }
  // `#…` shape: a clean hex parses; a `#`-prefixed-but-bad value is unparseable.
  if (s[0] === '#') {
    const m = s.match(/^#([0-9a-f]{3,8})$/)
    if (m && [3, 4, 6, 8].includes(m[1].length)) return { hex: expandHex(m[1]), status: 'ok' }
    return { hex: null, status: 'unparseable' }
  }
  // `rgb(…)` / `rgba(…)` shape.
  const m = s.match(/^rgba?\(\s*([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map((x) => x.trim())
    if (p.length < 3) return { hex: null, status: 'unparseable' }
    const nums = p.map((x) => parseFloat(x))
    if (nums.slice(0, 3).some((n) => Number.isNaN(n))) return { hex: null, status: 'unparseable' }
    const a = p[3] !== undefined ? parseFloat(p[3]) : 1
    return { hex: '#' + toHex2(nums[0]) + toHex2(nums[1]) + toHex2(nums[2]) + alphaHex(a), status: 'ok' }
  }
  return { hex: null, status: 'no-match' }
}

/** Normalize any CSS color to canonical `#rrggbbaa`, or null if not a color. */
export const normalizeColor = (value) => classifyColor(value).hex

/** Normalize a CSS length to a px number, or null. */
export const normalizeDimension = (value) => {
  if (value == null) return null
  const m = String(value).trim().match(/^(-?\d+(?:\.\d+)?)(?:px)?$/)
  return m ? parseFloat(m[1]) : null
}

// REC-2: a value that's still wrapped in `{…}` is an unresolved alias — Style
// Dictionary didn't follow the ref (a typo, a missing target, or a reference
// cycle). Observable, not fatal.
const ALIAS_RE = /^\{.+\}$/
const isAlias = (value) => typeof value === 'string' && ALIAS_RE.test(value.trim())
/** The bare ref path inside `{…}` (e.g. `{color.a}` → `color.a`), or null. */
const aliasTarget = (value) =>
  isAlias(value) ? String(value).trim().slice(1, -1).trim() : null

// Walk the alias graph from `id` and return the set of ids on an A↔B (or longer)
// cycle reachable from it, using the resolved map's own alias edges.
const findAliasCycles = (resolved) => {
  const byId = new Map(resolved.map((t) => [t.id, t]))
  const onCycle = new Set()
  for (const start of resolved) {
    if (!isAlias(start.value)) continue
    const seen = new Set()
    let cur = start
    while (cur && isAlias(cur.value)) {
      if (seen.has(cur.id)) { for (const id of seen) onCycle.add(id); break }
      seen.add(cur.id)
      cur = byId.get(aliasTarget(cur.value))
    }
  }
  return onCycle
}

/**
 * Build value→[token] indexes (colors, dims) from the resolved bindable map.
 * @returns {{ colors: Map, dims: Map, dropped: {id, value, reason}[] }}
 *   `dropped` (REC-1/2/6) records every token whose value normalized to null —
 *   unresolved-alias / cycle / unparseable-color / no-match — so a silent vanish
 *   becomes observable. Backward-compatible: `{colors, dims}` destructure still works.
 */
export const buildTokenIndex = (resolved) => {
  const colors = new Map()
  const dims = new Map()
  const dropped = []
  const cycles = findAliasCycles(resolved)
  const add = (map, key, t) => {
    if (key == null) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  const drop = (t, reason) => dropped.push({ id: t.id, value: t.value, reason })
  for (const t of resolved) {
    // REC-2: unresolved aliases / cycles never index — surface them.
    if (isAlias(t.value)) {
      drop(t, cycles.has(t.id) ? 'alias-cycle' : 'unresolved-alias')
      continue
    }
    const col = classifyColor(t.value)
    if (col.hex) { add(colors, col.hex, t); continue }
    const d = normalizeDimension(t.value)
    if (d != null) { add(dims, d, t); continue }
    // Neither a color nor a dimension → record *why* (REC-6 marker distinguishes
    // a malformed color from a value that's simply no color).
    drop(t, col.status === 'unparseable' ? 'unparseable-color' : 'no-match')
  }
  if (dropped.length) {
    warn(`buildTokenIndex dropped ${dropped.length} token(s):`,
      dropped.map((d) => `${d.id} (${d.reason})`).join(', '))
  }
  return { colors, dims, dropped }
}

// Binding = property affinity first, then tier precedence.
//
// Tier rank alone is ambiguous: one color value (e.g. #0F65EF) can match a
// `bg`, a `border`, AND a `text` token. The captured node's *property* tells us
// the role it plays — a frame fill wants a `bg` token, a stroke a `border`, a
// text fill a `text`, a corner radius a `radius`. We filter candidates to that
// role, then break remaining ties by tier (component > semantic > primitive).
// If no candidate carries the role, fall back to the full set (tier-only).
// TIER_RANK is the canonical ordering from @sorb/core (shared contract).

// role → the path segment a matching token id should contain (`.bg`, `.text`,
// `.border`, `.radius`). Matched on `.<role>` so `color.bg.surface`,
// `button.primary.bg.default`, and `button.radius` all qualify.
const byTier = (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)

const pick = (cands, role) => {
  if (!cands || !cands.length) return { token: null, candidates: [] }
  const roled = role ? cands.filter((c) => c.id.includes('.' + role)) : []
  const pool = roled.length ? roled : cands
  const best = [...pool].sort(byTier)[0]
  // REC-1/REC-3 fold-in: a role-miss that fell back to the tier-only pool can bind
  // the WRONG token silently. Flag it as a low-confidence pick so the bind is
  // observable. `offRole` is additive; existing callers ignore it.
  const offRole = !!(role && !roled.length)
  return { token: best.id, candidates: cands.map((c) => c.id), offRole, role }
}

export const matchColor = (index, value, role) => {
  const c = normalizeColor(value)
  return c ? pick(index.colors.get(c), role) : { token: null, candidates: [] }
}

export const matchDimension = (index, value, role) => {
  const d = normalizeDimension(value)
  return d == null ? { token: null, candidates: [] } : pick(index.dims.get(d), role)
}

// Walk a captured LayerNode tree and attach `sorb.tokens` / `.candidates`
// to each node whose bindable values match a token. Mutates and returns the
// tree. (The plugin materializer reads these to bind Figma Variables.)
export const annotateTree = (node, index) => {
  const tokens = {}
  const candidates = {}
  const diagnostics = []
  const set = (key, res) => {
    if (res.token) {
      tokens[key] = res.token
      candidates[key] = res.candidates
      // REC-1 fold-in: a token bound off-role is low-confidence — surface it.
      if (res.offRole) {
        diagnostics.push({ kind: 'off-role-bind', detail: { key, role: res.role, token: res.token } })
      }
    }
  }
  // A fill on a TEXT node is foreground (`text`); on a frame it's `bg`.
  const fillRole = node.type === 'TEXT' ? 'text' : 'bg'
  if (node.fills && node.fills[0]) set('fill', matchColor(index, node.fills[0].raw, fillRole))
  if (node.strokes && node.strokes[0]) set('stroke', matchColor(index, node.strokes[0].raw, 'border'))
  if (typeof node.cornerRadius === 'number') set('cornerRadius', matchDimension(index, node.cornerRadius, 'radius'))
  if (Array.isArray(node.effects)) {
    // No shadow tokens yet → no role, falls back to tier-only.
    node.effects.forEach((e, i) => { if (e.color) set(`effect${i}`, matchColor(index, e.color.raw)) })
  }
  if (Object.keys(tokens).length) {
    node.sorb = { tokens, candidates }
    // `diagnostics` is additive — only attached when there's something to report.
    if (diagnostics.length) node.sorb.diagnostics = diagnostics
  }
  if (diagnostics.length) {
    warn(`annotateTree: ${diagnostics.length} low-confidence bind(s) on ${node.name || node.type}`)
  }
  if (Array.isArray(node.children)) node.children.forEach((c) => annotateTree(c, index))
  return node
}
