// Sorb capture walker — runs IN THE PAGE (headless browser).
//
// Turns a DOM element (a Storybook story root) into our own `LayerNode` tree
// via getComputedStyle + getBoundingClientRect. Values are kept as `raw` CSS
// strings so the token annotator can match them later; colors are also given
// in Figma's {r,g,b}+opacity form for the materializer.
//
// Scope (v1): FRAME/RECTANGLE/TEXT; solid background fills; uniform border +
// corner radius; a single box-shadow; text (family/weight/size/line-height/
// letter-spacing/align/color); flex → auto-layout (+ padding); geometry
// relative to each parent. Deferred: gradients, bg-images, transforms, grid,
// pseudo-elements, SVG/img, per-side borders, multiple shadows.
//
// The DOM functions only run in a browser; the pure helpers are unit-tested.

// ─── pure helpers (no DOM) ───────────────────────────────────────────────────

/** "rgb(15, 101, 239)" / "rgba(…,a)" → { color:{r,g,b}, opacity, raw } or null. */
export const rgbToFigma = (str) => {
  if (str == null) return null
  const s = String(str).trim()
  const m = s.match(/^rgba?\(\s*([^)]+)\)$/i)
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x.trim()))
  if (p.length < 3 || p.some((n, i) => i < 3 && Number.isNaN(n))) return null
  const a = p[3] === undefined ? 1 : p[3]
  return { color: { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255 }, opacity: a, raw: s }
}

/** "4px" → 4; "0px" → 0; "none"/"normal"/"" → null. */
export const pxNum = (str) => {
  if (str == null) return null
  const m = String(str).trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  return m ? parseFloat(m[1]) : null
}

const FULLY_TRANSPARENT = (c) => !c || c.opacity === 0

/** Parse a single CSS box-shadow into a Figma effect, or null for "none". */
export const parseShadow = (str) => {
  if (str == null) return null
  const s = String(str).trim()
  if (s === '' || s === 'none') return null
  const inset = /\binset\b/.test(s)
  const colorMatch = s.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)
  const color = colorMatch ? rgbToFigma(colorMatch[0]) : { color: { r: 0, g: 0, b: 0 }, opacity: 1, raw: 'rgb(0,0,0)' }
  const rest = s.replace(colorMatch ? colorMatch[0] : '', '').replace(/\binset\b/, '')
  const nums = (rest.match(/-?\d+(?:\.\d+)?px/g) || []).map((n) => pxNum(n))
  const [x = 0, y = 0, blur = 0, spread = 0] = nums
  return {
    type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    offset: { x, y },
    radius: blur,
    spread,
    color,
    raw: s,
  }
}

/** CSS font-weight → number (normal=400, bold=700). */
export const normalizeWeight = (w) => {
  if (w === 'normal' || w == null) return 400
  if (w === 'bold') return 700
  const n = parseInt(w, 10)
  return Number.isNaN(n) ? 400 : n
}

export const mapJustify = (v) =>
  ({ 'flex-start': 'MIN', start: 'MIN', 'flex-end': 'MAX', end: 'MAX',
     center: 'CENTER', 'space-between': 'SPACE_BETWEEN' })[v] || 'MIN'

export const mapAlign = (v) =>
  ({ 'flex-start': 'MIN', start: 'MIN', 'flex-end': 'MAX', end: 'MAX',
     center: 'CENTER', baseline: 'MIN', stretch: 'MIN' })[v] || 'MIN'

export const mapTextAlign = (v) =>
  ({ left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED',
     start: 'LEFT', end: 'RIGHT' })[v] || 'LEFT'

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'BR'])

// ─── DOM walker (browser only) ───────────────────────────────────────────────

const firstFamily = (fontFamily) =>
  String(fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '')

const lineHeightOf = (cs) => {
  if (cs.lineHeight === 'normal') return { unit: 'AUTO' }
  const px = pxNum(cs.lineHeight)
  return px == null ? { unit: 'AUTO' } : { unit: 'PIXELS', value: px }
}

const cornerRadiusOf = (cs) => {
  const tl = pxNum(cs.borderTopLeftRadius) || 0
  const tr = pxNum(cs.borderTopRightRadius) || 0
  const br = pxNum(cs.borderBottomRightRadius) || 0
  const bl = pxNum(cs.borderBottomLeftRadius) || 0
  return tl === tr && tr === br && br === bl ? tl : [tl, tr, br, bl]
}

