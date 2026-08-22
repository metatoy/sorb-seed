// esbuild-only (no Playwright/browser needed) — proves the render worker
// bundles the SAME walker capture.js/captureCli.js already use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWalkerBundle } from './walkerBundle.js'

test('buildWalkerBundle: produces an IIFE that installs window.__sorbCapture', async () => {
  const bundle = await buildWalkerBundle()
  assert.equal(typeof bundle, 'string')
  assert.ok(bundle.includes('__sorbCapture'))
  assert.ok(bundle.length > 0)
})
