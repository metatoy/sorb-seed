# @sorb/seed

Storybook→Figma capture for Sorb™, the design-token bridge for your running app. (Seed.)

This package holds the **heavy** pieces (esbuild now; Playwright later)
so the bridge (`@sorb/juice`) and `@sorb/leaf` stay lean.

The full design lives in the team's internal spec (kept out of the repo).

## Install & link the CLI

This package is **private / not published to npm yet**, so there's no
`npm i @sorb/seed`. To get the `sorb-seed` command working:

```bash
# 1. install this package's deps (from this directory)
cd sorb-seed
npm install                 # pulls esbuild (Playwright is optional — see capture)

# 2. expose the `sorb-seed` bin on your PATH
npm link                    # creates a global symlink to bin → src/cli.js
```

`sorb-seed` is now runnable from anywhere. To remove the global symlink
later: `npm unlink -g @sorb/seed` (or `npm rm -g @sorb/seed`).

**Prefer not to touch your global PATH?** Skip `npm link` and invoke the source
directly from the consuming app:

```bash
node /abs/path/to/sorb-seed/src/cli.js resolve
```

The CLI has exactly two commands — **`resolve`** and **`capture`** — plus
`sorb-seed --help` / `-h` (usage) and `sorb-seed --version` / `-v`. (There is
**no** `annotate` command: `annotateTree`/`annotateTokens` is the internal
binder `capture` calls, not a CLI verb.)

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

## Framework target formats

