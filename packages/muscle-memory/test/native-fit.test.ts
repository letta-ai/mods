// Block N — native-fit safety: an autonomous (unattended) loop must know which shelf it may mutate.
// Agent-local = autonomous/writable; global Custom Skills = read-only for autonomous ops (audit-visible,
// never auto-retired/auto-rewritten). Plus MemFS-first write resolution. Deterministic, no model.
import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { skillShelves, autonomousShelves, agentSkillsDir, GLOBAL_SKILLS, writeSkill } from "../mods/core";
import { reachFn } from "../mods/engram";

function withMemoryDir<T>(dir: string, fn: () => T): T {
  const orig = process.env.MEMORY_DIR; process.env.MEMORY_DIR = dir;
  try { return fn(); } finally { if (orig === undefined) delete process.env.MEMORY_DIR; else process.env.MEMORY_DIR = orig; }
}

test("native-fit: agent shelf is writable + autonomous; global shelf is read-only + NOT autonomous", () => {
  const agent = mkdtempSync(join(tmpdir(), "mm-agent-"));
  withMemoryDir(agent, () => {
    const shelves = skillShelves({});
    const a = shelves.find((s) => s.name === "agent");
    expect(a?.writable).toBe(true); expect(a?.autonomous).toBe(true);
    // the agent shelf (MemFS) is distinct from the global shelf here → global must be present + locked down
    const g = shelves.find((s) => s.name === "global");
    expect(g).toBeTruthy();
    expect(g?.writable).toBe(false);     // global is NEVER autonomously writable
    expect(g?.autonomous).toBe(false);
  });
});

test("native-fit BOUNDARY: autonomousShelves contains ONLY the agent shelf, never the global shelf", () => {
  const agent = mkdtempSync(join(tmpdir(), "mm-agent-"));
  withMemoryDir(agent, () => {
    const auton = autonomousShelves({});
    expect(auton).toContain(join(agent, "skills"));   // agent-local is mutable by the autonomous loop
    expect(auton).not.toContain(GLOBAL_SKILLS);        // the shared global shelf is OFF LIMITS to autonomy
    expect(auton.length).toBe(1);
  });
});

test("native-fit MemFS-first: MEMORY_DIR ⇒ agentSkillsDir = $MEMORY_DIR/skills; writeSkill writes atomically there", () => {
  const mem = mkdtempSync(join(tmpdir(), "mm-memfs-"));
  withMemoryDir(mem, () => {
    expect(agentSkillsDir({})).toBe(join(mem, "skills"));   // MemFS shelf resolved first
    const p = writeSkill(agentSkillsDir({}), "a-skill", "---\nname: a-skill\ndescription: Use when testing the memfs write path\n---\n## Procedure\n1. ok");
    expect(p).toBe(join(mem, "skills", "a-skill", "SKILL.md"));
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toContain("name: a-skill");
    expect(existsSync(join(mem, "skills", "a-skill", ".SKILL.md.tmp"))).toBe(false); // atomic: no temp leftover
  });
});

test("native-fit: reachFn binds the extracted method to its receiver (SDK resources read this._client)", () => {
  class Resource {
    private _client = { ok: true };
    call(): boolean { return this._client.ok; } // throws if `this` is lost
  }
  const client = { agents: { passages: new Resource() } };
  const fn = reachFn(client, ["agents", "passages", "call"]);
  expect(fn).not.toBeNull();
  // Unbound extraction would throw "undefined is not an object (evaluating 'this._client')" —
  // the exact failure the live benchmark caught against the real letta-client, which the
  // best-effort catch blocks had been swallowing into a silent no-op (MM_NATIVE=blocks sync).
  expect(fn!()).toBe(true);
});