const isHidden = (cs) =>
  cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse'

const textLayer = (textNode, cs, parentRect) => {
  const value = textNode.nodeValue.replace(/\s+/g, ' ').trim()
  if (!value) return null
  const range = document.createRange()
  range.selectNodeContents(textNode)
  const r = range.getBoundingClientRect()
  const fill = rgbToFigma(cs.color)
  return {
    type: 'TEXT',
    name: value.slice(0, 40),
    x: r.left - parentRect.left,
    y: r.top - parentRect.top,
    width: r.width,
    height: r.height,
    characters: value,
    fontFamily: firstFamily(cs.fontFamily),
    fontWeight: normalizeWeight(cs.fontWeight),
    italic: cs.fontStyle === 'italic',
    fontSize: pxNum(cs.fontSize) || 16,
    lineHeight: lineHeightOf(cs),
    letterSpacing: pxNum(cs.letterSpacing) || 0,
    textAlign: mapTextAlign(cs.textAlign),
    fills: FULLY_TRANSPARENT(fill) ? [] : [{ type: 'SOLID', ...fill }],
  }
}

/**
 * Capture one element (and its subtree) into a LayerNode.
 * @param {Element} el
 * @param {DOMRect} parentRect  rect to make this node's geometry relative to
 * @returns {object|null} LayerNode, or null if skipped
 */
export const captureNode = (el, parentRect) => {
  if (SKIP_TAGS.has(el.tagName)) return null
  const cs = getComputedStyle(el)
  if (isHidden(cs)) return null
  const rect = el.getBoundingClientRect()

  const bg = rgbToFigma(cs.backgroundColor)
  const fills = FULLY_TRANSPARENT(bg) ? [] : [{ type: 'SOLID', ...bg }]

  const borderW = pxNum(cs.borderTopWidth) || 0
  const borderC = rgbToFigma(cs.borderTopColor)
  const hasStroke = borderW > 0 && cs.borderTopStyle !== 'none' && !FULLY_TRANSPARENT(borderC)
  const strokes = hasStroke ? [{ type: 'SOLID', ...borderC }] : []

  const shadow = parseShadow(cs.boxShadow)

  // drop entirely invisible, zero-area, contentless nodes
  const area = rect.width * rect.height
  if (area === 0 && !fills.length && !strokes.length) return null

  const display = cs.display
  const isFlex = display === 'flex' || display === 'inline-flex'
  const layout = isFlex
    ? {
        mode: cs.flexDirection.startsWith('column') ? 'VERTICAL' : 'HORIZONTAL',
        primaryAxisAlign: mapJustify(cs.justifyContent),
        counterAxisAlign: mapAlign(cs.alignItems),
        itemSpacing: pxNum(cs.columnGap) || pxNum(cs.gap) || 0,
        paddingTop: pxNum(cs.paddingTop) || 0,
        paddingRight: pxNum(cs.paddingRight) || 0,
        paddingBottom: pxNum(cs.paddingBottom) || 0,
        paddingLeft: pxNum(cs.paddingLeft) || 0,
      }
    : { mode: 'NONE' }

  const node = {
    type: 'FRAME',
    name: el.tagName.toLowerCase(),
    x: rect.left - parentRect.left,
    y: rect.top - parentRect.top,
    width: rect.width,
    height: rect.height,
    opacity: cs.opacity === '' ? 1 : parseFloat(cs.opacity),
    clipsContent: cs.overflow === 'hidden' || cs.overflowX === 'hidden',
    fills,
    strokes,
    strokeWeight: hasStroke ? borderW : 0,
    cornerRadius: cornerRadiusOf(cs),
    effects: shadow ? [shadow] : [],
    layout,
    children: [],
  }

  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const t = textLayer(child, cs, rect)
      if (t) node.children.push(t)
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const c = captureNode(child, rect)
      if (c) node.children.push(c)
    }
  }
  return node
}

/** Entry point: capture a root element with itself at the origin (0,0). */
export const captureRoot = (el) => captureNode(el, el.getBoundingClientRect())

// Install the walker on `window` so it can be called from a Playwright
// page.evaluate(() => window.__sorbCapture(...)) after this module is
// bundled and injected via addInitScript. No-op in Node tests.
if (typeof window !== 'undefined') {
  window.__sorbCapture = (el) => captureRoot(el || document.querySelector('#storybook-root'))
}
