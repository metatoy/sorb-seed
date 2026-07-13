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
