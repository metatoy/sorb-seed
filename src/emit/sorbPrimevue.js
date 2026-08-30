// Sorb PrimeVue v4 preset format (`sorb/primevue-preset`).
//
// PROMOTED from `sorb-demo-primevue/src/jjPreset.js` (P4/P4a spike →
// framework-targets-productization T4, first of the six JJ-demo formats that
// is a JS-EMITTING target rather than a CSS one). The demo file stays in
// place for now (T8 retrofit is founder-gated); this is the canonical,
// generalized home.
//
// MECHANISM (carried from the spike): a `definePreset` leaf value that is a
// plain string (not one of PrimeVue's own `{a.b.c}` refs) is written VERBATIM
// as the corresponding `--p-*` custom property's value. `var(--kebab-token)`
// strings therefore make every `--p-*` var a pure indirection onto the kit's
// own CSS vars — a Sorb bridge push re-themes PrimeVue with zero
// component-level code changes. Two override tiers, same as the spike:
//   1. SEMANTIC tier — a small set of roots (`primary`, `text`, `content`,
//      `formField`, `navigation.item`, `overlay.*`, `colorScheme.light.surface`)
//      that most PrimeVue components read from, so overriding them re-themes
//      Card/InputText/Select/Dialog/Toast/Tabs/… all at once.
//   2. COMPONENT tier — overrides for components that read straight from the
//      PrimeVue PRIMITIVE palette instead of a semantic root (severity-colored
//      Tag/Toast) or need an explicit per-component override (Menubar's
//      brand-colored bar — the kit's `nav.*` tokens are a deliberately
//      different color story than `content`/`surface`).
//
// RISK (framework-targets-productization risk table, T4): the emitted
// module's `import { definePreset } from '@primeuix/themes'` (+ the base
// preset import, e.g. `@primeuix/themes/aura`) is a PEER EXPECTATION — this
// format does not install or vendor `@primeuix/themes`; the consuming app's
// own bundler/dependency tree must already have it (any PrimeVue v4 app
// does). `new Function`/eval can't prove this module resolves for real (no
// `@primeuix/themes` in this package's — or even the consumer's CI —
// test env); it only proves the emitted source is syntactically the right
// shape. The real bundler path is proven by the T8 demo retrofit, not this
// format's test. Document this in the adapter/README snippet too.
//
// GENERALIZATION (T0 semantic-role contract): the spike hardcoded Janes
// Jeans' own token ids as every leaf. Promotion makes every leaf
// ROLE-RESOLVED — a non-JJ kit passes `options.roleMap` (role id → its own
// token id) instead of forking this file. Resolution is the same shape as
// `@sorb/core`'s `resolveRole`/`DEFAULT_ROLE_IDS`, inlined here rather than
// imported so this format degrades gracefully against an older published
// `@sorb/core` that predates the role contract (same feature-detect posture
// as the TargetAdapter registration side — see
// `sorb-leaf/src/targets/primevue.js`). None of the role ids below are in
// `@sorb/core`'s canonical `DEFAULT_ROLE_IDS` (JJ's component-tier ids —
// `button.primary.bg.default`, `card.bg`, `nav.bg`, `toast.bg.success`, …
// have no canonical counterpart yet; they're kit-private, per the
// productization spec's "contract scope = the union of the six maps' role
// columns, not a kit's full token tree"). They still go through the same
// `roleMap` resolution for consistency, and so a kit that DOES want to
// override them can.
//
// `options.basePreset` (default `'Aura'`) controls BOTH the base-theme
// import (`@primeuix/themes/<lowercased-name>`) and the `definePreset(<Name>,
// …)` call's first argument — PrimeVue v4 ships `Aura`/`Material`/`Lara`/
// `Nora` as documented base presets, each importable the same way.

export const SORB_PRIMEVUE_PRESET = 'sorb/primevue-preset'

/**
 * Structural role tree describing the PrimeVue `definePreset` shape this
 * format generates, mirroring `jjPreset.js`'s hand-authored nesting exactly.
 * Every leaf is a role id (a dot-path token id, canonical-or-JJ) resolved
 * through `options.roleMap` before becoming a `var(--kebab-id)` ref.
 */
