// Scoring harness (M2) — score the detection engine's DRIFT CLASSIFICATION
// against the injected ground truth (PREREGISTRATION.md §2). The engine sees
// only the source (never the labels); it detects sites, then a classifier
// decides drift vs benign per site. We compare to `isDrift` ground truth.
//
// Metric (frozen): coverage = TP/(TP+FN) over drift sites; precision =
// TP/(TP+FP) over sites predicted drift. Reported per split. The contrast
// oracle's false-negative rate on injected contrast-breaks is reported
// separately (the "zero false negatives by construction" line).
//
// The classifier is INTENTIONALLY toggleable: the baseline uses binding only;
// the M3 loop enables one extra signal per attempt. Each signal is a principled
// oracle, not a corpus-specific hack.
import { detectHardcoded } from '../adapt/detectHardcoded.js'
import { mapToToken, AUTO_THRESHOLD } from '../adapt/mapToToken.js'
import { parseHex, violatesAA } from './contrast.js'

/** Legitimate hardcoded literals that are NOT design-system drift. */
const LEGIT_LITERALS = new Set(['0', '0px', 'transparent', 'currentcolor', 'inherit', 'none', 'initial', 'unset', '#0000', '#00000000'])
const isLegitLiteral = (raw) => LEGIT_LITERALS.has(String(raw).trim().toLowerCase())

/**
 * @typedef {Object} ClassifierOpts
 * @property {boolean} [contrastAware]   flag a text site that fails AA vs its component bg, even if it binds
 * @property {boolean} [literalAllowlist] never flag legitimate literals (0/transparent/…)
 * @property {boolean} [roleAware]        flag a site that binds only OFF-role (wrong token for its property)
 * @property {boolean} [nearMatch]        treat an unbound color near a token (RGB dist ≤ threshold) as benign
 * @property {boolean} [lowConfDrift]     flag a bound site whose bind confidence is below AUTO_THRESHOLD
 */

/** Nearest token-color RGB distance for a hex, or Infinity. */
function nearestColorDist(raw, resolved) {
  const c = parseHex(raw)
  if (!c) return Infinity
  let best = Infinity
  for (const t of resolved) {
    if (t.type !== 'color' || typeof t.value !== 'string' || t.value[0] !== '#') continue
    const p = parseHex(t.value)
    if (!p) continue
    const d = Math.sqrt((c.r - p.r) ** 2 + (c.g - p.g) ** 2 + (c.b - p.b) ** 2)
    if (d < best) best = d
  }
  return best
}
const NEAR_THRESHOLD = 24

/**
 * Classify every detected site in one component's source. Engine-only view:
 * bg context for the contrast oracle is read from the sibling bg site in the
 * SAME source, never from labels.
 * @param {string} source
 * @param {string} filename
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {ClassifierOpts} opts
 */
export function classifyComponent(source, filename, index, resolved, opts = {}) {
  const sites = detectHardcoded(source, filename)
  const bgSite = sites.find((s) => s.role === 'bg')
  const bg = bgSite ? bgSite.raw : null
  return sites.map((site) => {
    const m = mapToToken(site, index, resolved)
    const bound = m.tokenId != null
    let predDrift = !bound // BASELINE: an unbindable literal is treated as drift
    const signals = {}

    if (opts.literalAllowlist && isLegitLiteral(site.raw)) {
      predDrift = false
      signals.allow = true
    }
    if (opts.roleAware && bound && m.offRole) {
      predDrift = true
      signals.offRole = true
    }
    if (opts.nearMatch && !bound && nearestColorDist(site.raw, resolved) <= NEAR_THRESHOLD) {
      // "a value near a token is just a representational difference, not drift"
      // — a plausible idea that misfires on nudge drift (which is near by design).
      predDrift = false
      signals.near = true
    }
    if (opts.lowConfDrift && bound && m.confidence < AUTO_THRESHOLD) {
      predDrift = true
      signals.lowConf = true
    }
    if (opts.contrastAware && site.role === 'text' && bg) {
      const v = violatesAA(site.raw, bg)
      if (v === true) {
        predDrift = true
        signals.contrast = true
      }
    }
    return { loc: site.loc, role: site.role, raw: site.raw, bound, predDrift, signals }
  })
}

/** Match predictions to labels by role (roles are unique per synthetic component). */
function pairByRole(preds, labels) {
  const out = []
  for (const l of labels) {
    const p = preds.find((x) => x.role === l.role)
    if (p) out.push({ label: l, pred: p })
  }
  return out
}

/**
 * Score one split of the corpus.
 * @param {import('./corpus.js').CorpusCase[]} cases
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {ClassifierOpts} opts
 */
export function scoreSplit(cases, index, resolved, opts) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  let cbTotal = 0, cbCaughtByOracle = 0
  for (const c of cases) {
    const preds = classifyComponent(c.source, c.name, index, resolved, opts)
    for (const { label, pred } of pairByRole(preds, c.labels)) {
      if (label.isDrift && pred.predDrift) tp++
      else if (label.isDrift && !pred.predDrift) fn++
      else if (!label.isDrift && pred.predDrift) fp++
      else tn++
      if (label.class === 'contrast-break') {
        cbTotal++
        if (pred.signals.contrast) cbCaughtByOracle++
      }
    }
  }
  const coverage = tp + fn === 0 ? 1 : tp / (tp + fn)
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const contrastFN = cbTotal === 0 ? 0 : (cbTotal - cbCaughtByOracle) / cbTotal
  return { tp, fp, fn, tn, coverage, precision, contrastFN, cbTotal, cbCaughtByOracle, drift: tp + fn, predicted: tp + fp }
}

/**
 * Score the whole corpus, split by train/test.
 * @param {import('./corpus.js').CorpusCase[]} cases
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {ClassifierOpts} opts
 */
export function scoreCorpus(cases, index, resolved, opts = {}) {
  const train = cases.filter((c) => c.split === 'train')
  const test = cases.filter((c) => c.split === 'test')
  return {
    train: scoreSplit(train, index, resolved, opts),
    test: scoreSplit(test, index, resolved, opts),
  }
}

const pct = (n) => (n * 100).toFixed(1) + '%'
/** One-line summary of a split score. */
export const fmtSplit = (s) => `coverage ${pct(s.coverage)} (${s.tp}/${s.drift})  precision ${pct(s.precision)} (${s.tp}/${s.predicted})  contrastFN ${pct(s.contrastFN)}`

export { isLegitLiteral }
