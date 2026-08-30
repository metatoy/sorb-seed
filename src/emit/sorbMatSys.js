// Sorb Angular Material 20 M3 system-variable override format
// (`sorb/mat-sys-vars`).
//
// PROMOTED from `sorb-demo-angular/sd.config.js:96-113` (the inline
// `SORB_MAT_SYS_VARS` format + `MAT_SYS_MAP`) — framework-targets-
// productization T5, the fifth of the six JJ-demo formats to graduate into
// `@sorb/seed`. The demo file stays in place for now (T8 retrofit is
// founder-gated); this is the canonical, generalized home.
//
// GENERALIZATION (T0 semantic-role contract): the demo hardcoded Janes
// Jeans' own token ids (`color.brand`, `radius.control`, …) as the map's
// right-hand column. Promotion makes that column ROLE-RESOLVED —
// `options.roleMap` (role id → kit-token-id overrides) lets a non-JJ kit
// reuse this format unmodified instead of forking it. Resolution is the
// same shape as `@sorb/core`'s `resolveRole` (`sorb-core/src/index.js`
// `DEFAULT_ROLE_IDS`/`resolveRole`), inlined here rather than imported so
// this format degrades gracefully against an older published `@sorb/core`
// that predates the role contract (same feature-detect posture as the
// TargetAdapter registration side — see
// `sorb-leaf/src/targets/angularMaterial.js`).
//
// Not every role id below is one of `@sorb/core`'s canonical
// `DEFAULT_ROLE_IDS` — `color.white` (the on-error/on-error-container rows)
// is a kit-private primitive, carried over from the demo's original literal
// `var(--color-white)` mapping. All ids go through the same `roleMap`
// resolution for consistency and so a kit without that primitive can
// override it.
//
// The `--mat-sys-*` left-hand column is Angular Material's own documented
// M3 system-variable surface (emitted by the `mat.theme()` mixin) —
// universal, and stays baked (not role-resolved). The map is left keyed by
// `--mat-sys-*` var (not role id, unlike `sorb/mantine-vars`) because several
// distinct Material system slots legitimately resolve to the same kit role
// (e.g. `--mat-sys-surface` and `--mat-sys-surface-bright` both track
// `color.surface`) — duplicate values are fine, duplicate object keys are
// not, so keying by the unique `--mat-sys-*` name preserves the full
// ~40-row demo mapping verbatim.
//
// PRECEDENCE FINDINGS (carried verbatim from the demo's header — this is the
// load-bearing reason every declaration below is `!important`, so don't drop
// it in a future edit): Angular Material's `mat.theme()` mixin emits its own
// `html { ... }` rule at a point in the stylesheet whose order relative to
// this override is not guaranteed across HMR/rebuild ordering. CSS's "later
// wins on equal specificity" rule alone won't reliably beat a component
// library's own injected styles — the same P2/Mantine specificity lesson
// travels here. `!important` on every declaration is the fix, not
// decoration.
//
// Zero-dep, zero-JS (Mechanism A): a static CSS file of `var()` refs,
// reacting to a live bridge push the same way `variables.css` already does.

export const SORB_MAT_SYS_VARS = 'sorb/mat-sys-vars'

/**
 * Angular Material `--mat-sys-*` CSS var name → role id (JJ id when
 * unmapped). The role id is resolved through `options.roleMap` at format
 * time (identity when the kit uses these ids directly — the JJ reference).
 * Semantic-tier-first per the field corrections carried from P2/P4: only
 * the handful of system roots Material's own components actually cascade
 * from — not every `--mat-sys-*` var Material defines (many, e.g.
 * per-component elevation/state-layer opacities, aren't part of the kit's
 * vocabulary and are intentionally left at Material's own defaults).
 */
