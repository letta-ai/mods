// muscle-memory · ui module (split from index.ts — behavior-preserving).
import { join } from "node:path";


/** Hermes-style compact summary of a review's WRITE actions (finished, not thinking). */
export function summarizeReflectActions(events: Array<{ phase: string; summary: string }>, mode: "compact" | "verbose" = "compact"): string {
  const primaryPhases = ["skill_created", "skill_updated", "skill_staged", "skill_graduated", "skill_retired"];
  const writes = events.filter((e) => [...primaryPhases, "skill_review", "memory_pref_injected", "noise_rejected"].includes(e.phase));
  if (!writes.length) { const last = events[events.length - 1]; return `💾 muscle-memory review: ${last ? last.summary : "nothing to save"}`; }
  const main = writes.filter((w) => primaryPhases.includes(w.phase)).map((w) => w.summary);
  const extras = mode === "verbose" ? writes.filter((w) => !primaryPhases.includes(w.phase)).map((w) => w.summary) : [];
  return `💾 muscle-memory review: ${[...main, ...extras].join(" · ") || writes[0].summary}`;
}


/** Panel body (string[] = lines). Cheap + side-effect-free; host clips/caps. Empty → panel hides. */
// LEAN, Hermes-style: ONE dense line that LIVE-mirrors skill development. Hidden when off+idle.
export function renderMuscleMemoryPanel(state: Record<string, any>): string[] {
  const mode = process.env.MM_REFLECT === "auto" ? "auto" : process.env.MM_REFLECT === "staged" ? "staged" : "off";
  if (!state || (!state.last && !state.phase)) return mode === "off" ? [] : [`💾 muscle-memory · ${mode} · watching`];
  const ageMs = typeof state.ts === "number" ? Date.now() - state.ts : 0;
  // TRANSIENT phases (reviewing/routing/writing) are mid-flight states. If a reflect is interrupted
  // before a terminal state is written (process killed, author error, /reload), they must NOT stick
  // forever — self-heal back to "watching" after a short window (a real reflect+author finishes well
  // under 2min). Bug fixed 2026-06-27: these previously had ttlMs=0 → the panel froze on "writing…".
  const TRANSIENT = state.phase === "reviewing" || state.phase === "routing" || state.phase === "writing";
  // EVERY phase must be finite — a notice that never expires freezes the panel (Adrian hit this with
  // "writing…" AND "protected"/"blocked"). protected/blocked are transient "I just blocked something"
  // notices, NOT permanent states; default is a safety net so no future phase can ever stick forever.
  const ttlMs = state.phase === "idle" ? 60_000
    : state.phase === "done" ? 5 * 60_000
    : state.phase === "protected" ? 5 * 60_000
    : state.phase === "blocked" ? 5 * 60_000
    : TRANSIENT ? 120_000
    : 90_000;
  if (ageMs > ttlMs) return mode === "off" ? [] : [`💾 muscle-memory · ${mode} · watching`];
  switch (state.phase) {
    case "reviewing": return [`💾 muscle-memory · 🔍 reviewing ${state.detail || "evidence…"}`];
    case "routing": return [`💾 muscle-memory · 🧭 ${state.route || "routing…"}`];
    case "writing": return [`💾 muscle-memory · ✍️  writing ${state.skill ? `'${state.skill}'` : "skill"}…`];
    case "protected": return [`💾 muscle-memory · 🛡️  ${state.last || "blocked unsafe content (safe)"}`];
    case "blocked": return [`💾 muscle-memory · ⚠️  ${state.last || "blocked"}`];
    default: return [`💾 muscle-memory · ${state.last || "ready"}`]; // done/idle: the finished action
  }
}
