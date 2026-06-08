// Tests for the variants.js pure helpers.
// Run: node --test src/variants.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bumpVersion,
  flattenVariantIds,
  cloneVariantSlice,
  applyDeprecation,
} from './variants.js'

// ─── In-memory button component token matrix ─────────────────────────────────

const BUTTON_PRIMARY_SLICE = {
  bg: {
    default: { $value: '#0f65ef', $type: 'color' },
    hover:   { $value: '#0a4fc4', $type: 'color' },
  },
  text: {
    default: { $value: '#ffffff', $type: 'color' },
  },
  border: {
    default: { $value: '#0f65ef', $type: 'color' },
  },
}

const BUTTON_SINGLE_LEVEL_SLICE = {
  radius: { $value: '4px', $type: 'dimension' },
}

// ─── flattenVariantIds ────────────────────────────────────────────────────────

test('flattenVariantIds — button.primary slice produces expected ids', () => {
  const ids = flattenVariantIds('button', 'primary', BUTTON_PRIMARY_SLICE)
  assert.deepEqual(ids.sort(), [
    'button.primary.bg.default',
    'button.primary.bg.hover',
    'button.primary.border.default',
    'button.primary.text.default',
  ])
})

test('flattenVariantIds — single-level slice produces correct ids', () => {
  const ids = flattenVariantIds('button', 'base', BUTTON_SINGLE_LEVEL_SLICE)
  assert.deepEqual(ids, ['button.base.radius'])
})

test('flattenVariantIds — skips $-prefixed metadata keys', () => {
  const sliceWithMeta = {
    $description: 'ignored',
    bg: { $value: '#000000', $type: 'color' },
  }
  const ids = flattenVariantIds('button', 'ghost', sliceWithMeta)
  assert.deepEqual(ids, ['button.ghost.bg'])
})

// ─── bumpVersion ─────────────────────────────────────────────────────────────

test('bumpVersion — "1.0.0" bumps patch to "1.0.1"', () => {
  assert.equal(bumpVersion('1.0.0'), '1.0.1')
})

test('bumpVersion — "2.3.7" bumps patch to "2.3.8"', () => {
  assert.equal(bumpVersion('2.3.7'), '2.3.8')
})

test('bumpVersion — malformed string falls back to "1.0.1"', () => {
  assert.equal(bumpVersion('not-a-semver'), '1.0.1')
})

test('bumpVersion — too few parts falls back to "1.0.1"', () => {
  assert.equal(bumpVersion('1.0'), '1.0.1')
})

test('bumpVersion — non-string input falls back to "1.0.1"', () => {
  assert.equal(bumpVersion(null), '1.0.1')
  assert.equal(bumpVersion(undefined), '1.0.1')
  assert.equal(bumpVersion(42), '1.0.1')
})

// ─── cloneVariantSlice ────────────────────────────────────────────────────────

test('cloneVariantSlice — returns a deep copy, not the same reference', () => {
  const clone = cloneVariantSlice(BUTTON_PRIMARY_SLICE)
  assert.deepEqual(clone, BUTTON_PRIMARY_SLICE)
  assert.notEqual(clone, BUTTON_PRIMARY_SLICE)
  assert.notEqual(clone.bg, BUTTON_PRIMARY_SLICE.bg)
  assert.notEqual(clone.bg.default, BUTTON_PRIMARY_SLICE.bg.default)
})

test('cloneVariantSlice — mutation of clone does not affect original', () => {
  const clone = cloneVariantSlice(BUTTON_PRIMARY_SLICE)
  clone.bg.default.$value = 'mutated'
  assert.equal(BUTTON_PRIMARY_SLICE.bg.default.$value, '#0f65ef')
})

// ─── applyDeprecation ─────────────────────────────────────────────────────────

test('applyDeprecation — all leaf nodes get $deprecated:true', () => {
  const result = applyDeprecation(BUTTON_PRIMARY_SLICE, 'button.primary-v2')
  assert.equal(result.bg.default.$deprecated, true)
  assert.equal(result.bg.hover.$deprecated, true)
  assert.equal(result.text.default.$deprecated, true)
  assert.equal(result.border.default.$deprecated, true)
})

test('applyDeprecation — all leaf nodes get $extensions.sorb.replacedBy set', () => {
  const result = applyDeprecation(BUTTON_PRIMARY_SLICE, 'button.primary-v2')
  assert.equal(result.bg.default.$extensions.sorb.replacedBy, 'button.primary-v2')
  assert.equal(result.bg.hover.$extensions.sorb.replacedBy, 'button.primary-v2')
  assert.equal(result.text.default.$extensions.sorb.replacedBy, 'button.primary-v2')
  assert.equal(result.border.default.$extensions.sorb.replacedBy, 'button.primary-v2')
})

test('applyDeprecation — does not mutate the original slice', () => {
  const original = {
    bg: { default: { $value: '#0f65ef', $type: 'color' } },
  }
  applyDeprecation(original, 'button.new')
  assert.equal(original.bg.default.$deprecated, undefined)
  assert.equal(original.bg.default.$extensions, undefined)
})

test('applyDeprecation — skips intermediate (non-leaf) nodes', () => {
  const result = applyDeprecation(BUTTON_PRIMARY_SLICE, 'button.primary-v2')
  // intermediate nodes should not have $deprecated or $extensions set
  assert.equal(result.bg.$deprecated, undefined)
  assert.equal(result.$deprecated, undefined)
})
