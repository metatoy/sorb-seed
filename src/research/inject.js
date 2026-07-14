// Fault-injection engine (M1) — the "instrument" of the research preview
// (PREREGISTRATION.md §3). Takes a clean synthetic component and replaces
// selected `var(--token, fallback)` bindings with literals, recording exact
// ground-truth labels. Two ground-truth outcomes the engine must separate:
//
//   isDrift=false  benign representational difference — literal EQUALS the
//                  token value; binds cleanly; must NOT be flagged as drift.
//   isDrift=true   semantic drift — the value DEVIATES from any token:
//                    · stale-value (nudge)   a color perturbed off its token
//                    · scale-violation       a dimension off its declared scale
//                    · contrast-break        a text color failing WCAG AA vs its bg
//
// A trivially-detectable corpus (all sites are "drift") would score ~100%
// coverage for free. Mixing benign + drift is what makes coverage/precision a
// real, improvable metric — and previews Objective 1's actual difficulty.
import { detectHardcoded } from '../adapt/detectHardcoded.js'
import { parseHex, contrastRatio, violatesAA, AA_NORMAL } from './contrast.js'
import { pick } from './prng.js'

const clamp = (n) => Math.max(0, Math.min(255, n | 0))
const toHex2 = (n) => clamp(n).toString(16).padStart(2, '0')
const rgbToHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`

/**
 * Perturb a hex color to a nearby DIFFERENT hex that is not any token value —
 * a "nudge" drift (near-match, the hard case for exact-value binding).
 * Deterministic given the input + the forbidden set.
 * @param {string} hex
 * @param {Set<string>} forbidden  lowercased token hex values to avoid
 * @returns {string}
 */
export function perturbHex(hex, forbidden) {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  for (let d = 3; d <= 40; d += 3) {
    // nudge the green channel (mid-weight in luminance) up then down
    for (const cand of [rgbToHex({ ...rgb, g: rgb.g + d }), rgbToHex({ ...rgb, g: rgb.g - d })]) {
      const lc = cand.toLowerCase()
      if (lc !== hex.toLowerCase() && !forbidden.has(lc)) return lc
    }
  }
  return rgbToHex({ ...rgb, g: rgb.g ^ 0x08 }).toLowerCase()
}

/**
 * Move a `<n>px` value off its declared scale to a px value that is not any
 * dimension token's value.
 * @param {string} value  e.g. '4px'
 * @param {Set<string>} dimValues  lowercased dim token values
 * @returns {string}
 */
export function offScalePx(value, dimValues) {
  const n = parseInt(String(value), 10)
  if (!Number.isFinite(n)) return value
  const tries = [n + 1, n + 3, n + 2, n + 5, n + 7, Math.max(1, n - 1)]
  for (const k of tries) {
    const cand = `${k}px`
    if (!dimValues.has(cand)) return cand
  }
  return `${n + 11}px`
}

/**
 * Produce a text color that FAILS WCAG AA contrast against `bg`, verified by
 * the oracle. Deterministic: blend bg toward mid-grey until the ratio drops
 * below threshold; fall back to bg itself (ratio 1) which always violates.
 * @param {string} bgHex
 * @param {number} [threshold=AA_NORMAL]
 * @returns {string}
 */
export function lowContrastFg(bgHex, threshold = AA_NORMAL) {
  const bg = parseHex(bgHex)
  if (!bg) return bgHex
  const mid = { r: 0x80, g: 0x80, b: 0x80 }
  let fallback = bgHex.toLowerCase()
  for (let f = 45; f <= 90; f += 15) {
    const t = f / 100
    const cand = rgbToHex({
      r: bg.r + (mid.r - bg.r) * t,
      g: bg.g + (mid.g - bg.g) * t,
      b: bg.b + (mid.b - bg.b) * t,
    }).toLowerCase()
    const ratio = contrastRatio(cand, bgHex)
    if (ratio != null && ratio < threshold && ratio > 1.15) return cand
    fallback = cand
  }
  // guaranteed violation: near-identical to bg
  return contrastRatio(fallback, bgHex) < threshold ? fallback : bgHex.toLowerCase()
}

/**
 * @typedef {Object} InjectPlanItem
 * @property {'bg'|'text'|'radius'} role   which binding to hit
 * @property {'benign'|'stale-value'|'scale-violation'|'contrast-break'} class
 * @property {'stale'|'rename'} [causal]   metadata for stale-value (observable identical)
 */

/**
 * @typedef {Object} DriftLabel
 * @property {string} file
 * @property {{line:number,column:number}} loc
 * @property {string} prop
 * @property {string} raw          the injected literal now in source
 * @property {string} role
 * @property {string} class
 * @property {string} causalEdit
 * @property {boolean} isDrift      ground truth: true = semantic drift, false = benign
 * @property {string|null} intendedTokenId
 * @property {string} originalValue
 * @property {{fg:string,bg:string,ratio:number,threshold:number,violates:boolean}} [contrast]
 */

/**
 * Apply an injection plan to a synthetic component. Returns the mutated source
 * plus one ground-truth label per injected site (loc read back from the real
 * detector so labels match exactly what the engine sees).
 * @param {import('./synth.js').SynthComponent} comp
 * @param {InjectPlanItem[]} plan
 * @param {{dimValues:Set<string>, colorValues:Set<string>}} palette
 * @returns {{name:string, source:string, labels:DriftLabel[]}}
 */
export function applyInjections(comp, plan, palette) {
  const byRole = Object.fromEntries(comp.bindings.map((b) => [b.role, b]))
  const bgVal = byRole.bg ? byRole.bg.value : null
  /** @type {Array<{b:any, item:InjectPlanItem, raw:string, label:Partial<DriftLabel>}>} */
  const staged = []

  for (const item of plan) {
    const b = byRole[item.role]
    if (!b) continue
    let raw = b.value
    /** @type {Partial<DriftLabel>} */
    const label = {
      prop: b.prop,
      role: b.role,
      class: item.class,
      intendedTokenId: b.tokenId,
      originalValue: b.value,
    }
    if (item.class === 'benign') {
      raw = b.value // exact literal — binds cleanly
      label.isDrift = false
      label.causalEdit = 'inline'
    } else if (item.class === 'stale-value') {
      raw = perturbHex(b.value, palette.colorValues)
      label.isDrift = true
      label.causalEdit = item.causal === 'rename' ? 'rename' : 'stale'
    } else if (item.class === 'scale-violation') {
      raw = offScalePx(b.value, palette.dimValues)
      label.isDrift = true
      label.causalEdit = 'off-scale'
    } else if (item.class === 'contrast-break') {
      raw = lowContrastFg(bgVal || b.value)
      const ratio = contrastRatio(raw, bgVal || b.value)
      label.isDrift = true
      label.causalEdit = 'contrast'
      label.intendedTokenId = null // contrast is a pairing property, not a single-token drift
      label.contrast = { fg: raw, bg: bgVal || b.value, ratio: ratio == null ? 0 : ratio, threshold: AA_NORMAL, violates: violatesAA(raw, bgVal || b.value) === true }
    } else {
      continue
    }
    label.raw = raw
    staged.push({ b, item, raw, label })
  }

  // Rewrite each hit binding's `'var(--x, val)'` → `'raw'` (string literal).
  let source = comp.source
  for (const s of staged) {
    const from = `'var(${s.b.cssVar}, ${s.b.value})'`
    const to = `'${s.raw}'`
    source = source.replace(from, to)
  }

  // Read loc back from the REAL detector so labels align with engine output.
  const sites = detectHardcoded(source, comp.name)
  const siteByRole = {}
  for (const st of sites) if (siteByRole[st.role] == null) siteByRole[st.role] = st

  const labels = staged.map((s) => {
    const st = siteByRole[s.label.role]
    return {
      file: comp.name,
      loc: st ? st.loc : { line: 0, column: 0 },
      ...s.label,
    }
  })
  return { name: comp.name, source, labels }
}

export { detectHardcoded, pick }
