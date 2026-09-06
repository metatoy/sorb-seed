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

// 0.5.1 — block identity (`group`/`parent`/`label`) + TRUE template lines.
const GROUP_SRC = `import styled from 'styled-components'
const Btn = styled.button\`
  background: #0f65ef;
  color: #ffffff;
  &:hover {
    background: #333333;
    span { color: #eeeeee; }
  }
\`
const s = { root: { color: '#111111' }, nested: { '&:hover': { background: '#222222' } } }
export default function App() {
  return <div style={{ backgroundColor: '#ffffff', color: '#333333', padding: 16 }} />
}
`

test('detectHardcoded (0.5.1): template declarations report their TRUE line, not the quasi line', () => {
  const sites = detectHardcoded(GROUP_SRC, 'x.jsx')
  const tpl = sites.filter((s) => s.group && s.group.startsWith('tpl@'))
  assert.deepEqual(
    tpl.map((s) => [s.loc.line, s.prop, s.raw]),
    [
      [3, 'background', '#0f65ef'],
      [4, 'color', '#ffffff'],
      [6, 'background', '#333333'],
      [7, 'color', '#eeeeee'],
    ],
  )
})

test('detectHardcoded (0.5.1): template blocks get monotonic ids with parent linkage + selector labels', () => {
  const sites = detectHardcoded(GROUP_SRC, 'x.jsx')
  const byRaw = (raw) => sites.find((s) => s.raw === raw)
  const top = byRaw('#0f65ef')
  assert.match(top.group, /^tpl@\d+:b0$/)
  assert.equal(top.parent, undefined)
  assert.equal(top.label, 'styled.button')
  assert.equal(byRaw('#ffffff').group, top.group) // same block ⇒ same group (bg + text pair)
  const hover = byRaw('#333333')
  assert.equal(hover.group, top.group.replace(':b0', ':b1'))
  assert.equal(hover.parent, top.group)
  assert.equal(hover.label, '&:hover')
  const span = byRaw('#eeeeee')
  assert.equal(span.group, top.group.replace(':b0', ':b2'))
  assert.equal(span.parent, hover.group)
  assert.equal(span.label, 'span')
})

test('detectHardcoded (0.5.1): object properties share `obj@{start}` per object; nested objects link to their parent', () => {
  const sites = detectHardcoded(GROUP_SRC, 'x.jsx')
  const inline = sites.filter((s) => s.label === 'style')
  assert.equal(inline.length, 3)
  assert.ok(inline.every((s) => s.group === inline[0].group && /^obj@\d+$/.test(s.group)))
  assert.equal(inline[0].parent, undefined)
  const root = sites.find((s) => s.raw === '#111111')
  assert.equal(root.label, 'root')
  assert.match(root.parent, /^obj@\d+$/)
  const nestedHover = sites.find((s) => s.raw === '#222222')
  assert.equal(nestedHover.label, '&:hover')
  assert.notEqual(nestedHover.group, root.group)
})

test('detectHardcoded (0.5.1): a block opened before an interpolation stays open across quasis', () => {
  const src = 'const C = styled.div`\n  &:hover {\n    color: ${(p) => p.c};\n    background: #000000;\n  }\n  color: #ffffff;\n`'
  const sites = detectHardcoded(src, 'y.jsx')
  const bg = sites.find((s) => s.raw === '#000000')
  const text = sites.find((s) => s.raw === '#ffffff')
  assert.equal(bg.loc.line, 4)
  assert.equal(bg.label, '&:hover')
  assert.equal(text.loc.line, 6)
  assert.match(text.group, /:b0$/)
  assert.equal(bg.parent, text.group)
})

test('detectHardcoded (0.5.1): the legacy fixture still yields exactly 8 sites (group is additive)', () => {
  const sites = detectHardcoded(fixture('Button.legacy.jsx'), 'Button.legacy.jsx')
  assert.equal(sites.length, 8)
  assert.ok(sites.every((s) => typeof s.group === 'string'))
})
