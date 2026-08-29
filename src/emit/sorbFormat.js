// Sorb custom Style Dictionary outputs.
//
// The key piece of the token pipeline: a "resolved bindable map" that Sorb's
// bridge serves, capture annotates against, and the plugin syncs to Figma. One
// build, one map — this is what retires the runtime esbuild-eval resolver and
// fixes the "two token lists" problem.
//
// Promoted here from `sorb-demo/sd/sorb-format.js` (component-compat-roadmap
// P0, part 2) — these formats used to live copy-locally in the demo app.
// `@sorb/seed` is the shared home so target adapters (Tailwind/shadcn/
// Mantine/… per the roadmap) IMPORT these formats instead of copy-pasting
// them again. Pure functions of Style Dictionary's `{ dictionary, options }`
// shape — no dependency on `style-dictionary` itself, so this file has zero
// new deps for `@sorb/seed`. `sorb-demo/sd/sorb-format.js` now re-exports
// from here for back-compat.

/**
 * Derive the token tier from the source file a token came from.
 * @param {string} filePath
 * @returns {'primitive'|'semantic'|'component'|'unknown'}
 */
export const tierOfFile = (filePath = '') =>
  /primitive\./.test(filePath) ? 'primitive'
  : /semantic\./.test(filePath) ? 'semantic'
  : /component\./.test(filePath) ? 'component'
  // bs.json — the bootstrap-styled brand overlay. Classified as `semantic` (a
  // core-valid tier) so its `--bs-*` roles group + bind alongside the other
  // semantic roles rather than falling through to an unranked `unknown` tier.
  : /bs\./.test(filePath) ? 'semantic'
  : 'unknown'

export const SORB_RESOLVED = 'sorb/resolved-map'
export const SORB_THEME_NESTED = 'sorb/theme-nested'
export const SORB_ALIASES = 'sorb/aliases-css'
export const SORB_VERSIONS = 'sorb/versions'
export const SORB_SET_META = 'sorb/set-meta'
export const SORB_TAILWIND = 'sorb/tailwind-theme'
export const SORB_TAILWIND_V3 = 'sorb/tailwind-v3-preset'
export const SORB_TOKENSET = 'sorb/tokenset-esm'

// ─── set-level metadata parser ───────────────────────────────────────────────
// Per-set `$version` lives at each token file's root. SD merges all sources
// into one tree, so three root `$version` keys collide ("token collision")
// during merge — and per-set versions wouldn't survive anyway. This parser runs
// PER FILE before the merge: it lifts `$version` out (stashing it by file) and
// strips it from the tree, so the merge is clean and versions are preserved for
// the `sorb/versions` output. (A preprocessor runs post-merge — too late.)
const _setVersions = {}
export const sorbSetMeta = {
  name: SORB_SET_META,
  pattern: /\.json$/,
  parser: ({ filePath, contents }) => {
    const obj = JSON.parse(contents)
    if (obj.$version != null) {
      _setVersions[tierOfFile(filePath)] = obj.$version
      delete obj.$version
    }
    return obj
  },
}

/** format: sorb/versions — { primitive, semantic, component } → version. */
export const sorbVersions = () =>
  JSON.stringify(_setVersions, null, 2) + '\n'

const cssNameOf = (id) => '--' + String(id).split('.').join('-')

/**
 * format: sorb/resolved-map
 * Emits the bindable map: one entry per token. Schema:
 * { id, cssVar, value, tier, type } plus { deprecated, replacedBy } when set.
 */
/**
 * Flat **TokenSet** ESM module for `@sorb/leaf`'s `SorbProvider` — one entry per
 * token, keyed by the CSS-var name WITHOUT the leading `--` (leaf's `applyTokens`
 * re-adds it via `setProperty('--' + key, value)`). This is the committed token
 * set bundled into the app at build time:
 *   export const tokens = { 'color-action-primary': '#0f65ef', ... }
 * Same names/values as `variables.css` and `resolved.json` (one source, many
 * surfaces). Consumed by `main.jsx` / `src/sorbConfig.js`.
 */
export const sorbTokenSet = ({ dictionary }) => {
  const out = {}
  for (const t of dictionary.allTokens) {
    out[t.path.join('-')] = t.$value ?? t.value
  }
  return 'export const tokens = ' + JSON.stringify(out, null, 2) + '\n'
}

export const sorbResolved = ({ dictionary }) => {
  const deprecated = []
  const out = dictionary.allTokens.map((t) => {
    const entry = {
      id: t.path.join('.'), //            color.action.primary
      cssVar: '--' + t.path.join('-'), // --color-action-primary
      value: t.$value ?? t.value, //      resolved (refs followed); SD v4 DTCG → $value
      tier: tierOfFile(t.filePath), //    primitive | semantic | component
      type: t.$type ?? t.type, //         color | dimension | fontWeight | …
    }
    if (t.$deprecated) {
      entry.deprecated = true
      const rb = t.$extensions && t.$extensions.sorb && t.$extensions.sorb.replacedBy
      if (rb) entry.replacedBy = rb
      deprecated.push(entry.id + (rb ? ` → ${rb}` : ''))
    }
    return entry
  })
  if (deprecated.length) {
    console.warn(`  ⚠ ${deprecated.length} deprecated token(s): ` + deprecated.join(', '))
  }
  return JSON.stringify(out, null, 2) + '\n'
}

