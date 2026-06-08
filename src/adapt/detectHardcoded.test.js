// P0 acceptance: detectHardcoded finds all N known hardcoded sites in a legacy
// fixture (zero false negatives) and 0 sites in a fully-var() file (zero false
// positives). Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { detectHardcoded, propToRole } from './detectHardcoded.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, '__fixtures__', name), 'utf-8')

test('propToRole maps CSS + JSX prop names to matcher roles', () => {
  assert.equal(propToRole('background'), 'bg')
  assert.equal(propToRole('background-color'), 'bg')
  assert.equal(propToRole('backgroundColor'), 'bg')
  assert.equal(propToRole('color'), 'text')
  assert.equal(propToRole('border-color'), 'border')
  assert.equal(propToRole('borderColor'), 'border')
  assert.equal(propToRole('border-radius'), 'radius')
  assert.equal(propToRole('borderRadius'), 'radius')
  assert.equal(propToRole('padding'), null) // non-roled → tier-only
})

test('detectHardcoded finds all 8 known hardcoded sites in the legacy fixture', () => {
  const src = fixture('Button.legacy.jsx')
  const sites = detectHardcoded(src, 'Button.legacy.jsx')
  assert.equal(sites.length, 8, `expected 8 sites, got ${sites.length}: ` +
    JSON.stringify(sites.map((s) => `${s.prop}=${s.raw}`)))

  // The specific bindings we depend on downstream.
  const byRaw = (raw) => sites.filter((s) => s.raw === raw)
  assert.ok(byRaw('#0F65EF').length >= 1) // inline bg + styled background
  assert.ok(sites.some((s) => s.prop === 'backgroundColor' && s.role === 'bg'))
  assert.ok(sites.some((s) => s.prop === 'borderColor' && s.role === 'border'))
  assert.ok(sites.some((s) => s.prop === 'borderRadius' && s.raw === '4' && s.role === 'radius'))
  assert.ok(sites.some((s) => s.prop === 'border-radius' && s.raw === '4px' && s.role === 'radius'))
  assert.ok(sites.some((s) => s.role === 'text')) // white text
  assert.ok(sites.some((s) => s.prop === 'padding' && s.role === null)) // non-roled
})

test('detectHardcoded records 1-based line numbers and the file path', () => {
  const sites = detectHardcoded(fixture('Button.legacy.jsx'), 'X.jsx')
  for (const s of sites) {
    assert.equal(s.file, 'X.jsx')
    assert.ok(s.loc.line > 0)
    assert.ok(Number.isInteger(s.loc.column))
  }
})

test('detectHardcoded finds 0 sites in a fully-var() (.tsx) file — no false positives', () => {
  const src = fixture('Button.tokenized.tsx')
  const sites = detectHardcoded(src, 'Button.tokenized.tsx')
  assert.equal(sites.length, 0, `expected 0, got: ` +
    JSON.stringify(sites.map((s) => `${s.prop}=${s.raw}`)))
})

test('detectHardcoded is resilient: unparseable source yields [] (no throw)', () => {
  const sites = detectHardcoded('const x = (((;;;', 'broken.js')
  assert.ok(Array.isArray(sites))
})
