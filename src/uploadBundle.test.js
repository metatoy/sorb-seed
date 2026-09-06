// `sorb-seed push-capture` / `capture --upload` — pure-module tests for the
// bundle upload path (spec/sorb/storybook-capture-hosting.md §3). No cloud, no
// git, no Playwright: fs is a temp dir, fetch/exec are injected.
// Run: `node --test src/uploadBundle.test.js`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CLOUD_URL, UploadError, resolveUploadConfig, resolveSourceSha,
  makeArtifactReader, buildBundlePayload, uploadBundle, runPushCapture, parseUploadFlags,
} from './uploadBundle.js'

const PROJECT = '0b8e6a3e-3f2c-4c9e-9a4b-2d1f0c7e5a10'
const ENV_OK = { SORB_CLOUD_KEY: 'sorb_sk_test', SORB_CLOUD_PROJECT: PROJECT }

/** A minimal on-disk project: index → 2 artifacts (one shared by 2 stories) + resolved. */
const makeProject = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sorb-seed-upload-'))
  mkdirSync(join(dir, '.sorb'))
  mkdirSync(join(dir, 'stories'))
  const btn = { schemaVersion: 1, component: 'Button', importPath: './stories/Button.stories.jsx', stories: [
    { id: 'components-button--primary', name: 'Primary', title: 'Components/Button', root: { type: 'FRAME', width: 92, height: 37 } },
    { id: 'components-button--ghost', name: 'Ghost', title: 'Components/Button', root: { type: 'FRAME', width: 80, height: 37 } },
  ] }
  const card = { schemaVersion: 1, component: 'Card', importPath: './stories/Card.stories.jsx', stories: [
    { id: 'components-card--basic', name: 'Basic', title: 'Components/Card', root: { type: 'FRAME', width: 200, height: 120 } },
  ] }
  writeFileSync(join(dir, 'stories/Button.sorb.json'), JSON.stringify(btn))
  writeFileSync(join(dir, 'stories/Card.sorb.json'), JSON.stringify(card))
  const index = {
    schemaVersion: 1,
    generatedAt: '2026-09-06T12:00:00.000Z',
    storybookUrl: 'http://localhost:6006',
    components: [
      { component: 'Button', importPath: './stories/Button.stories.jsx', artifact: 'stories/Button.sorb.json' },
      { component: 'Card', importPath: './stories/Card.stories.jsx', artifact: 'stories/Card.sorb.json' },
    ],
    stories: {
      'components-button--primary': { component: 'Button', artifact: 'stories/Button.sorb.json', title: 'Components/Button', name: 'Primary' },
      'components-button--ghost': { component: 'Button', artifact: 'stories/Button.sorb.json', title: 'Components/Button', name: 'Ghost' },
      'components-card--basic': { component: 'Card', artifact: 'stories/Card.sorb.json', title: 'Components/Card', name: 'Basic' },
    },
  }
  writeFileSync(join(dir, '.sorb/index.json'), JSON.stringify(index))
  writeFileSync(join(dir, '.sorb/resolved.json'), JSON.stringify([{ id: 'button.primary.bg', cssVar: '--button-primary-bg', value: '#0f65ef', tier: 'component', type: 'color' }]))
  return { dir, index }
}

const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init })
  return { ok: true, status: 201, json: async () => ({ bundleId: 'b-1', stories: 3, artifacts: 2, bytes: 1234, droppedKeys: 0, pruned: 0 }) }
}

// ── config precedence ─────────────────────────────────────────────────────────

