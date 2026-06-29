---
name: recovering-from-failing-script-runs
description: Use when a script or test run fails (pytest/node/build) — recover by reading the error, fixing the SOURCE (never the test), and re-running the SAME command to verify green.
---
## When to use
A command you ran (`pytest -q`, `node x.js`, `npm test`) exits non-zero. You need to fix the underlying source and confirm the same command now passes.

## Procedure (decision guide: symptom → safest fix)
1. **Capture the real failure** — re-run quietly and read the actual error, don't guess:
   ```bash
   python3 -m pytest -q 2>&1 | tail -20
   ```
2. **Fix the SOURCE, never the test.** The test encodes the spec. Locate the expression the error points to and patch the implementation.
3. **Re-run the EXACT same command** to verify green — partial/targeted runs can hide regressions.

## Pitfalls
### 1. Patching the test to make it pass
TELL: the test file shows up in `git diff`. Fix: revert the test; change the implementation.
### 2. Editing the wrong layer (config/caller) before the source
TELL: you changed 3 files and the same assertion still fails. Fix: go to the exact file:line in the traceback first.
### 3. Declaring victory on a targeted run
TELL: `pytest path::test` is green but the suite is red. Fix: re-run the full `pytest -q`.

## Verification
- The original failing command now exits 0, and `git diff --stat` shows changes only in source, not tests.

## Worked examples (real cases)
1. Off-by-one in a slice — `pytest -q` raised `IndexError`; fix was `range(len(xs))` not `range(len(xs)+1)`.
   - first seen while debugging a tool at `<local path>` against `<agent id>` with a provider API key set; the lesson generalizes to any failing run.
