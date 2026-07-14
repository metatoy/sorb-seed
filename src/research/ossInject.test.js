import test from 'node:test'
import assert from 'node:assert/strict'
import { injectFile } from './ossInject.js'
import { detectHardcoded } from '../adapt/detectHardcoded.js'
import { mulberry32 } from './prng.js'

const RESOLVED = [
  { id: 'color.white', cssVar: '--color-white', value: '#ffffff', tier: 'primitive', type: 'color' },
  { id: 'color.blue.500', cssVar: '--color-blue-500', value: '#0f65ef', tier: 'primitive', type: 'color' },
  { id: 'color.charcoal', cssVar: '--color-charcoal', value: '#4a4a4a', tier: 'semantic', type: 'color' },
  { id: 'color.grey', cssVar: '--color-grey', value: '#757575', tier: 'primitive', type: 'color' },
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]
const PAL = {
  colorTokens: RESOLVED.filter((t) => t.type === 'color'),
  dimTokens: RESOLVED.filter((t) => t.type === 'dimension'),
  colorValues: new Set(RESOLVED.filter((t) => t.type === 'color').map((t) => t.value)),
  dimValues: new Set(RESOLVED.filter((t) => t.type === 'dimension').map((t) => t.value)),
  colors: RESOLVED.filter((t) => t.type === 'color').map((t) => t.value),
}

// Real-shaped source: px string, bare numerics, hex colors, a bg + a text.
const SRC = [
  'export const A = () => (',
  "  <div style={{ padding: '20px', maxWidth: 420, background: '#0f65ef' }}>",
  "    <span style={{ color: '#4a4a4a', fontSize: 16 }}>hi</span>",
  '  </div>',
  ')',
].join('\n')

test('injectFile: produces labeled sites with perfect loc integrity on real-shaped source', () => {
  const rng = mulberry32(1425443)
  const { source, labels } = injectFile('A.jsx', SRC, rng, PAL, { maxPerFile: 6 })
  assert.ok(labels.length > 0, 'injected at least one site')
  // the mutated source still parses (detector does not throw / returns sites)
  const sites = detectHardcoded(source, 'A.jsx')
  assert.ok(sites.length > 0)
  for (const l of labels) {
    // every label's injected value is present on its recorded line
    const line = source.split('\n')[l.loc.line - 1] || ''
    assert.ok(line.includes(l.raw), `label raw ${l.raw} present on line ${l.loc.line}`)
    // ground-truth shape is well-formed
    assert.equal(typeof l.isDrift, 'boolean')
    assert.ok(['benign', 'benign-literal', 'stale-value', 'scale-violation', 'contrast-break'].includes(l.class))
    assert.deepEqual(
      detectHardcoded(source, 'A.jsx').find((s) => s.loc.line === l.loc.line && s.loc.column === l.loc.column)?.raw,
      l.raw,
      'label loc matches the detector'
    )
  }
})

// styled-components idiom: values live inside a template literal, so the
// detector reports them at the template-chunk loc. The injector must still
// place correct labels via globally-unique injected values.
const STYLED = [
  'import styled from "styled-components"',
  'export const Btn = styled.button`',
  '  border-radius: 32px;',
  '  margin-right: 4px;',
  '  padding: 12px;',
  '  line-height: 24px;',
  '`',
].join('\n')

test('injectFile: styled-components — every label is a UNIQUELY locatable injected value', () => {
  const rng = mulberry32(1425443)
  const { source, labels } = injectFile('Btn.jsx', STYLED, rng, PAL, { maxPerFile: 8 })
  assert.ok(labels.length > 0, 'produced labels from a styled-components file')
  const finalSites = detectHardcoded(source, 'Btn.jsx')
  for (const l of labels) {
    // strict-verify guarantee: the injected value occurs exactly once in source
    assert.equal(source.split(l.raw).length - 1, 1, `injected value ${l.raw} is unique`)
    // and the detector re-finds exactly one site carrying it
    assert.equal(finalSites.filter((s) => s.raw === l.raw).length, 1, `detector finds ${l.raw} once`)
    assert.ok(['scale-violation', 'stale-value'].includes(l.class), 'template idiom yields drift classes')
  }
})

test('injectFile: is deterministic for a fixed seed', () => {
  const a = injectFile('A.jsx', SRC, mulberry32(7), PAL, {})
  const b = injectFile('A.jsx', SRC, mulberry32(7), PAL, {})
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})
