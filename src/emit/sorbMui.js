// Sorb MUI v6 CSS-var override format (`sorb/mui-vars`).
//
// PROMOTED from `sorb-demo-mui/sd.config.js:18-86` (P3 spike →
// framework-targets-productization T3, third of the six JJ-demo formats to
// graduate into `@sorb/seed`). The demo file stays in place for now (T8
// retrofit is founder-gated); this is the canonical, generalized home.
//
// WHY THE INDIRECTION LAYER EXISTS: MUI v6 `createTheme({ cssVariables: true })`
// rejects `var(...)` strings as palette input (it needs real colors to compute
// contrast/tonal variants — verified via spike, see the demo's README §MUI
// integration). So MUI still computes its own `--mui-*` custom properties from
// hardcoded seed values, and this format emits a *second*, later-cascading
// `:root` block that re-points each covered `--mui-*` var at the matching kit
// token via `var(--kit-token, <seed-fallback>)`. Any component reading
// `var(--mui-palette-primary-main)` transitively resolves through to the kit
// token, and a Sorb bridge push (which sets `--color-*` on `:root`) re-themes
// it live with zero MUI reinitialization.
//
// GENERALIZATION (T0 semantic-role contract): the spike hardcoded two things
// that promotion must generalize —
//   (a) the JJ-token-id column (left side of the map): now ROLE-RESOLVED via
//       `options.roleMap` (role id → kit token id), same shape as
//       `@sorb/core`'s `resolveRole`/`DEFAULT_ROLE_IDS`, inlined here rather
//       than imported so this format degrades gracefully against an older
//       published `@sorb/core` that predates the role contract (same
//       feature-detect posture as the TargetAdapter registration side — see
//       `sorb-leaf/src/targets/mui.js`).
//   (b) the MUI fallback LITERAL (var()'s 2nd arg, e.g. `#1976d2`): this was
//       the demo's own Janes-Jeans hex values baked directly into the format
//       function. Promotion REQUIRES callers to supply these via
//       `options.seedValues` (role id → literal) — a public `@sorb/seed`
//       format must never ship one kit's brand hexes as its defaults (RISK,
//       framework-targets-productization.md risk table: "MUI fallback
//       literals leak kit values into public seed"). A role with no
//       `seedValues` entry emits `var(--kit-token)` with NO fallback — MUI may
//       then fail to compute tonal variants for that slot until a real value
//       resolves at runtime (documented, not silently patched over).
//
// Not every key below is one of `@sorb/core`'s canonical `DEFAULT_ROLE_IDS`
// — several (contrast-text roles) are Janes-Jeans-shaped ids with no
// canonical role counterpart yet (kit-private, per the productization spec's
// "contract scope = the union of the six maps' role columns, not a kit's
// full token tree"). They still go through the same `roleMap` resolution for
// consistency and so a kit that DOES want to override them can.
//
// The `--mui-*` right-hand column is MUI's own documented CSS-variables
// surface (verified against @mui/material 6.5.0's actual `theme.vars`
// shape) — universal, and stays baked (not role-resolved).
//
// COVERAGE BOUNDARY (EVIDENCE framing — verified against @mui/material
// 6.5.0's actual `theme.vars` shape, carried from the P3 spike header):
//   COVERED     — palette.{primary,secondary,error,success}.{main,dark,contrastText}
//                 (secondary/error/success contrastText not yet mapped — see
//                 role gaps in the T3 report), palette.background.{default,paper},
//                 palette.text.{primary,secondary}, palette.divider,
//                 shape.borderRadius.
//   NOT COVERED — typography (fontFamily/fontSize/fontWeight per variant — MUI
//                 v6 does not expose these as CSS vars by default), spacing
//                 function, transitions, zIndex, breakpoints. These stay
//                 JS-only theme values; a live preview cannot re-theme them.
//
// PRECEDENCE: !important, not just document-order — MUI/emotion injects its
// cssVariables stylesheet at RUNTIME (on ThemeProvider mount), so there is no
// guaranteed head-order relative to this override layer (a sibling pod, P2
// Mantine, hit exactly this as a silent no-op with a bare `:root` rule).
// `!important` makes the win unconditional regardless of insertion order.

export const SORB_MUI_VARS = 'sorb/mui-vars'

/**
 * role id (JJ id when unmapped) → MUI CSS var name.
 * Left side is resolved through `options.roleMap` at format time (identity
 * when the kit uses these ids directly — the JJ reference); right side is
 * the MUI v6 documented `cssVariables:true` var it overrides.
 */
