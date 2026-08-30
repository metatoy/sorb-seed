// Tests for the Sorb shadcn/ui theme format (`sorb/shadcn-theme`).
// Run: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORB_SHADCN, sorbShadcn, shadcnRootLines, shadcnThemeInlineLines } from './sorbShadcn.js'

// A fabricated dictionary carrying the JJ role tokens the format resolves
// against (identity roleMap case — the JJ reference kit already uses
// canonical role ids from `@sorb/core`'s DEFAULT_ROLE_IDS).
const JJ_ROLE_TOKEN_IDS = [
  'color.surface', 'color.surface-raised', 'color.surface-sunken',
  'color.ink', 'color.ink-muted',
  'color.brand', 'color.brand-contrast',
  'color.accent', 'color.accent-contrast',
  'color.danger', 'color.border', 'color.focus-ring',
  'color.white',
  'radius.control',
]
const dictionary = { allTokens: JJ_ROLE_TOKEN_IDS.map((id) => ({ path: id.split('.') })) }

test('format id is sorb/shadcn-theme', () => {
  assert.equal(SORB_SHADCN, 'sorb/shadcn-theme')
})

test('root map: identity roleMap resolves every shadcn var to its canonical role\'s var()', () => {
  const css = sorbShadcn({ dictionary })
  assert.match(css, /--background: var\(--color-surface\);/)
  assert.match(css, /--foreground: var\(--color-ink\);/)
  assert.match(css, /--primary: var\(--color-brand\);/)
  assert.match(css, /--primary-foreground: var\(--color-brand-contrast\);/)
  assert.match(css, /--destructive: var\(--color-danger\);/)
  assert.match(css, /--border: var\(--color-border\);/)
  assert.match(css, /--input: var\(--color-border\);/)
  assert.match(css, /--ring: var\(--color-focus-ring\);/)
  assert.match(css, /--radius: var\(--radius-control\);/)
})

test('root map: destructive-foreground falls back to the color.white primitive (role-contract gap)', () => {
  const css = sorbShadcn({ dictionary })
  assert.match(css, /--destructive-foreground: var\(--color-white\);/)
})

test('root map: options.roleMap overrides a canonical role id to a non-JJ kit token', () => {
  const css = sorbShadcn({
    dictionary: { allTokens: [{ path: ['brand', 'primary'] }, ...dictionary.allTokens] },
    options: { roleMap: { 'color.brand': 'brand.primary' } },
  })
  assert.match(css, /--primary: var\(--brand-primary\);/)
})

test('options.destructiveForeground / options.radiusRole override the non-role defaults', () => {
  const css = sorbShadcn({
    dictionary: { allTokens: [{ path: ['ink', 'onDanger'] }, { path: ['radius', 'lg'] }, ...dictionary.allTokens] },
    options: { destructiveForeground: 'ink.onDanger', radiusRole: 'radius.lg' },
  })
  assert.match(css, /--destructive-foreground: var\(--ink-onDanger\);/)
  assert.match(css, /--radius: var\(--radius-lg\);/)
})

test('emits an @theme inline block with the calc() radius scale, chained onto shadcn vars (not raw tokens)', () => {
  const css = sorbShadcn({ dictionary })
  assert.match(css, /@theme inline \{/)
  assert.match(css, /--color-background: var\(--background\);/)
  assert.match(css, /--color-primary-foreground: var\(--primary-foreground\);/)
  assert.match(css, /--radius-sm: calc\(var\(--radius\) - 4px\);/)
  assert.match(css, /--radius-md: calc\(var\(--radius\) - 2px\);/)
  assert.match(css, /--radius-lg: var\(--radius\);/)
  assert.match(css, /--radius-xl: calc\(var\(--radius\) \+ 4px\);/)
})

test('every emitted value is a var()/calc(var()) reference — never a baked literal (live-preview invariant)', () => {
  const css = sorbShadcn({ dictionary })
  const declLines = css.split('\n').filter((l) => /^\s*--[a-z-]+:/.test(l))
  assert.ok(declLines.length > 0)
  for (const line of declLines) {
    assert.match(line, /:\s*(var\(--[a-zA-Z0-9-]+\)|calc\(var\(--[a-zA-Z0-9-]+\)[^)]*\))\s*;\s*$/, `unexpected literal: ${line}`)
  }
})

test('warns (does not throw) when a resolved token id is not in the dictionary', () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => warnings.push(msg)
  try {
    const css = sorbShadcn({ dictionary: { allTokens: [{ path: ['color', 'surface'] }] } })
    assert.match(css, /--background: var\(--color-surface\);/) // still emits
  } finally {
    console.warn = origWarn
  }
  assert.ok(warnings.length > 0)
  assert.match(warnings[0], /unresolved token id/)
})

test('shadcnRootLines / shadcnThemeInlineLines are pure and independently testable', () => {
  const rootLines = shadcnRootLines({})
  assert.equal(rootLines.length, SHADCN_ROOT_LINE_COUNT)
  const themeLines = shadcnThemeInlineLines()
  assert.equal(themeLines.filter((l) => l.includes('--radius-')).length, 4)
})

// 18 color-role pairs + destructive-foreground + radius
const SHADCN_ROOT_LINE_COUNT = 20
