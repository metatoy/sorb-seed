// OSS injection (M4) — inject CONTROLLED drift/benign into REAL React component
// source at real hardcoded-style sites, so the blend corpus includes genuine
// third-party code (PREREGISTRATION.md §3, D1). We replace a real literal with
// a known value by exact-substring edit (no reformatting → locs stay stable),
// and score ONLY the sites we injected (known ground truth); pre-existing sites
// are left untouched and unscored.
//
// Classes supported on real source: benign / benign-literal / stale-value /
// scale-violation, plus contrast-break where a text color sits with a known bg.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { detectHardcoded } from '../adapt/detectHardcoded.js'
import { normalizeColor } from '../annotateTokens.js'
import { perturbHex, offScalePx, lowContrastFg } from './inject.js'
import { parseHex, contrastRatio, violatesAA, AA_NORMAL } from './contrast.js'
import { mulberry32, shuffle, pick } from './prng.js'

/** Recursively collect .jsx/.tsx files, skipping build/dep dirs. */
export function walkSources(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (e) {
    return acc
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) walkSources(p, acc)
    else if (/\.(jsx|tsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Replace the first occurrence of `raw` at/after `col` on `line` with `next`. */
function replaceOnLine(line, col, raw, next) {
  const at = line.indexOf(raw, Math.max(0, col - 1))
  if (at < 0) {
    const any = line.indexOf(raw)
    if (any < 0) return { line, ok: false }
    return { line: line.slice(0, any) + next + line.slice(any + raw.length), ok: true }
  }
  return { line: line.slice(0, at) + next + line.slice(at + raw.length), ok: true }
}

/**
 * Inject controlled drift/benign into one real file.
 * @param {string} name  file path (label)
 * @param {string} source
 * @param {() => number} rng
 * @param {{colorTokens:{value:string}[], dimTokens:{value:string}[], colorValues:Set<string>, dimValues:Set<string>, colors:string[]}} pal
 * @param {{maxPerFile?:number}} [o]
 * @returns {{name:string, source:string, labels:import('./inject.js').DriftLabel[]}}
 */
export function injectFile(name, source, rng, pal, o = {}) {
  const maxPerFile = o.maxPerFile == null ? 6 : o.maxPerFile
  const sites = detectHardcoded(source, name)
  // A file-level bg for optional contrast-breaks: first bg site that is a hex.
  const bgSite = sites.find((s) => s.role === 'bg' && parseHex(s.raw))
  const bg = bgSite ? bgSite.raw.toLowerCase() : null

  // Only inject where we can substitute a same-KIND value that stays valid in
  // context and re-detects: hex colors, `<n>px` strings, or bare numerics.
  const numPart = (px) => String(px).replace('px', '')
  const kindOf = (raw) => {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return 'hex'
    if (/^\d+px$/.test(raw)) return 'px'
    if (/^\d+$/.test(raw)) return 'num'
    return null
  }
  const eligible = sites.filter((s) => kindOf(s.raw) != null)
  const chosen = shuffle(rng, eligible).slice(0, maxPerFile)
  const plans = []
  for (const site of chosen) {
    const kind = kindOf(site.raw)
    let next = null
    /** @type {any} */
    const label = { file: name, prop: site.prop, role: site.role, originalValue: site.raw, intendedTokenId: null }
    if (kind === 'hex') {
      const tok = pick(rng, pal.colorTokens)
      const r = rng()
      if (site.role === 'text' && bg && r < 0.4) {
        let fg = null
        for (const h of pal.colors) if (h !== bg && violatesAA(h, bg) === true) { fg = h; break }
        if (!fg) fg = lowContrastFg(bg)
        next = fg
        const ratio = contrastRatio(fg, bg)
        Object.assign(label, { class: 'contrast-break', causalEdit: 'contrast', isDrift: true, contrast: { fg, bg, ratio: ratio == null ? 0 : ratio, threshold: AA_NORMAL, violates: violatesAA(fg, bg) === true, tokenValued: pal.colorValues.has(fg) } })
      } else if (r < 0.55) {
        next = tok.value
        Object.assign(label, { class: 'benign', causalEdit: 'inline', isDrift: false })
      } else {
        next = perturbHex(tok.value, pal.colorValues)
        Object.assign(label, { class: 'stale-value', causalEdit: rng() < 0.5 ? 'stale' : 'rename', isDrift: true })
      }
    } else {
      // dimension — px string or bare numeric; keep the same kind on substitution
      const tok = pick(rng, pal.dimTokens)
      const r = rng()
      const asKind = (px) => (kind === 'px' ? px : numPart(px))
      if (r < 0.4) {
        next = asKind(tok.value) // benign-exact (binds by normalized value)
        Object.assign(label, { class: 'benign', causalEdit: 'inline', isDrift: false })
      } else if (r < 0.7) {
        next = '0' // benign-literal precision trap
        Object.assign(label, { class: 'benign-literal', causalEdit: 'literal', isDrift: false })
      } else {
        next = asKind(offScalePx(tok.value, pal.dimValues))
        Object.assign(label, { class: 'scale-violation', causalEdit: 'off-scale', isDrift: true })
      }
    }
    if (next != null && next !== site.raw) plans.push({ site, next, label })
  }

  // Apply edits line-by-line, right-to-left within a line to keep columns valid.
  const lines = source.split('\n')
  const byLine = new Map()
  for (const p of plans) {
    const ln = p.site.loc.line
    if (!byLine.has(ln)) byLine.set(ln, [])
    byLine.get(ln).push(p)
  }
  for (const [ln, ps] of byLine) {
    ps.sort((a, b) => b.site.loc.column - a.site.loc.column)
    for (const p of ps) {
      const res = replaceOnLine(lines[ln - 1], p.site.loc.column, p.site.raw, p.next)
      if (res.ok) lines[ln - 1] = res.line
      else p.dropped = true
    }
  }
  const mutated = lines.join('\n')

  // Re-detect and attach real locs by (line, injected raw).
  const finalSites = detectHardcoded(mutated, name)
  const labels = []
  for (const p of plans) {
    if (p.dropped) continue
    const st = finalSites.find((s) => s.loc.line === p.site.loc.line && s.raw === p.next) || finalSites.find((s) => s.raw === p.next)
    if (!st) continue
    labels.push({ ...p.label, loc: st.loc, raw: p.next })
  }
  return { name, source: mutated, labels }
}

/**
 * Build the OSS corpus from real source roots.
 * @param {string[]} roots
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{seed:number, splitSeed:number, maxPerFile?:number, trainFrac?:number, repeats?:number}} o
 * @returns {import('./corpus.js').CorpusCase[]}
 */
export function buildOssCorpus(roots, resolved, o) {
  const pal = {
    colorTokens: resolved.filter((t) => t.type === 'color' && typeof t.value === 'string' && t.value[0] === '#'),
    dimTokens: resolved.filter((t) => t.type === 'dimension' && /^\d+px$/.test(String(t.value))),
    colorValues: new Set(resolved.filter((t) => t.type === 'color').map((t) => String(t.value).toLowerCase())),
    dimValues: new Set(resolved.filter((t) => t.type === 'dimension').map((t) => String(t.value).toLowerCase())),
    colors: resolved.filter((t) => t.type === 'color' && typeof t.value === 'string' && t.value[0] === '#').map((t) => String(t.value).toLowerCase()),
  }
  const files = []
  for (const root of roots) {
    for (const f of walkSources(root)) {
      const src = readFileSync(f, 'utf-8')
      if (detectHardcoded(src, f).length > 0) files.push({ name: f, source: src })
    }
  }
  // `repeats`: re-inject each file with a fresh rng stream for scale (distinct
  // seeded plans per repeat) — honest augmentation of a small real-file set.
  const repeats = o.repeats == null ? 1 : o.repeats
  const rng = mulberry32((o.seed ^ 0x05500001) >>> 0)
  /** @type {import('./corpus.js').CorpusCase[]} */
  const cases = []
  for (let rep = 0; rep < repeats; rep++) {
    for (const f of files) {
      const { source, labels } = injectFile(`${f.name}#${rep}`, f.source, rng, pal, { maxPerFile: o.maxPerFile })
      if (labels.length) cases.push({ name: `${f.name}#${rep}`, source, labels, split: 'train', sourceKind: 'oss' })
    }
  }
  const trainFrac = o.trainFrac == null ? 0.7 : o.trainFrac
  const idx = shuffle(mulberry32((o.splitSeed ^ 0x0550) >>> 0), cases.map((_, i) => i))
  const nTrain = Math.round(cases.length * trainFrac)
  const trainSet = new Set(idx.slice(0, nTrain))
  cases.forEach((c, i) => { c.split = trainSet.has(i) ? 'train' : 'test' })
  return cases
}
