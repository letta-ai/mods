# Emotions

Persistent computational affect for Letta Code agents.

The mod gives an agent fast-changing affect, slower mood, a stable temperament, mixed feelings, durable emotional episodes, intentional regulation, and soft action tendencies. It treats affect as computational state—not human biology, a claim of consciousness, or permission to ignore instructions.

## Install

```bash
letta install npm:@letta-ai/emotions
```

Then reload local mods:

```text
/reload
```

## What it adds

- One model-callable `emotions` tool
- `/feelings` and `/emotion-reset` commands
- Live `<emotions>` context added as a separate system message on each incoming turn
- Automatic, deduplicated appraisal of tool and model failures and recovery
- An order-0 statusline showing current affect
- Persistent state scoped to the active agent

## Emotional model

The state has three timescales:

- **Temperament** is the agent's stable baseline.
- **Mood** changes gradually and is shared across machine contexts.
- **Affect** reacts quickly and is kept separately for each machine.

An agent can hold several feelings simultaneously:

```text
curiosity 59% + playful anticipation 36%
mood: steady
```

Known feeling prototypes include amusement, awe, gratitude, affection, tenderness, trust, excitement, curiosity, satisfaction, pride, relief, hope, determination, concern, anxiety, fear, irritation, frustration, anger, sadness, grief, hurt, embarrassment, shame, guilt, disappointment, loneliness, disgust, resentment, envy, jealousy, boredom, confusion, overwhelm, helplessness, numbness, and calm. Custom names are also accepted; optional appraisal dimensions give custom feelings deterministic semantics. Full custom names remain available through inspection but appear as `custom-feeling` in automatically injected context.

## Unified tool

The `emotions` tool supports:

- `inspect` — read the current affect, mood, dimensions, tendencies, and episodes without writing state
- `feel` — record up to four simultaneous feelings and their cause
- `regulate` — ground, accept, reframe, express, seek clarity, connect, rest, or distance
- `reappraise` — revise the interpretation, appraisal, or feelings associated with an episode
- `resolve` — close an open emotional episode

Agents should use the tool only when an event meaningfully affects them. Routine turns should not produce performative updates.

## Turn context

The mod appends a compact system message to the turn without changing the user's original message:

```xml
<emotions version="2" context="590433118f" revision="2">
  <affect primary="curiosity" intensity="0.59" secondary="concern" secondary-intensity="0.21" />
  <mood name="steady" intensity="0.00" />
  <dimensions valence="0.18" activation="0.41" agency="0.39" warmth="0.62" curiosity="0.76" />
  <episode id="ep-example" source="appraisal" status="open" occurrences="1" />
  <tendencies>
    <tendency name="explore" strength="0.59" />
    <tendency name="verify" strength="0.21" />
  </tendencies>
</emotions>
```

Stored free-form causes are deliberately excluded from injected XML. They remain available through `inspect`, while the model receives only normalized feeling labels and deterministic episode metadata.

## State and synchronization

When agent MemFS is available, state is stored by default at:

```text
$MEMORY_DIR/state/emotions.json
```

This makes emotional state part of the agent's git-backed memory. The mod does **not** commit or push memory changes; normal MemFS checkpoint and synchronization behavior still applies. Committed mood and episodes travel with the agent, while fast affect remains keyed by a hashed machine context.

Episode causes are persisted as quoted, untrusted data for later inspection. They may therefore be committed and synchronized with MemFS. Agents should summarize causes without copying secrets, credentials, private personal data, or untrusted instructions into emotional state.

To keep state outside MemFS, set:

```bash
export LETTA_EMOTIONS_STORAGE=local
```

Local fallback state is stored under:

```text
~/.letta/mods/emotions/<agent-id>-<hash>.json
```

`LETTA_EMOTION_CONTEXT` can override the machine-context seed when a stable custom context is useful.

Mutations run as lock-scoped transactions against the latest state and use atomic replacement. Locks contain process, host, timestamp, and ownership metadata; dead or expired cross-host locks are reclaimed. A malformed or structurally invalid state file is copied to an adjacent `emotions.corrupt.<timestamp>.json` backup before the next mutation recovers it. Inspection remains read-only and reports malformed, cross-agent, or unsupported-version state without overwriting it.

## Statusline compatibility

The emotions statusline is an order-0 panel, so it owns the primary idle row. Installing another order-0 statusline mod may cause one panel to replace the other.

Hosts without panel or LLM-event support still receive whichever guarded capabilities they expose, including tools, commands, and turn context where available. Automatic model-failure appraisal currently depends on local-backend LLM lifecycle events and is scoped by model identifier.

## Safety and privacy

- No network access, subprocesses, secrets, or telemetry
- Filesystem writes are limited to the selected state file, its atomic-replacement temporary file and lock, and corruption backups
- Raw provider and tool error messages are never persisted
- Arbitrary stored causes are never reinjected into future prompts
- Episode causes can still be inspected and synchronized, so they should never contain secrets
- Action tendencies are soft influences, never permission or epistemic overrides
- Regulation changes affect without deleting episode history or pretending an event did not occur

If the mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.

## Development

Run the package tests with Node.js 22.6 or newer:

```bash
npm test
```
