// Seeded deterministic PRNG for the research corpus — reproducibility is a
// pre-registration requirement (PREREGISTRATION.md §4): the SAME seed must
// always yield the SAME corpus + train/test split. mulberry32: tiny, fast,
// good-enough distribution for sampling; NOT cryptographic.
//
// Node's Math.random() is deliberately NOT used anywhere in the research
// pipeline — every stochastic choice threads through a seeded rng() so a run
// is a pure function of its seed.

/**
 * mulberry32 — a 32-bit seeded PRNG. Returns a function yielding floats in
 * [0, 1). Deterministic for a given integer seed.
 * @param {number} seed  32-bit integer seed.
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Integer in [0, n) from an rng.
 * @param {() => number} rng
 * @param {number} n
 */
export const randInt = (rng, n) => Math.floor(rng() * n)

/**
 * Pick one element of `arr` using `rng`. Returns undefined for an empty array.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T}
 */
export const pick = (rng, arr) => (arr.length ? arr[randInt(rng, arr.length)] : undefined)

/**
 * Deterministic in-place-free Fisher–Yates shuffle → a new array.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(rng, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
