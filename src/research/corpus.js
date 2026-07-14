// Corpus builder (M1) — assembles the labeled fault-injection corpus and the
// frozen train/test split (PREREGISTRATION.md §3–§4). Deterministic: a corpus
// is a pure function of (resolved map, seed, splitSeed, n).
//
// Per component, each of the three bindings (bg / text / radius) is injected
// with either a benign representational difference or a true drift, so every
// corpus case carries a mix and coverage/precision are non-trivial.
import { synthComponents } from './synth.js'
import { applyInjections } from './inject.js'
import { mulberry32, shuffle } from './prng.js'

/**
 * @typedef {Object} CorpusCase
 * @property {string} name
 * @property {string} source              mutated source with injected drift
 * @property {import('./inject.js').DriftLabel[]} labels
 * @property {'train'|'test'} split
 * @property {'synthetic'|'oss'} sourceKind
 */

/** Build the palette lookup sets the injector needs from a resolved map. */
export function paletteFrom(resolved) {
  const colorValues = new Set()
  const dimValues = new Set()
  for (const t of resolved) {
    if (t.type === 'color' && typeof t.value === 'string') colorValues.add(String(t.value).toLowerCase())
    if (t.type === 'dimension') dimValues.add(String(t.value).toLowerCase())
  }
  return { colorValues, dimValues }
}

/**
 * Assign an injection plan to one component using rng. Weighted so roughly half
 * the sites are benign and half are drift, with contrast-breaks a minority of
 * the text sites (they're the scarcest real-world class).
 * @param {() => number} rng
 * @returns {import('./inject.js').InjectPlanItem[]}
 */
export function planFor(rng) {
  const bg = rng() < 0.5 ? { role: 'bg', class: 'benign' } : { role: 'bg', class: 'stale-value', causal: rng() < 0.5 ? 'stale' : 'rename' }
  const r = rng()
  const text =
    r < 0.4 ? { role: 'text', class: 'benign' } : r < 0.75 ? { role: 'text', class: 'stale-value', causal: rng() < 0.5 ? 'stale' : 'rename' } : { role: 'text', class: 'contrast-break' }
  const radius = rng() < 0.5 ? { role: 'radius', class: 'benign' } : { role: 'radius', class: 'scale-violation' }
  return [bg, text, radius]
}

/**
 * Build the full labeled corpus + split.
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{seed:number, n:number, splitSeed:number, trainFrac?:number}} o
 * @returns {CorpusCase[]}
 */
export function buildCorpus(resolved, o) {
  const trainFrac = o.trainFrac == null ? 0.7 : o.trainFrac
  const palette = paletteFrom(resolved)
  const comps = synthComponents(resolved, { seed: o.seed, n: o.n })
  const planRng = mulberry32((o.seed ^ 0x9e3779b9) >>> 0)

  /** @type {CorpusCase[]} */
  const cases = comps.map((comp) => {
    const plan = planFor(planRng)
    const { source, labels } = applyInjections(comp, plan, palette)
    return { name: comp.name, source, labels, split: 'train', sourceKind: 'synthetic' }
  })

  // Deterministic split by a separate seed — held-out is frozen per §4.
  const idx = shuffle(mulberry32(o.splitSeed >>> 0), cases.map((_, i) => i))
  const nTrain = Math.round(cases.length * trainFrac)
  const trainSet = new Set(idx.slice(0, nTrain))
  cases.forEach((c, i) => {
    c.split = trainSet.has(i) ? 'train' : 'test'
  })
  return cases
}

/**
 * Summary stats over a corpus: counts by split, class, and drift/benign — the
 * numbers that go into the run log so a reviewer can see the corpus shape.
 * @param {CorpusCase[]} cases
 */
export function corpusStats(cases) {
  const out = {
    cases: cases.length,
    train: 0,
    test: 0,
    sites: 0,
    drift: 0,
    benign: 0,
    byClass: {},
    testDrift: 0,
    testBenign: 0,
  }
  for (const c of cases) {
    out[c.split]++
    for (const l of c.labels) {
      out.sites++
      out.byClass[l.class] = (out.byClass[l.class] || 0) + 1
      if (l.isDrift) out.drift++
      else out.benign++
      if (c.split === 'test') {
        if (l.isDrift) out.testDrift++
        else out.testBenign++
      }
    }
  }
  return out
}