/**
 * format: sorb/aliases-css — legacy back-compat layer (migration window).
 * Reads `options.aliases` ({ legacyName: "new.dtcg.id" }) and emits
 *   --legacyName: var(--new-dtcg-id);
 * Each target is validated against the built tokens; unknown targets warn and
 * are skipped. Drop this platform once nothing references the legacy names.
 */
export const sorbAliases = ({ dictionary, options }) => {
  const aliases = (options && options.aliases) || {}
  const known = new Set(dictionary.allTokens.map((t) => t.path.join('.')))
  const lines = ['/* AUTO-GENERATED legacy alias layer — @deprecated, remove after migration. */', ':root {']
  const missing = []
  for (const legacy of Object.keys(aliases)) {
    if (legacy.startsWith('$')) continue // skip $comment / metadata keys
    const targetId = aliases[legacy]
    if (!known.has(targetId)) { missing.push(`${legacy} → ${targetId}`); continue }
    lines.push(`  --${legacy}: var(${cssNameOf(targetId)}); /* @deprecated → ${targetId} */`)
  }
  lines.push('}', '')
  if (missing.length) {
    console.warn(`  ⚠ aliases.json: ${missing.length} unknown target(s) skipped: ` + missing.join(', '))
  }
  return lines.join('\n')
}

/**
 * format: sorb/theme-nested
 * Emits a nested object of `var(--kebab, <fallback>)` strings so a
 * styled-components theme can read `theme.color.action.primary`. The fallback
 * is the committed value, so with no preview active rendering is unchanged.
 */
export const sorbThemeNested = ({ dictionary }) => {
  const root = {}
  for (const t of dictionary.allTokens) {
    const cssVar = '--' + t.path.join('-')
    let node = root
    for (let i = 0; i < t.path.length - 1; i++) {
      const k = t.path[i]
      node[k] = node[k] || {}
      node = node[k]
    }
    node[t.path[t.path.length - 1]] = `var(${cssVar}, ${t.$value ?? t.value})`
  }
  return (
    '// AUTO-GENERATED by Style Dictionary — do not edit.\n' +
    'export default ' +
    JSON.stringify(root, null, 2) +
    '\n'
  )
}

/**
 * Map one Sorb token to a Tailwind v4 `@theme` entry: { key, ref }.
 *
 * `key` is the theme variable name — its prefix picks the Tailwind utility
 * family (`--color-*`→bg/text/border, `--radius-*`→rounded, `--spacing-*`→
 * p/m/gap/w/h, `--text-*`→font-size, `--font-weight-*`→font weight). `ref` is
 * always `var(<the token's own --css-var>)` so the value stays a *reference* to
 * the same runtime-swappable var the bridge overrides — never a baked literal.
 * Because Sorb already names color vars `--color-*` (colliding with Tailwind's
 * own namespace), the format emits `@theme inline`, where Tailwind uses the ref
 * expression directly in utilities instead of redefining the key in `:root`.
 * @param {{path: string[], $type?: string, type?: string}} t
 * @returns {{key: string, ref: string}}
 */
export const tailwindThemeEntry = (t) => {
  const slug = t.path.join('-') //               color-action-primary | button-radius
  const ref = `var(--${slug})` //                points back at the Sorb css var
  const type = t.$type ?? t.type
  const strip = (re) => slug.replace(re, '').replace(/^-+|-+$/g, '')

  if (type === 'color') {
    // semantic/primitive already start with `color-`; component colors
    // (button-primary-bg-default) keep their full path under the color family.
    const name = slug.startsWith('color-') ? slug.slice('color-'.length) : slug
    return { key: `--color-${name}`, ref }
  }
  if (type === 'fontWeight') {
    return { key: `--font-weight-${strip(/font-weight-?/)}`, ref }
  }
  if (type === 'dimension') {
    if (t.path.includes('radius')) {
      // radius-100 → 100 ; button-radius → button  (→ rounded-100 / rounded-button)
      return { key: `--radius-${strip(/-?radius-?/) || 'DEFAULT'}`, ref }
    }
    if (t.path.includes('space') || t.path.includes('spacing')) {
      return { key: `--spacing-${strip(/space-?/)}`, ref }
    }
    if (t.path.includes('size')) {
      return { key: `--text-${strip(/font-size-?|size-?/)}`, ref }
    }
    return { key: `--spacing-${slug}`, ref } // unknown dimension → spacing family
  }
  return { key: `--sorb-${slug}`, ref } // anything else: registered, no utility family
}

/**
 * format: sorb/tailwind-theme
 * Emits a Tailwind v4 `@theme inline { … }` block — one entry per resolved
 * token, each value a `var(--token)` reference. Pair it with `variables.css`
 * (which defines those vars) so Tailwind utilities resolve through the exact
 * CSS vars the bridge swaps at runtime → live preview works with zero
 * Tailwind-specific bridge code. Duplicate theme keys are skipped (warned).
 */
