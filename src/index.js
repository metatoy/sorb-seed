// Public library surface for @sorb/seed.
//
// The resolved bindable token map is now produced by Style Dictionary (see
// `sorb-seed resolve`, a thin SD wrapper), not by scraping a theme module —
// so the old `resolveBindableTokens` export is gone. What remains useful as a
// library is the token-annotation layer used by `capture`.
export { buildTokenIndex, annotateTree, matchColor, matchDimension } from './annotateTokens.js'

// Sorb's custom Style Dictionary outputs (component-compat-roadmap P0, part
// 2) — promoted from sorb-demo's copy-local `sd/sorb-format.js` so target
// adapters import these formats instead of duplicating them. A consumer's
// `sd.config.js` registers these with `StyleDictionary.registerFormat`/
// `registerParser` the same way sorb-demo's does.
export {
  tierOfFile,
  SORB_RESOLVED,
  SORB_THEME_NESTED,
  SORB_ALIASES,
  SORB_VERSIONS,
  SORB_SET_META,
  SORB_TAILWIND,
  SORB_TAILWIND_V3,
  SORB_TOKENSET,
  sorbSetMeta,
  sorbVersions,
  sorbTokenSet,
  sorbResolved,
  sorbAliases,
  sorbThemeNested,
  tailwindThemeEntry,
  sorbTailwind,
  tailwindV3Slot,
  sorbTailwindV3,
} from './emit/sorbFormat.js'

// Mantine v7 CSS-var override format (framework-targets-productization T2) —
// promoted from `sorb-demo-mantine/sd/mantine-format.js`.
export { SORB_MANTINE_VARS, MANTINE_VAR_MAP, sorbMantineVars } from './emit/sorbMantine.js'
