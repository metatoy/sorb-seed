// Tests for the capture token-annotator (auto-bind: property affinity + tier
// precedence). Run: node --test  (zero-dep; resolves @sorb/core via the workspace link).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeColor,
  classifyColor,
  normalizeDimension,
  buildTokenIndex,
  matchColor,
  matchDimension,
  annotateTree,
} from './annotateTokens.js'

// A resolved map where one color value (#0f65ef) is shared across a component
// bg, a component border, a semantic bg, and a semantic border — so the tests
// exercise BOTH role affinity (which property) and tier precedence (the tiebreak).
const RESOLVED = [
  { id: 'button.primary.bg.default', cssVar: '--button-primary-bg-default', value: '#0f65ef', tier: 'component', type: 'color' },
  { id: 'button.primary.border.default', cssVar: '--button-primary-border-default', value: '#0F65EF', tier: 'component', type: 'color' },
  { id: 'color.action.primary', cssVar: '--color-action-primary', value: '#0f65ef', tier: 'semantic', type: 'color' },
  { id: 'color.border.default', cssVar: '--color-border-default', value: '#0f65ef', tier: 'semantic', type: 'color' },
  { id: 'button.primary.text.default', cssVar: '--button-primary-text-default', value: '#ffffff', tier: 'component', type: 'color' },
  { id: 'button.radius', cssVar: '--button-radius', value: '4px', tier: 'component', type: 'dimension' },
]

test('normalizeColor handles hex (3/4/6/8), rgb(a), transparent, and rejects junk', () => {
  assert.equal(normalizeColor('#fff'), '#ffffffff')
  assert.equal(normalizeColor('#FFFF'), '#ffffffff')
  assert.equal(normalizeColor('#0f65ef'), '#0f65efff')
  assert.equal(normalizeColor('#0F65EF80'), '#0f65ef80')
  assert.equal(normalizeColor('rgb(15, 101, 239)'), '#0f65efff')
  assert.equal(normalizeColor('rgba(0,0,0,0)'), '#00000000')
  assert.equal(normalizeColor('transparent'), '#00000000')
  assert.equal(normalizeColor('not-a-color'), null)
  assert.equal(normalizeColor(null), null)
})

test('normalizeDimension parses px / unitless / decimals, rejects non-lengths', () => {
  assert.equal(normalizeDimension('4px'), 4)
  assert.equal(normalizeDimension('4'), 4)
  assert.equal(normalizeDimension(8), 8)
  assert.equal(normalizeDimension('2.5px'), 2.5)
  assert.equal(normalizeDimension('-1px'), -1)
  assert.equal(normalizeDimension('1rem'), null)
  assert.equal(normalizeDimension(null), null)
})

test('buildTokenIndex groups tokens by normalized value into colors/dims', () => {
  const idx = buildTokenIndex(RESOLVED)
  assert.equal(idx.colors.get('#0f65efff').length, 4) // four tokens share this color
  assert.equal(idx.colors.get('#ffffffff').length, 1)
  assert.equal(idx.dims.get(4).length, 1)
})

test('matchColor: role affinity picks the right property family', () => {
  const idx = buildTokenIndex(RESOLVED)
  // bg role → only the component bg carries `.bg`
  assert.equal(matchColor(idx, '#0f65ef', 'bg').token, 'button.primary.bg.default')
  // border role → two `.border` cands; tier tiebreak picks component over semantic
  assert.equal(matchColor(idx, '#0f65ef', 'border').token, 'button.primary.border.default')
})

test('matchColor: all matches are kept as candidates regardless of the pick', () => {
  const idx = buildTokenIndex(RESOLVED)
  const res = matchColor(idx, '#0f65ef', 'bg')
  assert.equal(res.candidates.length, 4)
  assert.ok(res.candidates.includes('color.action.primary'))
})

test('matchColor: with no role, tier precedence wins (component beats semantic)', () => {
  const idx = buildTokenIndex(RESOLVED)
  const res = matchColor(idx, '#0f65ef')
  assert.ok(['button.primary.bg.default', 'button.primary.border.default'].includes(res.token))
})

test('matchColor / matchDimension return null token for a value with no match', () => {
  const idx = buildTokenIndex(RESOLVED)
  assert.equal(matchColor(idx, '#123456', 'bg').token, null)
  assert.equal(matchDimension(idx, 99, 'radius').token, null)
})

test('matchDimension binds a radius value to the component radius token', () => {
  const idx = buildTokenIndex(RESOLVED)
  assert.equal(matchDimension(idx, 4, 'radius').token, 'button.radius')
})

test('annotateTree binds a button: fill→bg, stroke→border, radius, TEXT child→text', () => {
  const idx = buildTokenIndex(RESOLVED)
  const node = {
    type: 'FRAME',
    fills: [{ raw: '#0f65ef' }],
    strokes: [{ raw: '#0f65ef' }],
    cornerRadius: 4,
    children: [{ type: 'TEXT', fills: [{ raw: '#ffffff' }] }],
  }
  const out = annotateTree(node, idx)
  assert.equal(out.sorb.tokens.fill, 'button.primary.bg.default')
  assert.equal(out.sorb.tokens.stroke, 'button.primary.border.default')
  assert.equal(out.sorb.tokens.cornerRadius, 'button.radius')
  // a fill on a TEXT node is foreground → the `text` role
  assert.equal(out.children[0].sorb.tokens.fill, 'button.primary.text.default')
})

