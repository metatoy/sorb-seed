// `sorb-seed capture --upload` / `sorb-seed push-capture` — upload the `.sorb/`
// capture bundle to Sorb Cloud as PURE DATA (spec/sorb/storybook-capture-hosting.md
// §3). The cloud validates + stores the JSON and renders per-story views from
// it; nothing here (and nothing there) executes user code.
//
// Pure module: every filesystem / network / process touch is injectable so the
// whole path is `node --test`-able without a cloud, a git repo, or Playwright.
//
// Envelope (cloud `POST /api/projects/:id/capture-bundle`):
//   { schemaVersion: 1, sourceSha?, generatedAt?, index, resolved?, artifacts: { [key]: SorbArtifact } }
// Artifact keys are the index's `artifact` strings VERBATIM — the cloud treats
// them as opaque ids (never paths). We only ever READ the files the index names,
// and only when they resolve under cwd.

import { readFileSync, existsSync } from 'fs'
import { resolve, relative, isAbsolute, sep } from 'path'
import { execSync } from 'child_process'

export const DEFAULT_CLOUD_URL = 'https://app.sorbcloud.com'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA_RE = /^[0-9a-f]{7,40}$/

/**
 * Thrown for every user-facing failure; `code` is a stable machine string
 * (the server's `error` code on HTTP failures) and `exitCode` is what the CLI
 * exits with.
 */
export class UploadError extends Error {
  /** @param {string} code @param {string} message @param {number} [exitCode] */
  constructor(code, message, exitCode = 1) {
    super(message)
    this.name = 'UploadError'
    this.code = code
    this.exitCode = exitCode
  }
}

/**
 * Resolve where + what to upload. Precedence mirrors juice `cloud.js`:
 * CLI flag > env > sorb.config.json. The API key comes from `SORB_CLOUD_KEY`
 * ONLY — secret keys never live in `sorb.config.json` (a `cloud.key` there is
 * ignored on purpose).
 *
 * @param {{ cloudUrl?: string, project?: string }} [flags]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ cloud?: { url?: string, projectId?: string } }} [config] parsed sorb.config.json
 * @returns {{ cloudUrl: string, projectId: string, apiKey: string }}
 */
export const resolveUploadConfig = (flags = {}, env = process.env, config = {}) => {
  const cloud = (config && config.cloud) || {}
  const cloudUrl = (flags.cloudUrl || env.SORB_CLOUD_URL || cloud.url || DEFAULT_CLOUD_URL).replace(/\/+$/, '')
  const projectId = flags.project || env.SORB_CLOUD_PROJECT || cloud.projectId || ''
  const apiKey = env.SORB_CLOUD_KEY || ''
  if (!/^https?:\/\//i.test(cloudUrl)) {
    throw new UploadError('invalid_cloud_url', `Cloud URL must be http(s): ${cloudUrl}`)
  }
  if (!projectId) {
    throw new UploadError(
      'missing_project',
      'No cloud project id. Pass --project=<uuid>, set SORB_CLOUD_PROJECT, or add "cloud": { "projectId": "…" } to sorb.config.json.',
    )
  }
  if (!UUID_RE.test(projectId)) {
    throw new UploadError('invalid_project', `Project id must be a UUID: ${projectId}`)
  }
  if (!apiKey) {
    throw new UploadError(
      'missing_key',
      'No API key. Set SORB_CLOUD_KEY to a sorb_sk_… SECRET key (publishable sorb_pk_ keys are read-only; keys are never read from sorb.config.json).',
    )
  }
  return { cloudUrl, projectId, apiKey }
}

/**
 * Best-effort source sha: `GITHUB_SHA` (CI) → `git rev-parse HEAD` → null.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(cmd: string, opts: object) => string} [exec] injectable for tests
 * @param {string} [cwd]
 * @returns {string | null}
 */
