// Deterministic WCAG-2 contrast oracle math — the pure functions behind the
// "zero false negatives by construction" claim (PREREGISTRATION.md §2). Built
// in M1 because the injector needs it to GUARANTEE an injected contrast-break
// actually violates; M2's oracle consumes the same functions to SCORE. One
// implementation, no drift between injection and scoring.
//
// Spec: WCAG 2.x relative luminance + contrast ratio.
//   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//   https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
// This is exact arithmetic on sRGB — a decidable class, not a heuristic.

/** AA thresholds (WCAG 2 §1.4.3). */
export const AA_NORMAL = 4.5
export const AA_LARGE = 3.0

/**
 * Parse a hex color (`#rgb` or `#rrggbb`) → {r,g,b} in 0..255. Returns null for
 * anything that isn't a plain hex triple (the oracle only reasons about opaque
 * sRGB hex; alpha/named/rgb() are out of the decidable class handled here).
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}|null}
 */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let s = hex.trim().toLowerCase()
  if (s[0] !== '#') return null
  s = s.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (s.length !== 6 || /[^0-9a-f]/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

/** sRGB 8-bit channel → linear-light component (WCAG formula). */
const linearize = (c8) => {
  const c = c8 / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Relative luminance of an sRGB hex color, 0..1. Null if unparseable.
 * @param {string} hex
 * @returns {number|null}
 */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b)
}

/**
 * WCAG contrast ratio between two hex colors, 1..21. Null if either is
 * unparseable (undecidable in this oracle → the caller must treat as unknown,
 * never as "passes").
 * @param {string} fg
 * @param {string} bg
 * @returns {number|null}
 */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  if (l1 == null || l2 == null) return null
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Does (fg on bg) violate the AA threshold? Deterministic. For an unparseable
 * pair, returns null (unknown) — the oracle NEVER reports a false "passes".
 * @param {string} fg
 * @param {string} bg
 * @param {number} [threshold=AA_NORMAL]
 * @returns {boolean|null}
 */
export function violatesAA(fg, bg, threshold = AA_NORMAL) {
  const ratio = contrastRatio(fg, bg)
  if (ratio == null) return null
  return ratio < threshold
}
