// P1 acceptance: against sorb-demo's real resolved.json, mapToToken binds the
// legacy Button fixture's hardcoded values to the SAME tokens annotateTokens.js
// would, with the documented auto/review split. Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildTokenIndex, matchColor, matchDimension } from '../annotateTokens.js'
import { detectHardcoded } from './detectHardcoded.js'
import { mapToToken, statusFor, AUTO_THRESHOLD, resolveCssVar } from './mapToToken.js'

const here = dirname(fileURLToPath(import.meta.url))
const RESOLVED = JSON.parse(
  readFileSync(
    join(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json'),
    'utf-8',
  ),
)
const index = buildTokenIndex(RESOLVED)

const site = (raw, role, prop = 'x') => ({ file: 'f', loc: { line: 1, column: 0 }, prop, raw, role })

test('P1: #0f65ef as bg → button.primary.bg.default, auto (exact, on-role, single bg)', () => {
  const m = mapToToken(site('#0f65ef', 'bg'), index, RESOLVED)
  assert.equal(m.tokenId, 'button.primary.bg.default')
  assert.equal(m.cssVar, '--button-primary-bg-default')
  assert.equal(m.confidence, 1.0)
  assert.equal(m.offRole, false)
  assert.equal(statusFor(m), 'auto')
})

test('P1: 4 and 4px as radius → button.radius, auto', () => {
  for (const raw of ['4', '4px']) {
    const m = mapToToken(site(raw, 'radius'), index, RESOLVED)
    assert.equal(m.tokenId, 'button.radius', `raw=${raw}`)
    assert.equal(m.cssVar, '--button-radius')
    assert.equal(statusFor(m), 'auto')
  }
})

test('P1: white as text → a *.text.*default* token, in review (ambiguous: many text candidates)', () => {
  const m = mapToToken(site('#ffffff', 'text'), index, RESOLVED)
  assert.ok(/\.text\..*default$/.test(m.tokenId), `got ${m.tokenId}`)
  assert.equal(m.tokenId, 'button.primary.text.default')
  assert.ok(m.candidates.length > 1)
  assert.equal(m.confidence, 0.6)
  assert.equal(statusFor(m), 'review')
})

test('P1: binding is byte-identical to annotateTokens matchColor/matchDimension', () => {
  // Same index, same matcher → same token. This is the no-drift guarantee.
  assert.equal(
    mapToToken(site('#0f65ef', 'bg'), index, RESOLVED).tokenId,
    matchColor(index, '#0f65ef', 'bg').token,
  )
  assert.equal(
    mapToToken(site('#0f65ef', 'border'), index, RESOLVED).tokenId,
    matchColor(index, '#0f65ef', 'border').token,
  )
  assert.equal(
    mapToToken(site('4px', 'radius'), index, RESOLVED).tokenId,
    matchDimension(index, '4px', 'radius').token,
  )
})

test('P1: a value with no token → unmapped, confidence 0', () => {
  const m = mapToToken(site('#123456', 'bg'), index, RESOLVED)
  assert.equal(m.tokenId, null)
  assert.equal(m.confidence, 0)
  assert.equal(statusFor(m), 'unmapped')
})

test('P1: an off-role bind is medium confidence → review', () => {
  // #0f65ef has no `.text` token in sorb-demo? It does NOT — narrow to a value
  // that only carries one role and force the wrong role. white only carries
  // bg/text tokens; asking for 'border' falls back off-role.
  const m = mapToToken(site('#ffffff', 'border'), index, RESOLVED)
  assert.equal(m.offRole, true)
  assert.equal(statusFor(m), 'review')
})

test('P1: AUTO_THRESHOLD sits between medium (0.6) and high (1.0)', () => {
  assert.ok(0.6 < AUTO_THRESHOLD && AUTO_THRESHOLD <= 1.0)
})

test('P1: resolveCssVar prefers the resolved map, falls back to id derivation', () => {
  assert.equal(resolveCssVar('button.radius', RESOLVED), '--button-radius')
  assert.equal(resolveCssVar('a.b.c', undefined), '--a-b-c')
})

test('P1: end-to-end over the legacy fixture maps the expected auto set', () => {
  const src = readFileSync(join(here, '__fixtures__', 'Button.legacy.jsx'), 'utf-8')
  const sites = detectHardcoded(src, 'Button.legacy.jsx')
  const mapped = sites.map((s) => ({ s, m: mapToToken(s, index, RESOLVED) }))
  // bg #0F65EF and radius 4/4px must be auto.
  const bg = mapped.find((x) => x.s.role === 'bg')
  assert.equal(bg.m.tokenId, 'button.primary.bg.default')
  assert.equal(statusFor(bg.m), 'auto')
  const rad = mapped.find((x) => x.s.role === 'radius')
  assert.equal(rad.m.tokenId, 'button.radius')
  assert.equal(statusFor(rad.m), 'auto')
})
