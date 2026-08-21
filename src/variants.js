// sorb-seed — variant lifecycle engine.
//
// Provides add and deprecate operations against DTCG component token sources.
// Each operation mutates the source JSON, bumps the $version, re-runs the SD
// build, and returns a VariantChangeset describing what changed.

import { readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'

// ─── types ───────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AddVariantOptions
 * @property {string} componentJsonPath - Absolute path to the component DTCG JSON file.
 * @property {string} variantId         - Full dot-path of the new variant, e.g. "button.tertiary".
 * @property {string} fromVariant       - Full dot-path of the source variant, e.g. "button.primary".
 * @property {string} sdConfigDir       - Directory containing sd.config.js (runs `npm run tokens` here).
 */

/**
 * @typedef {Object} DeprecateVariantOptions
 * @property {string} componentJsonPath - Absolute path to the component DTCG JSON file.
 * @property {string} variantId         - Full dot-path of the variant to deprecate, e.g. "button.danger".
 * @property {string} replacedBy        - Replacement variant dot-path, e.g. "button.error".
 * @property {string} sdConfigDir       - Directory containing sd.config.js.
 */

/**
 * @typedef {Object} VariantChangeset
 * @property {'add'|'deprecate'} action   - Which operation was performed.
 * @property {string}            variantId - The target variant dot-path.
 * @property {string[]}          tokenIds  - All token ids affected (leaf nodes).
 * @property {string}            newVersion - The bumped $version written to the source file.
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Bump the semver patch segment of a version string.
 * Non-parseable input returns "1.0.1" as a safe fallback.
 * @param {string} version
 * @returns {string}
 */
export const bumpVersion = (version) => {
  if (typeof version !== 'string') return '1.0.1'
  const parts = version.split('.')
  if (parts.length !== 3) return '1.0.1'
  const [major, minor, patch] = parts.map(Number)
  if (parts.some((p, i) => isNaN([major, minor, patch][i]))) return '1.0.1'
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Walk a variant slice (prop × state tree) and collect fully-qualified token
 * ids for every leaf node (a node that has a `$value` property).
 * @param {string} componentId - e.g. "button"
 * @param {string} variantKey  - e.g. "tertiary"
 * @param {Object} sliceObj    - The variant's token subtree.
 * @returns {string[]}
 */
export const flattenVariantIds = (componentId, variantKey, sliceObj) => {
  const ids = []

  /**
   * @param {Object} node
   * @param {string[]} path - segments accumulated so far (below variantKey)
   */
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if ('$value' in node) {
      // Leaf token — build the full dot-path id.
      ids.push([componentId, variantKey, ...path].join('.'))
      return
    }
    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue // skip metadata keys ($type, $description, etc.)
      walk(node[key], [...path, key])
    }
  }

  walk(sliceObj, [])
  return ids
}

/**
 * Deep-clone a variant slice (the value stored under a variant key).
 * Equivalent to JSON round-trip — suitable for pure token objects.
 * @param {Object} fromSlice
 * @returns {Object}
 */
export const cloneVariantSlice = (fromSlice) => JSON.parse(JSON.stringify(fromSlice))

/**
 * Walk a variant slice and mark every leaf node as deprecated, setting
 * `$deprecated = true` and `$extensions.sorb.replacedBy` to `replacedBy`.
 * Returns a **deep clone** with the mutations applied; the original is never
 * touched.
 * @param {Object} sliceObj  - The variant's token subtree.
 * @param {string} replacedBy - Replacement variant dot-path.
 * @returns {Object} mutated deep clone
 */
export const applyDeprecation = (sliceObj, replacedBy) => {
  const clone = cloneVariantSlice(sliceObj)

  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if ('$value' in node) {
      node.$deprecated = true
      node.$extensions = { sorb: { replacedBy } }
      return
    }
    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue
      walk(node[key])
    }
  }

  walk(clone)
  return clone
}

/**
 * Run `npm run tokens` in the given directory and return a promise that
 * resolves on exit 0 or rejects with the collected output on non-zero exit.
 * @param {string} sdConfigDir
 * @returns {Promise<void>}
 */
const runSdBuild = (sdConfigDir) =>
  new Promise((resolve, reject) => {
    const chunks = []
    const child = spawn('npm', ['run', 'tokens'], {
      cwd: sdConfigDir,
      stdio: 'pipe',
    })
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => chunks.push(d))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const output = Buffer.concat(chunks).toString('utf-8')
        reject(
          new Error(
            `SD build failed (exit ${code}) in ${sdConfigDir}:\n${output}`,
          ),
        )
      }
    })
    child.on('error', (err) => reject(err))
  })

