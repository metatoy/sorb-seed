// CLI/runner + glob coverage: parseAdaptArgs flags, globFiles matching, and
// runAdapt report mode over a temp project. Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { parseAdaptArgs, collectSites, runAdapt } from './adaptCli.js'
import { globFiles } from './glob.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureSrc = readFileSync(join(here, '__fixtures__', 'Button.legacy.jsx'), 'utf-8')
const resolvedSrc = readFileSync(
  join(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json'), 'utf-8',
)

test('parseAdaptArgs: defaults + flag forms (space and =)', () => {
  const d = parseAdaptArgs([])
  assert.equal(d.mode, 'report')
  assert.equal(d.write, false)
  assert.ok(d.src.includes('**'))
  const o = parseAdaptArgs(['--src', 'app/**/*.tsx', '--resolved=tok.json', '--mode', 'codemod', '--write'])
  assert.equal(o.src, 'app/**/*.tsx')
  assert.equal(o.resolved, 'tok.json')
  assert.equal(o.mode, 'codemod')
  assert.equal(o.write, true)
})

test('globFiles: matches **/*.{ext} and skips node_modules', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-glob-'))
  try {
    mkdirSync(join(cwd, 'src', 'ui'), { recursive: true })
    mkdirSync(join(cwd, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'ui', 'Button.jsx'), 'x')
    writeFileSync(join(cwd, 'src', 'ui', 'Card.tsx'), 'x')
    writeFileSync(join(cwd, 'src', 'readme.md'), 'x')
    writeFileSync(join(cwd, 'node_modules', 'pkg', 'Evil.jsx'), 'x')
    const hits = globFiles('src/**/*.{jsx,tsx}', cwd).map((p) => p.replace(cwd, ''))
    assert.equal(hits.length, 2)
    assert.ok(hits.some((h) => h.endsWith('Button.jsx')))
    assert.ok(hits.some((h) => h.endsWith('Card.tsx')))
    assert.ok(!hits.some((h) => h.includes('node_modules')))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('collectSites: aggregates sites across files with repo-relative file paths', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-collect-'))
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'Button.jsx'), fixtureSrc)
    const { sites, files } = collectSites('src/**/*.jsx', cwd)
    assert.equal(files.length, 1)
    assert.equal(sites.length, 8)
    assert.ok(sites.every((s) => s.file === join('src', 'Button.jsx')))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runAdapt report mode: writes .sorb/adapt-report.json + returns summary', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-adapt-run-'))
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true })
    mkdirSync(join(cwd, '.sorb'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'Button.jsx'), fixtureSrc)
    writeFileSync(join(cwd, '.sorb', 'resolved.json'), resolvedSrc)
    const res = await runAdapt(parseAdaptArgs(['--src', 'src/**/*.jsx']), cwd)
    assert.equal(res.ok, true)
    assert.equal(res.mode, 'report')
    assert.equal(res.summary.total, 8)
    assert.ok(res.summary.auto >= 2)
    assert.ok(existsSync(join(cwd, '.sorb', 'adapt-report.json')))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runAdapt: missing resolved map → ok:false with a helpful error', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-adapt-miss-'))
  try {
    const res = await runAdapt(parseAdaptArgs([]), cwd)
    assert.equal(res.ok, false)
    assert.match(res.error, /resolved map not found/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('runAdapt shim mode: emits a legacyMap of the auto set', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-adapt-shim-'))
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true })
    mkdirSync(join(cwd, '.sorb'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'Button.jsx'), fixtureSrc)
    writeFileSync(join(cwd, '.sorb', 'resolved.json'), resolvedSrc)
    const res = await runAdapt(parseAdaptArgs(['--src', 'src/**/*.jsx', '--mode', 'shim']), cwd)
    assert.equal(res.mode, 'shim')
    assert.ok(res.legacyMap.length >= 2)
    for (const e of res.legacyMap) {
      assert.ok(e.raw && e.cssVar && e.tokenId)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