export const MUI_VAR_MAP = {
  'color.brand': '--mui-palette-primary-main',
  'color.brand-hover': '--mui-palette-primary-dark',
  'color.brand-contrast': '--mui-palette-primary-contrastText',
  'color.accent': '--mui-palette-secondary-main',
  'color.accent-hover': '--mui-palette-secondary-dark',
  'color.accent-contrast': '--mui-palette-secondary-contrastText',
  'color.danger': '--mui-palette-error-main',
  'color.danger-hover': '--mui-palette-error-dark',
  'color.success': '--mui-palette-success-main',
  'color.success-hover': '--mui-palette-success-dark',
  'color.surface': '--mui-palette-background-default',
  'color.surface-raised': '--mui-palette-background-paper',
  'color.ink': '--mui-palette-text-primary',
  'color.ink-muted': '--mui-palette-text-secondary',
  'color.border': '--mui-palette-divider',
  'radius.control': '--mui-shape-borderRadius',
}

const cssVarOf = (id) => '--' + String(id).split('.').join('-')

// Same shape as `@sorb/core`'s `resolveRole` — inlined per the promotion
// spec so this format has no hard runtime dependency on a core version that
// ships the role contract (see file header).
const resolveRoleId = (roleId, roleMap) => (roleMap && roleMap[roleId]) || roleId

/**
 * format: sorb/mui-vars
 * Emits a CSS file that redeclares the mapped `--mui-*` vars as
 * `var(--<kit-token>, <seed-fallback>) !important` refs. `options.roleMap`
 * (role id → kit token id) lets a non-JJ kit reuse this format unmodified;
 * defaults to the canonical/JJ ids (identity resolution) when omitted.
 * `options.seedValues` (role id → literal fallback) is REQUIRED to avoid
 * baking any one kit's hex values into the public format — a role with no
 * `seedValues` entry emits `var(--kit-token)` with no fallback.
 * @param {{dictionary: {allTokens: Array}, options?: {roleMap?: Record<string,string>, seedValues?: Record<string,string>}}} args
 * @returns {string} the generated CSS.
 */
export const sorbMuiVars = ({ dictionary, options }) => {
  const roleMap = options && options.roleMap
  const seedValues = (options && options.seedValues) || {}
  if (!options || !options.seedValues) {
    // eslint-disable-next-line no-console
    console.warn(
      '  ⚠ sorb/mui-vars: options.seedValues not supplied — every declaration will emit ' +
        'var(--kit-token) with no fallback; MUI may not compute tonal variants until a real ' +
        'value resolves at runtime.'
    )
  }
  const byId = new Map(dictionary.allTokens.map((t) => [t.path.join('.'), t]))
  const lines = []
  const missing = []
  const noFallback = []
  for (const [roleId, muiVar] of Object.entries(MUI_VAR_MAP)) {
    const tokenId = resolveRoleId(roleId, roleMap)
    const t = byId.get(tokenId)
    if (!t) { missing.push(tokenId); continue }
    const seed = seedValues[roleId]
    const ref = seed != null ? `var(${cssVarOf(tokenId)}, ${seed})` : `var(${cssVarOf(tokenId)})`
    if (seed == null) noFallback.push(roleId)
    // !important is load-bearing here — see file header "Precedence".
    lines.push(`  ${muiVar}: ${ref} !important;`)
  }
  if (missing.length) {
    console.warn(`  ⚠ sorb/mui-vars: ${missing.length} unmapped token id(s) skipped: ` + missing.join(', '))
  }
  if (noFallback.length) {
    console.warn(
      `  ⚠ sorb/mui-vars: ${noFallback.length} role(s) with no seedValues fallback (var() with ` +
        'no 2nd arg): ' + noFallback.join(', ')
    )
  }
  return (
    '/* AUTOGENERATED by Style Dictionary (sorb/mui-vars) — do not edit.\n' +
    '   Maps MUI cssVariables:true output vars -> kit token vars, so a Sorb bridge push\n' +
    '   against --color-*, --radius-*, etc. cascades through to MUI. Load AFTER MUI\'s\n' +
    '   own theme stylesheet (see the consuming app\'s entry import order).\n' +
    '   !important is load-bearing, not decorative — see this format\'s header "Precedence".\n' +
    '\n' +
    '   COVERAGE (verified against @mui/material 6.5.0\'s actual theme.vars shape):\n' +
    '     COVERED     — palette.{primary,secondary,error,success}.{main,dark,contrastText},\n' +
    '                   palette.background.{default,paper}, palette.text.{primary,secondary},\n' +
    '                   palette.divider, shape.borderRadius.\n' +
    '     NOT COVERED — typography, spacing function, transitions, zIndex, breakpoints\n' +
    '                   (JS-only theme values; a live preview cannot re-theme them). */\n' +
    ':root, [data-mui-color-scheme] {\n' +
    lines.join('\n') +
    '\n}\n'
  )
}
