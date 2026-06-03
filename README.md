# @metatoy/sorb-seed

Storybook → Figma capture for Sorb. This package holds the **heavy**
pieces (esbuild now; Playwright later) so the bridge (`@metatoy/sorb-juice`)
and `@metatoy/sorb-leaf` stay lean.

The full design lives in the team's internal spec (kept out of the repo).

## Install & link the CLI

This package is **private / not published to npm yet**, so there's no
`npm i @metatoy/sorb-seed`. To get the `sorb-seed` command working:

```bash
# 1. install this package's deps (from this directory)
cd packages/seed
npm install                 # pulls esbuild (Playwright is optional — see capture)

# 2. expose the `sorb-seed` bin on your PATH
npm link                    # creates a global symlink to bin → src/cli.js
```

`sorb-seed` is now runnable from anywhere. To remove the global symlink
later: `npm unlink -g @metatoy/sorb-seed` (or `npm rm -g @metatoy/sorb-seed`).

**Prefer not to touch your global PATH?** Skip `npm link` and invoke the source
directly from the consuming app:

```bash
node /abs/path/to/sorb/packages/seed/src/cli.js resolve
```

> **Where you run it matters.** `sorb-seed` reads `sorb.config.json`,
> `sd.config.js`, and `tokens/` from the **current working directory** — i.e.
> your *app* (e.g. `example/`), **not** this package directory. Run the commands
> below from the app you're capturing, after `npm link`ing here once.

## Status

Early — not yet published (`private`). Implemented so far:

- **`sorb-seed resolve`** — a thin wrapper around **Style Dictionary**. The
  DTCG token sets (`tokens/{primitive,semantic,component}.json`) are the source
  of truth; SD's `sorb/resolved-map` format emits `.sorb/resolved.json` —
  one entry per token: `[{ id, cssVar, value, tier, type }]` where
  `tier ∈ {primitive, semantic, component}`. Reads `sorb.config.json`
  (`styleDictionaryConfig`, default `sd.config.js`). The bridge (`sorb dev`)
  serves this at `GET /tokens/resolved`; the plugin's **Sync Variables** button
  and `capture`'s annotator both consume it. (This retired the old
  esbuild-bundle-and-eval theme resolver.)

  ```bash
  sorb-seed resolve   # → runs style-dictionary build → .sorb/resolved.json
  ```

- **`sorb-seed capture`** (`src/captureCli.js`) — Playwright runner that
  visits every story in your running Storybook, injects the walker (below),
  captures the rendered root, annotates tokens against `.sorb/resolved.json`,
  and writes:
  - one **`<Component>.sorb.json`** *next to each story file* (containing
    all of that component's stories), and
  - **`.sorb/index.json`** — a story-id → artifact map (with content hashes
    for `--changed`).

  Playwright is an **optional peer dependency** — it (and its ~150 MB browser)
  is only needed for `capture`, never for `resolve` or a plain install.

  The URLs below align with the **sorb-demo** services (`npm run demo`):

  | Service | URL |
  |---|---|
  | App (Vite) | `http://localhost:5173` |
  | Bridge (`sorb dev`) | `http://localhost:7777` |
  | Storybook | `http://localhost:6006` |

  ```bash
  # one-time, only if you'll run capture:
  npm install playwright        # its postinstall fetches Chromium automatically
  #   (if browsers were skipped: npx playwright install chromium)

  # capture against the demo's Storybook (set once in sorb.config.json)
  sorb-seed capture                                      # uses seed.storybookUrl
  sorb-seed capture --only=Button.stories                # filter by importPath/title/id
  sorb-seed capture --changed                            # skip unchanged stories
  sorb-seed capture --storybook-url=http://localhost:6006  # override on the fly
  ```

  Set `seed.storybookUrl` in `sorb.config.json` so you don't need the flag:

  ```jsonc
  {
    "seed": { "storybookUrl": "http://localhost:6006" }
  }
  ```

  The captured artifacts are then served by the bridge at
  `GET http://localhost:7777/artifacts` (the index) and
  `GET http://localhost:7777/artifact?id=<storyId>` (one artifact, looked up
  by id — never a raw filesystem path). The Figma plugin's **Storybook** tab
  fetches from these endpoints to list and insert captured components.

- **`captureRoot(el)`** (`src/capture.js`) — in-page DOM walker (our own
  capture engine, no `htmlToFigma` dependency). Maps element →
  FRAME/RECTANGLE/TEXT `LayerNode` with fills, strokes, corner radius, single
  box-shadow, text (family/weight/size/line-height/letter-spacing/align/color),
  flex → auto-layout + padding, and geometry relative to each parent. Designed
  to run via Playwright's `page.evaluate`; pure helpers (color/dim/shadow
  parsing) unit-tested. Scope (v1) supports the design-system primitive case;
  gradients/grid/transform/pseudo-elements are deferred.
- **`annotateTree(node, index)`** (`src/annotateTokens.js`) — walks a captured
  tree, attaches a `sorb.tokens` / `sorb.candidates` side-channel to each
  node whose bindable values (fill, stroke, corner radius, effect color) match
  the resolved bindable map. Idempotent; preserves raw values for the plugin
  materializer.

Validated end-to-end against the sorb-demo resolved map: a Button DOM →
`captureRoot` → `annotateTree` binds `fill` → `button.primary.bg.default`,
`stroke` → `button.primary.border.default`, `cornerRadius` → `button.radius`,
text fill → `button.primary.text.default`, using tier + property-affinity
ranking (component > semantic > primitive).

Planned: the **plugin materializer** (turns each `LayerNode` into a Figma
component bound to Variables via `setBoundVariable`); pseudo-elements and
forced interaction states; component-set assembly from per-story captures.
