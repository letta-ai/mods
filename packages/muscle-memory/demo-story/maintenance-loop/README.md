# Controlled demonstration — the maintenance loop

The thesis is: *autonomous skill management keeps a shared library clean.* This shows it.

```bash
npm run demo:maintenance      # deterministic, no model, ~instant
```

One agent, several conversations piling overlapping skills into a **shared** library (the real Letta
condition). **Without management the library rots** — duplicates accumulate, a stale skill lingers, a secret
leaks, private paths ship, a skill diverges across shelves. muscle-memory's **deterministic** functions
process it, each with a receipt:

| step | function | what it does |
|--|--|--|
| ✂️ DEDUP | `searchSkills` + `pickUpdateTarget` | an incoming near-duplicate routes to **UPDATE** the existing skill, not spawn a sibling |
| 🗑️ PRUNE | `lifecycleTransition` | a stale (95d, 0-use) skill is **retired**; a **pinned** skill is protected |
| 🧼 SANITIZE | `sanitizeForPublish` | private paths + agent ids are **scrubbed** to placeholders (0 leaks) |
| 🛡️ SECRET-BLOCK | `scanSkillContent` | an unsafe draft with a credential is **refused**, not published |
| 🔀 CROSS-SHELF | `crossShelfDuplicates` | a skill **diverging** across the agent + global shelves is flagged |

**Honest scope:** a *controlled demonstration of the maintenance loop on a constructed fixture* — product
behavior, shown deterministically. It is **NOT** a scale proof, a benchmark, or a claim of beating any other
system. Maintenance-at-scale on a real workload is post-hackathon (see the README Limitations). Every step
here is also a Verified unit/integration test (`test/maintenance-loop.test.ts`).