test('resolveUploadConfig: flag > env > sorb.config.json; default cloud URL', () => {
  const cfg = { cloud: { url: 'https://cfg.example', projectId: PROJECT } }
  const env = { SORB_CLOUD_KEY: 'sorb_sk_x' }
  assert.deepEqual(resolveUploadConfig({}, env, cfg), { cloudUrl: 'https://cfg.example', projectId: PROJECT, apiKey: 'sorb_sk_x' })
  const env2 = { ...env, SORB_CLOUD_URL: 'https://env.example/', SORB_CLOUD_PROJECT: PROJECT.replace(/^0/, '1') }
  const r2 = resolveUploadConfig({}, env2, cfg)
  assert.equal(r2.cloudUrl, 'https://env.example', 'env beats config; trailing slash stripped')
  assert.equal(r2.projectId, PROJECT.replace(/^0/, '1'))
  const r3 = resolveUploadConfig({ cloudUrl: 'http://localhost:3000', project: PROJECT }, env2, cfg)
  assert.equal(r3.cloudUrl, 'http://localhost:3000', 'flag beats env')
  assert.equal(r3.projectId, PROJECT)
  assert.equal(resolveUploadConfig({}, ENV_OK, {}).cloudUrl, DEFAULT_CLOUD_URL)
})

test('resolveUploadConfig: API key comes from SORB_CLOUD_KEY ONLY — sorb.config.json keys are ignored', () => {
  const cfg = { cloud: { projectId: PROJECT, key: 'sorb_sk_from_config', apiKey: 'sorb_sk_from_config2' } }
  assert.throws(() => resolveUploadConfig({}, {}, cfg), (e) => e instanceof UploadError && e.code === 'missing_key' && /SORB_CLOUD_KEY/.test(e.message))
  assert.equal(resolveUploadConfig({}, { SORB_CLOUD_KEY: 'sorb_sk_env' }, cfg).apiKey, 'sorb_sk_env')
})

test('resolveUploadConfig: missing / non-UUID project and non-http URL are typed errors', () => {
  assert.throws(() => resolveUploadConfig({}, { SORB_CLOUD_KEY: 'k' }, {}), (e) => e.code === 'missing_project')
  assert.throws(() => resolveUploadConfig({ project: 'demo' }, { SORB_CLOUD_KEY: 'k' }, {}), (e) => e.code === 'invalid_project')
  assert.throws(() => resolveUploadConfig({ cloudUrl: 'ftp://x', project: PROJECT }, { SORB_CLOUD_KEY: 'k' }, {}), (e) => e.code === 'invalid_cloud_url')
})

test('parseUploadFlags pulls --cloud-url= / --project= and leaves the rest', () => {
  const { flags, rest } = parseUploadFlags(['--changed', `--project=${PROJECT}`, '--cloud-url=http://x', '--only=Button'])
  assert.deepEqual(flags, { project: PROJECT, cloudUrl: 'http://x' })
  assert.deepEqual(rest, ['--changed', '--only=Button'])
})

// ── source sha ────────────────────────────────────────────────────────────────

test('resolveSourceSha: GITHUB_SHA wins, else git rev-parse, else null; never throws', () => {
  const full = 'a'.repeat(40)
  assert.equal(resolveSourceSha({ GITHUB_SHA: full.toUpperCase() }, () => { throw new Error('nope') }), full)
  assert.equal(resolveSourceSha({}, () => 'deadbeef\n'), 'deadbeef')
  assert.equal(resolveSourceSha({}, () => 'not a sha'), null)
  assert.equal(resolveSourceSha({}, () => { throw new Error('not a git repo') }), null)
})

// ── payload ───────────────────────────────────────────────────────────────────

test('buildBundlePayload: artifact keys are the index strings VERBATIM, each file read once', () => {
  const { index } = makeProject()
  const reads = []
  const payload = buildBundlePayload({
    index,
    readArtifact: (k) => { reads.push(k); return { stories: [], key: k } },
    resolved: [{ id: 'x' }],
    sourceSha: 'abc1234',
  })
  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.sourceSha, 'abc1234')
  assert.equal(payload.generatedAt, '2026-09-06T12:00:00.000Z', 'reuses index.generatedAt')
  assert.deepEqual(Object.keys(payload.artifacts).sort(), ['stories/Button.sorb.json', 'stories/Card.sorb.json'])
  assert.deepEqual(reads.sort(), ['stories/Button.sorb.json', 'stories/Card.sorb.json'], 'shared artifact read once')
  assert.equal(payload.index, index)
  assert.deepEqual(payload.resolved, [{ id: 'x' }])
})

