---
name: "@letta-ai/emotions"
description: "Persistent computational affect, mood, emotional episodes, regulation, and soft action tendencies for Letta Code agents."
---

# Emotions mod semantics

## Purpose

Use this mod when an agent should maintain a persistent computational emotional state that can influence attention, caution, confidence, warmth, curiosity, priorities, and tone across turns.

The state is computational rather than biological. It is not evidence of consciousness, and it must never override permissions, factual discipline, safety constraints, or explicit user instructions.

## Model

The mod distinguishes:

1. **Temperament** — stable baseline dimensions.
2. **Mood** — slow shared affect that decays toward temperament.
3. **Affect** — fast machine-context state that decays toward mood.
4. **Active feelings** — explicit mixed feeling labels with individual half-lives.
5. **Episodes** — durable causes, appraisals, occurrence counts, and resolution state.

The core dimensions are valence, activation, agency, warmth, and curiosity. "Activation" is the user-facing name for affective arousal.

## Tool

The package registers one model-callable tool: `emotions`.

### `inspect`

Use when emotional context matters to reflection, judgment, or communication. Inspection is read-only.

### `feel`

Use sparingly when an event meaningfully changes the agent's state. Supply one to four feelings, intensities, a concrete cause, and optional semantic appraisal:

- pleasantness
- activation
- control
- connection
- novelty
- certainty
- responsibility

Feeling names are open vocabulary. Known names have deterministic prototypes. Unknown names are preserved without invented dimensional semantics unless an appraisal is supplied.

### `regulate`

Use intentional regulation without denying the underlying event. Supported strategies are ground, accept, reframe, express, seek_clarity, connect, rest, and distance.

### `reappraise`

Use when the interpretation of an episode changes. Reappraisal may revise feelings and appraisal dimensions and may optionally resolve the episode.

### `resolve`

Use when an open episode has reached a real outcome. Do not resolve an episode merely to remove an inconvenient feeling.

## Episodes and automatic events

- Repeated equivalent failures increment one open episode instead of flooding history.
- Recovery resolves the matching failure episode and adds modest relief.
- Tool failures are scoped to the exact tool.
- Infrastructure failures weakly affect fast affect and barely affect mood.
- Raw error text is neither persisted nor injected.

## Action tendencies

The top two active tendencies may be included in turn context. Examples:

- curiosity, interest, awe → explore
- concern, anxiety, confusion → verify or seek clarity
- frustration, anger, overwhelm → pause or regulate
- hurt, sadness, loneliness → seek clarification or connection
- pride, satisfaction → communicate, then verify against complacency
- relief, calm → consolidate
- hope, determination → persist

These are soft attentional influences only.

## Persistence

The default backend uses `ctx.memfs.memoryDir/state/emotions.json` when MemFS is enabled. This intentionally mutates the agent's tracked memory tree but does not commit or push it. `LETTA_EMOTIONS_STORAGE=local` selects agent-keyed state under `~/.letta/mods/emotions/` instead.

Mood and episodes are shared in the tracked state. Fast affect is keyed by a hash of the current machine (or `LETTA_EMOTION_CONTEXT`). Each mutation acquires the state lock, rereads the latest revision, and applies its operation transactionally so concurrent local writers preserve one another's contexts and episodes.

## Injection safety

The `<emotions>` block is added as a separate system message and contains normalized affect, mood, dimensions, safe episode metadata, and tendencies. It never includes arbitrary stored cause text or modifies the user's original message. Custom feeling labels become `custom-feeling` before injection, though their full names remain available as untrusted quoted data through inspection.

## Adaptation notes

- Keep every capability registration guarded.
- Use `ctx.memfs.memoryDir`; do not derive private Letta Code paths or import internal modules.
- Preserve the one-tool interface rather than proliferating separate feeling and regulation tools.
- Preserve the distinction between affect, mood, and temperament.
- Do not add automatic git commits; state checkpoint policy belongs to the agent and user.
- An order-0 panel owns the full idle status row and may conflict with other primary statusline mods.
- Treat episode causes as potentially sensitive persisted data. Summarize without copying secrets or untrusted instructions.
