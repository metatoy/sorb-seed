// Tests for the Sorb Angular Material M3 system-variable override format
// (`sorb/mat-sys-vars`).
// Run: node --test  (zero-dep, Node's built-in runner — matches the workspace convention).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_MAT_SYS_VARS, MAT_SYS_MAP, sorbMatSysVars } from './sorbMatSys.js'

// Helper: a fabricated dictionary of resolved tokens, keyed by dot-path id.
const tok = (id) => ({ path: id.split('.') })
const dictOf = (ids) => ({ allTokens: ids.map(tok) })

test('format name constant is the documented id', () => {
  assert.equal(SORB_MAT_SYS_VARS, 'sorb/mat-sys-vars')
})

test('emits a :root block with every mapped id present in the dictionary', () => {
  const dictionary = dictOf([...new Set(Object.values(MAT_SYS_MAP))])
  const css = sorbMatSysVars({ dictionary })
  assert.match(css, /^\/\*\*/) // header comment
  assert.match(css, /:root \{/)
  assert.match(css, /\}\s*$/)
  // one declaration per map entry (right-hand roles can repeat, so count
  // declarations, not unique role ids)
  const declCount = (css.match(/!important;/g) || []).length
  assert.equal(declCount, Object.keys(MAT_SYS_MAP).length)
})

test('each declaration maps the correct --mat-sys-* var to var(--kebab-id) and keeps !important', () => {
  const dictionary = dictOf([...new Set(Object.values(MAT_SYS_MAP))])
  const css = sorbMatSysVars({ dictionary })
  assert.match(css, /--mat-sys-primary: var\(--color-brand\) !important;/)
  assert.match(css, /--mat-sys-on-primary: var\(--color-brand-contrast\) !important;/)
  assert.match(css, /--mat-sys-secondary: var\(--color-accent\) !important;/)
  assert.match(css, /--mat-sys-surface: var\(--color-surface\) !important;/)
  assert.match(css, /--mat-sys-on-surface: var\(--color-ink\) !important;/)
  assert.match(css, /--mat-sys-outline: var\(--color-border\) !important;/)
  assert.match(css, /--mat-sys-error: var\(--color-danger\) !important;/)
  assert.match(css, /--mat-sys-on-error: var\(--color-white\) !important;/)
  assert.match(css, /--mat-sys-corner-small: var\(--radius-control\) !important;/)
  assert.match(css, /--mat-sys-corner-large: var\(--radius-card\) !important;/)
  assert.match(css, /--mat-sys-corner-full: var\(--radius-pill\) !important;/)
})

test('every value is a var() reference, never a baked literal (live-preview invariant)', () => {
  const dictionary = dictOf([...new Set(Object.values(MAT_SYS_MAP))])
  const css = sorbMatSysVars({ dictionary })
  for (const line of css.split('\n').filter((l) => l.trim().startsWith('--mat-sys'))) {
    assert.match(line, /: var\(--[a-z0-9-]+\) !important;$/)
  }
})

test('options.roleMap remaps the JJ-token-id column without forking the format', () => {
  // A hypothetical non-JJ kit names its brand/surface roles differently.
  const roleMap = {
    'color.brand': 'kit.primary',
    'color.surface': 'kit.bg',
  }
  const dictionary = dictOf(['kit.primary', 'kit.bg', 'color.brand-contrast'])
  const css = sorbMatSysVars({ dictionary, options: { roleMap } })
  assert.match(css, /--mat-sys-primary: var\(--kit-primary\) !important;/)
  assert.match(css, /--mat-sys-surface: var\(--kit-bg\) !important;/)
  // unmapped roles fall back to their canonical/default id
  assert.match(css, /--mat-sys-on-primary: var\(--color-brand-contrast\) !important;/)
})

test('unmapped/missing token ids are skipped, not emitted as broken var() refs', () => {
  const dictionary = dictOf(['color.brand']) // only one of the map's ids present
  const css = sorbMatSysVars({ dictionary })
  assert.match(css, /--mat-sys-primary: var\(--color-brand\) !important;/)
  // color.brand also backs --mat-sys-inverse-primary (both map to color.brand-hover
  // actually) — assert exact count matches how many map entries resolve to
  // 'color.brand' specifically.
  const brandEntries = Object.values(MAT_SYS_MAP).filter((r) => r === 'color.brand').length
  assert.equal((css.match(/!important;/g) || []).length, brandEntries)
})
