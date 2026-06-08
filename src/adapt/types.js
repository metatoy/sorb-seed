// JSDoc typedefs for the Legacy-React adapter (roadmap §6).
//
// JavaScript only — these are documentation/IDE shapes, not emitted types.
// Shared token shapes (`ResolvedToken`, `Tier`) come from @sorb/core; the
// adapter never re-declares them.

/**
 * A CSS property "role" the matcher understands. Drives property affinity in
 * `matchColor`/`matchDimension` (annotateTokens.js). `null` ⇒ tier-only match.
 * @typedef {'bg'|'text'|'border'|'radius'|null} AdaptRole
 */

/**
 * A single detected hardcoded style site in consumer source.
 * @typedef {Object} AdaptSite
 * @property {string} file              Source file path (as passed to detect).
 * @property {{line:number, column:number}} loc  1-based line, 0-based column (Babel loc.start).
 * @property {string} prop              The CSS/JSX property name as written (e.g. 'backgroundColor', 'border-radius').
 * @property {string} raw              The raw literal value as written (e.g. '#0F65EF', '4px', '4').
 * @property {AdaptRole} role          Property→role mapping (bg/text/border/radius) or null.
 */

/**
 * The result of mapping one site to the nearest resolved token.
 * @typedef {Object} AdaptMapping
 * @property {string|null} tokenId     Resolved token id, or null when unmapped.
 * @property {string|null} cssVar      The token's `--css-var`, or null.
 * @property {number} confidence       0..1 confidence score (see mapToToken).
 * @property {string[]} candidates     All token ids that matched the value.
 * @property {boolean} offRole         True when the pick fell back off-role (low confidence).
 */

/**
 * A fully scored report row (detect → map → score). Emitted to
 * `.sorb/adapt-report.json`.
 * @typedef {Object} AdaptRow
 * @property {string} file
 * @property {{line:number, column:number}} loc
 * @property {string} prop
 * @property {string} raw
 * @property {string|null} tokenId
 * @property {string|null} cssVar
 * @property {number} confidence
 * @property {string[]} candidates
 * @property {'auto'|'review'|'unmapped'} status
 */

export {}