// ─── exported API ─────────────────────────────────────────────────────────────

/**
 * Add a new component variant by cloning an existing one.
 *
 * Reads `componentJsonPath`, deep-clones the `fromVariant` slice into a new
 * `variantId` key, bumps the set's `$version`, writes the file back, runs the
 * SD build, and returns a {@link VariantChangeset}.
 *
 * @param {AddVariantOptions} options
 * @returns {Promise<VariantChangeset>}
 */
export const addVariant = async (options) => {
  const { componentJsonPath, variantId, fromVariant, sdConfigDir } = options

  // 1. Read + parse.
  const raw = readFileSync(componentJsonPath, 'utf-8')
  const parsed = JSON.parse(raw)

  // 2. Resolve keys.
  const componentId = variantId.split('.')[0]
  const newKey = variantId.split('.').slice(1).join('.')
  const fromKey = fromVariant.split('.').slice(1).join('.')

  // 3. Find component object.
  const componentObj = parsed[componentId]
  if (!componentObj || typeof componentObj !== 'object') {
    throw new Error(
      `addVariant: component "${componentId}" not found in ${componentJsonPath}`,
    )
  }

  // 4. Find source slice.
  const fromSlice = componentObj[fromKey]
  if (!fromSlice || typeof fromSlice !== 'object') {
    throw new Error(
      `addVariant: source variant "${fromKey}" not found in component "${componentId}"`,
    )
  }

  // 5. Deep-clone into new key.
  componentObj[newKey] = JSON.parse(JSON.stringify(fromSlice))

  // 6. Bump $version.
  const prevVersion = parsed.$version ?? '1.0.0'
  const newVersion = bumpVersion(String(prevVersion))
  parsed.$version = newVersion

  // 7. Write back.
  writeFileSync(componentJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')

  // 8. Run SD build.
  await runSdBuild(sdConfigDir)

  // 9. Collect token ids from the cloned slice.
  const tokenIds = flattenVariantIds(componentId, newKey, componentObj[newKey])

  return { action: 'add', variantId, tokenIds, newVersion }
}

/**
 * Mark every leaf token in a component variant as deprecated.
 *
 * Walks the `variantId` slice, sets `$deprecated = true` and
 * `$extensions.sorb.replacedBy` on every leaf, bumps `$version`, writes the
 * file back, runs the SD build, and returns a {@link VariantChangeset}.
 *
 * @param {DeprecateVariantOptions} options
 * @returns {Promise<VariantChangeset>}
 */
export const deprecateVariant = async (options) => {
  const { componentJsonPath, variantId, replacedBy, sdConfigDir } = options

  // 1. Read + parse.
  const raw = readFileSync(componentJsonPath, 'utf-8')
  const parsed = JSON.parse(raw)

  // 2. Resolve keys.
  const componentId = variantId.split('.')[0]
  const variantKey = variantId.split('.').slice(1).join('.')

  // 3. Find variant slice (error if absent).
  const componentObj = parsed[componentId]
  if (!componentObj || typeof componentObj !== 'object') {
    throw new Error(
      `deprecateVariant: component "${componentId}" not found in ${componentJsonPath}`,
    )
  }
  const variantSlice = componentObj[variantKey]
  if (!variantSlice || typeof variantSlice !== 'object') {
    throw new Error(
      `deprecateVariant: variant "${variantKey}" not found in component "${componentId}"`,
    )
  }

  // 4. Walk the slice; mark every leaf node.
  const tokenIds = []

  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if ('$value' in node) {
      node.$deprecated = true
      node.$extensions = { sorb: { replacedBy } }
      tokenIds.push([componentId, variantKey, ...path].join('.'))
      return
    }
    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue
      walk(node[key], [...path, key])
    }
  }

  walk(variantSlice, [])

  // 5. Bump $version.
  const prevVersion = parsed.$version ?? '1.0.0'
  const newVersion = bumpVersion(String(prevVersion))
  parsed.$version = newVersion

  // 6. Write back.
  writeFileSync(componentJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')

  // 7. Run SD build.
  await runSdBuild(sdConfigDir)

  // 8. Return changeset.
  return { action: 'deprecate', variantId, tokenIds, newVersion }
}
