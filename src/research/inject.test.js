import test from 'node:test'
import assert from 'node:assert/strict'
import { perturbHex, offScalePx, lowContrastFg, applyInjections } from './inject.js'
import { violatesAA } from './contrast.js'
import { detectHardcoded } from '../adapt/detectHardcoded.js'
import { buildTokenIndex } from '../annotateTokens.js'
import { mapToToken } from '../adapt/mapToToken.js'

const RESOLVED = [
  { id: 'color.white', cssVar: '--color-white', value: '#ffffff', tier: 'primitive', type: 'color' },
  { id: 'color.black', cssVar: '--color-black', value: '#000000', tier: 'primitive', type: 'color' },
  { id: 'color.blue.500', cssVar: '--color-blue-500', value: '#0f65ef', tier: 'primitive', type: 'color' },
  { id: 'color.charcoal', cssVar: '--color-charcoal', value: '#4a4a4a', tier: 'semantic', type: 'color' },
  { id: 'radius.200', cssVar: '--radius-200', value: '4px', tier: 'primitive', type: 'dimension' },
  { id: 'radius.400', cssVar: '--radius-400', value: '8px', tier: 'primitive', type: 'dimension' },
]
const palette = {
  colorValues: new Set(RESOLVED.filter((t) => t.type === 'color').map((t) => t.value)),
  dimValues: new Set(RESOLVED.filter((t) => t.type === 'dimension').map((t) => t.value)),
}

const COMP = {
  name: 'S0',
  source:
    "export const S0 = () => <div style={{ backgroundColor: 'var(--color-blue-500, #0f65ef)', color: 'var(--color-charcoal, #4a4a4a)', borderRadius: 'var(--radius-200, 4px)' }}>S0</div>",
  bindings: [
    { prop: 'backgroundColor', role: 'bg', cssVar: '--color-blue-500', tokenId: 'color.blue.500', value: '#0f65ef' },
    { prop: 'color', role: 'text', cssVar: '--color-charcoal', tokenId: 'color.charcoal', value: '#4a4a4a' },
    { prop: 'borderRadius', role: 'radius', cssVar: '--radius-200', tokenId: 'radius.200', value: '4px' },
  ],
}

test('perturbHex: yields a different, valid hex not in the token set', () => {
  const p = perturbHex('#0f65ef', palette.colorValues)
  assert.match(p, /^#[0-9a-f]{6}$/)
  assert.notEqual(p, '#0f65ef')
  assert.ok(!palette.colorValues.has(p))
})

test('offScalePx: moves off the declared scale', () => {
  const v = offScalePx('4px', palette.dimValues)
  assert.match(v, /^\d+px$/)
  assert.ok(!palette.dimValues.has(v)) // not 4px or 8px
})

test('lowContrastFg: injected text color is oracle-verified to FAIL AA vs bg', () => {
  for (const bg of ['#ffffff', '#0f65ef', '#000000', '#4a4a4a']) {
    const fg = lowContrastFg(bg)
    assert.equal(violatesAA(fg, bg), true, `expected ${fg} on ${bg} to violate AA`)
  }
})

test('applyInjections: benign binds cleanly, drift deviates, locs match the detector', () => {
  const plan = [
    { role: 'bg', class: 'benign' },
    { role: 'text', class: 'stale-value', causal: 'stale' },
    { role: 'radius', class: 'scale-violation' },
  ]
  const { source, labels } = applyInjections(COMP, plan, palette)
  const index = buildTokenIndex(RESOLVED)

  const bg = labels.find((l) => l.role === 'bg')
  const text = labels.find((l) => l.role === 'text')
  const radius = labels.find((l) => l.role === 'radius')

  // benign: literal equals the token value → maps back exactly, isDrift=false
  assert.equal(bg.isDrift, false)
  assert.equal(bg.raw, '#0f65ef')
  assert.equal(mapToToken({ raw: bg.raw, role: 'bg' }, index, RESOLVED).tokenId, 'color.blue.500')

  // stale-value drift: perturbed off its token → no exact bind, isDrift=true
  assert.equal(text.isDrift, true)
  assert.notEqual(text.raw, '#4a4a4a')
  assert.equal(mapToToken({ raw: text.raw, role: 'text' }, index, RESOLVED).tokenId, null)

  // scale-violation drift: off the declared scale
  assert.equal(radius.isDrift, true)
  assert.equal(radius.class, 'scale-violation')
  assert.ok(!palette.dimValues.has(radius.raw))

  // every label's loc matches what the real detector reports
  const sites = detectHardcoded(source, 'S0')
  assert.equal(sites.length, 3)
  for (const l of labels) {
    const st = sites.find((s) => s.role === l.role)
    assert.ok(st, `detector found a site for role ${l.role}`)
    assert.deepEqual(st.loc, l.loc)
    assert.equal(st.raw, l.raw)
  }
})

test('applyInjections: contrast-break carries an oracle-verified violation', () => {
  const { labels } = applyInjections(COMP, [{ role: 'text', class: 'contrast-break' }], palette)
  const l = labels[0]
  assert.equal(l.class, 'contrast-break')
  assert.equal(l.isDrift, true)
  assert.equal(l.contrast.violates, true)
  assert.ok(l.contrast.ratio < l.contrast.threshold)
})
