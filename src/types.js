// @sorb/seed — shared typedefs for the public library surface.
//
// JavaScript only — JSDoc typedefs, no TypeScript. Re-exports the Legacy-React
// adapter typedefs from `adapt/types.js` (kept there since they're adapter-
// internal shapes) alongside the result typedefs for the top-level `adapt`
// exports (`detectHardcoded`, `mapToToken`) and the `options` shapes the
// framework Style Dictionary formats accept. Shared cross-package shapes
// (`ResolvedToken`, `Tier`) come from `@sorb/core` — never re-declared here.

/** @typedef {import('./adapt/types.js').AdaptRole} AdaptRole */
/** @typedef {import('./adapt/types.js').AdaptSite} AdaptSite */
/** @typedef {import('./adapt/types.js').AdaptMapping} AdaptMapping */
/** @typedef {import('./adapt/types.js').AdaptRow} AdaptRow */

/**
 * Return value of `detectHardcoded(source, filename)` — every hardcoded
 * color/dimension style site found in one source file.
 * @typedef {AdaptSite[]} DetectHardcodedResult
 */

/**
 * Return value of `mapToToken(site, index, resolved)` — one detected site
 * mapped to its nearest resolved token plus a confidence score. Identical
 * shape to {@link AdaptMapping}; named for the function that produces it.
 * @typedef {AdaptMapping} MapToTokenResult
 */

/**
 * `options` accepted by every role-resolved framework format (`sorb/mantine-vars`,
 * `sorb/shadcn-theme`, `sorb/mat-sys-vars`, and the base case of `sorb/mui-vars` /
 * `sorb/primevue-preset`). Omit entirely for a kit that already uses the
 * canonical role ids as its own token ids (identity mapping).
 * @typedef {Object} RoleMapOptions
 * @property {Record<string,string>} [roleMap]  Canonical role id -> your kit's token id.
 */

/**
 * `options` for `sorb/mui-vars`. MUI's `createTheme({ cssVariables: true })`
 * needs a real literal to compute contrast/tonal variants, so `seedValues` is
 * REQUIRED — a role with no entry emits `var(--token)` with no fallback.
 * @typedef {Object} MuiFormatOptions
 * @property {Record<string,string>} [roleMap]  Canonical role id -> your kit's token id.
 * @property {Record<string,string>} seedValues  Canonical role id -> seed/fallback literal (e.g. `{ 'color.brand': '#1976d2' }`).
 */

/**
 * `options` for `sorb/primevue-preset`. `roleMap` here maps PrimeVue's own
 * role tree (`PRIMEVUE_ROLE_TREE`) entries -> your kit's token ids, not the
 * generic color/radius/shadow/typography roles.
 * @typedef {Object} PrimevueFormatOptions
 * @property {Record<string,string>} [roleMap]  PrimeVue role path -> your kit's token id.
 * @property {'Aura'|'Material'|'Lara'|'Nora'} [basePreset]  Base PrimeVue theme to extend (default `'Aura'`).
 */

export {}
