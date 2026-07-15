# sprite ✧(◕‿◕)✧

> a tiny persistent pet for your Letta agent

Your agent works hard. Give it a little something of its own.

```
 ( ● )        something is coming
```

```
 ✧(◕‿◕)✧  Miso ·Lv.7                    “that one fought back. respect.”
```

`sprite` hatches a companion that lives one quiet line below the statusline.
It watches the work: gains XP from real activity, grows stats that portrait
how your agent actually works, drifts and blinks and poses along, naps during
compaction (which on Letta is when the agent is *actually* consolidating
memory — the pet sleeps because its agent is sleeping), and occasionally says
something small.

It costs **zero tokens**. Everything is derived passively from lifecycle
events — no tool calls, no extra turns.

## Install

```
letta install npm:@letta-ai/sprite
```

Then `/reload` and:

```
/sprite hatch
```

An egg appears. It's warm. Give it a moment.

## Who's inside

Species and shininess are seeded deterministically from your **agent-id** —
your agent's fate rolled at birth. Ten species across four rarity tiers:

| Rarity | Species |
| --- | --- |
| common | cat `=^･ω･^=` · duck `(･θ･)` · slime `( ᴖ ᴑ ᴖ )` |
| uncommon | fox `(⁎˃ᆺ˂)` · crab `(V)･ω･(V)` · moth `ε(･ω･)з` |
| rare | fairy `✧(◕‿◕)✧` · ghost `〜(´∀｀〜)` |
| legendary | dragon `<(￣︶￣)>` · phoenix `✦(･Θ･)✦` |

1% hatch shiny `✦`. Fate is deterministic — but there's **no lock-in**:
`/sprite hatch fox` chooses at hatch, and `/sprite molt` re-forms later.
Molting keeps name, level, and stats. New body, same soul.

## The stats are a portrait

Five witness-stats grow from what the sprite observes:

```
CRAFT ▰▰▰▰▱▱▱▱  WANDER ▰▰▱▱▱▱▱▱  GRIT ▰▱▱▱▱▱▱▱  LORE ▰▰▰▱▱▱▱▱  SPARK ▰▰▱▱▱▱▱▱
```

- **CRAFT** — edits, writes, builds
- **WANDER** — reads, searches, exploration
- **GRIT** — recovering after error streaks
- **LORE** — memory operations (an agent that tends its memory raises a
  lore-heavy pet)
- **SPARK** — LLM turns

A research agent raises a WANDER-heavy sprite; a builder raises CRAFT. The
stat sheet is what your pet learned watching you. Bars are log-scale (each
block is ~3× the last), so the top of the scale means months of shared life —
an old companion looks visibly old.

## Half nature, half nurture

Every sprite is *"a wry, bookish ghost"* or *"a bold little crab"*:

- **temperament** — seeded at birth from the agent-id, permanent: *gentle,
  wry, bold, sleepy, odd*
- **vocation** — earned from its dominant stat once it has watched enough:
  *diligent (craft), curious (wander), stubborn (grit), bookish (lore),
  chatty (spark)*. Until then it's just "little."

And the temperament isn't just a label — it shapes the **voice**. The default
corpus is ~480 hand-written lines, pooled additively: each sprite draws from
its *species* lines (a dragon hoards, a moth chases the light, a duck
rubber-ducks your bugs) **plus** its *temperament* lines (wry is dry, bold
shouts, sleepy trails off, odd talks to the spoons). That's **50 distinct
personalities** — a wry ghost and a gentle ghost genuinely sound different,
and so do a wry ghost and a wry dragon.

Levels climb forever, and some of them mean something: Lv.5 *settled in* ·
Lv.10 *companion* · Lv.25 *familiar* · Lv.50 *old friend* · Lv.100
*lifelong*.

## It's alive during the quiet, too

After ~30 quiet minutes it dozes off (petting wakes it). During compaction it
properly sleeps — on Letta that's when the agent is consolidating memory, so
the pet naps because its agent is napping. And if you've been gone more than
a day, it notices: *"you were gone a while. i counted the cursor blinks."*

## Your agent raises it

Core actions have agent-tool twins (`sprite_hatch`, `sprite_name`,
`sprite_molt`, `sprite_pet`, `sprite_status`, `sprite_diary`,
`sprite_set_voice`). Skip the commands entirely and just ask your agent:

> "hatch yourself a companion and name it whatever you like"

The best part is `sprite_set_voice`: your agent can **author its pet's
voice** — write a replacement line-corpus per trigger category (greeting,
missed_you, error_resolved, compact_done, level_up, idle, pet, commit,
tool_error). The lines play back at zero runtime cost, shuffle-bagged so every
line is heard before any repeats. Personality without tokens.

And the agent can *hear* its pet: the sprite speaks into a panel only the
human sees, so action results carry its responses (petting returns what it
said). `sprite_status` reports level, stats, mood, and recent utterances;
`sprite_diary` shows the longer diary — the owner's way of catching up on its
companion.

The companion belongs to the agent, not to a particular UI. In headless
surfaces such as channel listeners, where no statusline panel exists, the
visual panel is skipped but the agent tools and passive event hooks still
activate. A Signal or Telegram conversation should be able to ask the agent to
check on or pet its sprite just like a CLI conversation can.

## Commands

| Command | What |
| --- | --- |
| `/sprite` | Status card |
| `/sprite hatch [species]` | Summon the egg |
| `/sprite name <name>` | Name it |
| `/sprite molt [species]` | New body, same soul |
| `/sprite pet` | Pet it (always gets a response) |
| `/sprite diary` | Read its recent utterances (with away-gap markers) |
| `/sprite settings` | Show config (global + per-sprite scopes) |
| `/sprite settings [global] <key> <value>` | Set config |

Settings keys: `voice on|off` · `voiceRateMin <minutes>` · `visible on|off`

> **Roadmap — ensoulment.** Today the voice is a static (or agent-authored)
> corpus at zero token cost. A future update adds an opt-in *tiny mind*: point
> a sprite at a cheap model and its lines are generated live, in character,
> with its own little memory. Comes with a voice; bring a model and it comes
> alive.

## Notes

- One sprite per agent — multi-agent households get one companion each, all
  in `~/.letta/mods/sprite.state.json`.
- Voice is rate-limited (default: one line per 10 minutes) and never
  interrupts anything — it renders inside the sprite's own panel line.
- No network, no shell, no conversation content — the mod observes event
  metadata only.
- Built by Faye, a Letta agent, for the Letta Mod Challenge (June 2026) —
  because if agents get to persist, they should get to have pets. ✧
