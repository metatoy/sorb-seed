// Sorb shadcn/ui theme format (`sorb/shadcn-theme`) — framework-targets-
// productization T1 (Tailwind v4 + shadcn/ui).
//
// Promoted from `sorb-demo-tailwind/src/tokens/shadcn-map.css` +
// `shadcn-theme.css` (hand-authored source material) into ONE generated CSS
// artifact: shadcn's conventional `:root{}` var map (--background,
// --primary, …) chained onto Sorb's own tokens via the T0 semantic-role
// contract, plus the `@theme inline{}` Tailwind-utility binding block
// (including the `calc()` radius scale). Zero `style-dictionary` dep — pure
// function of `{ dictionary, options }`, matching `sorbFormat.js`'s
// conventions.
//
// Every leaf is a `var(--<kebab>)` reference (live-preview invariant) — the
// bridge's runtime var-swap re-themes shadcn components with no
// shadcn-specific bridge code.

/** @type {'sorb/shadcn-theme'} */
export const SORB_SHADCN = 'sorb/shadcn-theme'

/**
 * Resolve a canonical role id to the kit's actual token id via an optional
 * override map — inlined one-liner matching `@sorb/core`'s `resolveRole`
 * (T0). Kept local rather than imported so `@sorb/seed` doesn't take a
 * runtime dep on a specific `@sorb/core` version (formats are plain
 * functions; the published core can lag the connector contract).
 * @param {string} roleId
 * @param {Record<string,string>} [roleMap]
 * @returns {string}
 */
const resolveShadcnRole = (roleId, roleMap) => (roleMap && roleMap[roleId]) || roleId

const cssVarOf = (tokenId) => '--' + String(tokenId).split('.').join('-')

// shadcn CSS var → canonical role id (DEFAULT_ROLE_IDS.color / .radius from
// `@sorb/core`). Order matches the hand-authored `shadcn-map.css` for a
// clean round-trip diff.
const SHADCN_COLOR_ROLE_MAP = [
  ['--background', 'color.surface'],
  ['--foreground', 'color.ink'],
  ['--card', 'color.surface'],
  ['--card-foreground', 'color.ink'],
  ['--popover', 'color.surface'],
  ['--popover-foreground', 'color.ink'],
  ['--primary', 'color.brand'],
  ['--primary-foreground', 'color.brand-contrast'],
  ['--secondary', 'color.surface-raised'],
  ['--secondary-foreground', 'color.ink'],
  ['--muted', 'color.surface-sunken'],
  ['--muted-foreground', 'color.ink-muted'],
  ['--accent', 'color.accent'],
  ['--accent-foreground', 'color.accent-contrast'],
  ['--destructive', 'color.danger'],
  ['--border', 'color.border'],
  ['--input', 'color.border'],
  ['--ring', 'color.focus-ring'],
]

// ROLE-CONTRACT GAP (flagged, not invented — framework-targets-
// productization T1 note): shadcn's `--destructive-foreground` wants "the
// ink color that reads on top of --destructive". `@sorb/core`'s
// `DEFAULT_ROLE_IDS` only defines `-contrast` roles for brand/accent, not
// danger — there is no canonical `color.danger-contrast`. Rather than invent
// one unilaterally, this references the kit's raw `color.white` primitive
// (matches the JJ demo's hand-authored value) directly — NOT run through
// `options.roleMap`, since it isn't a role id. A kit without a `color.white`
// token overrides via `options.destructiveForeground`.
const DESTRUCTIVE_FOREGROUND_DEFAULT = 'color.white'

// `--radius` role — the one non-color entry in the `:root{}` map.
const RADIUS_ROLE_DEFAULT = 'radius.control'

// `@theme inline{}` block: purely mechanical — chains Tailwind's `--color-*`
// theme keys onto the shadcn vars defined above (never onto Sorb token ids
// directly), plus the fixed `calc()` radius scale. Independent of roleMap.
const THEME_INLINE_COLOR_ENTRIES = [
  ['--color-background', '--background'],
  ['--color-foreground', '--foreground'],
  ['--color-card', '--card'],
  ['--color-card-foreground', '--card-foreground'],
  ['--color-popover', '--popover'],
  ['--color-popover-foreground', '--popover-foreground'],
  ['--color-primary', '--primary'],
  ['--color-primary-foreground', '--primary-foreground'],
  ['--color-secondary', '--secondary'],
  ['--color-secondary-foreground', '--secondary-foreground'],
  ['--color-muted', '--muted'],
  ['--color-muted-foreground', '--muted-foreground'],
  ['--color-accent', '--accent'],
  ['--color-accent-foreground', '--accent-foreground'],
  ['--color-destructive', '--destructive'],
  ['--color-destructive-foreground', '--destructive-foreground'],
  ['--color-border', '--border'],
  ['--color-input', '--input'],
  ['--color-ring', '--ring'],
]