export const sorbTailwind = ({ dictionary }) => {
  const seen = new Map() // key → originating token id (collision guard)
  const dupes = []
  const lines = []
  for (const t of dictionary.allTokens) {
    const { key, ref } = tailwindThemeEntry(t)
    const id = t.path.join('.')
    if (seen.has(key)) { dupes.push(`${key} (${seen.get(key)} vs ${id})`); continue }
    seen.set(key, id)
    lines.push(`  ${key}: ${ref};`)
  }
  if (dupes.length) {
    console.warn(`  ⚠ tailwind: ${dupes.length} duplicate theme key(s) skipped: ` + dupes.join(', '))
  }
  return (
    '/* AUTO-GENERATED by Style Dictionary (sorb/tailwind-theme) — do not edit.\n' +
    '   Tailwind v4 theme mapped onto Sorb\'s runtime CSS vars. Import order in your\n' +
    '   entry CSS:\n' +
    '       @import "tailwindcss";\n' +
    '       @import "./variables.css";       sorb tokens — the bridge swaps these live\n' +
    '       @import "./tailwind-theme.css";  this file\n' +
    '   `@theme inline` makes utilities reference var(--token) directly, so a\n' +
    '   POST /preview recolors Tailwind-classed elements with no extra code. */\n' +
    '@theme inline {\n' +
    lines.join('\n') +
    '\n}\n'
  )
}

/**
 * Classify one Sorb token into a Tailwind v3 `theme.extend` slot.
 * Returns the category (colors|borderRadius|spacing|fontSize|fontWeight), the
 * nested key path within it (Tailwind v3 flattens nested keys with `-`, so
 * `colors.action.primary` → utility `bg-action-primary`), and the var() ref.
 * Returns null for token types with no v3 utility family.
 * @param {{path: string[], $type?: string, type?: string}} t
 * @returns {{category: string, keyPath: string[], ref: string}|null}
 */
export const tailwindV3Slot = (t) => {
  const ref = `var(--${t.path.join('-')})`
  const type = t.$type ?? t.type
  const without = (seg) => t.path.filter((p) => p !== seg)

  if (type === 'color') {
    // strip a leading `color` segment (semantic/primitive); component colors keep full path
    const keyPath = t.path[0] === 'color' ? t.path.slice(1) : t.path.slice()
    return { category: 'colors', keyPath, ref }
  }
  if (type === 'fontWeight') {
    return { category: 'fontWeight', keyPath: t.path.filter((p) => p !== 'font' && p !== 'weight'), ref }
  }
  if (type === 'dimension') {
    if (t.path.includes('radius')) return { category: 'borderRadius', keyPath: without('radius'), ref }
    if (t.path.includes('space') || t.path.includes('spacing'))
      return { category: 'spacing', keyPath: t.path.filter((p) => p !== 'space' && p !== 'spacing'), ref }
    if (t.path.includes('size'))
      return { category: 'fontSize', keyPath: t.path.filter((p) => p !== 'font' && p !== 'size'), ref }
    return { category: 'spacing', keyPath: t.path.slice(), ref } // unknown dimension → spacing
  }
  return null // unknown type → no v3 utility family
}

/**
 * format: sorb/tailwind-v3-preset
 * Emits a Tailwind v3 **preset** (CommonJS) — `theme.extend.{colors,borderRadius,
 * spacing,fontSize,fontWeight}` whose leaves are `var(--token)` strings grouped by
 * tier/role. Consumer: `presets: [require('./tailwind-sorb-preset.cjs')]`. Same
 * live-preview behavior as v4 — utilities reference the runtime-swappable Sorb vars.
 */
export const sorbTailwindV3 = ({ dictionary }) => {
  const theme = { colors: {}, borderRadius: {}, spacing: {}, fontSize: {}, fontWeight: {} }
  const skipped = []
  for (const t of dictionary.allTokens) {
    const slot = tailwindV3Slot(t)
    if (!slot) { skipped.push(t.path.join('.')); continue }
    let node = theme[slot.category]
    for (let i = 0; i < slot.keyPath.length - 1; i++) {
      const k = slot.keyPath[i]
      node[k] = node[k] || {}
      node = node[k]
    }
    node[slot.keyPath[slot.keyPath.length - 1]] = slot.ref
  }
  if (skipped.length) {
    console.warn(`  ⚠ tailwind-v3: ${skipped.length} token(s) with no v3 family skipped: ` + skipped.join(', '))
  }
  return (
    '// AUTO-GENERATED by Style Dictionary (sorb/tailwind-v3-preset) — do not edit.\n' +
    '// Tailwind v3 preset of var(--token) refs from Sorb\'s resolved map. Usage:\n' +
    '//   presets: [require(\'./tailwind-sorb-preset.cjs\')]\n' +
    '// Import variables.css globally so the vars resolve; the bridge swaps them live.\n' +
    'module.exports = ' +
    JSON.stringify({ theme: { extend: theme } }, null, 2) +
    '\n'
  )
}