export const resolveSourceSha = (env = process.env, exec = execSync, cwd = process.cwd()) => {
  const fromEnv = (env.GITHUB_SHA || '').trim().toLowerCase()
  if (SHA_RE.test(fromEnv)) return fromEnv
  try {
    const out = String(exec('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })).trim().toLowerCase()
    return SHA_RE.test(out) ? out : null
  } catch (e) {
    return null
  }
}

/** True when `abs` is inside `root` (never equal to it, never via `..`). */
const isUnder = (root, abs) => {
  const rel = relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..')
}

/**
 * Default artifact reader: reads `<cwd>/<key>` and only when it resolves under
 * cwd. The key is the index's `artifact` string (relative, as `capture` wrote it).
 * @param {string} cwd
 * @returns {(key: string) => object}
 */
export const makeArtifactReader = (cwd) => (key) => {
  if (typeof key !== 'string' || !key || isAbsolute(key) || key.includes('\\')) {
    throw new UploadError('bad_artifact_ref', `Index references an artifact with an unusable key: ${JSON.stringify(key)}`)
  }
  const abs = resolve(cwd, key)
  if (!isUnder(cwd, abs)) {
    throw new UploadError('artifact_outside_project', `Refusing to read an artifact outside the project directory: ${key}`)
  }
  if (!existsSync(abs)) {
    throw new UploadError('artifact_missing', `Artifact named by .sorb/index.json is missing: ${key} (re-run \`sorb-seed capture\`, or commit the *.sorb.json files for CI).`)
  }
  return JSON.parse(readFileSync(abs, 'utf-8'))
}

/**
 * Build the upload envelope from an index + a reader for the artifacts it names.
 * Artifact keys = the index's `artifact` strings verbatim; each file is read at
 * most once even when many stories share it.
 *
 * @param {{
 *   index: { stories: Record<string, { artifact: string }>, components?: Array<{ artifact: string }> },
 *   readArtifact: (key: string) => object,
 *   resolved?: object[] | null,
 *   sourceSha?: string | null,
 *   generatedAt?: string,
 * }} input
 * @returns {{ schemaVersion: 1, sourceSha?: string, generatedAt: string, index: object, resolved?: object[], artifacts: Record<string, object> }}
 */
export const buildBundlePayload = ({ index, readArtifact, resolved = null, sourceSha = null, generatedAt }) => {
  if (!index || typeof index !== 'object' || !index.stories || typeof index.stories !== 'object') {
    throw new UploadError('bad_index', '.sorb/index.json has no `stories` map — run `sorb-seed capture` first.')
  }
  const keys = new Set()
  for (const id of Object.keys(index.stories)) {
    const entry = index.stories[id]
    if (!entry || typeof entry.artifact !== 'string') {
      throw new UploadError('bad_index', `.sorb/index.json story "${id}" has no artifact reference.`)
    }
    keys.add(entry.artifact)
  }
  for (const c of Array.isArray(index.components) ? index.components : []) {
    if (c && typeof c.artifact === 'string') keys.add(c.artifact)
  }
  if (keys.size === 0) {
    throw new UploadError('empty_index', '.sorb/index.json names no artifacts — nothing to upload.')
  }
  const artifacts = {}
  for (const key of keys) artifacts[key] = readArtifact(key)

  const payload = {
    schemaVersion: 1,
    generatedAt: generatedAt || (typeof index.generatedAt === 'string' ? index.generatedAt : new Date().toISOString()),
    index,
    artifacts,
  }
  if (sourceSha) payload.sourceSha = sourceSha
  if (Array.isArray(resolved)) payload.resolved = resolved
  return payload
}

/**
 * POST the envelope. Resolves with the parsed 201 body; throws UploadError
 * carrying the server's `error` code (and HTTP status) on any non-2xx.
 *
 * @param {object} payload from buildBundlePayload
 * @param {{ cloudUrl: string, projectId: string, apiKey: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ bundleId: string, stories: number, artifacts: number, bytes: number, droppedKeys?: number, sourceSha?: string|null, pruned?: number }>}
 */
export const uploadBundle = async (payload, { cloudUrl, projectId, apiKey, fetchImpl = fetch }) => {
  const url = `${cloudUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/capture-bundle`
  const body = JSON.stringify(payload)
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body, 'utf8')),
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'sorb-seed/push-capture',
      },
      body,
    })
  } catch (e) {
    throw new UploadError('network_error', `Could not reach ${url}: ${e && e.message ? e.message : e}`)
  }
  let parsed = null
  try {
    parsed = await res.json()
  } catch (e) {
    parsed = null
  }
  if (!res.ok) {
    const code = parsed && typeof parsed.error === 'string' ? parsed.error : `http_${res.status}`
    const detail = parsed && typeof parsed.message === 'string' ? ` — ${parsed.message}` : ''
    throw new UploadError(code, `Upload rejected (HTTP ${res.status} ${code})${detail}`, 1)
  }
  return parsed || {}
}

