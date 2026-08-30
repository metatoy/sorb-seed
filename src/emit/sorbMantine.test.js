// Tests for the Sorb Mantine v7 CSS-var override format (`sorb/mantine-vars`).
// Run: node --test  (zero-dep, Node's built-in runner — matches the workspace convention).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_MANTINE_VARS, MANTINE_VAR_MAP, sorbMantineVars } from './sorbMantine.js'

// Helper: a fabricated dictionary of resolved tokens, keyed by dot-path id.
const tok = (id) => ({ path: id.split('.') })
const dictOf = (ids) => ({ allTokens: ids.map(tok) })

test('format name constant is the documented id', () => {
  assert.equal(SORB_MANTINE_VARS, 'sorb/mantine-vars')
})

test('emits a :root block with every mapped id present in the dictionary', () => {
  const dictionary = dictOf(Object.keys(MANTINE_VAR_MAP))
  const css = sorbMantineVars({ dictionary })
  assert.match(css, /^:root \{/m)
  assert.match(css, /\}\s*$/)
  // one declaration per map entry
  const declCount = (css.match(/!important;/g) || []).length
  assert.equal(declCount, Object.keys(MANTINE_VAR_MAP).length)
})

test('each declaration maps the correct --mantine-* var to var(--kebab-id) and keeps !important', () => {
  const dictionary = dictOf(Object.keys(MANTINE_VAR_MAP))
  const css = sorbMantineVars({ dictionary })
  assert.match(css, /--mantine-color-body: var\(--color-surface\) !important;/)
  assert.match(css, /--mantine-color-text: var\(--color-ink\) !important;/)
  assert.match(css, /--mantine-color-anchor: var\(--color-brand\) !important;/)
  assert.match(css, /--mantine-color-error: var\(--color-danger\) !important;/)
  assert.match(css, /--mantine-default-border-color: var\(--color-border\) !important;/)
  assert.match(css, /--mantine-primary-color-filled: var\(--button-primary-bg-default\) !important;/)
  assert.match(css, /--mantine-primary-color-filled-hover: var\(--button-primary-bg-hover\) !important;/)
  assert.match(css, /--mantine-radius-default: var\(--radius-control\) !important;/)
  assert.match(css, /--mantine-radius-md: var\(--button-radius\) !important;/)
  assert.match(css, /--mantine-radius-lg: var\(--card-radius\) !important;/)
  assert.match(css, /--mantine-radius-xl: var\(--radius-pill\) !important;/)
})

test('every value is a var() reference, never a baked literal (live-preview invariant)', () => {
  const dictionary = dictOf(Object.keys(MANTINE_VAR_MAP))
  const css = sorbMantineVars({ dictionary })
  for (const line of css.split('\n').filter((l) => l.trim().startsWith('--mantine'))) {
    assert.match(line, /: var\(--[a-z0-9-]+\) !important;$/)
  }
})

test('options.roleMap remaps the JJ-token-id column without forking the format', () => {
  // A hypothetical non-JJ kit names its surface/ink/brand roles differently.
  const roleMap = {
    'color.surface': 'kit.bg',
    'color.brand': 'kit.primary',
  }
  const dictionary = dictOf(['kit.bg', 'kit.primary', 'color.ink'])
  const css = sorbMantineVars({ dictionary, options: { roleMap } })
  assert.match(css, /--mantine-color-body: var\(--kit-bg\) !important;/)
  assert.match(css, /--mantine-color-anchor: var\(--kit-primary\) !important;/)
  // unmapped roles fall back to their canonical/default id
  assert.match(css, /--mantine-color-text: var\(--color-ink\) !important;/)
})

test('unmapped/missing token ids are skipped, not emitted as broken var() refs', () => {
  const dictionary = dictOf(['color.surface']) // only one of the map's ids present
  const css = sorbMantineVars({ dictionary })
  assert.match(css, /--mantine-color-body: var\(--color-surface\) !important;/)
  assert.equal((css.match(/!important;/g) || []).length, 1)
})