export const MAT_SYS_MAP = {
  // Brand / primary action
  '--mat-sys-primary': 'color.brand',
  '--mat-sys-on-primary': 'color.brand-contrast',
  '--mat-sys-primary-container': 'color.brand-hover',
  '--mat-sys-on-primary-container': 'color.brand-contrast',
  '--mat-sys-inverse-primary': 'color.brand-hover',
  // Accent / secondary action
  '--mat-sys-secondary': 'color.accent',
  '--mat-sys-on-secondary': 'color.accent-contrast',
  '--mat-sys-secondary-container': 'color.surface-raised',
  '--mat-sys-on-secondary-container': 'color.ink',
  '--mat-sys-tertiary': 'color.accent',
  '--mat-sys-on-tertiary': 'color.accent-contrast',
  // Surfaces
  '--mat-sys-surface': 'color.surface',
  '--mat-sys-on-surface': 'color.ink',
  '--mat-sys-on-surface-variant': 'color.ink-muted',
  '--mat-sys-surface-container': 'color.surface-raised',
  '--mat-sys-surface-container-low': 'color.surface-raised',
  '--mat-sys-surface-container-high': 'color.surface-sunken',
  '--mat-sys-surface-container-highest': 'color.surface-sunken',
  '--mat-sys-surface-dim': 'color.surface-sunken',
  '--mat-sys-surface-bright': 'color.surface',
  '--mat-sys-inverse-surface': 'color.ink',
  '--mat-sys-inverse-on-surface': 'color.surface',
  '--mat-sys-background': 'color.surface',
  '--mat-sys-on-background': 'color.ink',
  // Structure
  '--mat-sys-outline': 'color.border',
  '--mat-sys-outline-variant': 'color.border-subtle',
  // Status
  '--mat-sys-error': 'color.danger',
  // `color.white` is a kit-private primitive (not a canonical role), carried
  // verbatim from the demo's original literal `var(--color-white)` mapping
  // for byte-parity (T8) — still routed through the same roleMap resolution
  // so a kit without a `color.white` id can override it.
  '--mat-sys-on-error': 'color.white',
  '--mat-sys-error-container': 'color.danger',
  '--mat-sys-on-error-container': 'color.white',
  // Shape (corner radii)
  '--mat-sys-corner-small': 'radius.control',
  '--mat-sys-corner-medium': 'radius.control',
  '--mat-sys-corner-large': 'radius.card',
  '--mat-sys-corner-extra-large': 'radius.card',
  '--mat-sys-corner-full': 'radius.pill',
}

const cssVarOf = (id) => '--' + String(id).split('.').join('-')

// Same shape as `@sorb/core`'s `resolveRole` — inlined per the promotion
// spec so this format has no hard runtime dependency on a core version that
// ships the role contract (see file header).
const resolveRoleId = (roleId, roleMap) => (roleMap && roleMap[roleId]) || roleId

/**
 * format: sorb/mat-sys-vars
 * Emits a CSS file that redeclares the mapped `--mat-sys-*` vars as
 * `var(--<kit-token>) !important` refs. `options.roleMap` (role id → kit
 * token id) lets a non-JJ kit reuse this format unmodified; defaults to the
 * canonical/JJ ids (identity resolution) when omitted.
 * @param {{dictionary: {allTokens: Array}, options?: {roleMap?: Record<string,string>}}} args
 * @returns {string} the generated CSS.
 */
export const sorbMatSysVars = ({ dictionary, options }) => {
  const roleMap = options && options.roleMap
  const byId = new Map(dictionary.allTokens.map((t) => [t.path.join('.'), t]))
  const lines = []
  const missing = []
  for (const [matVar, roleId] of Object.entries(MAT_SYS_MAP)) {
    const tokenId = resolveRoleId(roleId, roleMap)
    const t = byId.get(tokenId)
    if (!t) { missing.push(tokenId); continue }
    // !important is load-bearing here — see file header "Precedence findings".
    lines.push(`  ${matVar}: var(${cssVarOf(tokenId)}) !important;`)
  }
  if (missing.length) {
    console.warn(`  ⚠ sorb/mat-sys-vars: ${missing.length} unmapped token id(s) skipped: ` + missing.join(', '))
  }
  return (
    '/**\n' +
    ' * AUTO-GENERATED by Style Dictionary (sorb/mat-sys-vars) — do not edit.\n' +
    ' *\n' +
    ' * Remaps Angular Material\'s M3 system-variable layer onto the kit\n' +
    ' * vocabulary. Import AFTER the kit\'s own variables.css and AFTER Angular\n' +
    ' * Material\'s own theme styles so this :root block wins the cascade —\n' +
    ' * !important is required, not decorative (Angular Material\'s `mat.theme()`\n' +
    ' * mixin emits its own `html{}` rule whose order relative to this file is\n' +
    ' * not guaranteed across HMR/rebuild ordering; see this format\'s header\n' +
    ' * "Precedence findings").\n' +
    ' */\n' +
    ':root {\n' +
    lines.join('\n') +
    '\n}\n'
  )
}