export const PRIMEVUE_ROLE_TREE = {
  semantic: {
    primary: {
      color: 'button.primary.bg.default',
      hoverColor: 'button.primary.bg.hover',
      activeColor: 'button.primary.bg.hover',
      contrastColor: 'button.primary.fg.default',
    },
    text: {
      color: 'color.ink',
      hoverColor: 'color.ink',
      mutedColor: 'color.ink-muted',
      hoverMutedColor: 'color.ink-muted',
    },
    content: {
      background: 'card.bg',
      hoverBackground: 'color.surface-raised',
      borderColor: 'card.border',
      color: 'color.ink',
      hoverColor: 'color.ink',
      borderRadius: 'card.radius',
    },
    formField: {
      background: 'input.bg.default',
      disabledBackground: 'input.bg.disabled',
      filledBackground: 'input.bg.default',
      filledHoverBackground: 'input.bg.default',
      filledFocusBackground: 'input.bg.default',
      borderColor: 'input.border.default',
      hoverBorderColor: 'input.border.default',
      focusBorderColor: 'input.border.focus',
      invalidBorderColor: 'input.border.invalid',
      color: 'input.fg',
      disabledColor: 'color.ink-muted',
      placeholderColor: 'input.placeholder',
      invalidPlaceholderColor: 'input.placeholder',
      borderRadius: 'input.radius',
    },
    navigation: {
      item: {
        activeColor: 'nav.link-active',
        focusColor: 'nav.link-active',
      },
    },
    overlay: {
      select: { background: 'card.bg', borderColor: 'card.border', color: 'color.ink' },
      popover: { background: 'card.bg', borderColor: 'card.border', color: 'color.ink' },
      modal: { background: 'card.bg', borderColor: 'card.border', color: 'color.ink' },
    },
    colorScheme: {
      light: {
        surface: {
          50: 'color.surface-raised',
          100: 'color.surface-raised',
          200: 'color.surface-sunken',
          300: 'color.border',
        },
      },
    },
  },
  components: {
    // The brand-colored top bar — the one place the kit's nav.* tokens
    // (distinct from the content/surface story used everywhere else) apply.
    menubar: {
      colorScheme: {
        light: {
          root: { background: 'nav.bg', borderColor: 'nav.bg', color: 'nav.fg' },
          item: {
            color: 'nav.fg',
            focusColor: 'nav.link-active',
            activeColor: 'nav.link-active',
            icon: { color: 'nav.fg-muted', focusColor: 'nav.link-active', activeColor: 'nav.link-active' },
          },
        },
      },
    },
    // Toast severities: success/danger/info only (no "warn" — PrimeVue's
    // default stays themed by the semantic content/text overrides above).
    toast: {
      colorScheme: {
        light: {
          success: { background: 'toast.bg.success', color: 'toast.fg', borderColor: 'toast.bg.success' },
          error: { background: 'toast.bg.danger', color: 'toast.fg', borderColor: 'toast.bg.danger' },
          info: { background: 'toast.bg.info', color: 'toast.fg', borderColor: 'toast.bg.info' },
        },
      },
    },
  },
}

const cssVarOf = (id) => '--' + String(id).split('.').join('-')

// Same shape as `@sorb/core`'s `resolveRole` — inlined per the promotion
// spec so this format has no hard runtime dependency on a core version that
// ships the role contract (see file header).
const resolveRoleId = (roleId, roleMap) => (roleMap && roleMap[roleId]) || roleId

/**
 * Recursively walk `PRIMEVUE_ROLE_TREE` (or a subtree), resolving each leaf
 * role id through `roleMap` and, when `known` is supplied, dropping any leaf
 * whose resolved token id isn't in the dictionary (skip-missing, same
 * posture as `sorbMantineVars` — a partial kit still emits a valid, if
 * smaller, preset rather than a broken var() ref). Empty objects left behind
 * by an all-missing branch are pruned too.
 * @param {*} node
 * @param {Set<string>|undefined} known
 * @param {Record<string,string>|undefined} roleMap
 * @param {string[]} missing  accumulator for unresolved role ids (mutated)
 * @returns {*}
 */
const buildPresetNode = (node, known, roleMap, missing) => {
  if (typeof node === 'string') {
    const tokenId = resolveRoleId(node, roleMap)
    if (known && !known.has(tokenId)) {
      missing.push(tokenId)
      return undefined
    }
    return `var(${cssVarOf(tokenId)})`
  }
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    const resolved = buildPresetNode(value, known, roleMap, missing)
    if (resolved === undefined) continue
    if (typeof resolved === 'object' && Object.keys(resolved).length === 0) continue
    out[key] = resolved
  }
  return out
}

const BASE_PRESET_IMPORTS = {
  Aura: '@primeuix/themes/aura',
  Material: '@primeuix/themes/material',
  Lara: '@primeuix/themes/lara',
  Nora: '@primeuix/themes/nora',
}

/**
 * format: sorb/primevue-preset
 * Emits a JS/ESM module string:
 *   import { definePreset } from '@primeuix/themes';
 *   import Aura from '@primeuix/themes/aura';
 *   export const preset = definePreset(Aura, { semantic: {...}, components: {...} });
 * Every leaf is a `var(--kebab-token-id)` string — the live-preview
 * invariant, same as every other Sorb format (no baked literals). Pure
 * function of `{dictionary, options}`; zero `style-dictionary` dep.
 * @param {{dictionary: {allTokens: Array}, options?: {roleMap?: Record<string,string>, basePreset?: string}}} args
 * @returns {string} the generated ESM module source.
 */
export const sorbPrimevuePreset = ({ dictionary, options }) => {
  const roleMap = options && options.roleMap
  const basePreset = (options && options.basePreset) || 'Aura'
  const known = new Set((dictionary.allTokens || []).map((t) => t.path.join('.')))
  const missing = []

  const semantic = buildPresetNode(PRIMEVUE_ROLE_TREE.semantic, known, roleMap, missing)
  const components = buildPresetNode(PRIMEVUE_ROLE_TREE.components, known, roleMap, missing)

  if (missing.length) {
    console.warn(`  ⚠ sorb/primevue-preset: ${missing.length} unmapped token id(s) skipped: ` + missing.join(', '))
  }

  const basePresetImport = BASE_PRESET_IMPORTS[basePreset] || `@primeuix/themes/${String(basePreset).toLowerCase()}`
  const presetBody = JSON.stringify({ semantic, components }, null, 2)

  return (
    '// AUTO-GENERATED by Style Dictionary (sorb/primevue-preset) — do not edit.\n' +
    '// PEER EXPECTATION: this module imports `@primeuix/themes` (+ its base preset\n' +
    '// subpath) — install it in the consuming app; this format neither installs nor\n' +
    '// vendors it. See sorb-seed/src/emit/sorbPrimevue.js header "RISK".\n' +
    `import { definePreset } from '@primeuix/themes';\n` +
    `import ${basePreset} from '${basePresetImport}';\n` +
    '\n' +
    `export const preset = definePreset(${basePreset}, ` + presetBody + ');\n'
  )
}