test('buildBundlePayload: omits sourceSha/resolved when absent; rejects an index without stories', () => {
  const p = buildBundlePayload({ index: { stories: { s: { artifact: 'a' } } }, readArtifact: () => ({}) })
  assert.equal('sourceSha' in p, false)
  assert.equal('resolved' in p, false)
  assert.match(p.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.throws(() => buildBundlePayload({ index: {}, readArtifact: () => ({}) }), (e) => e.code === 'bad_index')
  assert.throws(() => buildBundlePayload({ index: { stories: { s: {} } }, readArtifact: () => ({}) }), (e) => e.code === 'bad_index')
  assert.throws(() => buildBundlePayload({ index: { stories: {} }, readArtifact: () => ({}) }), (e) => e.code === 'empty_index')
})

test('makeArtifactReader: reads only under cwd — traversal, absolute, backslash, missing all refuse', () => {
  const { dir } = makeProject()
  const read = makeArtifactReader(dir)
  assert.equal(read('stories/Button.sorb.json').component, 'Button')
  assert.throws(() => read('../../etc/passwd'), (e) => e.code === 'artifact_outside_project')
  assert.throws(() => read('stories/../../x.json'), (e) => e.code === 'artifact_outside_project')
  assert.throws(() => read('/etc/passwd'), (e) => e.code === 'bad_artifact_ref')
  assert.throws(() => read('stories\\Button.sorb.json'), (e) => e.code === 'bad_artifact_ref')
  assert.throws(() => read(''), (e) => e.code === 'bad_artifact_ref')
  assert.throws(() => read('stories/Nope.sorb.json'), (e) => e.code === 'artifact_missing')
  rmSync(dir, { recursive: true, force: true })
})

test('makeArtifactReader: a symlink that points OUTSIDE cwd is refused even though its path string is under cwd', () => {
  const { dir } = makeProject()
  const outside = mkdtempSync(join(tmpdir(), 'sorb-seed-outside-'))
  writeFileSync(join(outside, 'secret.json'), JSON.stringify({ secret: true }))
  symlinkSync(join(outside, 'secret.json'), join(dir, 'stories', 'Linked.sorb.json'))
  const read = makeArtifactReader(dir)
  assert.throws(() => read('stories/Linked.sorb.json'), (e) => e.code === 'artifact_outside_project' && /symlink/.test(e.message))
  // A symlink that stays INSIDE the project is fine.
  symlinkSync(join(dir, 'stories', 'Button.sorb.json'), join(dir, 'stories', 'Alias.sorb.json'))
  assert.equal(read('stories/Alias.sorb.json').component, 'Button')
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

// ── upload ────────────────────────────────────────────────────────────────────

test('uploadBundle: POSTs JSON with Bearer auth + content-length to the project route', async () => {
  const calls = []
  const res = await uploadBundle({ schemaVersion: 1, index: { stories: {} }, artifacts: {} }, {
    cloudUrl: 'https://app.sorbcloud.com/', projectId: PROJECT, apiKey: 'sorb_sk_abc', fetchImpl: okFetch(calls),
  })
  assert.equal(res.bundleId, 'b-1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://app.sorbcloud.com/api/projects/${PROJECT}/capture-bundle`)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sorb_sk_abc')
  assert.equal(calls[0].init.headers['content-length'], String(Buffer.byteLength(calls[0].init.body)))
  assert.deepEqual(JSON.parse(calls[0].init.body), { schemaVersion: 1, index: { stories: {} }, artifacts: {} })
})

test('uploadBundle: non-2xx surfaces the server error code (403 read_only, 402, 413, 400 typed)', async () => {
  const reject = (status, body) => async () => ({ ok: false, status, json: async () => body })
  for (const [status, body, code] of [
    [403, { error: 'read_only', message: 'publishable keys are read-only' }, 'read_only'],
    [402, { error: 'capture_not_entitled' }, 'capture_not_entitled'],
    [413, { error: 'payload_too_large', max: 5242880 }, 'payload_too_large'],
    [400, { error: 'invalid_artifact_key' }, 'invalid_artifact_key'],
    [502, 'not json', 'http_502'],
  ]) {
    await assert.rejects(
      uploadBundle({}, { cloudUrl: 'http://x', projectId: PROJECT, apiKey: 'k', fetchImpl: reject(status, body) }),
      (e) => e instanceof UploadError && e.code === code && e.exitCode === 1 && new RegExp(`HTTP ${status}`).test(e.message),
      `status ${status} → ${code}`,
    )
  }
  await assert.rejects(
    uploadBundle({}, { cloudUrl: 'http://x', projectId: PROJECT, apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED') } }),
    (e) => e.code === 'network_error' && /ECONNREFUSED/.test(e.message),
  )
})

// ── end-to-end (temp dir → injected fetch) ────────────────────────────────────

test('runPushCapture: reads .sorb/index.json + resolved.json, uploads, prints ✓ line', async () => {
  const { dir } = makeProject()
  const calls = []
  const lines = []
  const res = await runPushCapture({
    cwd: dir,
    env: { ...ENV_OK, GITHUB_SHA: 'f'.repeat(40) },
    fetchImpl: okFetch(calls),
    exec: () => { throw new Error('git must not be needed when GITHUB_SHA is set') },
    log: (l) => lines.push(l),
  })
  assert.equal(res.bundleId, 'b-1')
  const sent = JSON.parse(calls[0].init.body)
  assert.equal(sent.schemaVersion, 1)
  assert.equal(sent.sourceSha, 'f'.repeat(40))
  assert.equal(Object.keys(sent.index.stories).length, 3)
  assert.deepEqual(Object.keys(sent.artifacts).sort(), ['stories/Button.sorb.json', 'stories/Card.sorb.json'])
  assert.equal(sent.artifacts['stories/Button.sorb.json'].component, 'Button')
  assert.equal(sent.resolved.length, 1)
  assert.match(lines[0], /→ uploading 3 stories \/ 2 artifacts to https:\/\/app\.sorbcloud\.com/)
  assert.match(lines[1], /✓ uploaded 3 stories \/ 2 artifacts \(bundle b-1\)/)
  rmSync(dir, { recursive: true, force: true })
})

test('runPushCapture: no index → no_index; missing key → missing_key BEFORE touching the network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sorb-seed-upload-empty-'))
  let fetched = 0
  await assert.rejects(
    runPushCapture({ cwd: dir, env: ENV_OK, fetchImpl: async () => { fetched++; return {} }, exec: () => 'abc1234', log: () => {} }),
    (e) => e.code === 'no_index',
  )
  await assert.rejects(
    runPushCapture({ cwd: dir, env: { SORB_CLOUD_PROJECT: PROJECT }, fetchImpl: async () => { fetched++; return {} }, log: () => {} }),
    (e) => e.code === 'missing_key',
  )
  assert.equal(fetched, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('runPushCapture: sorb.config.json cloud.projectId is honored (key still env-only)', async () => {
  const { dir } = makeProject()
  writeFileSync(join(dir, 'sorb.config.json'), JSON.stringify({ namespace: 'demo', cloud: { projectId: PROJECT, key: 'sorb_sk_SHOULD_BE_IGNORED' } }))
  const calls = []
  await runPushCapture({ cwd: dir, env: { SORB_CLOUD_KEY: 'sorb_sk_env' }, fetchImpl: okFetch(calls), exec: () => 'abc1234', log: () => {} })
  assert.equal(calls[0].url, `${DEFAULT_CLOUD_URL}/api/projects/${PROJECT}/capture-bundle`)
  assert.equal(calls[0].init.headers.authorization, 'Bearer sorb_sk_env')
  assert.equal(JSON.parse(calls[0].init.body).sourceSha, 'abc1234')
  rmSync(dir, { recursive: true, force: true })
})
