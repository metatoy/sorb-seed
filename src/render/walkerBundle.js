// Bundles the SAME in-page walker `capture.js` uses (captureRoot →
// `window.__sorbCapture`) into a single IIFE string, exactly like
// captureCli.js's private `buildWalkerBundle` and the cloud's
// runnerEntry.mjs. Factored out here so the render worker can inject it into
// an arbitrary app page (not just a Storybook iframe) without duplicating the
// walker itself — only the bundling call is repeated, the capture ALGORITHM
// (capture.js) is the single shared source.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'

/** @returns {Promise<string>} an IIFE that installs `window.__sorbCapture`. */
export const buildWalkerBundle = async () => {
  const here = dirname(new URL(import.meta.url).pathname)
  const out = await build({
    entryPoints: [resolve(here, '../capture.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    target: 'es2020',
  })
  return out.outputFiles[0].text
}
