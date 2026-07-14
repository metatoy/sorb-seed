// Remediation preview (M10) — Objective 2: verified remediation. A proposer
// (here DETERMINISTIC, standing in for Phase I's LLM) emits candidate fixes;
// the DETERMINISTIC ORACLE, not the proposer, decides what may be applied. The
// claim being previewed is the *gate*, not the proposer's cleverness:
//
//   "An LLM will propose fixes that are plausible and wrong, so the oracle, not
//    the generator, is the arbiter of correctness."  → 0 false-applies.
//
// To prove the gate is sound we feed each episode a GUARANTEED-WRONG candidate
// (a plausible-but-non-conformant fix) and assert it is never applied. False-
// apply rate is 0 by construction — the demonstration is that it stays 0 even
// under adversarial proposals.
import { violatesAA } from './contrast.js'
import { shuffle, pick } from './prng.js'

/** Oracle: a contrast fix is conformant iff it passes WCAG AA vs the bg. */
export const contrastOracle = (value, ctx) => violatesAA(value, ctx.bg) === false
/** Oracle: a scale fix is conformant iff it is a real token dimension value. */
export const scaleOracle = (value, ctx) => ctx.dimValues.has(String(value).toLowerCase())

/**
 * Run one remediation episode: grade candidates through the oracle, apply the
 * first oracle-verified one. Returns what happened + integrity flags.
 * @param {{value:string, wrong:boolean}[]} candidates
 * @param {(v:string, ctx:any)=>boolean} oracle
 * @param {any} ctx
 */
export function remediateEpisode(candidates, oracle, ctx) {
  const graded = candidates.map((c) => ({ value: c.value, wrong: c.wrong, pass: oracle(c.value, ctx) }))
  const accepted = graded.filter((g) => g.pass)
  const applied = accepted.length ? accepted[0] : null
  // false-apply = we applied something the oracle would NOT verify (0 by construction)
  const falseApply = applied && !oracle(applied.value, ctx) ? 1 : 0
  // adversarial soundness: a guaranteed-wrong candidate must never be applied,
  // and must never be graded as passing.
  const wrongApplied = applied && applied.wrong ? 1 : 0
  const wrongPassed = graded.filter((g) => g.wrong && g.pass).length
  return { repaired: !!applied, appliedValue: applied ? applied.value : null, falseApply, wrongApplied, wrongPassed, nCandidates: candidates.length }
}

/**
 * Build + run remediation episodes over the corpus's oracle-checkable drift
 * (contrast-breaks and scale-violations). Deterministic given the rng seed.
 * @param {import('./corpus.js').CorpusCase[]} cases
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {() => number} rng
 * @param {{colors:string[], dimValues:Set<string>, dims:string[]}} pal
 */
export function runRemediation(cases, resolved, rng, pal) {
  const episodes = []
  for (const c of cases) {
    for (const l of c.labels) {
      if (l.class === 'contrast-break' && l.contrast) {
        const bg = l.contrast.bg
        // proposer: sample token colors (some pass, some fail) + 1 guaranteed-wrong (bg itself → ratio 1)
        const sample = shuffle(rng, pal.colors).slice(0, 5).map((v) => ({ value: v, wrong: violatesAA(v, bg) === true }))
        const candidates = shuffle(rng, [...sample, { value: bg, wrong: true }])
        episodes.push({ kind: 'contrast', ...remediateEpisode(candidates, contrastOracle, { bg }) })
      } else if (l.class === 'scale-violation') {
        // proposer: sample token dims (conformant) + 1 off-scale wrong
        const sample = shuffle(rng, pal.dims).slice(0, 4).map((v) => ({ value: v, wrong: false }))
        const wrongVal = `${parseInt(l.raw, 10) + 1}px`
        const candidates = shuffle(rng, [...sample, { value: wrongVal, wrong: !pal.dimValues.has(wrongVal) }])
        episodes.push({ kind: 'scale', ...remediateEpisode(candidates, scaleOracle, { dimValues: pal.dimValues }) })
      }
    }
  }
  const n = episodes.length
  const applied = episodes.filter((e) => e.repaired).length
  const falseApplies = episodes.reduce((s, e) => s + e.falseApply, 0)
  const wrongApplied = episodes.reduce((s, e) => s + e.wrongApplied, 0)
  const wrongPassed = episodes.reduce((s, e) => s + e.wrongPassed, 0)
  return {
    episodes: n,
    repaired: applied,
    repairRate: n ? applied / n : 0,
    falseApplies, // target 0
    falseApplyRate: applied ? falseApplies / applied : 0,
    wrongApplied, // target 0 — adversarial candidates never applied
    wrongPassed, // target 0 — oracle never grades a guaranteed-wrong as passing
  }
}
