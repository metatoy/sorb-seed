// E3 (hosted-capture render worker) — diff-only cache spike.
//
// Two independent wins, both real (not stubbed), scoped honestly:
//   1. EXACT-MATCH short-circuit: if a (url, tokenMap) pair was rendered before
//      and the token map is byte-identical, skip the render entirely and return
//      the cached result. This is the biggest, cheapest win during the credit
//      window (repeat previews of an unchanged proposal).
//   2. CHANGED-SUBTREE REPORT: when the token map differs from the last render
//      of the SAME url, we still do a full page recapture (Playwright reads the
//      whole rendered DOM in one pass — there is no cheap partial DOM read), but
//      we diff the new capture's per-node hashes against the previous one and
//      report which subtrees actually changed. That's real, useful signal for a
//      caller (cloud telemetry / a future incremental-repaint UI) even though the
//      RENDER itself is not selectively re-executed.
//
// TRUE selective re-render (only re-rendering the changed subtrees inside the
// browser, skipping layout for the rest) is NOT implemented — it would require
// either a persistent, patchable page (partial `page.evaluate` reflow, which
// Chromium doesn't expose cleanly) or a virtual-DOM diffing shim injected into
// the target app (out of our control since Mode B targets arbitrary apps). This
// is the honest boundary called out in hosted-bridge-modes-exploration-plan.md
// §3 E3 ("keep it behind a flag/option; correctness first, optimization second
// — leave a documented stub"). What IS implemented (page reuse — skip
// navigation on a cache-miss-but-same-url render) lives in `pagePool.js`.

import { createHash } from 'node:crypto'

/** Stable JSON stringify (sorted keys) so token-map key order never changes the hash. */
export const stableStringify = (value) => {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = sortKeys(v[k])
          return acc
        }, {})
    }
    return v
  }
  return JSON.stringify(sortKeys(value))
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Hash a token map (cssVar -> value), order-independent. */
export const hashTokenMap = (tokenMap) => 'sha256:' + sha256(stableStringify(tokenMap || {}))

/** The cache key for a render: (url, tokenMap-hash). */
export const makeCacheKey = (url, tokenMap) => `${url}::${hashTokenMap(tokenMap)}`

/**
 * Per-node hash map keyed by a stable structural path ("0.2.1" = root's 3rd
 * child's 2nd child), so two trees of the same shape can be compared node-by-
 * node even though DOM nodes have no stable id. Hash excludes nothing — the
 * whole node's own fields (not descendants) plus a summary of children count,
 * so a change anywhere down a branch bubbles up as a changed hash at every
 * ancestor on that branch (cheap "which top-level regions changed" signal).
 * @param {object} tree LayerNode-shaped tree (root, with .children[])
 * @returns {Map<string,string>} path -> sha256 hash
 */
export const hashNodePaths = (tree) => {
  const out = new Map()
  const walk = (node, path) => {
    if (!node) return
    const { children, ...ownFields } = node
    const own = sha256(stableStringify(ownFields))
    const childHashes = (children || []).map((c, i) => walk(c, path ? `${path}.${i}` : String(i)))
    const combined = sha256(own + '|' + childHashes.join(','))
    out.set(path || '0', combined)
    return combined
  }
  walk(tree, '0')
  return out
}

/**
 * Diff two node-path hash maps.
 * @returns {{changed:string[], added:string[], removed:string[]}} paths present
 *   in both but with a different hash / only in `next` / only in `prev`.
 */
export const diffNodeHashes = (prevHashes, nextHashes) => {
  const changed = []
  const added = []
  const removed = []
  for (const [path, hash] of nextHashes) {
    if (!prevHashes.has(path)) added.push(path)
    else if (prevHashes.get(path) !== hash) changed.push(path)
  }
  for (const path of prevHashes.keys()) {
    if (!nextHashes.has(path)) removed.push(path)
  }
  return { changed, added, removed }
}

/**
 * In-memory diff-cache. One process/worker instance's lifetime — not persisted.
 * `capacity` bounds memory (LRU-by-insertion via Map iteration order); default
 * is generous since a render result's dom tree is the only heavy field kept.
 */
export class DiffCache {
  constructor({ capacity = 200 } = {}) {
    this.capacity = capacity
    /** exact (url,tokenMap-hash) -> full render result */
    this.exact = new Map()
    /** url -> { tokenMap, hashes: Map<path,hash> } — last render, ANY token map */
    this.byUrl = new Map()
  }

  /** Exact-match lookup: same url + byte-identical token map. */
  getExact(url, tokenMap) {
    return this.exact.get(makeCacheKey(url, tokenMap))
  }

  /** Record an exact-match entry (called after every successful render). */
  putExact(url, tokenMap, result) {
    const key = makeCacheKey(url, tokenMap)
    this.exact.set(key, result)
    this._evictIfNeeded(this.exact)
  }

  /**
   * Diff a freshly-captured tree against the last capture for this URL
   * (regardless of token map), returning which node paths changed. Also
   * records this capture as the new "last" for the url. Returns `null` when
   * there is no prior capture to diff against (first render for this url).
   */
  diffAgainstLastForUrl(url, tokenMap, tree) {
    const prev = this.byUrl.get(url)
    const nextHashes = hashNodePaths(tree)
    let diff = null
    if (prev) {
      diff = diffNodeHashes(prev.hashes, nextHashes)
    }
    this.byUrl.set(url, { tokenMap, hashes: nextHashes })
    this._evictIfNeeded(this.byUrl)
    return diff
  }

  _evictIfNeeded(map) {
    while (map.size > this.capacity) {
      const oldestKey = map.keys().next().value
      map.delete(oldestKey)
    }
  }

  clear() {
    this.exact.clear()
    this.byUrl.clear()
  }
}
