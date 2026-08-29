// `figma-plugin` SourceConnector — the DEFAULT Figma tokens source (all
// tiers; no Enterprise gate). spec/sorb/figma-source-connector.md §1a.
//
// Unlike `storybook-dom` (a local Playwright/Node process this package drives
// directly), this connector's data does NOT come from a locally-callable API.
// It comes from the Figma plugin (`sorb-canopy`), which reads
// `figma.variables.*` **in-file** (via the shared token-mapping walk —
// `sorb-canopy/lib/token-mapping.js`), maps it to Sorb's resolved-map shape,
// and PUSHES it to the juice bridge (`POST /tokens/figma`, the plugin's
// "Export variables" action). So this connector is a BRIDGE CLIENT, not a
// Figma caller — spec's flagged riskiest coupling ("the plugin is the
// executor, the seed-side connector is a bridge client"). `readTokens()`
// reads the latest pushed artifact back via `GET /tokens/figma`.
//
// v1 scope is tokens-first (figma-source-connector.md §1a Fork F /
// §R "Cut"): `listUnits`/`captureGeometry` need a geometry-capable bridge
// endpoint the plugin doesn't push yet (component/node geometry, not just
// variables) — that's a deferred follow-on phase, so they throw a clear,
// actionable error instead of pretending to call Figma directly.
//
// No local token-mapping fork: this connector does no Figma-value mapping of
// its own — the resolved-map entries it reads back already match
// `@sorb/core`'s `ResolvedToken` shape because `sorb-canopy/lib/token-
// mapping.js` produced them before the push. There is nothing to share/
// extract on the seed side (the mapping stays owned by canopy, the one place
// that actually touches `figma.variables.*`).

import { registerSource } from '@sorb/core'

// sorb.config.json may set seed.bridgeOrigin (mirrors storybookUrlOf's
// seed.storybookUrl convention). Falls back to juice's default dev port.
export const bridgeOriginOf = (config) =>
  ((config && config.seed && config.seed.bridgeOrigin) || (config && config.bridgeOrigin) || 'http://localhost:7777').replace(
    /\/$/,
    '',
  )

const readTokens = async (config) => {
  const origin = bridgeOriginOf(config)
  const url = `${origin}/tokens/figma`
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    throw new Error(
      `figma-plugin source: could not reach the bridge at ${origin} (${e.message}). ` +
        'Run `sorb dev` first.',
    )
  }
  if (res.status === 404) {
    throw new Error(
      'figma-plugin source: no Figma export yet — in the Sorb Figma plugin, run ' +
        `"Export variables" (bridge: ${origin}).`,
    )
  }
  if (!res.ok) {
    throw new Error(`figma-plugin source: bridge GET /tokens/figma failed — HTTP ${res.status}`)
  }
  const artifact = await res.json()
  return Array.isArray(artifact.tokens) ? artifact.tokens : []
}

const GEOMETRY_NOT_YET_IMPLEMENTED =
  'figma-plugin source: listUnits/captureGeometry are not implemented in v1 (tokens-first — ' +
  'see spec/sorb/figma-source-connector.md §1a Fork F). Use readTokens() for the token half; ' +
  'geometry capture from Figma is a deferred follow-on phase.'

const listUnits = async () => {
  throw new Error(GEOMETRY_NOT_YET_IMPLEMENTED)
}

const captureGeometry = async () => {
  throw new Error(GEOMETRY_NOT_YET_IMPLEMENTED)
}

export const figmaPluginConnector = {
  id: 'figma-plugin',
  listUnits,
  captureGeometry,
  readTokens,
}

registerSource(figmaPluginConnector)
