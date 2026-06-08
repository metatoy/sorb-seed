// P3 acceptance: codemod dry-run produces a diff; --write on a fixture COPY
// rewrites to var(--x, original) preserving the fallback; re-detecting the
// rewritten file reports those sites as resolved (var), not hardcoded; and the
// default-branch refusal is enforced. Operates on temp copies — never tracked
// source. Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildTokenIndex } from '../annotateTokens.js'
import { detectHardcoded } from './detectHardcoded.js'
import { buildReport } from './report.js'
import { rewriteSource, runCodemod, varExpr, makeDiff } from './codemod.js'

const here = dirname(fileURLToPath(import.meta.url))
const RESOLVED = JSON.parse(
  readFileSync(join(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json'), 'utf-8'),
)
const index = buildTokenIndex(RESOLVED)
const fixtureSrc = readFileSync(join(here, '__fixtures__', 'Button.legacy.jsx'), 'utf-8')

const autoRows = (file) =>
  buildReport(detectHardcoded(fixtureSrc, file), index, RESOLVED).filter((r) => r.status === 'auto')

test('varExpr builds var(--x, fallback) with the original literal preserved', () => {
  assert.equal(varExpr('--button-radius', '4px'), 'var(--button-radius, 4px)')
})

test('rewriteSource rewrites auto sites to var() and leaves others untouched', () => {
  const rows = autoRows('Button.legacy.jsx')
  const { code, edits } = rewriteSource(fixtureSrc, rows)
  assert.ok(edits >= 2) // at least bg + radius
  assert.ok(code.includes('var(--button-primary-bg-default'))
  assert.ok(code.includes('var(--button-radius'))
  // fallback preserved (byte-identical render until a token applies)
  assert.ok(code.includes('#0F65EF'))
})

test('re-detecting the rewritten source reports the auto sites as resolved (not hardcoded)', () => {
  const rows = autoRows('Button.legacy.jsx')
  const { code } = rewriteSource(fixtureSrc, rows)
  const after = detectHardcoded(code, 'rewritten.jsx')
  // The bg #0F65EF and radius 4/4px sites must no longer be flagged.
  assert.ok(!after.some((s) => s.role === 'bg' && s.raw === '#0F65EF'))
  assert.ok(!after.some((s) => s.role === 'radius'))
})

test('makeDiff produces a reviewable +/- diff', () => {
  const d = makeDiff('f.jsx', 'a\nb\nc', 'a\nB\nc')
  assert.ok(d.includes('-b'))
  assert.ok(d.includes('+B'))
})

test('runCodemod dry-run (no --write) emits a diff and changes nothing on disk', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-codemod-'))
  try {
    const file = 'Button.legacy.jsx'
    const abs = join(cwd, file)
    writeFileSync(abs, fixtureSrc, 'utf-8')
    const rows = autoRows(file)
    const res = await runCodemod(rows, { cwd, write: false, allowBranch: true })
    assert.equal(res.refused, false)
    assert.equal(res.written, false)
    assert.ok(res.changedFiles >= 1)
    assert.ok(res.diff.length > 0)
    // disk untouched
    assert.equal(readFileSync(abs, 'utf-8'), fixtureSrc)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runCodemod --write rewrites the COPY + writes a .bak; rewritten re-detects clean', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-codemod-'))
  try {
    const file = 'Button.legacy.jsx'
    const abs = join(cwd, file)
    writeFileSync(abs, fixtureSrc, 'utf-8')
    const rows = autoRows(file)
    const res = await runCodemod(rows, { cwd, write: true, allowBranch: true })
    assert.equal(res.written, true)
    const rewritten = readFileSync(abs, 'utf-8')
    assert.notEqual(rewritten, fixtureSrc)
    assert.ok(rewritten.includes('var(--button-primary-bg-default'))
    assert.ok(rewritten.includes('#0F65EF')) // fallback preserved
    // .bak preserves the original
    const bak = join(cwd, '.sorb', 'bak', file + '.bak')
    assert.ok(existsSync(bak))
    assert.equal(readFileSync(bak, 'utf-8'), fixtureSrc)
    // re-detect: the auto sites now read as var()
    const after = detectHardcoded(rewritten, file)
    assert.ok(!after.some((s) => s.role === 'bg' && s.raw === '#0F65EF'))
    assert.ok(!after.some((s) => s.role === 'radius'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runCodemod refuses to run on a default branch (main)', async () => {
  // A temp git repo whose current branch is `main`.
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-codemod-main-'))
  try {
    const { execSync } = await import('child_process')
    const git = (c) => execSync(c, { cwd, stdio: 'ignore' })
    git('git init -q')
    git('git symbolic-ref HEAD refs/heads/main')
    // An initial commit so `rev-parse --abbrev-ref HEAD` resolves to 'main'
    // (an unborn branch reports 'HEAD', not the branch name).
    git('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init')
    writeFileSync(join(cwd, 'Button.legacy.jsx'), fixtureSrc, 'utf-8')
    const rows = autoRows('Button.legacy.jsx')
    const res = await runCodemod(rows, { cwd, write: true }) // allowBranch NOT set
    assert.equal(res.refused, true)
    assert.match(res.reason, /default branch/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
