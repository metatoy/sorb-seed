import { TIER_RANK } from '@sorb/core'

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

/** Normalize any CSS color to canonical `#rrggbbaa`, or null if not a color. */
export const normalizeColor = (value) => {
  if (value == null) return null
  const s = String(value).trim().toLowerCase()
  if (s === 'transparent') return '#00000000'
  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) return expandHex(m[1])
  m = s.match(/^rgba?\(\s*([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map((x) => x.trim())
    if (p.length < 3) return null
    const a = p[3] !== undefined ? parseFloat(p[3]) : 1
    return '#' + toHex2(+p[0]) + toHex2(+p[1]) + toHex2(+p[2]) + alphaHex(a)
  }
  return null
}

/** Normalize a CSS length to a px number, or null. */
export const normalizeDimension = (value) => {
  if (value == null) return null
  const m = String(value).trim().match(/^(-?\d+(?:\.\d+)?)(?:px)?$/)
  return m ? parseFloat(m[1]) : null
}

/** Build value→[token] indexes (colors, dims) from the resolved bindable map. */
export const buildTokenIndex = (resolved) => {
  const colors = new Map()
  const dims = new Map()
  const add = (map, key, t) => {
    if (key == null) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  for (const t of resolved) {
    const c = normalizeColor(t.value)
    if (c) add(colors, c, t)
    else add(dims, normalizeDimension(t.value), t)
  }
  return { colors, dims }
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
  return { token: best.id, candidates: cands.map((c) => c.id) }
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
  const set = (key, res) => {
    if (res.token) { tokens[key] = res.token; candidates[key] = res.candidates }
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
  if (Object.keys(tokens).length) node.sorb = { tokens, candidates }
  if (Array.isArray(node.children)) node.children.forEach((c) => annotateTree(c, index))
  return node
}
