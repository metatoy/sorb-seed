// Sorb Mantine v7 CSS-var override format (`sorb/mantine-vars`).
//
// PROMOTED from `sorb-demo-mantine/sd/mantine-format.js` (P2 spike →
// framework-targets-productization T2, first of the six JJ-demo formats to
// graduate into `@sorb/seed`). The demo file stays in place for now (T8
// retrofit is founder-gated); this is the canonical, generalized home.
//
// GENERALIZATION (T0 semantic-role contract): the spike hardcoded Janes
// Jeans' own token ids as the map's left-hand column. Promotion makes that
// column ROLE-RESOLVED — a non-JJ kit passes `options.roleMap` (role id →
// its own token id) instead of forking this file. Resolution is the same
// shape as `@sorb/core`'s `resolveRole` (see `sorb-core/src/index.js`
// `DEFAULT_ROLE_IDS`/`resolveRole`), inlined here rather than imported so
// this format degrades gracefully against an older published `@sorb/core`
// that predates the role contract (same feature-detect posture as the
// TargetAdapter registration side — see `sorb-leaf/src/targets/mantine.js`).
// Not every key below is one of `@sorb/core`'s canonical `DEFAULT_ROLE_IDS`
// — several (`button.primary.bg.*`, `button.radius`, `card.radius`) are
// Janes-Jeans component-tier ids with no canonical role counterpart yet
// (kit-private, per the productization spec's "contract scope = the union
// of the six maps' role columns, not a kit's full token tree"). They still
// go through the same `roleMap` resolution for consistency and so a kit
// that DOES want to override them can.
//
// The `--mantine-*` right-hand column is Mantine's own documented CSS
// surface — universal, and stays baked (not role-resolved).
//
// PRECEDENCE FINDINGS (carried verbatim from the P2 spike header — this is
// the load-bearing reason every declaration below is `!important`, so don't
// drop it in a future edit): Mantine's OWN core stylesheet declares these
// vars on `:root[data-mantine-color-scheme="light"]` — an attribute-selector
// rule, specificity (0,2,0) — and `MantineProvider` injects that stylesheet
// as a runtime `<style>` tag whose position in `<head>` is NOT guaranteed to
// precede ours. A first attempt used `:where(html) { ... }`, which carries
// ZERO specificity by definition and lost outright (confirmed via Playwright:
// overriding the underlying Sorb var had no effect on the Button's computed
// background). The fix is a plain `:root` block with `!important` on every
// declaration — `!important` author declarations win over normal-importance
// declarations regardless of specificity or source order, which is exactly
// the guarantee needed against a dynamically-injected, order-unstable
// stylesheet. Zero-dep, zero-JS (Mechanism A): a static CSS file of `var()`
// refs, reacting to a live bridge push the same way `variables.css` already
// does.

export const SORB_MANTINE_VARS = 'sorb/mantine-vars'

/**
 * role id (JJ id when unmapped) → Mantine CSS var name.
 * Left side is resolved through `options.roleMap` at format time (identity
 * when the kit uses these ids directly — the JJ reference); right side is
 * the Mantine v7 documented variable it overrides.
 */
export const MANTINE_VAR_MAP = {
  'color.surface': '--mantine-color-body',
  'color.ink': '--mantine-color-text',
  'color.ink-muted': '--mantine-color-placeholder',
  'color.brand': '--mantine-color-anchor',
  'color.danger': '--mantine-color-error',
  'color.border': '--mantine-default-border-color',

  'button.primary.bg.default': '--mantine-primary-color-filled',
  'button.primary.bg.hover': '--mantine-primary-color-filled-hover',

  'color.surface-raised': '--mantine-primary-color-light',
  'color.surface-sunken': '--mantine-primary-color-light-hover',

  'radius.control': '--mantine-radius-default',
  'button.radius': '--mantine-radius-md',
  'card.radius': '--mantine-radius-lg',
  'radius.pill': '--mantine-radius-xl',
}

const cssVarOf = (id) => '--' + String(id).split('.').join('-')

// Same shape as `@sorb/core`'s `resolveRole` — inlined per the promotion
// spec so this format has no hard runtime dependency on a core version that
// ships the role contract (see file header).
const resolveRoleId = (roleId, roleMap) => (roleMap && roleMap[roleId]) || roleId

/**
 * format: sorb/mantine-vars
 * Emits a CSS file that redeclares the mapped `--mantine-*` vars as
 * `var(--<kit-token>) !important` refs. `options.roleMap` (role id → kit
 * token id) lets a non-JJ kit reuse this format unmodified; defaults to the
 * canonical/JJ ids (identity resolution) when omitted.
 * @param {{dictionary: {allTokens: Array}, options?: {roleMap?: Record<string,string>}}} args
 * @returns {string} the generated CSS.
 */
export const sorbMantineVars = ({ dictionary, options }) => {
  const roleMap = options && options.roleMap
  const byId = new Map(dictionary.allTokens.map((t) => [t.path.join('.'), t]))
  const lines = []
  const missing = []
  for (const [roleId, mantineVar] of Object.entries(MANTINE_VAR_MAP)) {
    const tokenId = resolveRoleId(roleId, roleMap)
    const t = byId.get(tokenId)
    if (!t) { missing.push(tokenId); continue }
    // !important is load-bearing here — see file header "Precedence findings".
    lines.push(`  ${mantineVar}: var(${cssVarOf(tokenId)}) !important;`)
  }
  if (missing.length) {
    console.warn(`  ⚠ sorb/mantine-vars: ${missing.length} unmapped token id(s) skipped: ` + missing.join(', '))
  }
  return (
    '/* AUTO-GENERATED by Style Dictionary (sorb/mantine-vars) — do not edit.\n' +
    '   Overrides Mantine v7 core CSS vars with var(--token) refs so a Sorb bridge\n' +
    '   push re-themes Mantine components with zero component-level code changes.\n' +
    '   !important is required — see this format\'s header "Precedence findings":\n' +
    '   Mantine\'s :root[data-mantine-color-scheme] rule otherwise wins regardless\n' +
    '   of this file\'s load order (its <style> is injected by MantineProvider at\n' +
    '   runtime, not statically ordered in <head>). */\n' +
    ':root {\n' +
    lines.join('\n') +
    '\n}\n'
  )
}
