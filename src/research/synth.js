// Synthetic clean-component generator (M1). Builds deterministic, CONFORMANT
// tokenized React components from a resolved token map: every style value is a
// `var(--token, fallback)` binding, so `detectHardcoded` finds ZERO sites in a
// clean component. Drift is then injected (inject.js) by replacing a binding
// with a stale literal — the observable symptom the engine must recover.
//
// "Conformant" = the text color passes WCAG AA contrast against the background,
// so an injected contrast-break is a genuine regression from a passing state.
import { relativeLuminance, contrastRatio, AA_NORMAL } from './contrast.js'
import { mulberry32, pick, randInt } from './prng.js'

/**
 * @typedef {Object} Binding
 * @property {string} prop      JSX style prop ('backgroundColor'|'color'|'borderRadius')
 * @property {'bg'|'text'|'radius'} role
 * @property {string} cssVar    e.g. '--color-blue-500'
 * @property {string} tokenId   e.g. 'color.blue.500'
 * @property {string} value     the fallback literal, e.g. '#0f65ef' | '4px'
 */

/**
 * @typedef {Object} SynthComponent
 * @property {string} name
 * @property {string} source     one-line JSX source (all values are var() bindings)
 * @property {Binding[]} bindings
 */

const isPxColorSafe = (t) => t && t.type === 'color' && typeof t.value === 'string' && t.value[0] === '#'
const isPxDim = (t) => t && t.type === 'dimension' && /^\d+px$/.test(String(t.value))

/** Build one binding record from a resolved token. */
const binding = (prop, role, t) => ({ prop, role, cssVar: t.cssVar, tokenId: t.id, value: String(t.value).toLowerCase() })

/**
 * Choose a text color that passes AA against `bg` from the palette; if none of
 * the sampled picks pass, fall back to whichever palette color maximizes the
 * ratio (keeps the clean component conformant by construction).
 * @param {() => number} rng
 * @param {any[]} colors  hex color tokens
 * @param {any} bg
 */
function pickPassingText(rng, colors, bg) {
  for (let i = 0; i < 8; i++) {
    const cand = pick(rng, colors)
    if (cand && cand.id !== bg.id && contrastRatio(cand.value, bg.value) >= AA_NORMAL) return cand
  }
  // fallback: max-contrast color (deterministic — no rng)
  let best = null
  let bestRatio = -1
  for (const c of colors) {
    if (c.id === bg.id) continue
    const r = contrastRatio(c.value, bg.value)
    if (r != null && r > bestRatio) {
      bestRatio = r
      best = c
    }
  }
  return best || bg
}

/**
 * Generate `n` synthetic conformant components from a resolved map.
 * @param {import('@sorb/core').ResolvedToken[]} resolved
 * @param {{seed:number, n:number}} o
 * @returns {SynthComponent[]}
 */
export function synthComponents(resolved, o) {
  const rng = mulberry32(o.seed >>> 0)
  const colors = resolved.filter(isPxColorSafe)
  const dims = resolved.filter(isPxDim)
  if (colors.length < 2 || dims.length < 1) {
    throw new Error(`synth: need ≥2 hex colors and ≥1 px dimension in the resolved map (got ${colors.length} colors, ${dims.length} dims)`)
  }
  /** @type {SynthComponent[]} */
  const out = []
  for (let i = 0; i < o.n; i++) {
    const bg = pick(rng, colors)
    const text = pickPassingText(rng, colors, bg)
    const rad = dims[randInt(rng, dims.length)]
    const bindings = [
      binding('backgroundColor', 'bg', bg),
      binding('color', 'text', text),
      binding('borderRadius', 'radius', rad),
    ]
    const name = `S${i}`
    const styleEntries = bindings.map((b) => `${b.prop}: 'var(${b.cssVar}, ${b.value})'`).join(', ')
    const source = `export const ${name} = () => <div style={{ ${styleEntries} }}>${name}</div>`
    out.push({ name, source, bindings })
  }
  return out
}

export { relativeLuminance }
