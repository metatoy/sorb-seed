// Tests for the `figma-plugin` SourceConnector (figma-source-connector.md
// §1a). Mirrors the contract-registration style of sorb-core's
// connectors.test.js dummy-source test, plus exercises readTokens() as a
// bridge CLIENT against a mocked `fetch` (no real juice server needed —
// the contract is "GET /tokens/figma returns { tokens: ResolvedToken[] }").
import test from 'node:test'
import assert from 'node:assert/strict'
import { connectors, getSource } from '@sorb/core'
import { figmaPluginConnector, bridgeOriginOf } from './figmaPlugin.js'

test('registers under id "figma-plugin" and round-trips via getSource (contract dispatch)', () => {
  assert.equal(getSource('figma-plugin'), figmaPluginConnector)
  assert.equal(connectors.source.get('figma-plugin'), figmaPluginConnector)
})

test('bridgeOriginOf: defaults to the juice dev port, honors seed.bridgeOrigin, strips trailing slash', () => {
  assert.equal(bridgeOriginOf({}), 'http://localhost:7777')
  assert.equal(bridgeOriginOf(), 'http://localhost:7777')
  assert.equal(bridgeOriginOf({ seed: { bridgeOrigin: 'http://localhost:9999/' } }), 'http://localhost:9999')
  assert.equal(bridgeOriginOf({ bridgeOrigin: 'http://example.com/' }), 'http://example.com')
})

test('readTokens: reads the resolved-map array back from GET /tokens/figma', async (t) => {
  const tokens = [{ id: 'color.bg.primary', cssVar: '--color-bg-primary', value: '#ffffff', tier: 'primitive', type: 'color' }]
  const calls = []
  const realFetch = global.fetch
  global.fetch = async (url) => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => ({ fileKey: 'abc', exportedAt: '2026-08-29T00:00:00Z', tokens }) }
  }
  t.after(() => { global.fetch = realFetch })

  const got = await figmaPluginConnector.readTokens({ seed: { bridgeOrigin: 'http://localhost:7777' } })
  assert.deepEqual(got, tokens)
  assert.equal(calls[0], 'http://localhost:7777/tokens/figma')
})

test('readTokens: 404 (no export yet) throws an actionable "Export variables" error', async (t) => {
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'No Figma export yet.' }) })
  t.after(() => { global.fetch = realFetch })

  await assert.rejects(() => figmaPluginConnector.readTokens({}), /Export variables/)
})

test('readTokens: non-2xx, non-404 → surfaces the HTTP status', async (t) => {
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
  t.after(() => { global.fetch = realFetch })

  await assert.rejects(() => figmaPluginConnector.readTokens({}), /HTTP 500/)
})

test('readTokens: network failure (bridge not running) → actionable error naming the origin', async (t) => {
  const realFetch = global.fetch
  global.fetch = async () => { throw new Error('ECONNREFUSED') }
  t.after(() => { global.fetch = realFetch })

  await assert.rejects(() => figmaPluginConnector.readTokens({}), /could not reach the bridge at http:\/\/localhost:7777/)
})

test('listUnits/captureGeometry: v1 tokens-first scope — throw a clear not-yet-implemented error, not a silent no-op', async () => {
  await assert.rejects(() => figmaPluginConnector.listUnits({}), /not implemented in v1/)
  await assert.rejects(() => figmaPluginConnector.captureGeometry({ id: 'u1' }, {}), /not implemented in v1/)
})
