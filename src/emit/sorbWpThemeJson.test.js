// Tests for the Sorb WordPress theme.json preset format (`sorb/wp-theme-json`).
// Run: node --test  (zero-dep, Node's built-in runner).
// ⚠️ STAGED target (T9) — not yet shipped; see the format file header.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_WP_THEME_JSON, sorbWpThemeJson } from './sorbWpThemeJson.js'

// Fabricate resolved tokens: the format reads `.name` (kebab CSS-var name) +
// `.path` (dot-path segments) off each token, the way Style Dictionary shapes them.
const tok = (id) => ({ name: id.replace(/\./g, '-'), path: id.split('.') })
const dictOf = (ids) => ({ allTokens: ids.map(tok) })

test('format name constant is the documented id', () => {
  assert.equal(SORB_WP_THEME_JSON, 'sorb/wp-theme-json')
})

test('routes color.* into settings.color.palette as var() refs', () => {
  const json = JSON.parse(sorbWpThemeJson({ dictionary: dictOf(['color.brand', 'color.surface']) }))
  const palette = json.settings.color.palette
  assert.deepEqual(palette.find((p) => p.slug === 'brand'), { slug: 'brand', color: 'var(--color-brand)', name: 'Brand' })
  assert.deepEqual(palette.find((p) => p.slug === 'surface'), { slug: 'surface', color: 'var(--color-surface)', name: 'Surface' })
})

test('routes space.* -> spacingSizes and font.size.* -> fontSizes', () => {
  const json = JSON.parse(sorbWpThemeJson({ dictionary: dictOf(['space.4', 'font.size.body']) }))
  assert.deepEqual(json.settings.spacing.spacingSizes[0], { slug: '4', size: 'var(--space-4)', name: '4' })
  assert.deepEqual(json.settings.typography.fontSizes[0], { slug: 'body', size: 'var(--font-size-body)', name: 'Body' })
})

test('routes everything else (component tier, radius) into nested settings.custom', () => {
  const json = JSON.parse(sorbWpThemeJson({ dictionary: dictOf(['button.primary.bg.default', 'radius.card']) }))
  assert.equal(json.settings.custom.button.primary.bg.default, 'var(--button-primary-bg-default)')
  assert.equal(json.settings.custom.radius.card, 'var(--radius-card)')
})

test('every emitted leaf is a var() ref — never a resolved literal (live-preview invariant)', () => {
  const out = sorbWpThemeJson({ dictionary: dictOf(['color.brand', 'space.4', 'button.primary.bg.default']) })
  // no hex/rgb/px literals in the emit
  assert.ok(!/#[0-9a-fA-F]{3,8}|rgb\(|\d+px/.test(out))
  // every value string is a var(--…) ref
  for (const m of out.matchAll(/"(?:color|size)": "([^"]+)"/g)) assert.match(m[1], /^var\(--[a-z0-9-]+\)$/)
})

test('color palette de-dupes repeated slugs', () => {
  const json = JSON.parse(sorbWpThemeJson({ dictionary: dictOf(['color.brand', 'color.brand']) }))
  assert.equal(json.settings.color.palette.filter((p) => p.slug === 'brand').length, 1)
})
