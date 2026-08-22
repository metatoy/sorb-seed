// cli.js wiring test. Deliberately does NOT exercise a real render (that would
// launch a real browser) — it drives the `--job=` path with an invalid job
// (missing `url`), which renderJob rejects BEFORE ever touching the page pool
// (see worker.js: the url check runs first). That proves the CLI's NDJSON
// error-emission + pool-lifecycle wiring without needing Playwright/a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from './cli.js'

function captureStdout(fn) {
  const lines = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => {
    lines.push(String(chunk))
    return true
  }
  return fn().finally(() => {
    process.stdout.write = original
  }).then(() => lines.join(''))
}

test('cli main(): --job= with a missing url emits a {t:"error"} NDJSON line, not a throw', async () => {
  const output = await captureStdout(() => main(['node', 'cli.js', `--job=${JSON.stringify({})}`]))
  const lines = output.trim().split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  const msg = JSON.parse(lines[0])
  assert.equal(msg.t, 'error')
  assert.match(msg.message, /url is required/)
  assert.deepEqual(msg.job, {})
})

test('cli main(): --job-file= reads the job from disk', async () => {
  const { writeFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { randomUUID } = await import('node:crypto')
  const path = join(tmpdir(), `sorb-cli-test-${randomUUID()}.json`)
  await writeFile(path, JSON.stringify({}))
  try {
    const output = await captureStdout(() => main(['node', 'cli.js', `--job-file=${path}`]))
    const msg = JSON.parse(output.trim())
    assert.equal(msg.t, 'error')
    assert.match(msg.message, /url is required/)
  } finally {
    await rm(path, { force: true })
  }
})
