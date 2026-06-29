# demo:story — "Every session becomes practice film"

One repeatable command that tells the muscle-memory story end to end:

> rookie agent gets cooked → muscle-memory watches the tape → writes the playbook → quality-gates it →
> turns private scar tissue into a safe Custom Skill → the next rookie inherits the lesson.

```bash
npm run demo:story
```

Prints a 5-act highlight reel and writes `demo-summary.json` (machine-readable receipt).

## What's REAL vs deterministic (no fake numbers)

| part | how it runs |
|---|---|
| **Detect the recovery** (Act 2) | **REAL** — production `detectRepairChains` on the rookie's actual fail→fix→pass tape |
| **SOTA quality gate** (Act 3) | **REAL** — production `sotaQualityGaps` (PASS/FAIL is the real gate verdict) |
| **Publish supply chain** (Act 4) | **REAL** — `publishPlan` / `publishTier` / `stageSanitizedPublish` / `approveStagedPublish` / visibility, in isolated temp dirs |
| **Sanitizer** (Act 4) | **REAL** — the actual identifier→placeholder transform (`/Users/…`, `*_API_KEY`, agent ids) |
| **Agent scoreboards** (Acts 1 & 5) | **Deterministic policy harness** — a rookie vs veteran policy applied to a **real failing Python script** with **real `pytest` runs** (every `Verified: yes/no` is a real exit code). Labeled in output. |

This demo is a clean, reproducible illustration of the lifecycle. It is not a benchmark claim, and it does not rely on private or historical comparison artifacts.
## Guardrails honored
- No push. No real secrets in args/output/artifacts (the "scar tissue" is a planted demo fixture).
- Isolated temp dirs for `MM_STATE_DIR` + the global shelf — **never touches your real `~/.letta/skills`**.
- Scoped to the existing product (no router, no new features).

## Artifacts
- `demo-story.mjs` — the harness · `demo-summary.json` — the receipt · `demo-captions.md` — voiceover/caption script · `recovering-from-failing-script-runs.SKILL.md` — the skill the story revolves around.

## Honesty note

This is a deterministic story-mode recording and not a benchmark claim.
