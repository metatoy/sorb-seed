#!/usr/bin/env node
// Run the legacy-adapter benchmark over the labeled fixture corpus against
// sorb-demo's resolved map. Prints the MEASURED precision/recall/coverage —
// the number behind the "~99%" claim. `pnpm bench`.
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { runBenchmark } from './benchmark.js'

const here = dirname(fileURLToPath(import.meta.url))
const corpus = join(here, '__fixtures__', 'corpus')
// Default to sorb-demo's resolved map (sibling repo); override with argv[2].
const resolvedPath =
  process.argv[2] ||
  resolve(here, '..', '..', '..', 'sorb-demo', '.sorb', 'resolved.json')

runBenchmark(corpus, resolvedPath)
