// P1 — mapToToken: map a detected site to the nearest resolved token, reusing
// the EXACT capture matcher (matchColor/matchDimension from annotateTokens.js),
// and attach a confidence score.
//
// Confidence model (spec §6-P1, open-question "Confidence score model"):
//   - exact value match + exactly ONE *on-role* candidate + on-role (offRole=false)
//       ⇒ high confidence (1.0) ⇒ status 'auto'
//   - a token bound, but EITHER offRole=true OR more than one on-role candidate
//       ⇒ medium confidence (0.6) ⇒ status 'review'  (ambiguous → human gate)
//   - no token matched
//       ⇒ confidence 0 ⇒ status 'unmapped'
//
// "One candidate" = one candidate AFTER property-affinity role filtering (the
// disambiguated pool the matcher actually picks from), NOT the raw value-
// collision set. A single color (#0f65ef) collides with bg/border/text tokens,
// but role 'bg' narrows that to exactly one bg token — an unambiguous bind, so
// it earns 'auto'. The full collision set is still reported as `candidates`.
//
// AUTO_THRESHOLD is the single explicit cut between 'auto' and 'review'. A
// mapping with confidence >= AUTO_THRESHOLD is auto-applied; below it routes to
// review. 0.9 sits above the medium score (0.6) and at-or-below high (1.0), so
// only unambiguous exact one-candidate on-role picks clear it.
export const AUTO_THRESHOLD = 0.9

const HIGH = 1.0 // exact + single candidate + on-role
const MEDIUM = 0.6 // bound but ambiguous (off-role OR multiple candidates)

import { matchColor, matchDimension, normalizeColor } from '../annotateTokens.js'

/**
 * Choose the matcher by the site's value type: a value that normalizes to a
 * color goes through matchColor; otherwise (a dimension) through matchDimension.
 * Role is passed straight through (annotateTokens applies property affinity).
 * @param {import('./types.js').AdaptSite} site
 * @param {{colors:Map, dims:Map}} index
 */
const matchSite = (site, index) => {
  // Prefer color when the raw value is a color; the detector only ever flags a
  // raw that is one or the other, but a value like '4' is unambiguously a dim.
  if (normalizeColor(site.raw) != null) return matchColor(index, site.raw, site.role)
  return matchDimension(index, site.raw, site.role)
}

/**
 * Map one detected site → its nearest resolved token + confidence.
 * @param {import('./types.js').AdaptSite} site
 * @param {{colors:Map, dims:Map}} index   from buildTokenIndex(resolved)
 * @param {import('@sorb/core').ResolvedToken[]} [resolved]  optional, to resolve cssVar
 * @returns {import('./types.js').AdaptMapping}
 */
export function mapToToken(site, index, resolved) {
  const res = matchSite(site, index)
  if (!res.token) {
    return { tokenId: null, cssVar: null, confidence: 0, candidates: res.candidates || [], offRole: false }
  }
  const offRole = !!res.offRole
  // Count candidates AFTER role filtering — the pool the matcher disambiguated
  // to. When offRole (role missed entirely) we use the full set, which is
  // already ambiguous by definition.
  const onRole =
    site.role && !offRole
      ? res.candidates.filter((id) => id.includes('.' + site.role))
      : res.candidates
  const ambiguous = offRole || onRole.length > 1
  const confidence = ambiguous ? MEDIUM : HIGH
  const cssVar = resolveCssVar(res.token, resolved)
  return { tokenId: res.token, cssVar, confidence, candidates: res.candidates, offRole }
}

/**
 * Map a confidence score to a report status using the single AUTO_THRESHOLD cut.
 * @param {import('./types.js').AdaptMapping} mapping
 * @returns {'auto'|'review'|'unmapped'}
 */
export function statusFor(mapping) {
  if (!mapping.tokenId) return 'unmapped'
  return mapping.confidence >= AUTO_THRESHOLD ? 'auto' : 'review'
}

/**
 * Look up a token's cssVar from the resolved map (so the report carries the
 * `--var` for the codemod/shim). Falls back to deriving it from the id when the
 * resolved map isn't supplied.
 * @param {string} tokenId
 * @param {import('@sorb/core').ResolvedToken[]} [resolved]
 */
export function resolveCssVar(tokenId, resolved) {
  if (resolved) {
    const t = resolved.find((r) => r.id === tokenId)
    if (t && t.cssVar) return t.cssVar
  }
  // Derive `--a-b-c` from `a.b.c` as a last resort (matches the SD convention).
  return '--' + String(tokenId).replace(/\./g, '-')
}