Six framework-specific Style Dictionary formats promoted into `@sorb/seed`
0.4.0 (framework-targets-productization T1–T5), plus the original
`sorb/tokenset-esm` (`@sorb/leaf`'s React + Bootstrap target). Register the
one(s) you need with `StyleDictionary.registerFormat`, then reference it by
name in a `platforms.<key>.files[]` entry — same mechanics as every other
`sorb/*` format above.

**Semantic-role contract.** Every format below resolves a small set of
canonical role ids (`color.brand`, `color.surface`, `radius.control`, …) to
your kit's actual token ids via `options.roleMap` (`Record<roleId,
tokenId>`). **Omit `roleMap` and it defaults to identity** — correct out of
the box for a kit that already uses the canonical role ids as its own token
ids (the reference `janes-jeans` kit does). A kit with different ids for
the same concepts supplies overrides, e.g. `roleMap: { 'color.brand':
'jj.brand.500' }`. `sorb/tailwind-theme` is the one exception — it maps
every resolved token 1:1 into Tailwind theme keys mechanically, so it takes
no `roleMap`.

### `tailwind-v4` — `sorb/tailwind-theme`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_TAILWIND, sorbTailwind } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_TAILWIND, format: sorbTailwind })

export default {
  // ...source, parsers, other platforms
  platforms: {
    tailwind: {
      transformGroup: 'css', // kebab names so var() refs match the css platform
      buildPath: 'src/tokens/generated/',
      files: [{ destination: 'tailwind-theme.css', format: SORB_TAILWIND }],
    },
  },
}
```

`@theme inline { … }` of `var(--token)` refs — Tailwind utilities
(`bg-*`/`rounded-*`/…) resolve through the runtime-swappable Sorb vars with
zero Tailwind-specific app code. Mirrors `sorb-demo-tailwind/sd.config.js`'s
`tailwind` platform verbatim.

### `shadcn` — `sorb/shadcn-theme`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_SHADCN, sorbShadcn } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_SHADCN, format: sorbShadcn })

export default {
  platforms: {
    shadcn: {
      transformGroup: 'css',
      buildPath: 'src/tokens/generated/',
      files: [
        {
          destination: 'shadcn-theme.css',
          format: SORB_SHADCN,
          options: {
            // roleMap: { 'color.brand': 'my-kit.brand' },  // non-JJ kit only
          },
        },
      ],
    },
  },
}
```

One artifact: shadcn's `:root{}` semantic-var map (`--background`,
`--primary`, `--ring`, …) chained onto Sorb vars via the role contract,
followed by the `@theme inline{}` Tailwind-utility bindings (incl. the
`calc()` radius scale). Import order in your app's entry CSS: `tailwindcss`
→ `variables.css` (the Sorb tokens) → this file. Mirrors
`sorb-demo-tailwind/sd.config.js`'s `tailwind`/`shadcn` platforms, which
consume this exact published format (identity `roleMap` — JJ already uses
canonical role ids).

### `mantine` — `sorb/mantine-vars`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_MANTINE_VARS, sorbMantineVars } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_MANTINE_VARS, format: sorbMantineVars })

export default {
  platforms: {
    mantine: {
      transformGroup: 'css',
      buildPath: 'src/tokens/generated/',
      files: [{ destination: 'mantine-vars.css', format: SORB_MANTINE_VARS }],
    },
  },
}
```

Redeclares Mantine v7's core `--mantine-*` vars as `var(--token) !important`
refs (`!important` is load-bearing — `MantineProvider` injects its own
`:root[data-mantine-color-scheme]` stylesheet at runtime, order-unstable
relative to a static file). Mirrors `sorb-demo-mantine/sd.config.js`'s
`mantine` platform, which now registers this exact published format (T8
retrofit, superseding its former local `sd/mantine-format.js` spike).

### `mui` — `sorb/mui-vars`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_MUI_VARS, sorbMuiVars } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_MUI_VARS, format: sorbMuiVars })

export default {
  platforms: {
    mui: {
      transformGroup: 'css',
      buildPath: 'src/tokens/generated/',
      files: [
        {
          destination: 'mui-vars.css',
          format: SORB_MUI_VARS,
          options: {
            // roleMap: { 'color.brand': 'my-kit.brand' },  // non-JJ kit only
            seedValues: {
              // REQUIRED — MUI's createTheme({ cssVariables: true }) needs a real
              // color to compute contrast/tonal variants; a role with no entry
              // here emits var(--token) with NO fallback. These are seed/fallback
              // literals only, never the values a live preview push resolves to.
              'color.brand': '#1976d2',
              'color.brand-hover': '#1565c0',
              'color.brand-contrast': '#fff',
              'color.accent': '#9c27b0',
              'color.danger': '#d32f2f',
              'color.success': '#2e7d32',
              'color.surface': '#fff',
              'color.ink': 'rgba(0,0,0,0.87)',
              'radius.control': '4px',
            },
          },
        },
      ],
    },
  },
}
```

MUI computes its own `--mui-*` vars from these seed values, and this format
emits a *second*, later-cascading `:root, [data-mui-color-scheme]` block
(`!important`) that re-points each covered `--mui-*` var at `var(--token,
<seed>)` — a Sorb bridge push against `--color-*`/`--radius-*` then cascades
through with zero MUI reinitialization. Load the generated file **after**
MUI's own theme stylesheet. Mirrors `sorb-demo-mui/sd.config.js`'s `mui`
platform, which now registers this exact published format (T8 retrofit)
wrapped to inject the JJ kit's seed literals via `options.seedValues`.

### `primevue` — `sorb/primevue-preset`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_PRIMEVUE_PRESET, sorbPrimevuePreset } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_PRIMEVUE_PRESET, format: sorbPrimevuePreset })

export default {
  platforms: {
    primevue: {
      transformGroup: 'css',
      buildPath: 'src/tokens/generated/',
      files: [
        {
          destination: 'jjPreset.generated.js',
          format: SORB_PRIMEVUE_PRESET,
          options: {
            // roleMap: { 'button.primary.bg.default': 'my-kit.button.bg' },  // non-JJ kit only
            // basePreset: 'Aura',  // default; also: 'Material' | 'Lara' | 'Nora'
          },
        },
      ],
    },
  },
}
```

The **only JS-emitting** target format — writes an ESM module
(`import { definePreset } from '@primeuix/themes'; export const preset =
definePreset(Aura, { semantic: {...}, components: {...} })`) where every
leaf is a `var(--kebab-token-id)` string (no baked literals). `@primeuix/themes`
is a **peer expectation**: this format neither installs nor vendors it — the
consuming PrimeVue v4 app must already have it. Mirrors
`sorb-demo-primevue/sd.config.js`'s `primevue` platform (T8 retrofit): the
demo's former hand-authored `src/jjPreset.js` is deleted, and `src/main.js`
now imports `preset` from the generated `jjPreset.generated.js` this format
produces — same mapping, now data-driven from `PRIMEVUE_ROLE_TREE`.

### `angular-material` — `sorb/mat-sys-vars`

```js
import StyleDictionary from 'style-dictionary'
import { SORB_MAT_SYS_VARS, sorbMatSysVars } from '@sorb/seed'

StyleDictionary.registerFormat({ name: SORB_MAT_SYS_VARS, format: sorbMatSysVars })

export default {
  platforms: {
    matSys: {
      transformGroup: 'css',
      buildPath: 'src/tokens/generated/',
      files: [{ destination: 'mat-sys-overrides.css', format: SORB_MAT_SYS_VARS }],
    },
  },
}
```

Remaps ~30 of Angular Material 20's M3 `--mat-sys-*` system vars (emitted by
the `mat.theme()` mixin) onto your kit's `var(--token) !important` refs.
Import **after** both your kit's own `variables.css` and Angular Material's
own theme styles — `!important` is required, not decorative (Material's
`html{}` theme rule isn't guaranteed to precede this file in the cascade).
Mirrors `sorb-demo-angular/sd.config.js`'s local `SORB_MAT_SYS_VARS` +
`MAT_SYS_MAP` (flagged there as a promotion candidate; this is that
promotion).

---

**Sorb™** is a trademark of Metatoy LLC.