/**
 * The whole CLI path shared by `capture --upload` and `push-capture`: read
 * `.sorb/index.json` (+ `.sorb/resolved.json` when present), build, upload,
 * print one line. Everything injectable.
 *
 * @param {{
 *   cwd?: string,
 *   flags?: { cloudUrl?: string, project?: string },
 *   env?: NodeJS.ProcessEnv,
 *   config?: object,
 *   fetchImpl?: typeof fetch,
 *   exec?: (cmd: string, opts: object) => string,
 *   log?: (line: string) => void,
 * }} [opts]
 * @returns {Promise<object>} the server's 201 body
 */
export const runPushCapture = async (opts = {}) => {
  const cwd = opts.cwd || process.cwd()
  const env = opts.env || process.env
  const log = opts.log || ((line) => console.log(line))
  const config = opts.config || readJsonIfPresent(resolve(cwd, 'sorb.config.json')) || {}

  const { cloudUrl, projectId, apiKey } = resolveUploadConfig(opts.flags || {}, env, config)

  const indexPath = resolve(cwd, '.sorb/index.json')
  if (!existsSync(indexPath)) {
    throw new UploadError('no_index', 'No .sorb/index.json — run `sorb-seed capture` first (or commit it for CI).')
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
  const resolvedRaw = readJsonIfPresent(resolve(cwd, '.sorb/resolved.json'))
  const resolved = Array.isArray(resolvedRaw) ? resolvedRaw : resolvedRaw && Array.isArray(resolvedRaw.tokens) ? resolvedRaw.tokens : null

  const payload = buildBundlePayload({
    index,
    readArtifact: makeArtifactReader(cwd),
    resolved,
    sourceSha: resolveSourceSha(env, opts.exec || execSync, cwd),
  })
  const nStories = Object.keys(index.stories).length
  const nArtifacts = Object.keys(payload.artifacts).length
  log(`→ uploading ${nStories} stor${nStories === 1 ? 'y' : 'ies'} / ${nArtifacts} artifact${nArtifacts === 1 ? '' : 's'} to ${cloudUrl} (project ${projectId})`)

  const result = await uploadBundle(payload, { cloudUrl, projectId, apiKey, fetchImpl: opts.fetchImpl || fetch })
  log(`✓ uploaded ${result.stories ?? nStories} stories / ${result.artifacts ?? nArtifacts} artifacts (bundle ${result.bundleId || '?'})`)
  if (result.droppedKeys) log(`  · ${result.droppedKeys} unknown key${result.droppedKeys === 1 ? '' : 's'} dropped by the cloud validator (forward-compat, harmless)`)
  if (result.pruned) log(`  · pruned ${result.pruned} older bundle${result.pruned === 1 ? '' : 's'} (retention: newest 10)`)
  return result
}

const readJsonIfPresent = (p) => {
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch (e) { return null }
}

/**
 * Parse `--cloud-url=` / `--project=` out of an argv slice (shared by both
 * commands). Unknown args are returned so the caller can handle its own.
 * @param {string[]} args
 * @returns {{ flags: { cloudUrl?: string, project?: string }, rest: string[] }}
 */
export const parseUploadFlags = (args) => {
  const flags = {}
  const rest = []
  for (const a of args) {
    if (a.startsWith('--cloud-url=')) flags.cloudUrl = a.slice('--cloud-url='.length)
    else if (a.startsWith('--project=')) flags.project = a.slice('--project='.length)
    else rest.push(a)
  }
  return { flags, rest }
}
