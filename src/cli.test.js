// Smoke tests for the `sorb-seed` CLI entrypoint — --help / --version / unknown
// command dispatch (GFP RC1 Part 2 · D4). Spawns the real bin so exit codes and
// stdout/stderr are exercised end-to-end. Run: `node --test src/cli.test.js`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(here, 'cli.js')
const pkgVersion = JSON.parse(
  readFileSync(resolve(here, '..', 'package.json'), 'utf-8'),
).version

const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' })

test('--help prints usage, lists resolve+capture, exits 0', () => {
  const r = run(['--help'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage: sorb-seed/)
  assert.match(r.stdout, /\bresolve\b/)
  assert.match(r.stdout, /\bcapture\b/)
})

test('-h is an alias for --help', () => {
  const r = run(['-h'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage: sorb-seed/)
})

test('--version prints the package.json version, exits 0', () => {
  const r = run(['--version'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), pkgVersion)
})

test('-v is an alias for --version', () => {
  const r = run(['-v'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), pkgVersion)
})

test('unknown command exits 1 and points at --help', () => {
  const r = run(['bogus'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Unknown command: bogus/)
  assert.match(r.stderr, /--help/)
})

// ── push-capture (storybook-capture-hosting.md §3) ───────────────────────────

test('--help documents push-capture, --upload, and the env-only SORB_CLOUD_KEY rule', () => {
  const r = run(['--help'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\bpush-capture\b/)
  assert.match(r.stdout, /--upload/)
  assert.match(r.stdout, /SORB_CLOUD_KEY/)
  assert.match(r.stdout, /never put keys in\s+sorb\.config\.json/)
})

test('push-capture without SORB_CLOUD_KEY exits 1 with the missing-key message before any network', () => {
  const env = { ...process.env, SORB_CLOUD_PROJECT: '0b8e6a3e-3f2c-4c9e-9a4b-2d1f0c7e5a10' }
  delete env.SORB_CLOUD_KEY
  const r = spawnSync(process.execPath, [CLI, 'push-capture'], { encoding: 'utf-8', env, cwd: here })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /SORB_CLOUD_KEY/)
  assert.match(r.stderr, /sorb_sk_/)
})

test('push-capture without a project id exits 1 and names the three ways to set it', () => {
  const env = { ...process.env, SORB_CLOUD_KEY: 'sorb_sk_test' }
  delete env.SORB_CLOUD_PROJECT
  const r = spawnSync(process.execPath, [CLI, 'push-capture'], { encoding: 'utf-8', env, cwd: here })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--project=<uuid>/)
  assert.match(r.stderr, /SORB_CLOUD_PROJECT/)
})
