# SORB Learning-Loop POC — Pre-Registration (frozen protocol)

> **This file is committed BEFORE any corpus is generated or any loop is run.** Its commit is the
> proof-of-order: results live in later commits. Do not edit the frozen sections after the first
> loop run — amendments go in an append-only "Amendments" log at the bottom, each with its own date.
>
> - **Spec:** `spec/metatoy-studio/llc/funding/nsf-sbir-run-2026-07/phase4-pitch-sorb-v3-learning-loop-poc.md`
> - **Registered (UTC):** 2026-07-14T04:42Z
> - **Parent commit (harness baseline):** `03a09103bc08520fac8e6d9dd2d32d4d6ac3eaef` (branch `feat/research-loop-poc`, off `feat/legacy-react-adapter`)
> - **Resolved token map under test:** `sorb-demo/.sorb/resolved.json` (104 tokens: 86 color, 14 dimension) — snapshotted into the artifact at roll-up.

---

## 1. Research question (frozen)

Can the built detection engine (`detectHardcoded` + `mapToToken`) recover **injected specification
drift** in React component source at high precision, and can an iterative-improvement loop **close a
measured coverage gap** on a held-out test split without sacrificing precision — previewing Phase I
Objective 1. In parallel, does a deterministic WCAG-2 contrast oracle flag **injected contrast
violations with zero false negatives by construction** — previewing the Objective 2 guarantee.

## 2. Metric (frozen — this defines the "2%")

- **Primary optimization target:** **detection coverage on the HELD-OUT test split.**
  `coverage = (labeled drift sites detected) ÷ (total labeled drift sites)` on test cases only.
- **Hard constraint:** **precision ≥ 0.99 on the held-out split.** `precision = (detected sites
  correctly attributed to the intended token / drift class) ÷ (detected sites)`. An attempt that
  raises coverage but drops held-out precision below 0.99 **does not count as an improvement.**
- **Contrast oracle (separate, binary):** **false-negative rate on injected `contrast-break` sites**,
  computed by the deterministic WCAG-2 relative-luminance oracle. Target: **0 false negatives.**
- All percentages reported to 1 decimal; **per-source breakdown (OSS-lib vs synthetic) reported
  separately** — the OSS number is the headline; synthetic is scale/robustness only.

## 3. Corpus (frozen shape; contents snapshotted at roll-up)

- **Blend (D1):** real OSS token-based React component sources (credibility) **+** deterministically
  **synthesized** clean tokenized components (scale). M1 delivers the synthetic generator + the
  injector; OSS sources are added at M4 scale-up and injected by the same injector.
- **Injection classes (the injected ground truth):**
  1. `stale-value` — a `var(--token, fallback)` binding replaced by a bare literal (the code went
     stale / the token was renamed at source). Two variants: `exact` (literal = fallback, maps back
     cleanly) and `nudge` (literal perturbed off the token value — the hard case where the coverage
     gap lives). `causalEdit ∈ {stale, rename}`.
  2. `scale-violation` — a dimension value moved off its declared scale step (e.g. radius 4px → 5px),
     verified not to collide with any existing token value. `causalEdit = off-scale`.
  3. `contrast-break` — a text color set to fail WCAG-2 AA contrast against its component's
     background, verified by the oracle to violate at injection time. `causalEdit = contrast`.
- **Ground-truth label per injected site:** `{file, loc, prop, raw, class, causalEdit,
  intendedTokenId, originalValue, contrast?}` — emitted by the generator, never hand-edited.

## 4. Train / test split (frozen)

- Deterministic split by a **seeded PRNG** (mulberry32). **Split seed: `0xS0RB` (1425443)`.**
- **70% train / 30% test**, assigned per corpus case at generation. Held-out test cases are **never**
  used to tune any attempt; they are scored once per attempt to produce the reported delta.

## 5. The loop + stop rule (frozen — founder-specified)

- **Baseline:** the current engine, unmodified, scored on the held-out split. This is attempt 0.
- **Attempt:** exactly **one pre-declared engine change** (a heuristic / threshold / normalization
  rule), tuned on the train split, then scored **once** on the held-out split. Each attempt is logged
  with: the change, its rationale, its train score, its held-out score, and Δcoverage vs the current
  best.
- **Continue rule:** continue while an attempt yields **Δheld-out-coverage ≥ 2.0 percentage points
  AND held-out precision ≥ 0.99.**
- **Stop rule:** stop after **3 consecutive attempts** that fail the continue rule (no-gains).
- **No fishing:** no more than one change per evaluated attempt; no post-hoc metric or split changes.

## 6. Execution envelope (frozen — founder-specified)

- **Manual-first** (this build): the runner is invoked by hand; nightly cron is added only after one
  clean at-scale run. **Wallclock cap: ≤ 4 hours per run**, checkpointed; if the at-scale corpus
  can't finish in budget, **degrade N and log the reduced N honestly** — never fake completion or
  silently truncate.
- **At scale:** grow the corpus toward **~1000+ injected instances** across the blend for the
  stress run.

## 7. Success / null criteria (frozen — declared before results exist)

- **Feasibility shown (primary):** the loop runs end-to-end within 4h and reports held-out coverage
  (detection) + false-negative rate (contrast oracle) on the blend, with per-source breakdown.
- **A "lead" (stretch):** post-loop held-out coverage on the **OSS** cases exceeds the **88.9%**
  prior baseline by any honest margin, **and** the contrast oracle shows **0 false negatives** on
  injected contrast-breaks. Both then citable in outline §4.
- **Null (still a valid result):** if the loop stops at 3 no-gains without beating baseline, the
  honest null + the reproducible artifact are rolled up (still clears gate G3; still a feasibility
  signal). A null is reported, never buried.

## 8. Integrity commitments (Sitaker-lens)

Held-out-only evaluation · one change per attempt · report the null · per-source breakdown · the new
number is **preliminary** and does **not** enter the submitted, founder-certified pitch as a hard
figure until the founder verifies (D4). "Don't misrepresent; they'll catch you."

---

## Amendments (append-only; each dated)

*(none yet)*
