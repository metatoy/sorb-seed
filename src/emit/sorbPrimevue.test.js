// Tests for the Sorb PrimeVue v4 preset format (`sorb/primevue-preset`) — the
// first JS-EMITTING target format (the others emit CSS). `@primeuix/themes`
// isn't installed in this package's test env (it's a peer expectation of the
// EMITTED module, not a dep of `@sorb/seed` — see the format's file header),
// so these tests can't `import()` the real output. Instead they (a) assert
// the raw source string's shape by regex, and (b) `new Function`-evaluate a
// transformed copy (imports stripped, `definePreset`/base preset stubbed) to
// prove the object-literal body is syntactically valid and structurally
// correct — the same "prove it evaluates" spirit as sorbFormat.test.js's
// `new Function('module','exports', src)` check, adapted for ESM `import`/
// `export` syntax that `new Function` cannot parse directly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_PRIMEVUE_PRESET, PRIMEVUE_ROLE_TREE, sorbPrimevuePreset } from './sorbPrimevue.js'

// Helper: a fabricated dictionary of resolved tokens, keyed by dot-path id.
const tok = (id) => ({ path: id.split('.') })
const dictOf = (ids) => ({ allTokens: ids.map(tok) })

// Every role id referenced anywhere in PRIMEVUE_ROLE_TREE, flattened.
const flattenRoleIds = (node, out = []) => {
  if (typeof node === 'string') { out.push(node); return out }
  for (const v of Object.values(node)) flattenRoleIds(v, out)
  return out
}
const ALL_ROLE_IDS = flattenRoleIds(PRIMEVUE_ROLE_TREE)

// Evaluate the object-literal body of an emitted module: strip the `import`
// lines and the `export const preset = definePreset(Base, ` … `);` wrapper,
// then run the remaining `{ ... }` object literal through `new Function` with
// no external bindings needed (it's pure data — strings only).
const evalPresetBody = (src) => {
  const withoutImports = src.replace(/^import .*$/gm, '')
  const match = withoutImports.match(/export const preset = definePreset\(\w+, ([\s\S]*)\);\s*$/)
  assert.ok(match, 'module source must match the definePreset(Base, {...}); shape')
  return new Function(`return (${match[1]})`)()
}

test('format name constant is the documented id', () => {
  assert.equal(SORB_PRIMEVUE_PRESET, 'sorb/primevue-preset')
})

test('emits the documented import lines + definePreset(Aura, ...) call by default', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary })
  assert.match(src, /^import \{ definePreset \} from '@primeuix\/themes';$/m)
  assert.match(src, /^import Aura from '@primeuix\/themes\/aura';$/m)
  assert.match(src, /^export const preset = definePreset\(Aura, \{/m)
  assert.match(src, /\}\);\s*$/)
})

test('every leaf is a var() reference, never a baked literal (live-preview invariant)', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary })
  const preset = evalPresetBody(src)
  const leaves = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : leaves(v)))
  const values = [...leaves(preset.semantic), ...leaves(preset.components)]
  assert.ok(values.length > 0)
  for (const val of values) assert.match(val, /^var\(--[a-z0-9-]+\)$/)
})

test('semantic tier matches jjPreset.js structure/values exactly (identity roleMap)', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary })
  const preset = evalPresetBody(src)
  assert.equal(preset.semantic.primary.color, 'var(--button-primary-bg-default)')
  assert.equal(preset.semantic.primary.contrastColor, 'var(--button-primary-fg-default)')
  assert.equal(preset.semantic.text.mutedColor, 'var(--color-ink-muted)')
  assert.equal(preset.semantic.content.borderRadius, 'var(--card-radius)')
  assert.equal(preset.semantic.formField.focusBorderColor, 'var(--input-border-focus)')
  assert.equal(preset.semantic.navigation.item.activeColor, 'var(--nav-link-active)')
  assert.equal(preset.semantic.overlay.popover.background, 'var(--card-bg)')
  assert.equal(preset.semantic.colorScheme.light.surface['200'], 'var(--color-surface-sunken)')
})

test('component tier (Menubar/Toast reading the primitive palette) matches jjPreset.js', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary })
  const preset = evalPresetBody(src)
  assert.equal(preset.components.menubar.colorScheme.light.root.background, 'var(--nav-bg)')
  assert.equal(preset.components.menubar.colorScheme.light.item.icon.color, 'var(--nav-fg-muted)')
  assert.equal(preset.components.toast.colorScheme.light.success.background, 'var(--toast-bg-success)')
  assert.equal(preset.components.toast.colorScheme.light.error.borderColor, 'var(--toast-bg-danger)')
  assert.equal(preset.components.toast.colorScheme.light.info.color, 'var(--toast-fg)')
})

test('options.roleMap remaps the role-id column without forking the format', () => {
  const roleMap = {
    'button.primary.bg.default': 'kit.primary',
    'color.ink': 'kit.text',
  }
  const dictionary = dictOf(['kit.primary', 'kit.text', ...ALL_ROLE_IDS.filter((id) => id !== 'button.primary.bg.default' && id !== 'color.ink')])
  const src = sorbPrimevuePreset({ dictionary, options: { roleMap } })
  const preset = evalPresetBody(src)
  assert.equal(preset.semantic.primary.color, 'var(--kit-primary)')
  assert.equal(preset.semantic.text.color, 'var(--kit-text)')
  // unmapped roles fall back to their canonical/default id
  assert.equal(preset.semantic.text.mutedColor, 'var(--color-ink-muted)')
})

test('options.basePreset swaps both the base import and the definePreset() base arg', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary, options: { basePreset: 'Lara' } })
  assert.match(src, /^import Lara from '@primeuix\/themes\/lara';$/m)
  assert.match(src, /^export const preset = definePreset\(Lara, \{/m)
})

test('an unmapped/missing token id is skipped, not emitted as a broken var() ref', () => {
  // Only supply the tokens for the `primary` subtree; everything else absent.
  const dictionary = dictOf([
    'button.primary.bg.default',
    'button.primary.bg.hover',
    'button.primary.fg.default',
  ])
  const src = sorbPrimevuePreset({ dictionary })
  const preset = evalPresetBody(src)
  assert.equal(preset.semantic.primary.color, 'var(--button-primary-bg-default)')
  // text/content/formField/etc never had their tokens present → pruned away
  assert.equal(preset.semantic.text, undefined)
  assert.equal(preset.components.menubar, undefined)
})

test('emitted module source contains no baked literal — only var(--kebab) leaves', () => {
  const dictionary = dictOf(ALL_ROLE_IDS)
  const src = sorbPrimevuePreset({ dictionary })
  // Every quoted string value in the object body must be a var() ref.
  const stringValues = [...src.matchAll(/: "([^"]*)"/g)].map((m) => m[1])
  assert.ok(stringValues.length > 0)
  for (const v of stringValues) assert.match(v, /^var\(--[a-z0-9-]+\)$/)
})
