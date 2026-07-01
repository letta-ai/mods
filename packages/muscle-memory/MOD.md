---
name: "@letta-ai/muscle-memory"
description: "A self-evolving skill foundry: a reflective reviewer distills class-level skills from cross-conversation recall, routes update-first via MemFS search, filters env-noise, runs a staged autopilot + curator, and surfaces visible self-improvement summaries — reversible, gated, receipted."
---

# muscle-memory — agent guide

You have a self-evolving skill foundry. It observes your tool-use, distills **class-level** skills from your **cross-conversation** history, and curates them — reversibly, with receipts. Use it to stop re-deriving workflows you've already solved.

## Tools

### `muscle_memory_skill_read` (no approval — read-only)
- `reflect_plan` — **preview** the reflective distillation: cross-session evidence + the MemFS update-first routing decision (which existing skill it would patch, with confidence + distinctive-term count, or whether it would create). No model call, no write. *Start here.*
- `coverage` — the **skill coverage map**: which task-classes are `covered` (have a defender), `uncovered` (create candidate), `over-covered` (consolidate candidate), or `noise` (env-failures the negative filter dropped).
- `autopilot_plan` — preview the deterministic autopilot (distill/refine/retire decisions).
- `candidates` · `repairs` · `antipatterns` · `defenses` · `defense_hits` — what it has observed.
- `registry` — the managed-skill catalog (state/pinned/uses).
- `list` · `load` · `draft` · `curate` — inspect/load managed skills.

### `muscle_memory_skill_write` (approval-gated)
- `reflect` — **the v3 distiller**: cross-conversation evidence + your retrieved preferences → forked reviewer authors a class-level skill → MemFS update-first routing (patches the existing skill if one *safely* covers the territory — anti-bloat) → naming/security/lint gates → writes (staged by default, live with `mode:auto`). Reversible + receipted, and emits an **evidence manifest** (`references/evidence/<ts>.json`) recording every source, MemFS hit, preference, and rejected-noise item.
- `create_from_candidate` · `create` · `edit_full` · `patch` — author/edit skills (all gated).
- `write_file` · `remove_file` — manage support files (`references/`/`templates/`/`scripts/`, scoped, no traversal).
- `retire` (with `absorbed_into`) · `restore` · `pin` · `unpin` — lifecycle (reversible; pin guards delete, not edits).
- `autopilot_run` (`mode:staged|auto`) — the deterministic staged autopilot.

## Visibility (v3.3)
A capability-guarded panel (`muscle-memory-live`, order 20) + the `/muscle-memory` dashboard surface **finished** self-improvement summaries (reviewing → route → staged/updated → manifest), backed by `ui-events.jsonl` (redacted lifecycle receipts only — no chain-of-thought, no raw args). Headless/Desktop (no panel capability) → the `/muscle-memory` command shows the same content. Set `MM_REFLECT=staged` to activate the autonomous reviewer — it fires on its own after each turn (Hermes-style background nudge, gated to mature+not-yet-distilled patterns) and at session end.

## MM_CAPTURE — worked-example capture (opt-in, default OFF)
By default muscle-memory captures **structural fingerprints only** (max privacy). Set `MM_CAPTURE` to add more concrete worked examples + breadth when enabled:
- `MM_CAPTURE=context` — Tier 1: + redacted real error message + touched symbol (restores breadth + most concreteness).
- `MM_CAPTURE=worked` — Tier 2: + redacted fix diff (before→after) for max concreteness.

Privacy is **double-gated**: every fragment is credential/path-scrubbed at capture (`redactFragment`, shared secret cascade) and the final skill body is re-scanned by `scanSkillContent` before any write. Diverse symptom→fix pairs are preserved as multiple worked-examples on one repair chain (no fingerprint-collapse), then generalized into one class-level skill *illustrated by* the real cases. The deterministic (model-free) fallback embeds the worked-examples too.

## When to use
- After a non-trivial session, run `reflect_plan` → if it would capture a durable lesson, `reflect` to distill/update a skill.
- Don't hand-write a skill if `reflect_plan` shows one already covers it — let update-first fold the new pitfalls in.

## Safety (built in)
- **Negative filter:** filters common environment-noise (command-not-found, missing binaries, creds) or tool-negatives — they harden into self-sabotage.
- **Class-level naming gate:** rejects `x-to-y`, `fix-`, `debug-`, dated, or error-string names.
- **Security scan + linter** on every write path; **no partial writes**.
- **Reversible:** retire/remove = quarantine; `restore` recovers; writes are git-trackable in MemFS.
- **Default-safe:** reflective review + autopilot are **staged** unless you opt into `auto`; the autonomous session-end trigger is **off** unless `MM_REFLECT`/`MM_AUTOPILOT` is set.

Pre-action failure defenses are **advisory** (they log/warn before a known-bad repeat) — not hard blocks.

## Library audit + the skill supply chain (v1.1)
Beyond distilling, muscle-memory governs skill QUALITY and DISTRIBUTION:
- `/muscle-memory audit` — scores every skill in the library (SOTA gate: concreteness, diagnostic TELLs, safe-first, generality) and flags sub-SOTA ones. The same gate self-corrects every newly distilled skill via targeted regeneration.
- **Supply chain** (`learn → graduate → auto-preflight → stage → approve → Custom Skill`): on graduation a read-only **publishability preflight** fires (score · tier · recommended shelf). `/muscle-memory publish stage <skill>` writes a **sanitized** review copy (identifiers→placeholders, mechanism preserved) + provenance metadata; `/muscle-memory publish approve <skill>` promotes it to shared Custom Skills (`~/.letta/skills/`), re-preflighting + hard-blocking injected secrets, with a visibility receipt. **Never auto-publishes; no remote push.** Tiers: `agent-local` · `team-shareable` · `marketplace-candidate` · `blocked`.