test('annotateTree leaves unmatched nodes without a `sorb` key', () => {
  const idx = buildTokenIndex(RESOLVED)
  const node = { type: 'FRAME', fills: [{ raw: '#abcdef' }] }
  const out = annotateTree(node, idx)
  assert.equal(out.sorb, undefined)
})

// ── REC-6: CSS named-color support + unparseable/no-match marker ──────────────

test('REC-6: normalizeColor resolves common CSS named colors', () => {
  assert.equal(normalizeColor('red'), '#ff0000ff')
  assert.equal(normalizeColor('WHITE'), '#ffffffff') // case-insensitive
  assert.equal(normalizeColor('rebeccapurple'), null) // not in the minimal table → no-match
  assert.equal(normalizeColor('purple'), '#800080ff')
})

test('REC-6: classifyColor distinguishes ok / no-match / unparseable', () => {
  assert.deepEqual(classifyColor('#0f65ef'), { hex: '#0f65efff', status: 'ok' })
  assert.deepEqual(classifyColor('blue'), { hex: '#0000ffff', status: 'ok' })
  // a `#`-prefixed but malformed value is recognized-but-unparseable, not just no-match
  assert.equal(classifyColor('#ggg').status, 'unparseable')
  assert.equal(classifyColor('#12').status, 'unparseable')
  assert.equal(classifyColor('rgb(1,2)').status, 'unparseable')
  assert.equal(classifyColor('rgb(x,y,z)').status, 'unparseable')
  // a clean non-color (e.g. a dimension) is no-match, not unparseable
  assert.equal(classifyColor('4px').status, 'no-match')
  assert.equal(classifyColor('not-a-color').status, 'no-match')
  assert.equal(classifyColor(null).status, 'no-match')
})

test('REC-6: normalizeColor tolerates exotic whitespace (NBSP) around a hex', () => {
  assert.equal(normalizeColor(' #0f65ef '), '#0f65efff')
})

// ── REC-1: buildTokenIndex.dropped[] for vanished tokens ─────────────────────

test('REC-1: buildTokenIndex still destructures to {colors, dims} (backward-compat)', () => {
  const { colors, dims, dropped } = buildTokenIndex(RESOLVED)
  assert.ok(colors.get('#0f65efff'))
  assert.ok(dims.get(4))
  assert.deepEqual(dropped, []) // a clean map drops nothing
})

test('REC-1: an unparseable-color token is dropped with a marker reason', () => {
  const { dropped } = buildTokenIndex([
    { id: 'color.bad', cssVar: '--bad', value: '#ggg', tier: 'semantic', type: 'color' },
  ])
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].id, 'color.bad')
  assert.equal(dropped[0].reason, 'unparseable-color')
})

test('REC-1: a no-match token (NBSP-only / junk) is dropped as no-match', () => {
  const { dropped } = buildTokenIndex([
    { id: 'space.weird', cssVar: '--w', value: ' ', tier: 'primitive', type: 'dimension' },
  ])
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].reason, 'no-match')
})

// ── REC-2: unresolved-alias / cycle detection ────────────────────────────────

test('REC-2: a still-wrapped {…} value is dropped as unresolved-alias (not thrown)', () => {
  const { dropped, colors } = buildTokenIndex([
    { id: 'color.action', cssVar: '--a', value: '{color.brand.primary}', tier: 'semantic', type: 'color' },
    { id: 'color.brand.primary', cssVar: '--p', value: '#0f65ef', tier: 'primitive', type: 'color' },
  ])
  const alias = dropped.find((d) => d.id === 'color.action')
  assert.ok(alias)
  assert.equal(alias.reason, 'unresolved-alias')
  // the real token still indexed normally
  assert.ok(colors.get('#0f65efff'))
})

test('REC-2: an A↔B alias cycle is detected and dropped as alias-cycle', () => {
  const { dropped } = buildTokenIndex([
    { id: 'a', cssVar: '--a', value: '{b}', tier: 'semantic', type: 'color' },
    { id: 'b', cssVar: '--b', value: '{a}', tier: 'semantic', type: 'color' },
  ])
  const reasons = dropped.map((d) => d.reason)
  assert.equal(dropped.length, 2)
  assert.ok(reasons.every((r) => r === 'alias-cycle'))
})

// ── pick() off-role fallback → low-confidence diagnostic ─────────────────────

test('off-role fallback bind is surfaced as a low-confidence diagnostic', () => {
  // #ffffff only carries a `.text` token; binding it as a frame `bg` fill is off-role.
  const idx = buildTokenIndex(RESOLVED)
  const node = { type: 'FRAME', fills: [{ raw: '#ffffff' }] }
  const out = annotateTree(node, idx)
  assert.equal(out.sorb.tokens.fill, 'button.primary.text.default') // still binds
  assert.ok(Array.isArray(out.sorb.diagnostics))
  assert.equal(out.sorb.diagnostics[0].kind, 'off-role-bind')
  assert.equal(out.sorb.diagnostics[0].detail.role, 'bg')
})

test('an on-role bind attaches no diagnostics (additive, only when needed)', () => {
  const idx = buildTokenIndex(RESOLVED)
  const node = { type: 'FRAME', fills: [{ raw: '#0f65ef' }] }
  const out = annotateTree(node, idx)
  assert.equal(out.sorb.tokens.fill, 'button.primary.bg.default')
  assert.equal(out.sorb.diagnostics, undefined)
})
