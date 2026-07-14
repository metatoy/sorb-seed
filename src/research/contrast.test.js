import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHex, relativeLuminance, contrastRatio, violatesAA, AA_NORMAL } from './contrast.js'

test('parseHex: #rgb, #rrggbb, and rejects junk', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 })
  assert.deepEqual(parseHex('#0f65ef'), { r: 15, g: 101, b: 239 })
  assert.equal(parseHex('rgb(0,0,0)'), null)
  assert.equal(parseHex('#zzz'), null)
  assert.equal(parseHex('not a color'), null)
})

test('relativeLuminance: white=1, black=0', () => {
  assert.equal(relativeLuminance('#ffffff'), 1)
  assert.equal(relativeLuminance('#000000'), 0)
  assert.equal(relativeLuminance('rgb(0,0,0)'), null)
})

test('contrastRatio: black on white = 21 (the maximum)', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
  // symmetric
  assert.equal(contrastRatio('#000000', '#ffffff'), contrastRatio('#ffffff', '#000000'))
})

test('violatesAA: passing vs failing pairs; unknown → null (never a false pass)', () => {
  assert.equal(violatesAA('#000000', '#ffffff'), false) // 21:1 passes
  assert.equal(violatesAA('#bbbbbb', '#ffffff'), true) // ~1.6:1 fails
  assert.equal(violatesAA('#4a4a4a', '#ffffff', AA_NORMAL), false) // charcoal on white ~9:1 passes
  assert.equal(violatesAA('rgba(0,0,0,0.1)', '#ffffff'), null) // undecidable → null
})
