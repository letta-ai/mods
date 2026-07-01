#!/usr/bin/env node
// Live runtime smoke — proves the mod actually LOADS and behaves in a real-ish harness, beyond unit tests.
// Builds the bundle, mounts it against a mock Letta with full + degraded capability surfaces, and checks
// every wiring path doesn't throw. Run: node scripts/live-smoke.mjs   (or `npm run smoke:live`)
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
execSync(`bun build ${join(PKG, "mods/index.ts")} --target node --outfile /tmp/mm-smoke.mjs`, { stdio: "pipe" });

let failed = 0; const ok = (name, cond) => { console.log(`  ${cond ? "✅" : "❌"} ${name}`); if (!cond) failed++; };
function mockLetta(caps) {
  const reg = { tools: [], events: [], commands: {}, panel: false };
  return { _reg: reg, capabilities: caps,
    events: { on: (n, fn) => { reg.events.push(n); reg._handlers = reg._handlers || {}; reg._handlers[n] = fn; return () => {}; } },
    tools: { register: (t) => { reg.tools.push(t?.name); return () => {}; } },
    commands: { register: (c) => { reg.commands[c.id] = c; return () => {}; } },
    ui: { panels: caps?.ui?.panels, openPanel: caps?.ui?.panels ? () => { reg.panel = true; return { update() {}, close() {} }; } : undefined },
    client: {} };
}
const FULL = { events: { tools: true, turns: true, compact: true, llm: true, lifecycle: true }, ui: { panels: true }, commands: true, tools: true };

async function main() {
  process.env.MM_STATE_DIR = mkdtempSync(join(tmpdir(), "mm-smoke-"));
  const mod = await import("/tmp/mm-smoke.mjs?t=" + Date.now());
  const activate = mod.default || mod.activate;
  console.log("\n━━ muscle-memory live smoke ━━");

  // 1. activate loads + registers, full capabilities
  const L = mockLetta(FULL); let dispose; let threw = null;
  try { dispose = activate(L); } catch (e) { threw = e; }
  ok("activate() loads without throwing", !threw);
  ok("registers tools (3)", L._reg.tools.filter(Boolean).length >= 3);
  ok("registers events incl turn_end + tool_start/end", ["turn_end", "tool_start", "tool_end"].every((e) => L._reg.events.includes(e)));
  ok("registers the /muscle-memory command", !!L._reg.commands["muscle-memory"]);
  ok("opens the panel", L._reg.panel === true);

  // 2. panel render returns valid content
  let panelOut; try { panelOut = (mod.__mm?.renderMuscleMemoryPanel || (() => []))({}); } catch (e) { panelOut = e; }
  ok("panel render returns an array (no throw)", Array.isArray(panelOut));

  // 3. tool_start / tool_end capture path doesn't throw
  try { L._reg._handlers?.tool_start?.({ tool: "Bash", args: { command: "ls" }, conversationId: "c1" }); L._reg._handlers?.tool_end?.({ tool: "Bash", ok: true, conversationId: "c1" }); ok("tool_start/tool_end capture path doesn't throw", true); } catch { ok("tool_start/tool_end capture path doesn't throw", false); }

  // 4. turn_end hook path doesn't throw (MM_REFLECT off → should early-return cleanly)
  try { L._reg._handlers?.turn_end?.({ conversationId: "c1" }, { agentId: "a1" }); ok("turn_end hook path doesn't throw (reflect off)", true); } catch { ok("turn_end hook path doesn't throw (reflect off)", false); }

  // 5. a command runs end to end
  try { const r = await L._reg.commands["muscle-memory"].run({ argv: ["audit"] }); ok("/muscle-memory audit runs", typeof r?.output === "string"); } catch { ok("/muscle-memory audit runs", false); }

  // 6. MemFS/temp skill write path works (publish stage → approve dry path, isolated dirs)
  try {
    const M = mod.__mm; const g = mkdtempSync(join(tmpdir(), "mm-smoke-g-"));
    const nm = "smoke-skill"; const body = "---\nname: " + nm + "\ndescription: Use when smoke testing the publish path end to end\n---\n## Procedure\n```bash\necho ok\n```\n## Pitfalls\n### 1. x\nTELL: y. Fix it.\n## Verification\n- ok.";
    const st = M.stageSanitizedPublish({ name: nm, description: "Use when smoke testing the publish path", body });
    const ap = M.approveStagedPublish(nm, g);
    ok("publish stage → approve dry path works (file on shelf)", st.staged && ap.published && existsSync(ap.path));
  } catch (e) { ok("publish stage → approve dry path works", false); }

  if (dispose) try { dispose(); } catch {}

  // 7. DEGRADED surfaces — no capabilities / no-mods fallback must NOT throw
  for (const [label, caps] of [["no event capabilities", { ui: {}, commands: true, tools: true, events: {} }], ["no ui/panel capability", { events: FULL.events, ui: {}, commands: true, tools: true }], ["bare/empty capabilities", {}]]) {
    let t2 = null; const L2 = mockLetta(caps); try { const d = activate(L2); if (d) d(); } catch (e) { t2 = e; }
    ok(`degraded: ${label} — activate doesn't throw`, !t2);
  }

  console.log(failed === 0 ? "\nSMOKE: ✅ ALL GREEN" : `\nSMOKE: ❌ ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error("smoke crashed:", e); process.exit(1); });
