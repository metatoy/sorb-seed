// sorb/wp-theme-json — WordPress theme.json preset emit format
// (framework-targets-productization T9). Promoted verbatim from
// `sorb-demo-wordpress/sd-formats/wp-theme-json.js`.
//
// ⚠️ EXPERIMENTAL / STAGED — NOT formally included or supported yet
// (founder 2026-08-30). Built + round-trip-verified on the `feat/wordpress-target`
// branch, but deliberately NOT merged to main, NOT published in any @sorb/seed
// release, and NOT listed in the public README or the sorb-cloud dashboard.
// The `wordpress` TargetAdapter (sorb-leaf/src/targets/wordpress.js) is likewise
// staged. To formally ship: merge this branch, add the README snippet + the
// dashboard CONNECTOR_AXES entry, and cut the next seed/leaf release.
//
// STRUCTURAL format (like `sorb/tailwind-theme`): it routes tokens by their
// path structure and emits the WHOLE resolved tree — it does NOT map framework
// vars onto semantic roles the way the CSS-var formats do, so it takes no
// `options.roleMap` (any kit's full token tree emits correctly as-is).
//
// What it does: walks the resolved Style Dictionary token tree and emits a JSON
// fragment shaped like a WP theme.json `settings` block — but every leaf value
// is `var(--<kebab-token-id>)`, a reference to the SAME custom property the kit's
// own `variables.css` defines, never a resolved literal. WP's theme.json preset
// system compiles `settings.color.palette` into `--wp--preset--color--<slug>`
// (and `settings.custom` into `--wp--custom--<path>` recursively); if that value
// is itself `var(--color-brand)`, the WP preset variable becomes a pure
// indirection onto the kit variable. A live Sorb preview push only rewrites the
// kit's own `--color-brand` at `:root` — the WP preset vars follow automatically
// through the var() chain, with NO plugin override layer required. (Verified
// empirically in the sorb-demo-wordpress build; the theme's functions.php merges
// this fragment via the `wp_theme_json_data_theme` filter — note WP's
// `WP_Theme_JSON_Data::update_with()` needs a top-level `version` key or the
// merge silently no-ops.)
//
// Token routing:
//   color.*        -> settings.color.palette[]        (primitive + semantic color scales)
//   space.*        -> settings.spacing.spacingSizes[]
//   font.size.*    -> settings.typography.fontSizes[]
//   everything else-> settings.custom.<path>          (radius/shadow/typography roles +
//                     the whole component tier -> WP auto-generates
//                     --wp--custom--button--primary--bg--default etc.)

/** SD format id for the WordPress theme.json preset fragment. @type {string} */
export const SORB_WP_THEME_JSON = 'sorb/wp-theme-json'

function humanize(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function setDeep(obj, path, val) {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    cur[path[i]] = cur[path[i]] || {}
    cur = cur[path[i]]
  }
  cur[path[path.length - 1]] = val
}

/**
 * Emit a WP theme.json `settings` fragment where every preset leaf is a
 * `var(--<token>)` ref back onto the kit's own custom properties.
 * @param {{ dictionary: { allTokens: Array<{name: string, path: string[]}> } }} arg
 * @returns {string} pretty-printed JSON + trailing newline.
 */
export function sorbWpThemeJson({ dictionary }) {
  const paletteSlugs = new Set()
  const palette = []
  const spacingSizes = []
  const fontSizes = []
  const custom = {}

  for (const token of dictionary.allTokens) {
    const varRef = `var(--${token.name})`
    const path = token.path
    const top = path[0]

    if (top === 'color') {
      const slug = path.slice(1).join('-')
      if (slug && !paletteSlugs.has(slug)) {
        paletteSlugs.add(slug)
        palette.push({ slug, color: varRef, name: humanize(slug) })
      }
      continue
    }
    if (top === 'space') {
      const slug = path.slice(1).join('-')
      spacingSizes.push({ slug, size: varRef, name: slug })
      continue
    }
    if (top === 'font' && path[1] === 'size') {
      const slug = path.slice(2).join('-')
      fontSizes.push({ slug, size: varRef, name: humanize(slug) })
      continue
    }

    setDeep(custom, path, varRef)
  }

  const themeJsonFragment = {
    settings: {
      color: { palette },
      spacing: { spacingSizes },
      typography: { fontSizes },
      custom,
    },
  }

  return JSON.stringify(themeJsonFragment, null, 2) + '\n'
}
