# CLAUDE.md — sorb-seed

Part of the **Sorb** polyrepo under the **Metatoy** org (local base
`workspace/metatoy/`). Siblings: `sorb-core`, `sorb-leaf`, `sorb-juice`,
`sorb-canopy`, `sorb-demo`, `sorb-cloud`.

## What this is

`@sorb/seed` — Storybook → Figma capture. Headless capture (Playwright,
optional peer) + the resolved bindable token map and the `annotateTokens` binder
that stamps `node.sorb = { tokens, candidates }` onto captured layer nodes. Bin:
**`sorb-seed <resolve|capture>`**. Heavy deps live here so the bridge stays lean.

## Hard rules

- **JavaScript only — never TypeScript.** JSDoc typedefs; shared shapes come from
  `@sorb/core` (e.g. `TIER_RANK` in `annotateTokens.js`).
- **Per-repo lockfile is correct** (polyrepo). Cross-repo dev: `npm link
  @sorb/core` against the sibling `../sorb-core`.
- Capture writes to **`.sorb/`** (`resolved.json`, `index.json`, `*.sorb.json`
  artifacts) — gitignored generated output.
- **Commit/push only when asked.** If on the default branch, branch first.
