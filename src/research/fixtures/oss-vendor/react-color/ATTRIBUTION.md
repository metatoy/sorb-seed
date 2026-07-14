# Vendored third-party source — react-color (independent color/contrast OSS)

Unmodified React component source from **react-color** (casesandberg/react-color),
used ONLY as an independent real-world corpus for the SORB learning-loop POC
fault-injection harness. Not part of the Sorb product; not imported by any Sorb package.

- Source: https://github.com/casesandberg/react-color (branch: master)
- License: **MIT** (© Case Sandberg) — see the upstream repo LICENSE.
- Files (renamed .js → .jsx so the AST detector parses them; content unmodified):
  Twitter, Block, ChromeFields, Material, Github, Chrome ← src/components/*

Purpose: independent third-party code that hardcodes **literal hex colors** in inline
style objects (a color-picker library), giving genuine independent COLOR drift +
contrast-break injection — closing the "contrast story is synthetic-only" caveat.
