// Tests for the Sorb MUI v6 CSS-var override format (`sorb/mui-vars`).
// Run: node --test  (zero-dep, Node's built-in runner — matches the workspace convention).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_MUI_VARS, MUI_VAR_MAP, sorbMuiVars } from './sorbMui.js'

// Helper: a fabricated dictionary of resolved tokens, keyed by dot-path id.
const tok = (id) => ({ path: id.split('.') })
const dictOf = (ids) => ({ allTokens: ids.map(tok) })

// A fabricated seedValues map covering every canonical role in MUI_VAR_MAP,
// standing in for a demo's own JJ hex values (never baked into the format).
const FAB_SEED_VALUES = {
  'color.brand': '#1976d2',
  'color.brand-hover': '#1565c0',
  'color.brand-contrast': '#fff',
  'color.accent': '#9c27b0',
  'color.accent-hover': '#7b1fa2',
  'color.accent-contrast': '#fff',
  'color.danger': '#d32f2f',
  'color.danger-hover': '#c62828',
  'color.success': '#2e7d32',
  'color.success-hover': '#1b5e20',
  'color.surface': '#fff',
  'color.surface-raised': '#fff',
  'color.ink': 'rgba(0,0,0,0.87)',
  'color.ink-muted': 'rgba(0,0,0,0.6)',
  'color.border': 'rgba(0,0,0,0.12)',
  'radius.control': '4px',
}

test('format name constant is the documented id', () => {
  assert.equal(SORB_MUI_VARS, 'sorb/mui-vars')
})

test('emits a :root, [data-mui-color-scheme] block with every mapped id present in the dictionary', () => {
  const dictionary = dictOf(Object.keys(MUI_VAR_MAP))
  const css = sorbMuiVars({ dictionary, options: { seedValues: FAB_SEED_VALUES } })
  assert.match(css, /^:root, \[data-mui-color-scheme\] \{/m)
  assert.match(css, /\}\s*$/)
  const declCount = (css.match(/!important;/g) || []).length
  assert.equal(declCount, Object.keys(MUI_VAR_MAP).length)
})

test('each declaration maps the correct --mui-* var to var(--kebab-id, seed) and keeps !important', () => {
  const dictionary = dictOf(Object.keys(MUI_VAR_MAP))
  const css = sorbMuiVars({ dictionary, options: { seedValues: FAB_SEED_VALUES } })
  assert.match(css, /--mui-palette-primary-main: var\(--color-brand, #1976d2\) !important;/)
  assert.match(css, /--mui-palette-primary-dark: var\(--color-brand-hover, #1565c0\) !important;/)
  assert.match(css, /--mui-palette-primary-contrastText: var\(--color-brand-contrast, #fff\) !important;/)
  assert.match(css, /--mui-palette-secondary-main: var\(--color-accent, #9c27b0\) !important;/)
  assert.match(css, /--mui-palette-error-main: var\(--color-danger, #d32f2f\) !important;/)
  assert.match(css, /--mui-palette-success-main: var\(--color-success, #2e7d32\) !important;/)
  assert.match(css, /--mui-palette-background-default: var\(--color-surface, #fff\) !important;/)
  assert.match(css, /--mui-palette-background-paper: var\(--color-surface-raised, #fff\) !important;/)
  assert.match(css, /--mui-palette-text-primary: var\(--color-ink, rgba\(0,0,0,0\.87\)\) !important;/)
  assert.match(css, /--mui-palette-text-secondary: var\(--color-ink-muted, rgba\(0,0,0,0\.6\)\) !important;/)
  assert.match(css, /--mui-palette-divider: var\(--color-border, rgba\(0,0,0,0\.12\)\) !important;/)
  assert.match(css, /--mui-shape-borderRadius: var\(--radius-control, 4px\) !important;/)
})

test('assert NO fallback when a role has no seedValues entry (documented, no baked literal)', () => {
  const dictionary = dictOf(Object.keys(MUI_VAR_MAP))
  const css = sorbMuiVars({ dictionary, options: { seedValues: { 'color.brand': '#1976d2' } } })
  // The one role WITH a seedValue gets its fallback.
  assert.match(css, /--mui-palette-primary-main: var\(--color-brand, #1976d2\) !important;/)
  // Every other mapped role has no seedValues entry — no fallback, no comma.
  assert.match(css, /--mui-palette-primary-dark: var\(--color-brand-hover\) !important;/)
  assert.match(css, /--mui-palette-background-default: var\(--color-surface\) !important;/)
  assert.match(css, /--mui-shape-borderRadius: var\(--radius-control\) !important;/)
})

test('no seedValues supplied at all: every declaration has no fallback (no JJ hexes baked in)', () => {
  const dictionary = dictOf(Object.keys(MUI_VAR_MAP))
  const css = sorbMuiVars({ dictionary })
  for (const line of css.split('\n').filter((l) => l.trim().startsWith('--mui'))) {
    assert.match(line, /: var\(--[a-z0-9-]+\) !important;$/)
  }
})

test('options.roleMap remaps the JJ-token-id column without forking the format', () => {
  const roleMap = {
    'color.brand': 'kit.primary',
    'color.surface': 'kit.bg',
  }
  const dictionary = dictOf(['kit.primary', 'kit.bg', 'color.brand-hover'])
  const css = sorbMuiVars({
    dictionary,
    options: { roleMap, seedValues: { 'color.brand': '#1976d2' } },
  })
  assert.match(css, /--mui-palette-primary-main: var\(--kit-primary, #1976d2\) !important;/)
  assert.match(css, /--mui-palette-background-default: var\(--kit-bg\) !important;/)
  // unmapped roles fall back to their canonical/default id
  assert.match(css, /--mui-palette-primary-dark: var\(--color-brand-hover\) !important;/)
})

test('unmapped/missing token ids are skipped, not emitted as broken var() refs', () => {
  const dictionary = dictOf(['color.brand'])
  const css = sorbMuiVars({ dictionary, options: { seedValues: FAB_SEED_VALUES } })
  assert.match(css, /--mui-palette-primary-main: var\(--color-brand, #1976d2\) !important;/)
  assert.equal((css.match(/!important;/g) || []).length, 1)
})
