#!/usr/bin/env bash
# Nightly SORB learning-loop seed-robustness sweep (manual-first → cron, M6).
#
# Runs the FROZEN protocol (src/research/PREREGISTRATION.md) on a FRESH
# per-date-seeded corpus, appends a row to the nightly ledger, and exits
# non-zero on regression (see runBlend.js GUARD). This is a robustness sweep —
# it proves the result is not a seed artifact; it does NOT replace the canonical
# frozen-seed artifact.
#
# Non-disruptive by design: if the research code is not present on the currently
# checked-out branch, it logs and skips (exit 0) — it NEVER switches branches.
#
# Scheduled by ~/Library/LaunchAgents/com.metatoy.sorb.research-loop-nightly.plist
set -uo pipefail

SEED_DIR="/Users/nobrien/workspace/metatoy/sorb-seed"
NODE="/opt/homebrew/bin/node"
LOG_DIR="$SEED_DIR/.sorb/nightly-logs"   # .sorb is gitignored
mkdir -p "$LOG_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
log="$LOG_DIR/nightly-$ts.log"

cd "$SEED_DIR" 2>/dev/null || { echo "[$ts] no sorb-seed at $SEED_DIR"; exit 0; }
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

if [ ! -f src/research/runBlend.js ]; then
  echo "[$ts] research-loop code not on branch '$branch' — skipping (no branch switch)" | tee "$log"
  exit 0
fi
if [ ! -x "$NODE" ]; then
  NODE="$(command -v node || echo node)"
fi

echo "[$ts] branch=$branch node=$NODE — running nightly seed-robustness sweep" | tee "$log"
"$NODE" src/research/runBlend.js --nightly 2>&1 | tee -a "$log"
rc=${PIPESTATUS[0]}
echo "[$ts] exit=$rc $([ "$rc" -eq 0 ] && echo PASS || echo REGRESSION)" | tee -a "$log"
exit "$rc"
