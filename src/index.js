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

// shadcn/ui theme format (framework-targets-productization T1) — promoted
// from `sorb-demo-tailwind`'s hand-authored `shadcn-map.css`+`shadcn-theme.css`.
export { SORB_SHADCN, sorbShadcn, shadcnRootLines, shadcnThemeInlineLines } from './emit/sorbShadcn.js'

// MUI v6 CSS-var override format (framework-targets-productization T3) —
// promoted from `sorb-demo-mui/sd.config.js:18-86`.
export { SORB_MUI_VARS, MUI_VAR_MAP, sorbMuiVars } from './emit/sorbMui.js'

// Angular Material 20 M3 system-variable override format
// (framework-targets-productization T5) — promoted from
// `sorb-demo-angular/sd.config.js:96-113`.
export { SORB_MAT_SYS_VARS, MAT_SYS_MAP, sorbMatSysVars } from './emit/sorbMatSys.js'

// PrimeVue v4 preset format (framework-targets-productization T4) — the first
// JS-emitting target format; generated from `sorb-demo-primevue/src/jjPreset.js`.
export { SORB_PRIMEVUE_PRESET, PRIMEVUE_ROLE_TREE, sorbPrimevuePreset } from './emit/sorbPrimevue.js'

// Legacy-React adapter surface (roadmap §6 / tokenize-repo P0). The static
// hardcoded-literal detector + the SAME normalizers the capture binder uses, so
// downstream consumers (e.g. sorb-cloud's tokenize pipeline) flag exactly the
// values the matcher would bind — no drift. JS-AST/regex only; never executes
// consumer code. The value-normalizers (`normalizeColor`/`normalizeDimension`)
// are the contract the cloud CSS/SCSS scanner shares so JS and CSS sites cluster
// on identical canonical values.
export { detectHardcoded, propToRole, parseSource } from './adapt/detectHardcoded.js'
export { normalizeColor, normalizeDimension, classifyColor } from './annotateTokens.js'
export { mapToToken, statusFor, resolveCssVar, AUTO_THRESHOLD } from './adapt/mapToToken.js'
