// E3 — token-map injection + conformance snapshot.
//
// Mode B's input is an app URL + a token map (cssVar -> proposed value,
// possibly one of several viewports — the caller runs renderJob once per
// viewport). We inject the map as CSS custom properties on :root (the same
// mechanism `@sorb/leaf`'s SorbProvider uses at runtime — `var(--token,
// fallback)`), then read back what the page actually resolved so the caller
// gets a conformance snapshot, not just a rendered picture.

/**
 * Set each `tokenMap` entry as a CSS custom property on `document.documentElement`.
 * @param {{evaluate: Function}} page a Playwright Page (or a test double with the same shape)
 * @param {Object.<string,string>} tokenMap cssVar name -> value
 */
export async function injectTokenMap(page, tokenMap) {
  await page.evaluate((map) => {
    const root = document.documentElement
    for (const key of Object.keys(map)) root.style.setProperty(key, map[key])
  }, tokenMap)
}

/**
 * Read back the RESOLVED (computed) value of each cssVar from `:root`.
 * @param {{evaluate: Function}} page
 * @param {string[]} varNames
 * @returns {Promise<Object.<string,string>>} cssVar -> resolved value (raw string, trimmed)
 */
export async function readResolvedVars(page, varNames) {
  if (!varNames.length) return {}
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement)
    const out = {}
    for (const name of names) out[name] = cs.getPropertyValue(name).trim()
    return out
  }, varNames)
}

/**
 * Compare the requested token map against what actually resolved in-page.
 * @param {Object.<string,string>} tokenMap requested cssVar -> value
 * @param {Object.<string,string>} resolvedVars actual cssVar -> resolved value
 * @returns {{rows: Array<{cssVar:string,expected:string,actual:string,match:boolean}>, conformant: boolean, mismatchCount: number}}
 */
export function buildConformance(tokenMap, resolvedVars) {
  const rows = Object.keys(tokenMap).map((cssVar) => {
    const expected = String(tokenMap[cssVar]).trim()
    const actualRaw = resolvedVars ? resolvedVars[cssVar] : undefined
    const actual = actualRaw == null ? '' : String(actualRaw).trim()
    return { cssVar, expected, actual, match: expected === actual }
  })
  const mismatchCount = rows.filter((r) => !r.match).length
  return { rows, conformant: mismatchCount === 0, mismatchCount }
}
