// Unit tests for the capture root-trim helpers (sorb-capture-trim-spec.md §6).
// Pure geometry — no Playwright/DOM needed. Run: `node --test src/capture.test.js`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasContent, contentBBox, tightenRoot } from './capture.js'

// ─── tiny LayerNode factories ───────────────────────────────────────────────
const SOLID = [{ type: 'SOLID', r: 0.1, g: 0.3, b: 0.9 }]

/** A FRAME. Pass `{ fill: true }` to make it self-painting. */
const frame = (x, y, w, h, opts = {}, children = []) => ({
  type: 'FRAME',
  name: opts.name || 'div',
  x, y, width: w, height: h,
  fills: opts.fill ? SOLID : [],
  strokes: opts.stroke ? SOLID : [],
  children,
})

const text = (x, y, w, h, value = 'Primary') => ({
  type: 'TEXT', name: value, x, y, width: w, height: h, fills: SOLID, children: [],
})

// ─── hasContent ─────────────────────────────────────────────────────────────
test('hasContent: TEXT, painted frame, and nested content are content-bearing', () => {
  assert.equal(hasContent(text(0, 0, 10, 10)), true)
  assert.equal(hasContent(frame(0, 0, 10, 10, { fill: true })), true)
  assert.equal(hasContent(frame(0, 0, 10, 10, { stroke: true })), true)
  // transparent wrapper around a painted child → content-bearing via descendant
  assert.equal(hasContent(frame(0, 0, 10, 10, {}, [frame(0, 0, 5, 5, { fill: true })])), true)
  // empty transparent wrapper → not content-bearing
  assert.equal(hasContent(frame(0, 0, 10, 10, {}, [frame(0, 0, 5, 5)])), false)
  assert.equal(hasContent(null), false)
})

// ─── contentBBox ────────────────────────────────────────────────────────────
test('contentBBox: union of painted/text rects in local coords; null when nothing paints', () => {
  // a painted button with an inset text label
  const button = frame(0, 0, 82, 38, { fill: true }, [text(16, 10, 50, 18)])
  assert.deepEqual(contentBBox(button), { minX: 0, minY: 0, maxX: 82, maxY: 38 })

  // transparent wrapper: bbox bounds only the painted descendants (accumulated offset)
  const wrapped = frame(0, 0, 200, 100, {}, [frame(20, 30, 40, 20, { fill: true })])
  assert.deepEqual(contentBBox(wrapped), { minX: 20, minY: 30, maxX: 60, maxY: 50 })

  // nothing drawn → null
  assert.equal(contentBBox(frame(0, 0, 100, 100, {}, [frame(0, 0, 10, 10)])), null)
})

test('contentBBox: negative/overflow offsets are included (never clips content)', () => {
  const n = frame(0, 0, 100, 100, {}, [
    frame(-5, -8, 10, 10, { fill: true }),
    frame(90, 95, 20, 20, { fill: true }),
  ])
  assert.deepEqual(contentBBox(n), { minX: -5, minY: -8, maxX: 110, maxY: 115 })
})

// ─── tightenRoot: the three canonical shapes (spec §6) ──────────────────────
test('tightenRoot: single component — descends wrappers, crops to the button (82×38 at origin)', () => {
  // story 1248×86 → wrapper → wrapper → button 82×38 @(24,24) → text
  const tree = frame(0, 0, 1248, 86, {}, [
    frame(0, 0, 1248, 86, {}, [
      frame(0, 0, 1248, 86, {}, [
        frame(24, 24, 82, 38, { fill: true, name: 'button' }, [text(16, 10, 50, 18)]),
      ]),
    ]),
  ])
  const out = tightenRoot(tree)
  assert.equal(out.name, 'button')
  assert.equal(out.x, 0)
  assert.equal(out.y, 0)
  assert.equal(out.width, 82)
  assert.equal(out.height, 38)
  // the text child is preserved (annotation-safe) and unshifted (dx=dy=0)
  assert.equal(out.children.length, 1)
  assert.equal(out.children[0].type, 'TEXT')
})

test('tightenRoot: multi-child row — stops at the row, crops to the variant group (tight, not 1248)', () => {
  // a row of three buttons, left-padded by 10
  const row = frame(0, 0, 1248, 40, { name: 'row' }, [
    frame(10, 0, 80, 40, { fill: true }, [text(8, 10, 40, 18)]),
    frame(110, 0, 90, 40, { fill: true }, [text(8, 10, 50, 18)]),
    frame(210, 0, 70, 40, { fill: true }, [text(8, 10, 40, 18)]),
  ])
  const tree = frame(0, 0, 1248, 40, {}, [row])
  const out = tightenRoot(tree)
  assert.equal(out.name, 'row')
  assert.equal(out.x, 0)
  assert.equal(out.width, 270) // (210+70) - 10  → tight row, not 1248
  assert.equal(out.height, 40)
  assert.equal(out.children.length, 3)
  assert.equal(out.children[0].x, 0) // first button shifted left by dx=10
  assert.equal(out.children[1].x, 100)
  assert.equal(out.children[2].x, 200)
})

test('tightenRoot: visual card — descent stops at the painted surface (kept, not skipped)', () => {
  const card = frame(20, 10, 320, 180, { fill: true, name: 'card' }, [
    frame(16, 16, 200, 24, {}, [text(0, 0, 180, 20, 'Title')]),
  ])
  const tree = frame(0, 0, 1248, 220, {}, [card])
  const out = tightenRoot(tree)
  assert.equal(out.name, 'card')
  assert.equal(out.width, 320) // card surface preserved
  assert.equal(out.height, 180)
  assert.equal(out.x, 0)
})

// ─── tightenRoot: edge cases (spec §5) ──────────────────────────────────────
test('tightenRoot: sole child is TEXT — does not descend into raw text; crops the wrapper to it', () => {
  const tree = frame(0, 0, 200, 50, { name: 'label-wrap' }, [text(5, 5, 40, 16, 'Hi')])
  const out = tightenRoot(tree)
  assert.equal(out.name, 'label-wrap') // kept the wrapper, not the TEXT
  assert.equal(out.width, 40)
  assert.equal(out.height, 16)
  assert.equal(out.children[0].x, 0) // text normalized to origin
  assert.equal(out.children[0].y, 0)
})

test('tightenRoot: nothing drawn — returns the tree untouched, no crash', () => {
  const tree = frame(0, 0, 100, 100, {}, [frame(0, 0, 50, 50)])
  const out = tightenRoot(tree)
  assert.equal(out, tree) // unchanged reference
  assert.equal(out.width, 100)
})

test('tightenRoot: wrapper with its OWN bound fill stops descent (no lost token surface)', () => {
  // an Alert/Card whose background is token-bound: selfVisual → keep it
  const alert = frame(0, 0, 600, 60, { fill: true, name: 'alert' }, [
    frame(0, 0, 600, 60, {}, [text(12, 20, 200, 18, 'Heads up')]),
  ])
  const tree = frame(0, 0, 1248, 60, {}, [alert])
  const out = tightenRoot(tree)
  assert.equal(out.name, 'alert')
  assert.equal(out.width, 600)
})

test('tightenRoot: null/empty input is safe', () => {
  assert.equal(tightenRoot(null), null)
})
