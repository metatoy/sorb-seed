# @sorb/seed

Storybook→Figma capture for Sorb™, the design-token bridge for your running app. (Seed.)

This package holds the **heavy** pieces (esbuild now; Playwright later)
so the bridge (`@sorb/juice`) and `@sorb/leaf` stay lean.

Full docs: **[sorbcloud.com/docs/packages/seed](https://www.sorbcloud.com/docs/packages/seed)**.

## Install

`@sorb/seed` is published on npm — installing it (usually as a dev dependency
alongside `@sorb/juice` and `style-dictionary`) exposes the `sorb-seed` CLI
via your package manager's bin shim, no `npm link` needed:

```bash
npm install -D @sorb/seed style-dictionary
npx sorb-seed resolve
```

**Prefer a global install or a checkout you're developing against?**

```bash
npm install -g @sorb/seed      # exposes `sorb-seed` on your PATH globally
# — or, from a local checkout —
npm link                       # from this package dir: symlinks the bin here
node /abs/path/to/sorb-seed/src/cli.js resolve   # or invoke the source directly
```

The CLI has five commands — **`resolve`** (default), **`capture`**, **`adapt`**,
**`variant <add|deprecate>`**, and the internal **`render-worker`** — plus
`sorb-seed --help` / `-h` (usage) and `sorb-seed --version` / `-v`. (There is
**no** `annotate` command: `annotateTree`/`annotateTokens` is the internal
binder `capture` calls, not a CLI verb.)

> **Where you run it matters.** `sorb-seed` reads `sorb.config.json`,
> `sd.config.js`, and `tokens/` from the **current working directory** — i.e.
> your *app* (e.g. `example/`), **not** this package directory. Run the commands
> below from the app you're capturing.

## Status

Published (`@sorb/seed` 0.5.0). Implemented so far:

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

  ### Upload the capture to Sorb Cloud (hosted Storybook)

  The same `.sorb/index.json` + `*.sorb.json` + `.sorb/resolved.json` files can
  be uploaded to Sorb Cloud as **pure data** — the cloud validates the JSON and
  renders per-story previews + the Bound Tokens panel from it. Nothing from your
  repo is cloned, installed, built, or executed on Sorb infrastructure; the
  Storybook build and the Playwright capture always run on **your** machine/CI.

  ```bash
  # capture and upload in one go
  SORB_CLOUD_KEY=sorb_sk_… SORB_CLOUD_PROJECT=<project-uuid> sorb-seed capture --upload

  # or upload already-captured, committed artifacts (no Playwright needed — the CI path)
  SORB_CLOUD_KEY=sorb_sk_… SORB_CLOUD_PROJECT=<project-uuid> sorb-seed push-capture
  ```

  Settings (flag > env > `sorb.config.json`): `--project=<uuid>` /
  `SORB_CLOUD_PROJECT` / `"cloud": { "projectId": "…" }`; `--cloud-url=<url>` /
  `SORB_CLOUD_URL` (default `https://app.sorbcloud.com`). The API key is read
  from **`SORB_CLOUD_KEY` only** and must be a `sorb_sk_…` **secret** key
  (publishable `sorb_pk_` keys are read-only and get a 403) — never put keys in
  `sorb.config.json`. `sourceSha` is stamped from `GITHUB_SHA`, else
  `git rev-parse HEAD`, best-effort. The cloud keeps the newest 10 bundles per
  project; the upload is capped at 5 MB / 200 artifacts / 500 stories.

  GitHub Actions — build Storybook, capture with Playwright, upload:

  ```yaml
  - run: npm ci && npx playwright install --with-deps chromium
  - run: npx storybook build && (npx http-server storybook-static -p 6006 &) && npx wait-on http://localhost:6006
  - run: npx sorb-seed resolve && npx sorb-seed capture --upload --storybook-url=http://localhost:6006
    env:
      SORB_CLOUD_KEY: ${{ secrets.SORB_CLOUD_KEY }}     # sorb_sk_… secret key
      SORB_CLOUD_PROJECT: ${{ vars.SORB_CLOUD_PROJECT }}
  ```

  If you commit the `*.sorb.json` artifacts and `.sorb/index.json`, the last
  step can simply be `npx sorb-seed push-capture` (no browser in CI at all).

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

## Adapt: find hardcoded styles in a legacy app and map them to tokens

**`sorb-seed adapt`** (`src/adapt/adaptCli.js`) scans an existing React
codebase for hardcoded color/dimension style literals and maps each one to
the nearest token in your resolved map — the on-ramp for a codebase that
predates Sorb.

```bash
sorb-seed adapt                                    # report mode, default glob
sorb-seed adapt --src 'src/**/*.{jsx,tsx}'          # scan a narrower glob
sorb-seed adapt --resolved .sorb/resolved.json      # resolved map to map against (default shown)
sorb-seed adapt --mode codemod --write              # rewrite matched sites in place
```

| Flag | Default | Meaning |
|---|---|---|
| `--src <glob>` | `src/**/*.{jsx,tsx,js,ts}` | Source files to scan. |
| `--resolved <path>` | `.sorb/resolved.json` | Resolved token map to map hits against. |
| `--mode <report\|shim\|codemod>` | `report` | `report` scores and writes `.sorb/adapt-report.json`; `shim` emits a runtime-shim payload; `codemod` rewrites matched literals to `var(--token)`. |
| `--write` | off | `codemod` mode only — actually rewrite source files (otherwise a dry run). |

It detects three shapes of hardcoded style: JSX inline `style={{ backgroundColor: '#0F65EF' }}`,
styled-components template literals, and plain CSS-Module-style objects. A
value already written as `var(--…)` is never flagged.

**Confidence model.** Each detected site scores `auto` (1.0 — one on-role
candidate, unambiguous), `review` (0.6 — bound but ambiguous: off-role or
multiple candidates), or `unmapped` (0 — no token matched). `--mode codemod`
only ever rewrites `auto`-status sites; `review`/`unmapped` sites stay in the
report for a human to resolve.

Library exports for scripting the adapter yourself (all from `@sorb/seed`):

| Export | Signature | What it does |
|---|---|---|
| `detectHardcoded` | `(source, filename) => AdaptSite[]` | Parse one file's source (Babel AST) and return every detected hardcoded style site. |
| `propToRole` | `(prop) => AdaptRole` | Map a CSS/JSX property name to a matcher role (`bg`/`text`/`border`/`radius`/`null`). |
| `parseSource` | `(source) => babel.Node` | Parse source into a Babel AST (jsx + typescript plugins, error-recovering). |
| `mapToToken` | `(site, index, resolved?) => AdaptMapping` | Map one detected site to its nearest resolved token + a confidence score. |
| `statusFor` | `(mapping) => 'auto'\|'review'\|'unmapped'` | Turn a mapping's confidence into a report status via `AUTO_THRESHOLD`. |
| `resolveCssVar` | `(tokenId, resolved?) => string` | Look up (or derive) a token id's `--css-var`. |
| `AUTO_THRESHOLD` | `0.9` | The confidence cut between `auto` and `review` — the single explicit threshold. |
| `normalizeColor` / `normalizeDimension` / `classifyColor` | — | The same value normalizers the capture binder uses, shared here so a value the matcher would bind is exactly a value `adapt` flags — no drift. |

Typedefs (`AdaptSite`, `AdaptMapping`, `AdaptRow`, `AdaptRole`, plus
`DetectHardcodedResult`/`MapToTokenResult` result aliases and the per-format
`options` shapes) live in [`src/types.js`](./src/types.js) and
[`src/adapt/types.js`](./src/adapt/types.js).

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

## Related packages

- [`@sorb/core`](https://www.sorbcloud.com/docs/packages/core) — the shared contract
- [`@sorb/juice`](https://www.sorbcloud.com/docs/packages/juice) — the bridge server / CLI
- [`@sorb/leaf`](https://www.sorbcloud.com/docs/packages/leaf) — the React SDK

Full docs: [sorbcloud.com/docs/packages/seed](https://www.sorbcloud.com/docs/packages/seed).

**Sorb™** is a trademark of Metatoy LLC.
