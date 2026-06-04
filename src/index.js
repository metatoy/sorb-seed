// Public library surface for @sorb/seed.
//
// The resolved bindable token map is now produced by Style Dictionary (see
// `sorb-seed resolve`, a thin SD wrapper), not by scraping a theme module —
// so the old `resolveBindableTokens` export is gone. What remains useful as a
// library is the token-annotation layer used by `capture`.
export { buildTokenIndex, annotateTree, matchColor, matchDimension } from './annotateTokens.js'
