// Tests for the Sorb Tailwind v4 theme format (`sorb/tailwind-theme`).
// Run: node --test  (zero-dep, Node's built-in runner — matches the workspace convention).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tailwindThemeEntry, sorbTailwind, tailwindV3Slot, sorbTailwindV3 } from './sorbFormat.js'

// Helper: a token as Style Dictionary hands it to a format (path + $type).
const tok = (id, type) => ({ path: id.split('.'), $type: type })

test('color tokens map to the Tailwind --color-* family, value = var(self)', () => {
  // semantic: leading `color.` is the namespace, not doubled
  assert.deepEqual(tailwindThemeEntry(tok('color.action.primary', 'color')), {
    key: '--color-action-primary',
    ref: 'var(--color-action-primary)',
  })
  // primitive ramp
  assert.deepEqual(tailwindThemeEntry(tok('color.blue.300', 'color')), {
    key: '--color-blue-300',
    ref: 'var(--color-blue-300)',
  })
})

test('component colors keep their full path under the color family', () => {
  // button.primary.bg.default has $type color but path does NOT start with `color`
  assert.deepEqual(tailwindThemeEntry(tok('button.primary.bg.default', 'color')), {
    key: '--color-button-primary-bg-default',
    ref: 'var(--button-primary-bg-default)', // ref always points at the token's own css var
  })
})

test('radius dimensions map to --radius-* (→ rounded-* utilities)', () => {
  assert.deepEqual(tailwindThemeEntry(tok('radius.100', 'dimension')), {
    key: '--radius-100',
    ref: 'var(--radius-100)',
  })
  // component radius is remapped into the radius family so rounded-button works
  assert.deepEqual(tailwindThemeEntry(tok('button.radius', 'dimension')), {
    key: '--radius-button',
    ref: 'var(--button-radius)',
  })
})

test('space → --spacing-*, font.size → --text-*, fontWeight → --font-weight-*', () => {
  assert.equal(tailwindThemeEntry(tok('space.200', 'dimension')).key, '--spacing-200')
  assert.equal(tailwindThemeEntry(tok('space.200', 'dimension')).ref, 'var(--space-200)')
  assert.equal(tailwindThemeEntry(tok('font.size.300', 'dimension')).key, '--text-300')
  assert.equal(tailwindThemeEntry(tok('font.weight.semibold', 'fontWeight')).key, '--font-weight-semibold')
})

test('the ref is ALWAYS a var() reference, never a baked literal (live-preview invariant)', () => {
  // This is the property that makes the bridge's runtime var-swap recolor
  // Tailwind utilities with no Tailwind-specific code. Every entry must be var(…).
  for (const t of [
    tok('color.action.primary', 'color'),
    tok('button.radius', 'dimension'),
    tok('space.100', 'dimension'),
  ]) {
    assert.match(tailwindThemeEntry(t).ref, /^var\(--[a-z0-9-]+\)$/)
  }
})

test('sorbTailwind emits an `@theme inline` block, one entry per token', () => {
  const dictionary = {
    allTokens: [
      tok('color.action.primary', 'color'),
      tok('button.radius', 'dimension'),
      tok('space.100', 'dimension'),
    ],
  }
  const css = sorbTailwind({ dictionary })
  assert.match(css, /@theme inline \{/)
  assert.match(css, /\}\s*$/)
  assert.match(css, /^ {2}--color-action-primary: var\(--color-action-primary\);$/m)
  assert.match(css, /^ {2}--radius-button: var\(--button-radius\);$/m)
  // exactly 3 entries
  assert.equal((css.match(/: var\(/g) || []).length, 3)
})

test('duplicate theme keys are skipped (collision guard), not emitted twice', () => {
  const dictionary = {
    // two distinct tokens that would collapse to the same theme key
    allTokens: [tok('color.action.primary', 'color'), tok('color.action.primary', 'color')],
  }
  const css = sorbTailwind({ dictionary })
  assert.equal((css.match(/--color-action-primary: /g) || []).length, 1)
})

// ─── Tailwind v3 preset (sorb/tailwind-v3-preset) ────────────────────────────

test('v3 slot: colors strip leading `color`, components keep full path', () => {
  assert.deepEqual(tailwindV3Slot(tok('color.action.primary', 'color')), {
    category: 'colors', keyPath: ['action', 'primary'], ref: 'var(--color-action-primary)',
  })
  assert.deepEqual(tailwindV3Slot(tok('button.primary.bg.default', 'color')), {
    category: 'colors', keyPath: ['button', 'primary', 'bg', 'default'], ref: 'var(--button-primary-bg-default)',
  })
})

test('v3 slot: dimensions/weights map to the right v3 categories', () => {
  assert.deepEqual(tailwindV3Slot(tok('radius.100', 'dimension')), { category: 'borderRadius', keyPath: ['100'], ref: 'var(--radius-100)' })
  assert.deepEqual(tailwindV3Slot(tok('button.radius', 'dimension')), { category: 'borderRadius', keyPath: ['button'], ref: 'var(--button-radius)' })
  assert.deepEqual(tailwindV3Slot(tok('space.200', 'dimension')), { category: 'spacing', keyPath: ['200'], ref: 'var(--space-200)' })
  assert.deepEqual(tailwindV3Slot(tok('font.size.300', 'dimension')), { category: 'fontSize', keyPath: ['300'], ref: 'var(--font-size-300)' })
  assert.deepEqual(tailwindV3Slot(tok('font.weight.regular', 'fontWeight')), { category: 'fontWeight', keyPath: ['regular'], ref: 'var(--font-weight-regular)' })
})

test('v3 slot: unknown type → null (no v3 family)', () => {
  assert.equal(tailwindV3Slot({ path: ['z', 'index'], $type: 'number' }), null)
})

test('sorbTailwindV3 emits a requireable preset with nested theme.extend of var() refs', () => {
  const dictionary = {
    allTokens: [
      tok('color.action.primary', 'color'),
      tok('button.primary.bg.default', 'color'),
      tok('button.radius', 'dimension'),
      tok('space.100', 'dimension'),
    ],
  }
  const src = sorbTailwindV3({ dictionary })
  assert.match(src, /^module\.exports = /m)
  // evaluate the generated CommonJS to prove it's a valid, requireable preset
  const mod = { exports: {} }
  new Function('module', 'exports', src)(mod, mod.exports)
  const ext = mod.exports.theme.extend
  assert.equal(ext.colors.action.primary, 'var(--color-action-primary)') // → bg-action-primary
  assert.equal(ext.colors.button.primary.bg.default, 'var(--button-primary-bg-default)')
  assert.equal(ext.borderRadius.button, 'var(--button-radius)') // → rounded-button
  assert.equal(ext.spacing['100'], 'var(--space-100)') // → p-100
  // every leaf is a var() ref (the live-preview invariant), never a literal
  const leaves = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : leaves(v)))
  for (const v of leaves(ext)) assert.match(v, /^var\(--[a-z0-9-]+\)$/)
})
