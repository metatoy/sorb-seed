# Vendored third-party source — Spectrum (independent OSS corpus)

These files are **unmodified** styled-components component source vendored from
**Spectrum** (withspectrum/spectrum), used ONLY as an independent real-world
corpus for the SORB learning-loop POC fault-injection harness. They are not part
of the Sorb product and are not imported by any Sorb package.

- Source: https://github.com/withspectrum/spectrum (branch: alpha)
- License: **BSD-3-Clause** (© Spectrum authors) — see the upstream repo LICENSE.
- Files (renamed .js → .jsx so the AST detector parses them; content unmodified):
  - button.style.jsx  ← src/components/button/style.js
  - message.style.jsx ← src/components/message/style.js
  - listItems.style.jsx ← src/components/listItems/style.js
  - threadFeed.style.jsx ← src/components/threadFeed/style.js

Purpose: independent (not-ours) real React source in the styled-components idiom,
to complement sorb-demo (inline-style idiom) in the blend corpus. Injection targets
dimension literals (Spectrum resolves colors via theme fns, so no color/contrast).
