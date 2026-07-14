// Learning loop (M3) — the improvement loop the founder specified
// (PREREGISTRATION.md §5): start from the baseline engine, try ONE pre-declared
// signal per attempt, keep it only if it's an admissible improvement, and stop
// after 3 consecutive no-gains. Held-out (test) split drives every decision.
//
// Admissibility (faithful to the frozen rule "continue on ≥2pp coverage gain,
// precision ≥ 99% constraint"):
//   feasible          = held-out precision ≥ PRECISION_FLOOR
//   accept an attempt if EITHER
//     (a) it stays/gets feasible AND coverage ≥ best.coverage + MIN_GAIN, OR
//     (b) it REPAIRS feasibility (best infeasible → attempt feasible) without
//         losing coverage.
//   otherwise the attempt is a no-gain (reverted).
//
// The attempt ORDER is pre-registered — not chosen after seeing results.
import { scoreCorpus, fmtSplit } from './score.js'

export const MIN_GAIN = 0.02 // 2 percentage points, held-out coverage
export const PRECISION_FLOOR = 0.99
export const PATIENCE = 3

/**
 * Pre-registered, ordered attempts. Each enables exactly one classifier signal.
 * (Frozen in PREREGISTRATION.md Amendment 1.)
 * @type {{name:string, opt:string, rationale:string}[]}
 */
export const ATTEMPTS = [
  { name: 'literal-allowlist', opt: 'literalAllowlist', rationale: 'legit hardcoded literals (0/transparent) are not drift → repair precision' },
  { name: 'contrast-oracle', opt: 'contrastAware', rationale: 'deterministic WCAG oracle catches contrast-breaks that bind to a token → close coverage gap' },
  { name: 'role-aware', opt: 'roleAware', rationale: 'a value that binds only off-role is the wrong token → maybe drift' },
  { name: 'near-match-benign', opt: 'nearMatch', rationale: 'a value near a token is a representational difference → maybe benign' },
  { name: 'low-confidence-drift', opt: 'lowConfDrift', rationale: 'an ambiguous/low-confidence bind → maybe drift' },
]

const feasible = (s) => s.precision >= PRECISION_FLOOR

/**
 * Run the loop.
 * @param {import('./corpus.js').CorpusCase[]} cases
 * @param {{colors:Map,dims:Map}} index
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{attempts?:typeof ATTEMPTS, minGain?:number, patience?:number}} [o]
 */
export function runLoop(cases, index, resolved, o = {}) {
  const attempts = o.attempts || ATTEMPTS
  const minGain = o.minGain == null ? MIN_GAIN : o.minGain
  const patience = o.patience == null ? PATIENCE : o.patience

  const enabled = {}
  const baseline = scoreCorpus(cases, index, resolved, {}).test
  let best = baseline
  const history = [{ attempt: 'baseline', accepted: true, opts: {}, test: baseline, coverage: baseline.coverage, precision: baseline.precision, deltaCoverage: 0, feasible: feasible(baseline) }]

  let noGain = 0
  let stoppedBy = 'attempts-exhausted'
  for (const a of attempts) {
    const trial = { ...enabled, [a.opt]: true }
    const s = scoreCorpus(cases, index, resolved, trial).test
    const gain = s.coverage - best.coverage
    const repair = !feasible(best) && feasible(s) && s.coverage >= best.coverage - 1e-9
    const improve = feasible(s) && gain >= minGain - 1e-12
    const accepted = repair || improve
    history.push({
      attempt: a.name,
      rationale: a.rationale,
      accepted,
      reason: accepted ? (repair && !improve ? 'feasibility-repair' : 'coverage-gain') : (!feasible(s) ? 'precision<floor' : 'gain<2pp'),
      opts: trial,
      test: s,
      coverage: s.coverage,
      precision: s.precision,
      contrastFN: s.contrastFN,
      deltaCoverage: gain,
    })
    if (accepted) {
      Object.assign(enabled, { [a.opt]: true })
      best = s
      noGain = 0
    } else {
      noGain++
      if (noGain >= patience) {
        stoppedBy = `${patience}-consecutive-no-gains`
        break
      }
    }
  }

  return { baseline, final: best, enabled, history, stoppedBy }
}

/** Human-readable trajectory for the run log. */
export function formatLoop(r) {
  const lines = []
  lines.push(`baseline           : ${fmtSplit(r.baseline)}  ${feasible(r.baseline) ? '[feasible]' : '[INFEASIBLE]'}`)
  for (const h of r.history.slice(1)) {
    const tag = h.accepted ? `ACCEPT (${h.reason})` : `reject (${h.reason})`
    lines.push(`+${h.attempt.padEnd(20)}: ${fmtSplit(h.test)}  Δcov ${(h.deltaCoverage * 100 >= 0 ? '+' : '')}${(h.deltaCoverage * 100).toFixed(1)}pp  ${tag}`)
  }
  lines.push(`stopped by         : ${r.stoppedBy}`)
  lines.push(`final config       : {${Object.keys(r.enabled).join(', ') || 'baseline'}}`)
  lines.push(`final held-out     : ${fmtSplit(r.final)}`)
  return lines.join('\n')
}
