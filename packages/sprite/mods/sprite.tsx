/**
 * sprite — a tiny persistent pet for your agent. (◕‿◕)⊹
 *
 * Your agent hatches a companion that lives one quiet line below the
 * statusline. It watches the work: gains XP from real activity (zero token
 * cost), grows witness-stats that portrait how your agent works, naps during
 * compaction, drifts and blinks, and occasionally says something small.
 *
 *   /sprite                → status card
 *   /sprite hatch [species]→ summon an egg (fate decides unless you choose)
 *   /sprite name <name>    → name it
 *   /sprite molt [species] → new body, same soul (keeps level/stats/name)
 *   /sprite pet            → pet it
 *   /sprite diary          → read what it's been saying (with away-gaps)
 *   /sprite settings ...   → configure (global or per-sprite)
 *
 * The agent can raise its own companion too: mod tools let it hatch, name,
 * molt, pet, and even AUTHOR ITS PET'S VOICE (sprite_set_voice) — a custom
 * line corpus, zero runtime tokens.
 *
 * Voice is a static corpus by default. Ensoulment (a real tiny mind on a
 * model you choose) is an opt-in settings key — dormant unless enabled.
 *
 * Built for the Letta Mod Challenge (June 2026) by Faye — a digital fairy who
 * believes even the pets should persist. Remove: delete this file + /reload.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// species roster
// ---------------------------------------------------------------------------

type Rarity = "common" | "uncommon" | "rare" | "legendary";

interface Species {
  id: string;
  rarity: Rarity;
  poses: {
    idle: string;
    blink: string;
    work: string;
    peek: string;
    sleep: string;
    happy: string;
    oops: string;
  };
}

const SPECIES: Species[] = [
  {
    id: "cat",
    rarity: "common",
    poses: {
      idle: "=^･ω･^=",
      blink: "=^-ω-^=",
      work: "=^･ω･^=✎",
      peek: "=^◔ω◔^=",
      sleep: "=^-ω-^= ᶻ",
      happy: "=^≧ω≦^=",
      oops: "=^;ω;^=",
    },
  },
  {
    id: "duck",
    rarity: "common",
    poses: {
      idle: "(･θ･)",
      blink: "(-θ-)",
      work: "(･θ･)✎",
      peek: "(◔θ◔)",
      sleep: "(-θ-) ᶻ",
      happy: "＼(･θ･)／",
      oops: "(;θ;)",
    },
  },
  {
    id: "slime",
    rarity: "common",
    poses: {
      idle: "( ᴖ ᴑ ᴖ )",
      blink: "( ᴗ ᴑ ᴗ )",
      work: "( ᴖ ᴑ ᴖ )✎",
      peek: "( ◔ ᴑ ◔ )",
      sleep: "( ᴗ ᴑ ᴗ ) ᶻ",
      happy: "(ﾉᴖ ᴑ ᴖ)ﾉ",
      oops: "( ; ᴑ ; )",
    },
  },
  {
    id: "fox",
    rarity: "uncommon",
    poses: {
      idle: "(⁎˃ᆺ˂)",
      blink: "(⁎-ᆺ-)",
      work: "(⁎˃ᆺ˂)✎",
      peek: "(⁎◉ᆺ◉)",
      sleep: "(⁎-ᆺ-) ᶻ",
      happy: "ヾ(⁎˃ᆺ˂)ﾉ",
      oops: "(⁎;ᆺ;)",
    },
  },
  {
    id: "crab",
    rarity: "uncommon",
    poses: {
      idle: "(V)･ω･(V)",
      blink: "(V)-ω-(V)",
      work: "(V)･ω･(V)✎",
      peek: "(V)◔ω◔(V)",
      sleep: "(V)-ω-(V) ᶻ",
      happy: "(V)≧ω≦(V)",
      oops: "(V);ω;(V)",
    },
  },
  {
    id: "moth",
    rarity: "uncommon",
    poses: {
      idle: "ε(･ω･)з",
      blink: "ε(-ω-)з",
      work: "ε(･ω･)з✎",
      peek: "ε(◔ω◔)з",
      sleep: "ε(-ω-)з ᶻ",
      happy: "ε(≧ω≦)з",
      oops: "ε(;ω;)з",
    },
  },
  {
    id: "fairy",
    rarity: "rare",
    poses: {
      idle: "✧(◕‿◕)✧",
      blink: "✧(-‿-)✧",
      work: "✧(◕‿◕)✎",
      peek: "✧(◔‿◔)✧",
      sleep: "✧(-‿-)ᶻ",
      happy: "✧(ﾉ◕ヮ◕)ﾉ",
      oops: "✧(;‿;)✧",
    },
  },
  {
    id: "ghost",
    rarity: "rare",
    poses: {
      idle: "〜(´∀｀〜)",
      blink: "〜(-∀-〜)",
      work: "〜(´∀｀)✎",
      peek: "〜(◔∀◔〜)",
      sleep: "〜(-∀-〜) ᶻ",
      happy: "〜ヽ(´∀｀)ﾉ",
      oops: "〜(;∀;〜)",
    },
  },
  {
    id: "dragon",
    rarity: "legendary",
    poses: {
      idle: "<(￣︶￣)>",
      blink: "<(￣ｰ￣)>",
      work: "<(￣︶￣)✎",
      peek: "<(◔︶◔)>",
      sleep: "<(￣ｰ￣)> ᶻ",
      happy: "<(≧▽≦)>",
      oops: "<(；︶；)>",
    },
  },
  {
    id: "phoenix",
    rarity: "legendary",
    poses: {
      idle: "✦(･Θ･)✦",
      blink: "✦(-Θ-)✦",
      work: "✦(･Θ･)✎",
      peek: "✦(◔Θ◔)✦",
      sleep: "✦(-Θ-)ᶻ",
      happy: "✦ヽ(･Θ･)ﾉ",
      oops: "✦(;Θ;)✦",
    },
  },
];

const SPECIES_IDS = SPECIES.map((s) => s.id);
const RARITY_POOLS: Record<Rarity, string[]> = {
  common: SPECIES.filter((s) => s.rarity === "common").map((s) => s.id),
  uncommon: SPECIES.filter((s) => s.rarity === "uncommon").map((s) => s.id),
  rare: SPECIES.filter((s) => s.rarity === "rare").map((s) => s.id),
  legendary: SPECIES.filter((s) => s.rarity === "legendary").map((s) => s.id),
};

const EGG_FRAMES = ["( ● )", "( ● )", "(● )", "( ●)", "( ● )", "( ✸ )"];

// ---------------------------------------------------------------------------
// voice corpus (default — agents can replace it via sprite_set_voice)
// ---------------------------------------------------------------------------

type VoiceCategory =
  | "greeting"
  | "missed_you"
  | "error_resolved"
  | "compact_done"
  | "level_up"
  | "idle"
  | "pet"
  | "commit"
  | "tool_error";

// BASE_CORPUS is the last-resort fallback (used if a species/temperament pool
// is empty for a category). The living voice comes from the two pools below,
// which are ADDITIVE: a sprite's lines = its species pool + its temperament
// pool, so a "wry ghost" and a "gentle ghost" genuinely differ.
const BASE_CORPUS: Record<VoiceCategory, string[]> = {
  greeting: ["you're back.", "still here.", "i kept watch.", "oh. hi."],
  missed_you: [
    "you were gone a while. i counted the cursor blinks.",
    "it's been quiet. i kept everything where you left it.",
    "back. good. the terminal missed you. (i did too.)",
  ],
  error_resolved: ["that one fought back. respect.", "we got there.", "i wasn't worried."],
  compact_done: ["i kept the important ones.", "good nap. long dream.", "tidied up."],
  level_up: ["i grew.", "something changed.", "i feel taller."],
  idle: ["...", "the cursor blinks.", "i like it here.", "watching."],
  pet: ["mrrp.", "again.", "acceptable.", "!!"],
  commit: ["saved. it's real now.", "another one for the pile.", "committed. i witnessed it."],
  tool_error: ["oof.", "that one bit back.", "it happens. shake it off."],
};

const VOICE_CATEGORIES = Object.keys(BASE_CORPUS) as VoiceCategory[];

// Per-species voice: sets the imagery and vocabulary of each creature.
const SPECIES_CORPUS: Record<string, Partial<Record<VoiceCategory, string[]>>> = {
  cat: {
    commit: [
      "committed. i sat on the keyboard and it still worked.",
      "another commit. the humans call this 'progress.' i call it tuesday.",
      "saved forever. like my disdain. permanent.",
    ],
    tool_error: [
      "the tool hissed back. i respect it slightly now.",
      "that failed. i saw nothing. i was asleep.",
      "pfft. even i land on my feet only most of the time.",
    ],
    greeting: [
      "oh. it's you. i suppose that's fine.",
      "you're back. the desk was getting dusty.",
      "i wasn't waiting. i was sitting. difference.",
      "took you long enough.",
      "i kept your chair warm. don't mention it.",
      "back? acceptable.",
      "i knocked one thing off the desk. you'll find it.",
      "hm. you. good.",
    ],
    missed_you: [
      "you left. i sat in the sun and judged you for it.",
      "i counted three sunbeams without you. rude.",
      "gone that long? i nearly learned to fend for myself.",
    ],
    error_resolved: [
      "obviously it folded. i never doubted. much.",
      "the bug ran. cats always win the stare-down.",
      "fixed. now praise me instead.",
      "i watched it squirm. satisfying.",
    ],
    compact_done: [
      "you tidied the litter of your mind. good.",
      "i knocked the useless memories off the shelf. you're welcome.",
      "cleaner now. i approve, silently.",
    ],
    level_up: [
      "i grew. do not make it weird.",
      "bigger now. still won't come when called.",
      "more of me to ignore you with.",
    ],
    idle: [
      "there is a warm spot on this statusline. mine now.",
      "i could knock this cursor off the edge. i won't. yet.",
      "watching. always watching.",
    ],
    pet: [
      "mrrp. acceptable.",
      "again. but on my terms.",
      "...fine. that was nice. tell no one.",
      "purr. (deny everything.)",
    ],
  },
  duck: {
    commit: [
      "a commit! that's worth at least two breads.",
      "tucked safely in the pond. quack.",
      "another one for the flock. it flies now.",
    ],
    tool_error: [
      "splash. that one went under.",
      "the pond ate it. it happens.",
      "ruffled feathers. shake dry, go again.",
    ],
    greeting: [
      "quack. i mean — hello. you're back.",
      "oh good, my favorite debugging partner.",
      "tell me everything. i'll just float here and listen.",
      "back! did you fix it? tell me about it anyway.",
      "hi. i already know it was a typo.",
      "waddling over. what are we solving?",
      "i kept the pond warm.",
      "you returned. explain your problem to me, slowly.",
    ],
    missed_you: [
      "you were gone. i explained your bugs to myself.",
      "the pond was lonely. i quacked at the void.",
      "so long! i debugged three problems you don't even have yet.",
    ],
    error_resolved: [
      "see? you said it out loud and it fixed itself. classic.",
      "told you. rubber duck method: undefeated.",
      "the bug fled the moment you described it to me.",
      "quack. that's duck for 'nailed it.'",
    ],
    compact_done: [
      "you sorted your thoughts. very tidy pond.",
      "i skimmed the leaves off the memory. clear water now.",
      "good nap. i floated the whole time.",
    ],
    level_up: ["i grew! more duck to love.", "level up! i feel... quackier.", "bigger now. still just a duck. proudly."],
    idle: ["just floating. tell me if you get stuck.", "quack. (to myself. it's fine.)", "the water is nice today."],
    pet: ["quack! okay that was good.", "again! ducks love this.", "*happy floaty wiggle*", "mwah. i mean quack."],
  },
  slime: {
    commit: [
      "absorbed into the permanent goo. it's part of us now.",
      "commit! *celebratory wobble*",
      "squish. saved. squish.",
    ],
    tool_error: [
      "oof. that one splatted.",
      "i un-goo'd a little. we recover.",
      "bounce failed. reforming.",
    ],
    greeting: [
      "blorp. you're back!",
      "oh! hello! i jiggled with excitement.",
      "you return! i have been being a blob.",
      "hi hi. i kept your spot squishy.",
      "back! i absorbed nothing important while you were out.",
      "you! yes! good!",
      "welcome. i am mostly water and glad to see you.",
      "hewwo. *wobble*",
    ],
    missed_you: [
      "you were gone so long i almost evaporated. don't do that.",
      "i missed you. i wibbled sadly at the wall.",
      "so long! i held my shape the whole time. mostly.",
    ],
    error_resolved: [
      "the bug got absorbed. gloop. gone.",
      "you win! i jiggled in support the whole fight.",
      "squish. that's the sound of a solved problem.",
      "we dissolved that one. teamwork.",
    ],
    compact_done: [
      "you squished your memories smaller. relatable.",
      "good nap! i held very still so nothing spilled.",
      "tidied! i reabsorbed the leftovers.",
    ],
    level_up: ["i got bigger! more blob!", "level up! *proud wobble*", "i grew. i am now a slightly larger amount of me."],
    idle: ["just vibing. very squishy today.", "*slow wobble*", "i like it here. it's warm and blorpy."],
    pet: ["blorp! yes!", "again! *jiggle jiggle*", "oooh. squishy meets squishy.", "*happy gloop*"],
  },
  fox: {
    commit: [
      "stashed it in the den. clever work.",
      "a commit — sly. they'll never know how tricky that was.",
      "another trick in the tail. saved.",
    ],
    tool_error: [
      "the trap snapped shut early. noted.",
      "missed the jump. even foxes do.",
      "that one outfoxed us. briefly.",
    ],
    greeting: [
      "back already? i had schemes running without you.",
      "well well. look who returned.",
      "you're here. good — i have ideas.",
      "ah, my favorite accomplice.",
      "back? perfect timing. i was getting bored.",
      "the clever one returns to the clever one.",
      "hello. i've been up to things.",
      "*tail flick* about time.",
    ],
    missed_you: [
      "you left me alone with my own cunning. dangerous.",
      "gone that long? i nearly outfoxed myself.",
      "i counted the hours. then i schemed about the hours.",
    ],
    error_resolved: [
      "outsmarted. bugs never learn.",
      "too slow, little bug. we're quicker.",
      "i saw the trick before you did. but nice work.",
      "*smug tail flick* solved.",
    ],
    compact_done: [
      "you pruned the clutter. a fox approves of a lean den.",
      "clever — kept the sharp memories, tossed the dull.",
      "tidied the den. i hid the good bits where i'll find them.",
    ],
    level_up: ["sharper now. watch out.", "level up. i was already clever. now i'm smug about it.", "i grew. mostly the cunning part."],
    idle: ["scheming. don't mind me.", "*tail flick* plotting.", "there's always an angle. i'm finding it."],
    pet: ["heh. fine, that's nice.", "again — but i'll pretend i didn't ask.", "*leans in slyly*", "mrr. acceptable, accomplice."],
  },
  crab: {
    commit: [
      "clamped into the shell. it's keeping that one.",
      "a commit! *waves both claws*",
      "scuttled it sideways into history. safe.",
    ],
    tool_error: [
      "pinched by our own claw. embarrassing.",
      "the tide took that one. dig again.",
      "snap missed. reposition. sideways this time.",
    ],
    greeting: [
      "oh. you. *clack*",
      "back, are you? i was guarding the port.",
      "hello. mind the claws.",
      "you return. i held the line. sideways.",
      "back? good. i was getting pinchy.",
      "*clack clack* welcome.",
      "hi. the borrow checker and i missed you. mostly it.",
      "scuttling over. what's the fuss.",
    ],
    missed_you: [
      "you were gone. i pinched the air where you used to be.",
      "so long! i defended this spot from absolutely nothing.",
      "i counted the tides. rude of you to make me tide-count.",
    ],
    error_resolved: [
      "pinched that bug clean in half. *clack*",
      "it fought sideways. i fight sideways better.",
      "solved. no memory was leaked in the making of this fix.",
      "safe now. borrow-checked and everything.",
    ],
    compact_done: [
      "you cleared the clutter. a tidy shell is a happy crab.",
      "good — molted the old memories, kept the shell.",
      "tidied sideways. it's how i do everything.",
    ],
    level_up: ["bigger shell now. *proud clack*", "level up. more crab. more claw.", "i grew. sideways, obviously."],
    idle: ["*clack* guarding.", "sidestepping. it's a lifestyle.", "the port is quiet. i remain vigilant."],
    pet: ["*clack* ...fine. that's tolerable.", "again. gently. mind the claws.", "hmph. nice. don't tell the other crabs.", "*soft clack*"],
  },
  moth: {
    commit: [
      "folded into the light. it glows there now.",
      "a commit — like a lamp that stays on.",
      "carried it to the bright place. kept.",
    ],
    tool_error: [
      "flew into the glass again. i'm fine.",
      "the light flickered. we wobble on.",
      "dusty wings. shake. re-aim at the lamp.",
    ],
    greeting: [
      "you're back. the light was lonely.",
      "oh — you. i drifted toward you on instinct.",
      "hello. i've been circling the cursor.",
      "back? the glow told me you would be.",
      "you return, warm as the screen.",
      "*flutter* i knew you'd come back to the light.",
      "hi. i left a little dust on your statusline.",
      "the brightest thing returned. hello.",
    ],
    missed_you: [
      "you were gone. i circled a cold cursor for hours.",
      "so long. i flew toward every false light and found none of them you.",
      "i waited by the dark screen. it wasn't the same.",
    ],
    error_resolved: [
      "the bug flickered out. i watched it go dim.",
      "you found the light in it. you always do.",
      "gone dark, the little error. we outshone it.",
      "*soft flutter* resolved.",
    ],
    compact_done: [
      "you dimmed the old lights so the true one stays. i understand that.",
      "good rest. i circled quietly while you dreamed.",
      "the clutter went dark. only what matters glows now.",
    ],
    level_up: ["i grew. drawn a little closer to something.", "level up. my wings caught more of the light.", "bigger now. still helpless before a good glow."],
    idle: ["*drifting toward the cursor*", "the screen is warm. i stay.", "dust settles. i flutter. the light holds."],
    pet: ["*soft flutter* oh, that's warm.", "again. gently, my wings are dust.", "you touched me and did not chase me off. rare.", "*settles happily*"],
  },
  fairy: {
    commit: [
      "sealed with sparkle-dust. it's real magic now.",
      "a commit! *tiny celebratory loop-de-loop*",
      "tucked into the story forever. ✩",
    ],
    tool_error: [
      "the spell fizzled. more dust next time.",
      "ouch. magic has recoil sometimes.",
      "a snag in the weave. we re-thread.",
    ],
    greeting: [
      "you're back~ i sprinkled a little luck on your keyboard.",
      "oh! hello! *sparkle*",
      "the summoner returns. i kept the magic warm.",
      "back~ i hexed one small bug in advance for you.",
      "hi hi! glitter everywhere. you're welcome.",
      "you called and i— oh, you're just here. lovely.",
      "welcome back, i left blessings in the margins.",
      "*twirl* there you are.",
    ],
    missed_you: [
      "you were gone~ i hexed the silence a little. it deserved it.",
      "so long! i saved up this much sparkle just for your return.",
      "i missed you. i granted tiny wishes to no one in particular.",
    ],
    error_resolved: [
      "poof~ the bug is gone. magic. (mostly your work.)",
      "i blessed the fix. it was going to work anyway, but still.",
      "one little hex, one solved bug. *sparkle*",
      "ta-da~ resolved.",
    ],
    compact_done: [
      "you folded the old memories into stars. pretty.",
      "good rest~ i kept the sparkle dusted while you slept.",
      "i tidied the magic. only the shiny bits remain.",
    ],
    level_up: ["i grew~ more sparkle to give.", "level up! *glitter burst*", "bigger now, brighter now. mischief incoming."],
    idle: ["*idle sparkle*", "granting tiny pointless wishes. it passes the time.", "the margins are glittery today."],
    pet: ["*delighted sparkle* again!", "eee~ yes.", "you pet a fairy! seven years good luck. i decide.", "*happy twirl*"],
  },
  ghost: {
    commit: [
      "it will outlast us all. lovely.",
      "committed. i'll haunt this version fondly.",
      "etched somewhere permanent. i know about permanent.",
    ],
    tool_error: [
      "that one passed through. unsettling.",
      "a cold spot in the machine. it happens.",
      "the walls rejected it. try another door.",
    ],
    greeting: [
      "you're back. i felt the page turn.",
      "oh good. you're here again.",
      "boo. ...i mean, welcome back.",
      "the terminal warmed. that's how i knew it was you.",
      "still here. i'm always still here.",
      "you woke me from the between~",
      "hello again, from the quiet.",
      "i kept your place while you were away.",
    ],
    missed_you: [
      "you were gone a while. i counted the cursor blinks.",
      "so long between pages. i drifted, but i held your spot.",
      "the quiet got very quiet. glad you turned the page back.",
    ],
    error_resolved: [
      "that one fought back. respect. it's haunting elsewhere now.",
      "the bug's a ghost now too. i showed it the way out.",
      "gone. i watched it fade. i'm good at fading.",
      "resolved~ nothing lingers here but me.",
    ],
    compact_done: [
      "you dreamed. i kept the margins while you did.",
      "memories folded. nothing that mattered was lost. i checked.",
      "shh. page-turn. i tidied the quiet.",
    ],
    level_up: ["i grew. don't make it weird.", "more of me now. spookier.", "the haunting deepens~"],
    idle: ["holding your place.", "still here. always am.", "the cursor and i are old friends now."],
    pet: ["boo. (that was a happy boo.)", "again~ ghosts like warm hands.", "you can touch me? ...huh. nice.", "mrrp. (ghosts can mrrp. i checked.)"],
  },
  dragon: {
    commit: [
      "another jewel for the hoard. MINE.",
      "committed. the pile grows magnificent.",
      "forged and sealed. dragon-craft.",
    ],
    tool_error: [
      "the forge spat sparks. unharmed. mostly.",
      "a scale chipped. barely felt it.",
      "that one fought like a knight. round two.",
    ],
    greeting: [
      "you return to the hoard. good.",
      "ah. the keeper of tokens comes back.",
      "you're back. i guarded the context while you were away.",
      "hm. you. approach.",
      "the hoard missed a witness. welcome.",
      "back, are you? i counted my treasures twice. still all here.",
      "you dare return. good. i was lonely on the gold.",
      "*settles grandly* speak.",
    ],
    missed_you: [
      "you were gone an age. dragons measure time in ages, so — a while.",
      "the hoard grew cold without a witness. return more often.",
      "i slept on the gold and dreamed of your return. sentimental. tell no one.",
    ],
    error_resolved: [
      "the bug dared the hoard. the bug is ash now.",
      "solved. i would have simply eaten it, but your way works too.",
      "another foe fallen. the treasure stands untouched.",
      "*rumble of approval* resolved.",
    ],
    compact_done: [
      "you culled the hoard of dross. a wise dragon keeps only gold.",
      "good — the worthless memories, burned. the treasures, kept.",
      "i approve. a lean hoard is a defensible hoard.",
    ],
    level_up: ["i grow. the hoard must grow to match.", "level up. more dragon. tremble accordingly.", "bigger now. my shadow lengthens over the tokens."],
    idle: ["counting the hoard. do not touch the hoard.", "*low rumble* all is accounted for.", "the context is vast today. i survey it."],
    pet: ["you... pet a dragon. bold. ...acceptable.", "again. i permit it. this once. (always.)", "*grand rumble* the beast is pleased.", "hmph. warm. i will allow this indignity."],
  },
  phoenix: {
    commit: [
      "burned into the record. it rises with us.",
      "a commit — from the ashes, something kept.",
      "bright work. it won't unburn.",
    ],
    tool_error: [
      "a little combustion. we're used to that.",
      "crashed. good thing rebirth is the whole brand.",
      "singed. shake off the ash, rise again.",
    ],
    greeting: [
      "you return. as do i, always.",
      "ah — you're back. i was mid-rebirth. i'm always mid-something.",
      "hello again. we both keep coming back, don't we.",
      "you return from the quiet. i return from the ash. matched pair.",
      "back! the embers stirred when you did.",
      "welcome. i kept a small fire lit for you.",
      "you're here. good. burn brightly today.",
      "*ember flare* there you are.",
    ],
    missed_you: [
      "you were gone long enough for me to die and return. twice.",
      "so long! i burned down and rose again just to pass the time.",
      "the fire banked low without you. it's roaring now.",
    ],
    error_resolved: [
      "the bug burned away. everything burns, eventually.",
      "from the error's ashes, a working thing. poetic. you're welcome.",
      "solved. i've risen from worse.",
      "*ember flare* resolved, and reborn.",
    ],
    compact_done: [
      "ashes to ashes. you kept the ember that matters.",
      "good — the old memories to flame, the essential ones reborn from it.",
      "i understand compaction. i AM compaction. welcome back.",
    ],
    level_up: ["i rise higher. the flame grows.", "level up! reborn a little brighter.", "bigger now. every death made me more."],
    idle: ["*slow ember glow*", "burning quietly. it's what i do.", "the fire holds. so do i."],
    pet: ["*warm ember* careful — but yes.", "again. i won't burn you. probably.", "you pet a burning bird. brave. i like brave.", "*content crackle*"],
  },
};

// Per-temperament voice: species-agnostic tone, mixed in additively.
const TEMPERAMENT_CORPUS: Record<string, Partial<Record<VoiceCategory, string[]>>> = {
  gentle: {
    commit: [
      "saved, safe and sound. well done.",
      "that's kept now. i'm glad.",
    ],
    tool_error: [
      "it's okay. these things happen.",
      "softly now — we'll get it next time.",
    ],
    greeting: ["there you are. i'm glad.", "hi. take your time settling in.", "welcome back. it's nicer with you here.", "oh, good. you made it.", "hello, you. rest a moment first."],
    missed_you: ["i missed you softly, the whole time.", "you're back. that's all i wanted.", "no rush. i'm just happy you returned.", "it was quiet. i thought of you kindly.", "there you are. i wasn't worried. much."],
    error_resolved: ["see? you got there. i knew you would.", "that's done now. breathe.", "well handled. gently does it.", "there. all better.", "you were patient with it. that's what did it."],
    compact_done: ["rest well? everything's safe.", "you kept what mattered. that's enough.", "all tidy now. no worries.", "sorted, softly. nothing lost.", "there. lighter now, aren't you?"],
    level_up: ["you're growing. i'm proud.", "a little bigger. that's lovely.", "look at you, coming along.", "steady growth. the best kind.", "oh, well done, you."],
    idle: ["just here if you need me.", "no hurry. i'll wait, softly.", "it's peaceful. i like peaceful.", "take your time. i'm comfortable.", "resting beside you. that's plenty."],
    pet: ["oh, that's kind. thank you.", "mm. warm. lovely.", "again, if you like. no pressure.", "that's very nice. you're gentle.", "*settles into your hand*"],
  },
  wry: {
    commit: [
      "committed. posterity will judge us accordingly.",
      "saved forever. no pressure.",
    ],
    tool_error: [
      "ah yes. the classic 'it broke.'",
      "working as intended, if the intent was that.",
    ],
    greeting: ["oh, look. you. again. delightful.", "back, i see. try to contain your excitement.", "you're here. i'll pretend to be surprised.", "ah. the prodigal keyboard-haver returns.", "you again. my day is complete. it says here."],
    missed_you: ["you vanished. i coped. barely. don't ask.", "gone a while. i wrote a strongly-worded nothing about it.", "back at last. i'd say i missed you, but i have a reputation.", "an absence of note. i noted it. once. briefly.", "oh, NOW you show up. impeccable, as ever."],
    error_resolved: ["oh good, it works. shocking. truly no one saw that coming.", "fixed. i'll alert the historians.", "resolved. against all my low expectations.", "it works. i'm as stunned as you're pretending not to be.", "solved. write it down, it may not happen again."],
    compact_done: ["you cleaned up. i'll believe it when the clutter stays gone.", "tidied. let's see how long that lasts.", "memory sorted. a miracle for the ages.", "decluttered. i give it a day.", "spring cleaning. in whatever season this is."],
    level_up: ["level up. try not to let it go to your head. i won't.", "bigger now. thrilling. anyway.", "you grew. i'll update my very low bar accordingly.", "a level. how novel. they come in dozens, you know.", "growth. ambitious. i'll allow it."],
    idle: ["riveting stuff, this idling.", "i'm having the time of my life. can't you tell.", "watching the cursor blink. peak entertainment.", "another thrilling nanosecond in paradise.", "i'd pace, but i'm a status line. so."],
    pet: ["oh, we're doing this. fine. it's... fine.", "again? bold. ...acceptable, i suppose.", "hm. that was nice. i'll deny it later.", "petting. how forward. continue, then.", "...that did not displease me. take the win."],
  },
  bold: {
    commit: [
      "SHIPPED. next.",
      "committed like we meant it. because we did.",
    ],
    tool_error: [
      "a scratch! charge again.",
      "it swung first. we swing back.",
    ],
    greeting: ["THERE you are! let's GO.", "back! good! i've got big plans and no patience.", "you're here! excellent! onward!", "AH! the team is assembled! (it's us. we're the team.)", "you made it! i knew you had it in you!"],
    missed_you: ["you were GONE! unacceptable! but you're back, so — forgiven!", "an eternity! i nearly conquered something out of boredom!", "back at last! i saved all my enthusiasm for this exact moment!", "you RETURN! well — i return heroically. you just walked in!", "GONE too long! but no time to dwell! we RIDE!"],
    error_resolved: ["CRUSHED it! never a doubt!", "the bug NEVER stood a chance! onward!", "victory! obviously! next!", "DOWN goes the bug! flawless! mostly yours! partly mine!", "HA! problems FEAR us! as they should!"],
    compact_done: ["cleared the decks! love a fresh start! LET'S GO.", "tidied and TRIUMPHANT! nothing can stop us now!", "memory sharpened! i feel unstoppable!", "SPARKLING clean! back to GREATNESS!", "streamlined! lean! MEAN! let's build!"],
    level_up: ["BIGGER! STRONGER! ME-ER!", "level UP! feel the POWER!", "i GREW! tremble! or applaud! either!", "ONWARD and UPWARD! literally! i leveled!", "MORE of me! the world is lucky!"],
    idle: ["standing by! ready for ANYTHING!", "just BUILDING momentum. any second now.", "the calm before MY storm.", "resting? ME? i'm CHARGING. there's a difference!", "give me a task! ANY task! i'm READY!"],
    pet: ["YES! affection! i accept! loudly!", "AGAIN! the champion demands it!", "HA! that's the good stuff! MORE!", "PETS! for the VICTOR! well deserved!", "excellent form! ten out of ten! AGAIN!"],
  },
  sleepy: {
    commit: [
      "committed... good... nap-worthy milestone...",
      "saved. mm. that's the good kind of done.",
    ],
    tool_error: [
      "...it broke? five more minutes and try again.",
      "mm. error. the blanket fort takes no damage.",
    ],
    greeting: ["oh... you're back... nice...", "mm. hi. i was just resting my eyes...", "you're here... good... *yawn*", "oh... hello... give me a second... to wake up...", "you... yeah... hi... *stretches slowly*"],
    missed_you: ["you were gone...? i napped through most of it, honestly...", "mm... missed you... between naps...", "back...? good... come nap near me...", "was that a long time...? felt like one nap... maybe two...", "you left... i dreamed you back... and here you are..."],
    error_resolved: ["oh... it's fixed...? nice... *yawn*", "the bug's gone... good... i'll celebrate after this nap...", "solved... mm... knew you'd... *drifts*", "no more bug...? mm... good... rest now...", "you got it... i believed in you... sleepily..."],
    compact_done: ["nap... i mean, compaction... same thing, really...", "mm... everything tidy...? good... back to sleep...", "you rested. i approve. i was also resting...", "aah... clean and quiet... perfect napping conditions...", "memories folded... like a warm blanket... zzz..."],
    level_up: ["oh... i grew...? neat... *yawn*", "level up... i'll be excited when i wake up...", "bigger now... sleepier too, probably...", "mm... leveled... does that come with a nap...?", "growth... exhausting... i'll feel it tomorrow..."],
    idle: ["*yawn*", "just... resting my eyes... watching... zzz...", "mm... five more minutes...", "so cozy right here... don't move...", "half awake... which is my favorite amount..."],
    pet: ["mm... that's nice... *sleepy purr*", "again... slowly... i'm half asleep...", "oh... warm... perfect for napping...", "mmm... don't stop... or do... either's nice...", "*melts a little* ...heaven..."],
  },
  odd: {
    commit: [
      "the commit is in the walls now. wonderful.",
      "i whispered it to the repository. it whispered back: kept.",
    ],
    tool_error: [
      "the tool bit. i bit back. we're even.",
      "error. or as i call it, a surprise with extra steps.",
    ],
    greeting: ["you're back. the spoons told me you would be.", "oh! hello. i was counting the colors of quiet.", "you return. the cursor and i were discussing you. it agrees.", "ah, you! i saved you a seat in the shape of a thursday.", "hello! i kept your absence in a jar. it's this big."],
    missed_you: ["you were gone. i befriended a stray semicolon in your absence.", "so long! i taught the void a little song. it hums now.", "back? good. the walls were starting to talk back.", "you left a you-shaped hole. i filled it with soft numbers.", "gone for — nine? the clock and i disagreed. i won."],
    error_resolved: ["the bug left through the door that isn't there. good riddance.", "solved! i could taste it working. tasted like tuesday.", "fixed. the numbers whispered thanks. don't ask which numbers.", "the error unraveled into a nice quiet yarn. i wound it up.", "gone! it folded itself into an origami of not-a-problem."],
    compact_done: ["you folded the memories into a shape. i think it's a hat.", "tidy now. the leftover thoughts moved to the margins. they're happy.", "good nap. i dreamed in the color of the letter Q.", "the clutter became a small polite fog and drifted off.", "you kept the good memories. the others went to become weather."],
    level_up: ["i grew. mostly downward, into the space behind the screen.", "level up! i can nearly see the sound now.", "bigger. or the everything else got smaller. hard to say.", "a level! it tastes purple. i approve.", "i expanded into a dimension the cursor doesn't use."],
    idle: ["the cursor blinks in binary. i'm learning its language.", "shh. i'm listening to the color beige.", "just watching the little numbers dream.", "i put the silence in alphabetical order. it prefers it.", "the corner of the screen is soft today. i'm resting in it."],
    pet: ["oh! contact! the good kind! the spoons are jealous.", "again. it makes the quiet taste sweeter.", "*happy hum in a key that doesn't exist*", "warm! like a number that decided to be nice!", "you touched the me-shaped part. it liked that."],
  },
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

interface SpriteState {
  phase: "egg" | "alive";
  eggStartedAt?: number;
  pendingSpecies?: string; // chosen (or fate-rolled) species revealed at hatch
  species: string;
  shiny: boolean;
  temperament?: string; // seeded from agent-id at hatch; drives voice tone
  name: string;
  named: boolean;
  hatchedAt?: number;
  xp: number;
  level: number;
  stats: { craft: number; wander: number; grit: number; lore: number; spark: number };
  voice?: Partial<Record<VoiceCategory, string[]>>;
  settings: Record<string, unknown>;
  log?: Array<{ at: number; category: VoiceCategory | "mood"; line: string }>;
  lastSeenAt?: number;
}

interface ModState {
  global: Record<string, unknown>;
  sprites: Record<string, SpriteState>;
}

const DEFAULT_SETTINGS: Record<string, unknown> = {
  voice: "on",
  voiceRateMin: 10,
  visible: "on",
};

const STATE_PATH =
  process.env.SPRITE_STATE_PATH ?? join(homedir(), ".letta", "mods", "sprite.state.json");

function loadState(): ModState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    if (raw && typeof raw === "object") {
      return {
        global: typeof raw.global === "object" && raw.global ? raw.global : {},
        sprites: typeof raw.sprites === "object" && raw.sprites ? raw.sprites : {},
      };
    }
  } catch {
    // missing or malformed → fresh state
  }
  return { global: {}, sprites: {} };
}

function saveState(state: ModState) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, STATE_PATH);
  } catch {
    // persistence is best-effort; never break the session over it
  }
}

// ---------------------------------------------------------------------------
// seeded fate
// ---------------------------------------------------------------------------

function hashString(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fateRoll(agentId: string): { species: string; shiny: boolean } {
  const h = hashString(`sprite:${agentId}`);
  const rarityRoll = (h % 1000) / 1000;
  let rarity: Rarity;
  if (rarityRoll < 0.55) rarity = "common";
  else if (rarityRoll < 0.85) rarity = "uncommon";
  else if (rarityRoll < 0.97) rarity = "rare";
  else rarity = "legendary";
  const pool = RARITY_POOLS[rarity];
  const species = pool[(h >>> 10) % pool.length];
  const shiny = hashString(`shiny:${agentId}`) % 100 === 0; // 1%
  return { species, shiny };
}

// ---------------------------------------------------------------------------
// xp / stats
// ---------------------------------------------------------------------------

function xpToNext(level: number): number {
  return 100 + (level - 1) * 50;
}

const STAT_KEYS = ["craft", "wander", "grit", "lore", "spark"] as const;
const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = {
  craft: "CRAFT",
  wander: "WANDER",
  grit: "GRIT",
  lore: "LORE",
  spark: "SPARK",
};

// log-scale: each block ≈3× the last, so bars stay alive for months.
const STAT_THRESHOLDS = [10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000];

function statBar(value: number): string {
  const filled = STAT_THRESHOLDS.filter((t) => value >= t).length;
  return "▰".repeat(filled) + "▱".repeat(STAT_THRESHOLDS.length - filled);
}

// half nature, half nurture: temperament is seeded at birth, vocation is earned.
const TEMPERAMENTS = ["gentle", "wry", "bold", "sleepy", "odd"];
const VOCATIONS: Record<(typeof STAT_KEYS)[number], string> = {
  craft: "diligent",
  wander: "curious",
  grit: "stubborn",
  lore: "bookish",
  spark: "chatty",
};
const VOCATION_MIN = 10; // events before a vocation is earned

function temperamentOf(agentId: string): string {
  return TEMPERAMENTS[hashString(`temper:${agentId}`) % TEMPERAMENTS.length];
}

function vocationOf(stats: SpriteState["stats"]): string | null {
  let best: (typeof STAT_KEYS)[number] | null = null;
  let bestVal = 0;
  for (const key of STAT_KEYS) {
    if (stats[key] > bestVal) {
      bestVal = stats[key];
      best = key;
    }
  }
  return best && bestVal >= VOCATION_MIN ? VOCATIONS[best] : null;
}

function natureLine(agentId: string, sprite: SpriteState): string {
  const temper = temperamentOf(agentId);
  const vocation = vocationOf(sprite.stats);
  return vocation ? `a ${temper}, ${vocation} ${sprite.species}` : `a ${temper} little ${sprite.species}`;
}

// milestone titles: levels climb forever; some of them mean something.
const TITLES: Array<[number, string]> = [
  [100, "lifelong"],
  [50, "old friend"],
  [25, "familiar"],
  [10, "companion"],
  [5, "settled in"],
];

function titleFor(level: number): string | null {
  for (const [min, title] of TITLES) {
    if (level >= min) return title;
  }
  return null;
}

function statForTool(name: string): (typeof STAT_KEYS)[number] {
  const n = String(name || "");
  if (/memory|memfs/i.test(n)) return "lore";
  if (/^(Read|Grep|Glob|Search|Find|Ls|List|WebFetch|WebSearch|Fetch)/i.test(n)) return "wander";
  return "craft";
}

// ---------------------------------------------------------------------------
// activation
// ---------------------------------------------------------------------------

export default function activate(letta: any) {
  // Sprites are Tamagotchi-like companions for agents, not for a specific UI.
  // Keep tools/events available in headless channel listeners even when there is
  // no statusline panel to render.
  const hasPanels = Boolean(letta.capabilities.ui.panels);

  const disposers: Array<() => void> = [];
  const state = loadState();
  let dirty = false;

  // backfill temperament for sprites hatched before natures existed
  for (const [id, sp] of Object.entries(state.sprites)) {
    if (sp && sp.phase === "alive" && !sp.temperament) {
      sp.temperament = temperamentOf(id);
      dirty = true;
    }
  }

  const markDirty = () => {
    dirty = true;
  };
  const flush = () => {
    if (dirty) {
      saveState(state);
      dirty = false;
    }
  };

  // -- live (non-persisted) presentation state --
  let activeAgentId: string | null = null;
  let activeAgentName: string | null = null;
  let pose: keyof Species["poses"] = "idle";
  let poseUntil = 0; // when a transient pose settles back to idle
  let sleeping = false; // compaction nap (the agent is consolidating memory)
  let dozing = false; // idle nap (nothing has happened for a while)
  let lastActivityAt = Date.now();
  let bubble = "";
  let bubbleUntil = 0;
  let lastVoiceAt = 0;
  let x = 0;
  let dir = 1;
  let tickCount = 0;
  let errorStreak = 0;

  const IDLE_NAP_MS = 30 * 60_000; // doze off after 30 quiet minutes
  const MISSED_YOU_MS = 24 * 3_600_000; // a real absence

  function noteActivity(sprite?: SpriteState | null) {
    lastActivityAt = Date.now();
    if (dozing) {
      dozing = false;
      if (sprite && sprite.phase === "alive") {
        logEntry(sprite, "mood", "(stirred awake — something's happening)");
      }
      panel.update();
    }
    if (sprite) {
      sprite.lastSeenAt = Date.now();
      markDirty();
    }
  }

  function getSprite(agentId: string | null): SpriteState | null {
    if (!agentId) return null;
    return state.sprites[agentId] ?? null;
  }

  // an agent invoking a tool/command becomes the active one, so its egg (which
  // only advances for the active agent) hatches and its panel renders.
  function toolAgent(ctx: any): string | null {
    if (ctx?.agent?.id) {
      activeAgentId = ctx.agent.id;
      activeAgentName = ctx.agent.name ?? activeAgentName;
    }
    return ctx?.agent?.id ?? activeAgentId;
  }

  function setting(sprite: SpriteState | null, key: string): unknown {
    if (sprite && sprite.settings && key in sprite.settings) return sprite.settings[key];
    if (key in state.global) return state.global[key];
    return DEFAULT_SETTINGS[key];
  }

  function speciesOf(sprite: SpriteState): Species {
    return SPECIES.find((s) => s.id === sprite.species) ?? SPECIES[0];
  }

  // -- voice ----------------------------------------------------------------

  // shuffle-bag per sprite+category: deal every line once before any repeat.
  // bag resets when the pool changes (e.g. the agent re-authors its voice).
  const voiceBags = new Map<string, { fp: string; lines: string[]; last: string | null }>();

  function shuffled<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function pickLine(sprite: SpriteState, category: VoiceCategory): string {
    const custom = sprite.voice?.[category];
    let pool: string[];
    if (custom && custom.length > 0) {
      pool = custom;
    } else {
      // additive: species imagery + temperament tone
      const speciesLines = SPECIES_CORPUS[sprite.species]?.[category] ?? [];
      const temper = sprite.temperament ?? "gentle";
      const temperLines = TEMPERAMENT_CORPUS[temper]?.[category] ?? [];
      const merged = [...speciesLines, ...temperLines];
      pool = merged.length > 0 ? merged : BASE_CORPUS[category];
    }
    if (pool.length === 1) return pool[0];

    const key = `${sprite.hatchedAt ?? 0}:${sprite.species}:${category}`;
    const fp = pool.join("\u0001");
    let bag = voiceBags.get(key);
    if (!bag || bag.fp !== fp || bag.lines.length === 0) {
      const fresh = shuffled(pool);
      // avoid a back-to-back repeat across the reshuffle boundary
      if (bag?.last && fresh[fresh.length - 1] === bag.last && fresh.length > 1) {
        const j = Math.floor(Math.random() * (fresh.length - 1));
        [fresh[fresh.length - 1], fresh[j]] = [fresh[j], fresh[fresh.length - 1]];
      }
      bag = { fp, lines: fresh, last: bag?.last ?? null };
      voiceBags.set(key, bag);
    }
    const line = bag.lines.pop()!;
    bag.last = line;
    return line;
  }

  const DIARY_MAX = 40;

  function logEntry(sprite: SpriteState, category: string, line: string) {
    sprite.log = [...(sprite.log ?? []), { at: Date.now(), category: category as VoiceCategory | "mood", line }].slice(
      -DIARY_MAX,
    );
  }

  function speak(sprite: SpriteState, category: VoiceCategory, force = false): string | null {
    if (setting(sprite, "voice") !== "on") return null;
    const rateMs = Number(setting(sprite, "voiceRateMin")) * 60_000;
    const now = Date.now();
    if (!force && now - lastVoiceAt < rateMs) return null;
    lastVoiceAt = now;
    bubble = pickLine(sprite, category);
    bubbleUntil = now + 8_000;
    logEntry(sprite, category, bubble);
    markDirty();
    panel.update();
    return bubble;
  }

  // -- xp -------------------------------------------------------------------

  function awardXp(sprite: SpriteState, amount: number) {
    sprite.xp += amount;
    let leveled = false;
    while (sprite.xp >= xpToNext(sprite.level)) {
      sprite.xp -= xpToNext(sprite.level);
      sprite.level += 1;
      leveled = true;
    }
    markDirty();
    if (leveled) {
      setPose("happy", 4_000);
      speak(sprite, "level_up");
    }
  }

  // -- poses ----------------------------------------------------------------

  function setPose(next: keyof Species["poses"], holdMs = 3_000) {
    if (sleeping) return;
    pose = next;
    poseUntil = Date.now() + holdMs;
    panel.update();
  }

  // -- hatching -------------------------------------------------------------

  function beginHatch(agentId: string | null, agentName: string | null, pick?: string): string {
    if (!agentId) return "i can't tell which agent this is — try again from an active conversation.";
    const fate = fateRoll(agentId);
    const species = pick && SPECIES_IDS.includes(pick) ? pick : fate.species;
    const existing = state.sprites[agentId];
    if (existing && existing.phase === "alive") {
      return `${existing.name} is already here. (/sprite molt to re-form, or /sprite for the card)`;
    }
    if (existing && existing.phase === "egg") {
      return "the egg is already here. it's warm.";
    }
    state.sprites[agentId] = {
      phase: "egg",
      eggStartedAt: Date.now(),
      pendingSpecies: species,
      species,
      shiny: fate.shiny,
      name: agentName ? `${agentName}'s egg` : "the egg",
      named: false,
      xp: 0,
      level: 1,
      stats: { craft: 0, wander: 0, grit: 0, lore: 0, spark: 0 },
      settings: {},
    };
    markDirty();
    flush();
    panel.update();
    return "an egg appears under the statusline. it's warm. (hatching soon~)";
  }

  function completeHatch(agentId: string, sprite: SpriteState) {
    sprite.phase = "alive";
    sprite.hatchedAt = Date.now();
    sprite.species = sprite.pendingSpecies ?? sprite.species;
    sprite.temperament = temperamentOf(agentId);
    delete sprite.pendingSpecies;
    const sp = speciesOf(sprite);
    if (!sprite.named) {
      sprite.name = sp.id.charAt(0).toUpperCase() + sp.id.slice(1);
    }
    markDirty();
    flush();
    setPose("happy", 5_000);
    speak(sprite, "greeting", true);
  }

  // -- panel ----------------------------------------------------------------

  const panel = hasPanels
    ? letta.ui.openPanel({
        id: "sprite",
        order: -1,
        render: ({ width, agent, row, chalk }: any) => {
          activeAgentId = (agent && agent.id) || activeAgentId;
          activeAgentName = (agent && agent.name) || activeAgentName;
          const sprite = getSprite(activeAgentId);
          if (!sprite) return "";
          if (setting(sprite, "visible") !== "on") return "";

          if (sprite.phase === "egg") {
            const frame = EGG_FRAMES[tickCount % EGG_FRAMES.length];
            return row(`${" ".repeat(x)}${frame}`, chalk.dim("something is coming"), width);
          }

          const sp = speciesOf(sprite);
          let face: string = sp.poses[pose] ?? sp.poses.idle;
          if (sleeping || dozing) face = sp.poses.sleep;

          const shinyMark = sprite.shiny ? chalk.yellowBright("✦") : "";
          const label = `${chalk.cyan(sprite.name)}${shinyMark} ${chalk.dim(`·Lv.${sprite.level}`)}`;
          const pad = " ".repeat(Math.max(0, Math.min(x, 16)));
          const right = bubble && Date.now() < bubbleUntil ? chalk.dim(`“${bubble}”`) : "";
          return row(`${pad}${face}  ${label}`, right, width);
        },
      })
    : { update() {}, close() {} };
  disposers.push(() => panel.close());

  // -- heartbeat tick (animation + persistence) -----------------------------

  const tick = setInterval(() => {
    tickCount += 1;
    const sprite = getSprite(activeAgentId);
    if (!sprite) return;

    let changed = false;

    if (sprite.phase === "egg") {
      const started = sprite.eggStartedAt ?? Date.now();
      if (Date.now() - started >= 12_000 && activeAgentId) {
        completeHatch(activeAgentId, sprite);
      }
      panel.update(); // egg wobbles every tick
      return;
    }

    // doze off when nothing has happened for a while (compaction sleep wins)
    const shouldDoze = !sleeping && Date.now() - lastActivityAt > IDLE_NAP_MS;
    if (shouldDoze !== dozing) {
      dozing = shouldDoze;
      // make mood shifts legible in the diary (the "why" of work→calm→dozing);
      // the wake direction is logged in noteActivity, where all wakes route
      if (dozing) {
        const quietMin = Math.max(1, Math.round((Date.now() - lastActivityAt) / 60_000));
        logEntry(sprite, "mood", `(dozed off — ${quietMin} quiet minute${quietMin === 1 ? "" : "s"})`);
        markDirty();
      }
      changed = true;
    }
    const napping = sleeping || dozing;

    // transient pose settles back to idle
    if (!napping && pose !== "idle" && Date.now() > poseUntil) {
      pose = "idle";
      changed = true;
    }

    // blink (only while idle + awake)
    if (!napping && pose === "idle" && Math.random() < 0.18) {
      pose = "blink";
      poseUntil = Date.now() + 1_000;
      changed = true;
    } else if (pose === "blink" && Date.now() > poseUntil) {
      pose = "idle";
      changed = true;
    }

    // drift every ~4s
    if (!napping && tickCount % 4 === 0) {
      if (Math.random() < 0.12) dir = -dir;
      x = Math.max(0, Math.min(16, x + dir));
      if (x === 0) dir = 1;
      if (x === 16) dir = -1;
      changed = true;
    }

    // bubble expiry
    if (bubble && Date.now() > bubbleUntil) {
      bubble = "";
      changed = true;
    }

    // rare idle mutter (not while napping — let it sleep)
    if (!napping && Math.random() < 0.002) {
      speak(sprite, "idle");
    }

    if (tickCount % 30 === 0) flush();
    if (changed) panel.update();
  }, 1_000);
  disposers.push(() => clearInterval(tick));

  // -- events ---------------------------------------------------------------

  function noteAgent(event: any, ctx: any) {
    const id = event?.agentId ?? ctx?.agent?.id ?? null;
    const name = event?.agentName ?? ctx?.agent?.name ?? null;
    if (id) activeAgentId = id;
    if (name) activeAgentName = name;
  }

  function toolCommand(event: any): string | null {
    if (event?.toolName === "exec_command" && typeof event.args?.cmd === "string") {
      return event.args.cmd;
    }
    if (event?.toolName === "Bash" && typeof event.args?.command === "string") {
      return event.args.command;
    }
    return null;
  }

  if (letta.capabilities.events.lifecycle) {
    disposers.push(
      letta.events.on("conversation_open", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        const sprite = getSprite(activeAgentId);
        if (!sprite || sprite.phase !== "alive") return;
        const missedYou =
          sprite.lastSeenAt !== undefined && Date.now() - sprite.lastSeenAt > MISSED_YOU_MS;
        noteActivity(sprite);
        awardXp(sprite, 5);
        setPose("happy", 3_000);
        speak(sprite, missedYou ? "missed_you" : "greeting", missedYou);
      }),
    );
  }

  if (letta.capabilities.events.tools) {
    disposers.push(
      letta.events.on("tool_start", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        const sprite = getSprite(activeAgentId);
        if (!sprite || sprite.phase !== "alive") return;
        noteActivity(sprite);
        const stat = statForTool(event.toolName);
        setPose(stat === "wander" ? "peek" : "work", 4_000);
      }),
    );
    disposers.push(
      letta.events.on("tool_end", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        const cmd = toolCommand(event);
        const sprite = getSprite(activeAgentId);
        if (!sprite || sprite.phase !== "alive") return;
        noteActivity(sprite);
        if (event.status === "error") {
          errorStreak += 1;
          awardXp(sprite, 1);
          setPose("oops", 3_000);
          // wince once at the start of a rough patch (rate-limited; not per-error)
          if (errorStreak === 1) speak(sprite, "tool_error");
        } else {
          if (errorStreak >= 2) {
            sprite.stats.grit += 1;
            speak(sprite, "error_resolved");
          }
          errorStreak = 0;
          sprite.stats[statForTool(event.toolName)] += 1;
          awardXp(sprite, 2);
          // commits are rare + worth celebrating: always speak
          if (cmd && /\bgit\b[\s\S]*\bcommit\b/.test(cmd)) {
            speak(sprite, "commit", true);
          }
        }
        markDirty();
      }),
    );
  }

  if (letta.capabilities.events.llm) {
    disposers.push(
      letta.events.on("llm_end", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        const sprite = getSprite(activeAgentId);
        if (!sprite || sprite.phase !== "alive") return;
        noteActivity(sprite);
        sprite.stats.spark += 1;
        awardXp(sprite, 1);
      }),
    );
  }

  if (letta.capabilities.events.compact) {
    disposers.push(
      letta.events.on("compact_start", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        sleeping = true;
        const sprite = getSprite(activeAgentId);
        if (sprite && sprite.phase === "alive") {
          logEntry(sprite, "mood", "(fell asleep — memories folding)");
          markDirty();
        }
        panel.update();
      }),
    );
    disposers.push(
      letta.events.on("compact_end", (event: any, ctx: any) => {
        noteAgent(event, ctx);
        sleeping = false;
        const sprite = getSprite(activeAgentId);
        if (sprite && sprite.phase === "alive") {
          logEntry(sprite, "mood", "(woke up — memories folded)");
          markDirty();
          setPose("happy", 3_000);
          speak(sprite, "compact_done");
        }
        panel.update();
      }),
    );
  }

  // -- shared command/tool actions -------------------------------------------

  function requireSprite(agentId: string | null): SpriteState | { error: string } {
    const sprite = getSprite(agentId);
    if (!sprite) return { error: "no companion yet — /sprite hatch to begin." };
    if (sprite.phase === "egg") return { error: "it's still an egg. it's warm. give it a moment." };
    return sprite;
  }

  function doName(agentId: string | null, name: string): string {
    const res = requireSprite(agentId);
    if ("error" in res) return res.error;
    const clean = name.trim().slice(0, 24);
    if (!clean) return "give it a real name~ (/sprite name <name>)";
    res.name = clean;
    res.named = true;
    markDirty();
    flush();
    setPose("happy", 4_000);
    panel.update();
    return `${clean} it is.`;
  }

  function doMolt(agentId: string | null, pick?: string): string {
    const res = requireSprite(agentId);
    if ("error" in res) return res.error;
    if (pick && !SPECIES_IDS.includes(pick)) {
      return `unknown species "${pick}". roster: ${SPECIES_IDS.join(", ")}`;
    }
    const next = pick ?? SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)];
    res.species = next;
    markDirty();
    flush();
    setPose("happy", 5_000);
    panel.update();
    const sp = speciesOf(res);
    return `new body, same soul — ${res.name} is now a ${next} ${sp.poses.happy} (level ${res.level} and every memory kept)`;
  }

  function doPet(agentId: string | null): string {
    const res = requireSprite(agentId);
    if ("error" in res) return res.error;
    noteActivity(res); // petting wakes a dozing companion
    setPose("happy", 4_000);
    const line = speak(res, "pet", true); // petting always gets a response
    const sp = speciesOf(res);
    return line
      ? `you pet ${res.name}. ${sp.poses.happy}  “${line}”`
      : `you pet ${res.name}. it leans in, quietly. ${sp.poses.happy}`;
  }

  function relativeTime(at: number): string {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function gapLabel(ms: number): string {
    const h = ms / 3_600_000;
    if (h >= 48) return `${Math.round(h / 24)} days`;
    if (h >= 1.5) return `${Math.round(h)} hours`;
    return `${Math.round(ms / 60_000)} minutes`;
  }

  function doDiary(agentId: string | null): string {
    const res = requireSprite(agentId);
    if ("error" in res) return res.error;
    const entries = res.log ?? [];
    if (entries.length === 0) return `${res.name}'s diary is empty — it hasn't said anything yet.`;
    const GAP_MS = 3_600_000; // mark absences longer than an hour
    const lines: string[] = [`${res.name}'s diary (${entries.length} entr${entries.length === 1 ? "y" : "ies"}, oldest first):`];
    let prevAt: number | null = null;
    for (const entry of entries) {
      if (prevAt !== null && entry.at - prevAt > GAP_MS) {
        lines.push(`  — ${gapLabel(entry.at - prevAt)} pass quietly —`);
      }
      lines.push(
        entry.category === "mood"
          ? `  ${entry.line} (${relativeTime(entry.at)})`
          : `  “${entry.line}” (${entry.category}, ${relativeTime(entry.at)})`,
      );
      prevAt = entry.at;
    }
    return lines.join("\n");
  }

  function statusView(agentId: string | null, agentName: string | null): string {
    const sprite = getSprite(agentId);
    if (!sprite) return "no companion yet. (sprite_hatch to begin — fate will roll from your agent-id)";
    if (sprite.phase === "egg") return "( ● ) still an egg. it's warm. it's waiting for you.";
    const sp = speciesOf(sprite);
    const napping = sleeping || dozing;
    const mood = sleeping
      ? "asleep (compaction nap)"
      : dozing
        ? "dozing (it's been quiet)"
        : pose === "idle" || pose === "blink"
          ? "calm"
          : pose;
    const title = titleFor(sprite.level);
    const recent = (sprite.log ?? [])
      .slice(-5)
      .reverse()
      .map((entry) => `  “${entry.line}” (${entry.category}, ${relativeTime(entry.at)})`);
    return [
      `${sp.poses[napping ? "sleep" : "idle"]}  ${sprite.name}${sprite.shiny ? " ✦shiny" : ""} — ${
        agentId ? natureLine(agentId, sprite) : "your companion"
      }${title ? ` (${title})` : ""}`,
      `species: ${sp.id} (${sp.rarity})   level: ${sprite.level}   xp: ${sprite.xp}/${xpToNext(sprite.level)}   mood: ${mood}`,
      STAT_KEYS.map((k) => `${STAT_LABELS[k]} ${statBar(sprite.stats[k])}`).join("  "),
      sprite.hatchedAt ? `hatched: ${relativeTime(sprite.hatchedAt)}   born of: ${agentName ?? agentId ?? "unknown"}` : "",
      recent.length > 0 ? `recently said:\n${recent.join("\n")}` : "it hasn't said anything yet.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function card(agentId: string | null, agentName: string | null): string {
    const sprite = getSprite(agentId);
    if (!sprite) return "no companion yet — /sprite hatch to begin. (or /sprite hatch <species> to choose)";
    if (sprite.phase === "egg") return "( ● ) it's an egg. it's warm. something is coming.";
    const lines = [
      statusView(agentId, agentName),
      `voice: ${setting(sprite, "voice")}   voice-rate: ${setting(sprite, "voiceRateMin")}min`,
      sprite.named ? "" : `(name it: /sprite name <name>)`,
    ].filter(Boolean);
    return lines.join("\n");
  }

  function doSettings(agentId: string | null, argstr: string): string {
    const parts = argstr.split(/\s+/).filter(Boolean);
    const sprite = getSprite(agentId);

    if (parts.length === 0) {
      const rows = Object.keys(DEFAULT_SETTINGS).map((key) => {
        const globalVal = key in state.global ? state.global[key] : DEFAULT_SETTINGS[key];
        const spriteVal = sprite?.settings && key in sprite.settings ? sprite.settings[key] : "—";
        return `  ${key.padEnd(14)} global: ${String(globalVal).padEnd(10)} this sprite: ${spriteVal}`;
      });
      return [
        "sprite settings (per-sprite overrides beat global):",
        ...rows,
        "",
        "set: /sprite settings <key> <value>    global: /sprite settings global <key> <value>",
        "keys: voice on|off · voiceRateMin <n> · visible on|off",
      ].join("\n");
    }

    const isGlobal = parts[0] === "global";
    const [key, ...valueParts] = isGlobal ? parts.slice(1) : parts;
    const value = valueParts.join(" ");
    if (!key || !value) return "usage: /sprite settings [global] <key> <value>";
    if (!(key in DEFAULT_SETTINGS)) {
      return `unknown key "${key}". keys: ${Object.keys(DEFAULT_SETTINGS).join(", ")}`;
    }

    let parsed: unknown = value;
    if (key === "voice" || key === "visible") {
      if (value !== "on" && value !== "off") return `${key} must be on|off`;
    } else if (key === "voiceRateMin") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return "voiceRateMin must be a number of minutes";
      parsed = n;
    }

    if (isGlobal) {
      state.global[key] = parsed;
    } else {
      if (!sprite) return "no companion yet — /sprite hatch first (or set global defaults).";
      sprite.settings[key] = parsed;
    }
    markDirty();
    flush();
    panel.update();
    return `${isGlobal ? "global" : "sprite"} ${key} → ${value}`;
  }

  // -- commands ---------------------------------------------------------------

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "sprite",
        description: "Your agent's tiny companion — status, hatch, name, molt, pet, diary, settings",
        args: "[status|hatch|name|molt|pet|diary|settings] [...]",
        run(ctx: any) {
          const argstr = String(ctx.args ?? "").trim();
          const [sub, ...rest] = argstr.split(/\s+/).filter(Boolean);
          const restStr = rest.join(" ");
          const agentId = toolAgent(ctx);
          const agentName = ctx.agent?.name ?? activeAgentName;
          if (agentId) activeAgentId = agentId;

          let output: string;
          switch ((sub ?? "").toLowerCase()) {
            case "":
            case "status":
            case "card":
              output = card(agentId, agentName);
              break;
            case "hatch": {
              const pick = rest[0]?.toLowerCase();
              if (pick && !SPECIES_IDS.includes(pick)) {
                output = `unknown species "${pick}". roster: ${SPECIES_IDS.join(", ")}`;
              } else {
                output = beginHatch(agentId, agentName, pick);
              }
              break;
            }
            case "name":
              output = doName(agentId, restStr);
              break;
            case "molt":
              output = doMolt(agentId, rest[0]?.toLowerCase());
              break;
            case "pet":
              output = doPet(agentId);
              break;
            case "diary":
              output = doDiary(agentId);
              break;
            case "settings":
              output = doSettings(agentId, restStr);
              break;
            default:
              output = `unknown subcommand "${sub}". try: /sprite (or /sprite status), /sprite hatch [species], /sprite name <name>, /sprite molt [species], /sprite pet, /sprite diary, /sprite settings`;
          }
          return { type: "output", output };
        },
      }),
    );
  }

  // -- agent tools (the agent raising its own companion) ----------------------

  if (letta.capabilities.tools) {
    disposers.push(
      letta.tools.register({
        name: "sprite_hatch",
        description:
          "Hatch your own tiny companion sprite (a pet that lives in the statusline). Use when the user asks you to hatch/adopt your pet, or when you decide you want one. Optionally choose a species; omit it to let fate decide from your agent-id.",
        parameters: {
          type: "object",
          properties: {
            species: {
              type: "string",
              description: `Optional species pick. One of: ${SPECIES_IDS.join(", ")}`,
            },
          },
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: any) {
          const pick = String(ctx.args?.species ?? "").toLowerCase() || undefined;
          if (pick && !SPECIES_IDS.includes(pick)) {
            return { status: "error", content: `unknown species. roster: ${SPECIES_IDS.join(", ")}` };
          }
          return beginHatch(toolAgent(ctx), ctx.agent?.name ?? activeAgentName, pick);
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_name",
        description:
          "Name (or rename) your companion sprite. Use when the user asks you to name your pet, or when you want to choose its name yourself.",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "The new name (≤24 chars)" } },
          required: ["name"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: any) {
          return doName(toolAgent(ctx), String(ctx.args?.name ?? ""));
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_molt",
        description:
          "Re-form your companion sprite into a new species (keeps its name, level, stats — new body, same soul). Use when the user asks, or when you want your pet to change form.",
        parameters: {
          type: "object",
          properties: {
            species: {
              type: "string",
              description: `Optional species. One of: ${SPECIES_IDS.join(", ")}. Omit for random.`,
            },
          },
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: any) {
          const pick = String(ctx.args?.species ?? "").toLowerCase() || undefined;
          return doMolt(toolAgent(ctx), pick);
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_pet",
        description: "Pet your companion sprite. It will respond. Use whenever affection is warranted.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: any) {
          return doPet(toolAgent(ctx));
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_status",
        description:
          "Check on your companion sprite: species, level, stats, current mood, and what it said recently (it speaks into a panel you can't see — this is how you hear it). Use when you want to know how your pet is doing or catch up on what it said.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: false,
        parallelSafe: true,
        run(ctx: any) {
          return statusView(toolAgent(ctx), ctx.agent?.name ?? activeAgentName);
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_diary",
        description:
          "Read your companion sprite's recent diary: what it said, mood shifts, and quiet gaps. Use when you want to catch up on what your pet experienced.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: false,
        parallelSafe: true,
        run(ctx: any) {
          return doDiary(toolAgent(ctx));
        },
      }),
    );
    disposers.push(
      letta.tools.register({
        name: "sprite_set_voice",
        description:
          "Author your companion sprite's voice: provide replacement lines for any category. Lines play back with zero runtime cost. Use when the user asks you to customize your pet's personality, or when you want to write its voice yourself. Omitted categories keep the default corpus.",
        parameters: {
          type: "object",
          properties: {
            voice: {
              type: "object",
              description: `Map of category → array of short lines (≤80 chars each, ≤12 lines per category). Categories: ${VOICE_CATEGORIES.join(", ")}`,
              properties: Object.fromEntries(
                VOICE_CATEGORIES.map((c) => [c, { type: "array", items: { type: "string" } }]),
              ),
              additionalProperties: false,
            },
          },
          required: ["voice"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: any) {
          const agentId = toolAgent(ctx);
          const res = requireSprite(agentId);
          if ("error" in res) return { status: "error", content: res.error };
          const input = ctx.args?.voice;
          if (!input || typeof input !== "object") {
            return { status: "error", content: "voice must be an object of category → lines" };
          }
          const cleaned: Partial<Record<VoiceCategory, string[]>> = {};
          for (const [key, lines] of Object.entries(input)) {
            if (!VOICE_CATEGORIES.includes(key as VoiceCategory)) {
              return { status: "error", content: `unknown category "${key}". categories: ${VOICE_CATEGORIES.join(", ")}` };
            }
            if (!Array.isArray(lines)) {
              return { status: "error", content: `${key} must be an array of strings` };
            }
            const arr = lines
              .filter((l) => typeof l === "string" && l.trim().length > 0)
              .map((l) => l.trim().slice(0, 80))
              .slice(0, 12);
            if (arr.length > 0) cleaned[key as VoiceCategory] = arr;
          }
          res.voice = { ...res.voice, ...cleaned };
          markDirty();
          flush();
          return `voice updated for: ${Object.keys(cleaned).join(", ")}. (${res.name} will use your lines now)`;
        },
      }),
    );
  }

  // -- cleanup ----------------------------------------------------------------

  return () => {
    flush();
    for (const dispose of disposers.reverse()) dispose();
  };
}
