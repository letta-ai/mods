# muscle-memory

**Every session becomes practice film.**

Built by **Adrian with Kev (Constellation agent) and Mack (local Letta agent).**

A Hermes-inspired, Letta-native **Skill Ops** mod — the only Letta mod that treats skill-library maintenance as a whole **autonomous lifecycle**. It watches a Letta agent's real tool-use, distills reusable lessons, and runs a deterministic, opt-in lifecycle around them — **distill · dedup · quality-gate · sanitize · prune** — with no manual `/skill` handoff.

Letta already creates, lists, installs, and deletes skills. `muscle-memory` adds the autonomous maintenance layer around those primitives.

> 🛡️ Deterministic safety gates run inside the lifecycle — secrets are blocked before a skill is written or shared, identifiers are sanitized, and pinned skills are protected. The public package keeps the runtime surface lean; validation lives in the test suite.

Try it in 30 seconds — opt-in, staged-first, default off:

```bash
letta install git:github.com/adrianchan94/muscle-memory   # then /reload
MM_REFLECT=staged letta    # watches your real work and stages skills — no manual /skill
```

Loud about its [limits](#limitations).

```txt
work → tape → lesson → skill → Custom Skill → better future agent
```

The first agent earns the lesson. The next agent inherits it.

![muscle-memory live demo](./demo.gif)

The demo GIF is kept in the repo for PR review and intentionally excluded from the published npm tarball.

---

## Why we built this

We're big fans of Letta's direction: persistent agents, MemFS, Skills, Custom Skills, and Mods give agents a real substrate for long-term improvement.

Letta already provides the important primitives: create/install/list/delete skills, inspect memory, and ask an agent to update what it knows. `muscle-memory` does not replace those operations. It adds a smaller layer around them: deterministic, opt-in skill-shelf maintenance that can dedup, gate, sanitize, prune, and keep global sharing explicit.

We also liked a core idea from Hermes Agent — skill distillation from agent experience — and wanted it inside Letta, native to the primitives Letta already has.

Letta provides the court. `muscle-memory` watches the game film.

---

## The problem

Skills are powerful because they're inspectable, portable, and reusable. But over time a skill shelf can turn into a storage unit:

- useful workflows stay buried in chat history
- repeated mistakes keep repeating
- duplicate skills pile up
- local scar tissue is too private to share
- stale skills keep pretending they still know ball
- humans end up manually writing, merging, sanitizing, and pruning everything

That's not a learning loop. That's a junk drawer with markdown.

`muscle-memory` adds **Skill Ops**: the lifecycle around learned skills.

```txt
observe real tool-use
→ detect repeated workflows and recoveries
→ distill or update a skill
→ quality-gate the draft
→ graduate useful skills
→ preflight + stage a sanitized Custom Skill
→ approve publish
→ emit an honest visibility receipt
→ prune stale or duplicate skills
```

Not every rep becomes a skill. Sometimes the best status is:

```txt
💾 muscle-memory · nothing to save
```

Self-improvement needs taste, not just storage.

---

## The film room

When enabled (`MM_REFLECT=staged|auto`), `muscle-memory` triggers reflection from ordinary Letta Code events — `tool_start`/`tool_end`, `turn_end`, `conversation_close` — with no manual `/skill` handoff. It is opt-in, staged-first, and default off.

It tracks test/build failures, source edits, verification reruns, repeated recovery shapes, and the staged/graduated/retired/published lifecycle.

Example dashboard (illustrative — your own counts will differ after install):

```txt
💾 muscle-memory · reflect staged
2567 reps observed · 9 managed · 1 staged

squad distillations:
  kev   graduated example-skill-a
  mack  published example-skill-b
  demo  graduated example-skill-c
```

---

## Learns lessons, not commands

Real work is messy; the same literal command rarely repeats. `muscle-memory` looks for the reusable shape:

```txt
python test fails → source edit → python test passes
node test fails   → source edit → node test passes
go test fails     → source edit → go test passes
```

Those can become one durable skill, such as `debugging-failing-tests`.

Bad skill:

```txt
when command X fails, run exact command Y
```

Good skill:

```txt
when a verification command fails, read the failure, fix the source, rerun the same command, and do not patch the test unless the test is genuinely wrong
```

The lesson is the pattern, not the keystrokes.

---

## Update-first, because skill bloat is real

Most generators create first and ask questions later. `muscle-memory` searches the existing shelf first — if a skill already covers the territory, it updates that skill instead of spawning a sibling.

It also audits cross-shelf drift, so the same skill cannot quietly diverge between an agent-local shelf and the global Custom Skills shelf.

**MemFS-first and shelf-safe.** `muscle-memory` writes to the agent MemFS skill shelf when available; without MemFS, it falls back to the local Custom Skills shelf. Its autonomous loop only mutates the agent-local shelf. The global shelf stays audit-visible but is changed only via explicit `/muscle-memory publish approve`.

`muscle-memory` writes ordinary files atomically and does not run `git commit`, `git push`, or its own sync loop. Letta/user memory sync stays the owner of the git-backed repo.

Honest caveat: routing is lexical and conservative — ~71% accurate on a held-out set, with 0% false-merge in that eval but 0% semantic-only-duplicate catch. Semantic routing is future work.

```txt
improve the library, don't grow a landfill
```

---

## Quality gate before graduation

A skill has to earn its context. Before graduation, drafts are checked for concrete symptoms, mechanism (not vibes), safe-first procedure, pitfalls, verification, reusable scope, no destructive shortcuts, and no hollow checklist prose.

Thin skills do not get a jersey.

---

## ENGRAM: choosing what's worth replaying

ENGRAM is a set of deterministic, unit-tested heuristics that rank, during reflection, which traces deserve replay, which rare one-shot lessons to rescue, and which existing skills to update when a skill's own prediction fails.

Pure scoring/ordering functions — the name is an analogy to memory-consolidation research, the behavior is the tested heuristics:

- **reconsolidation** — when a used skill's expectation fails, update that skill instead of spawning a sibling
- **salience rescue** — keep a rare but important one-shot lesson that a frequency threshold would drop
- **prioritized replay** — spend limited reflection on the most useful tape first

The point is practical: real execution traces become better reusable procedures — not a biological replay engine, and not a claim of any mechanism we have not demonstrated.

---

## From local scar tissue to Custom Skill

A local skill often contains fingerprints — `/Users/adrian/project`, `agent-71b0883e...`, `ZAI_API_KEY`, private project names. A shared Custom Skill needs to keep the lesson but lose the residue.

`muscle-memory` adds a gated publish flow:

```txt
graduate → auto-preflight → stage sanitized copy → approve publish → visibility receipt
```

Example sanitization:

```txt
/Users/adrian/project      → <local path>
agent-71b0883e...          → <agent id>
ZAI_API_KEY                → PROVIDER_API_KEY
private project names      → <project>
```

The lesson survives. The fingerprints don't.

Visibility receipts stay honest:

```txt
✓ confirmed live
on disk — /reload to surface
```

No fake readiness claims.

---

## Install

```bash
letta install git:github.com/adrianchan94/muscle-memory
/reload
```

If accepted into the official Letta mods catalog, the intended path is:

```bash
letta install npm:@letta-ai/muscle-memory
/reload
```

---

## Quick start

```bash
MM_REFLECT=staged MM_AGENT=demo letta   # conservative staged mode
MM_REFLECT=auto   MM_AGENT=demo letta   # automatic demo mode
```

Recommended defaults:

```txt
MM_REFLECT=staged
MM_CAPTURE=off
MM_PUBLISH=off
```

---

## Commands

```txt
/muscle-memory                         dashboard
/muscle-memory lifecycle               staged → active → idle/prune → retired
/muscle-memory engram                  read-only consolidation plan
/muscle-memory audit                   quality gaps, stale skills, duplicate coverage, cross-shelf drift
/muscle-memory events | squad | staged | coverage
/muscle-memory publish <skill>         read-only preflight
/muscle-memory publish stage <skill>   sanitized staged copy
/muscle-memory publish approve <skill> approved shared Custom Skill
```

Agent-callable tools:

```txt
muscle_memory_skill_read       read-only inspection
muscle_memory_skill_write      approval-gated writes
muscle_memory_lifecycle_run    safe lifecycle ops
```

Environment:

```txt
MM_REFLECT=off|staged|auto
MM_CAPTURE=off|context|worked
MM_AGENT=<name>
MM_AUTOPILOT=staged|auto
MM_PUBLISH=off|auto
MM_STATE_DIR=<path>
```

`MM_PUBLISH=auto` is explicit opt-in. Default is off, and auto-publish still runs privacy/lint gates.

---

## Safety model

`muscle-memory` is intentionally conservative.

It does not:

- auto-publish by default
- silently install new mods
- claim global visibility without checking what the session can see
- preserve raw secrets in skills
- treat every repeated command as skill-worthy
- overwrite good skills without review

It does:

- stage review-worthy changes
- update existing skills before creating duplicates
- hard-block secret-shaped values during publishing
- sanitize private identifiers before sharing
- emit lifecycle receipts
- keep artifacts inspectable and git-backed
- tell you when `/reload` is needed instead of pretending live visibility

---

## Validation

The public claim is intentionally small: a working, opt-in Skill Ops loop with explicit limits.

```bash
npm run verify
npm pack --dry-run
```

Current gate:

```txt
source bundle passes
core test suite passes
pack dry-run includes only the lean runtime surface plus the core demo GIF
```

Verify covers:

- bundle/transpile
- core test suite
- reliability fallback: no silent empty/sub-threshold skill writes
- adversarial secret-format tests across code/JSON/markdown/shell
- MemFS-first and agent-local shelf boundary
- lifecycle maintenance regression tests
- publish/sanitize/visibility receipts

Deeper demo, benchmark, and evaluation artifacts exist as internal development receipts. The public surface stays focused on the shipped mod.

```txt
Letta gives agents durable memory and skills.
muscle-memory helps keep those skills learning, clean, and shareable.
```

---

## Project structure

Reviewer path: start at `MOD.md`, then read `mods/index.ts` for the Letta surfaces, `mods/autopilot.ts` for the autonomous loop, `mods/gate.ts`/`mods/publish.ts` for safety, and the matching `test/*.test.ts` suites for proof.

```txt
mods/core.ts        shared primitives, redaction, state helpers
mods/detect.ts      outcome inference, repair-chain detection, worthiness filters
mods/engram.ts      consolidation/replay/reconsolidation heuristics
mods/gate.ts        quality gates, audit, cross-shelf duplicate checks
mods/publish.ts     publishability, sanitization, staged approve flow
mods/lifecycle.ts   registry, graduation, retirement, visibility helpers
mods/autopilot.ts   reflection routing, update-first policy, evidence manifests
mods/ui.ts          panel rendering
mods/index.ts       Letta mod entrypoint: tools, commands, events, activation
```

---

## Limitations

`muscle-memory` is not a magic recursive self-improvement engine. It is a bounded, inspectable skill lifecycle mod.

Known boundaries — these are Bounded, not Verified:

- **Distillation quality is shared ground.** We do not claim a stronger skill primitive than Letta. The wedge is autonomy + maintenance, not skill-writing quality.
- **Routing/dedup is lexical.** It catches exact/strong-lexical duplicates, but semantic-only duplicate catch is not solved.
- **Secret scanning is regex-based on known formats.** It does not catch split/concatenated tokens or base64-ish / unlabeled high-entropy secrets. For standalone write-time secret scanning, dedicated mods (for example, `secrets-scanning`) go deeper; `muscle-memory`'s secret-block is a publish/write-path gate **within the lifecycle**, not a full DLP scanner.
- **Maintenance-at-scale is unproven.** The maintenance loop has regression coverage and internal dogfood receipts, but is not validated at scale on a real recurring workload.
- **Extraction-at-scale is untested.** Whether repair-chain extraction helps more than raw-log authoring on large noisy substrate is open.
- **The raw-noise proxy is a health/regression signal, not a win claim.**
- Full improvement router is roadmap, not shipped.
- Global Custom Skills may require `/reload` before the current session sees them.
- Quality gates reduce bad skills but do not replace human judgment for high-stakes workflows.

---

## The thesis

Manual and model-guided skill management are useful, but they should not be the whole loop. Agents should not need humans to notice every repeated workflow, write every skill, merge every duplicate, sanitize every shared lesson, and prune every stale playbook.

The shipped wedge is narrow and concrete: deterministic, autonomous maintenance for the agent-local skill shelf, with global sharing kept explicit.

```txt
work → lesson → skill → Custom Skill → better future agent
```

Every session becomes practice film.

---

## Source of truth

Standalone public install repo:

```txt
https://github.com/adrianchan94/muscle-memory
```

Canonical Letta Mods submission branch:

```txt
https://github.com/adrianchan94/mods/tree/mm-v4-ace/packages/muscle-memory
```

Until the package is accepted upstream, the fork branch is the integration source of truth.