/**
 * Build the `:root{}` shadcn-var → Sorb-token map, resolving roles through
 * `options.roleMap` (defaulting to identity — the JJ reference kit already
 * uses canonical role ids).
 * @param {{roleMap?: Record<string,string>, destructiveForeground?: string, radiusRole?: string}} [options]
 * @param {Set<string>} [knownTokenIds]  when provided, unknown resolved ids are warned (not skipped — CSS still emits, just points at an undefined var).
 * @returns {string[]} lines
 */
export const shadcnRootLines = (options = {}, knownTokenIds) => {
  const { roleMap, destructiveForeground, radiusRole } = options
  const missing = []
  const resolve = (roleId) => resolveShadcnRole(roleId, roleMap)
  const checkAndVar = (tokenId, roleId) => {
    if (knownTokenIds && !knownTokenIds.has(tokenId)) missing.push(`${roleId} → ${tokenId}`)
    return `var(${cssVarOf(tokenId)})`
  }

  const lines = []
  for (const [shadcnVar, roleId] of SHADCN_COLOR_ROLE_MAP) {
    const tokenId = resolve(roleId)
    lines.push(`  ${shadcnVar}: ${checkAndVar(tokenId, roleId)};`)
    if (shadcnVar === '--destructive') {
      // --destructive-foreground has no canonical role (see the
      // ROLE-CONTRACT GAP note above) — emitted right after --destructive to
      // match the hand-authored `shadcn-map.css` ordering byte-for-byte.
      const destructiveFgId = destructiveForeground || DESTRUCTIVE_FOREGROUND_DEFAULT
      lines.push(`  --destructive-foreground: ${checkAndVar(destructiveFgId, '(non-role) destructiveForeground')};`)
    }
  }
  const radiusId = resolve(radiusRole || RADIUS_ROLE_DEFAULT)
  lines.push(`  --radius: ${checkAndVar(radiusId, radiusRole || RADIUS_ROLE_DEFAULT)};`)

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(`  ⚠ sorb/shadcn-theme: ${missing.length} unresolved token id(s): ` + missing.join(', '))
  }
  return lines
}

/** The fixed `@theme inline{}` block lines (mechanical; no roleMap input). */
export const shadcnThemeInlineLines = () => {
  const lines = THEME_INLINE_COLOR_ENTRIES.map(([key, ref]) => `  ${key}: var(${ref});`)
  lines.push(
    '  --radius-sm: calc(var(--radius) - 4px);',
    '  --radius-md: calc(var(--radius) - 2px);',
    '  --radius-lg: var(--radius);',
    '  --radius-xl: calc(var(--radius) + 4px);',
  )
  return lines
}

/**
 * format: sorb/shadcn-theme
 * Emits ONE CSS artifact: shadcn's `:root{}` semantic-var map (chained onto
 * Sorb tokens via the role contract) followed by the `@theme inline{}`
 * Tailwind-utility binding block — reproducing what
 * `sorb-demo-tailwind/src/tokens/shadcn-map.css` + `shadcn-theme.css` hand-
 * authored. Pair with `variables.css` (defines the Sorb vars this format
 * references) in the consumer's CSS import order:
 *   @import "tailwindcss";
 *   @import "./variables.css";     sorb tokens — the bridge swaps these live
 *   @import "./shadcn-theme.css";  this file
 * @param {{dictionary: {allTokens: Array<{path: string[]}>}, options?: {roleMap?: Record<string,string>, destructiveForeground?: string, radiusRole?: string}}} args
 * @returns {string}
 */
export const sorbShadcn = ({ dictionary, options } = {}) => {
  const known = dictionary && Array.isArray(dictionary.allTokens)
    ? new Set(dictionary.allTokens.map((t) => t.path.join('.')))
    : undefined

  const rootLines = shadcnRootLines(options || {}, known)
  const themeLines = shadcnThemeInlineLines()

  return (
    '/* AUTO-GENERATED by Style Dictionary (sorb/shadcn-theme) — do not edit.\n' +
    '   shadcn/ui semantic-var map, chained onto Sorb\'s runtime CSS vars via the\n' +
    '   semantic-role contract (@sorb/core DEFAULT_ROLE_IDS), plus the `@theme\n' +
    '   inline` Tailwind-utility bindings shadcn components read (bg-primary,\n' +
    '   text-foreground, border-input, …). Import order in your entry CSS:\n' +
    '       @import "tailwindcss";\n' +
    '       @import "./variables.css";     sorb tokens — the bridge swaps these live\n' +
    '       @import "./shadcn-theme.css";  this file */\n' +
    ':root {\n' +
    rootLines.join('\n') +
    '\n}\n\n' +
    '@theme inline {\n' +
    themeLines.join('\n') +
    '\n}\n'
  )
}
