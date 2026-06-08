// P1 acceptance: buildReport produces scored AdaptRow[] with the auto/review/
// unmapped split, and writeReport writes JSON to .sorb/. Run: node --test src/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildTokenIndex } from '../annotateTokens.js'
import { detectHardcoded } from './detectHardcoded.js'
import { buildReport, summarize, writeReport } from './report.js'

const here = dirname(fileURLToPath(import.meta.url))
const RESOLVED = JSON.parse(
  readFileSync(join(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json'), 'utf-8'),
)
const index = buildTokenIndex(RESOLVED)
const fixtureSrc = readFileSync(join(here, '__fixtures__', 'Button.legacy.jsx'), 'utf-8')

test('buildReport emits one row per detected site with the full schema', () => {
  const sites = detectHardcoded(fixtureSrc, 'Button.legacy.jsx')
  const rows = buildReport(sites, index, RESOLVED)
  assert.equal(rows.length, sites.length)
  for (const r of rows) {
    for (const k of ['file', 'loc', 'prop', 'raw', 'tokenId', 'cssVar', 'confidence', 'candidates', 'status']) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, k), `missing ${k}`)
    }
    assert.ok(['auto', 'review', 'unmapped'].includes(r.status))
  }
})

test('buildReport splits the legacy fixture into auto/review correctly', () => {
  const sites = detectHardcoded(fixtureSrc, 'Button.legacy.jsx')
  const rows = buildReport(sites, index, RESOLVED)
  const bg = rows.find((r) => r.prop === 'backgroundColor')
  assert.equal(bg.tokenId, 'button.primary.bg.default')
  assert.equal(bg.status, 'auto')
  const rad = rows.find((r) => r.prop === 'borderRadius')
  assert.equal(rad.tokenId, 'button.radius')
  assert.equal(rad.status, 'auto')
  // white text is ambiguous → review
  const text = rows.find((r) => r.prop === 'color')
  assert.equal(text.status, 'review')
})

test('summarize counts statuses and totals', () => {
  const rows = buildReport(detectHardcoded(fixtureSrc, 'f'), index, RESOLVED)
  const s = summarize(rows)
  assert.equal(s.total, rows.length)
  assert.equal(s.auto + s.review + s.unmapped, rows.length)
  assert.ok(s.auto >= 1)
})

test('writeReport writes .sorb/adapt-report.json with valid JSON', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sorb-adapt-'))
  try {
    const rows = buildReport(detectHardcoded(fixtureSrc, 'f'), index, RESOLVED)
    const path = writeReport(rows, cwd)
    assert.ok(existsSync(path))
    assert.equal(path, join(cwd, '.sorb', 'adapt-report.json'))
    const back = JSON.parse(readFileSync(path, 'utf-8'))
    assert.deepEqual(back, rows)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
