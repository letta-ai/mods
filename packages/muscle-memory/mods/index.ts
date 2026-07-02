/**
 * muscle-memory — turns repeated reps into skills, and forgets the ones that don't earn their context.
 *
 * A Letta Code mod that watches your real tool-use, mines recurring workflows/fixes,
 * drafts SKILL.md playbooks (with receipts), keeps writes behind an approval gate, and runs a full
 * anti-bloat lifecycle (born-hard -> usage-tracked -> retired/merged -> capped).
 *
 * ── D1: OBSERVE ──────────────────────────────────────────────────────────────
 * tool_start  -> append a REDACTED fingerprint of every tool call to an experience log.
 * conversation_close -> write a session summary row.
 *
 * ── D2: DETECT ───────────────────────────────────────────────────────────────
 * Deterministic miner over the experience log:
 *  - command-template clustering (recurring Bash/file templates)
 *  - tool n-gram sequences (recurring multi-step workflows within a conversation)
 *  - maturity score = frequency x cross-session spread x resolved-friction (fix patterns)
 * /muscle-memory -> shows stats + the current mature skill candidates.
 *
 * Privacy/safety: does not intentionally store raw args or secret values — only a structural fingerprint,
 * a normalized command template, and a hash. Fire-and-forget; never blocks/transforms.
 *
 * Later (D3-D5): distill (fork -> draft SKILL.md to _proposed/), graduate/retire gate.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
// ── public API — intentional surface, not the whole internals. The mod entry is the default export
// (activate); `__mm` is the test surface; the rest are the few symbols the test suite imports directly.
// Everything else stays internal to its module.
export type { Row } from "./core";
export type { Defense } from "./engram";
export { detect, detectRepairChains, isSkillWorthy } from "./detect";
export { draftWithRepair } from "./gate";
export { preserveExistingFrontmatterMetadata, isAmbiguousExistingRoute, compareSkillSections } from "./autopilot";
import { GLOBAL_SKILLS, LOG_PATH, MM, MM_TAG, NEOCORTEX_BLOCK, OUTCOME_PATH, RECEIPTS_DIR, SESSIONS_PATH, STAGED_DIR, STATE_DIR, TELEMETRY_PATH, agentSkillsDir, appendJsonl, appendMeshFeed, appendUiEvent, ensureDir, hash, isManaged, listSkillNames, loadExperience, loadMeshFeed, loadRows, loadUiEvents, readSkill, readUiState, redactFragment, removeSupportFile, renderMeshFeed, scanDirs, scanSkillContent, scanSupportFile, setLivePanel, skillDesc, slug, validateSupportPath, writeSkill, writeSupportFile, writeUiState } from "./core";
import { buildCrossConversationEvidence, classifyError, commandTemplate, correlateOutcomes, detect, detectAntiPatterns, detectInvocationGotchas, detectRepairChains, detectSequences, detectTemplates, fingerprint, impactScore, inferOutcomes, isDurableLesson, isValidSkillName, maturityScore, mergeOutcomes, stepSig } from "./detect";
import { auditSkills, buildDiffFragment, candidateDescription, candidateName, crossShelfDuplicates, dedupCheck, draftSkillFromCandidate, draftWithRepair, effectivenessVerdict, findCandidate, lintSkillDraft, repairForCandidate, sotaQualityGaps } from "./gate";
import { approveStagedPublish, catalogPrivacyScan, findSimilarSkills, liveSkillVisible, publishHardBlocks, publishMetadata, publishPlan, publishSkillToCatalog, publishTier, publishVisibilityReceipt, publishabilityScore, sanitizeForPublish, stageSanitizedPublish } from "./publish";
import { Defense, ENGRAM, GuardMode, buildDefenses, buildNeocortexBlock, captureTagged, engramConsolidate, expectationFor, guardDecision, interleave, labileSkills, nativeEnabled, preActionDefense, predictionError, renderEngramDigest, replayQueue, reverseReplay, skillRetrieved, syncNeocortexBlock, tagExperience } from "./engram";
import { CURATOR, aggregateTelemetry, buildRegistry, bumpUsage, churnSignal, coverageMap, curateManagedSkills, curatorPass, isPinned, lifecycleTransition, managedSkillUsage, restoreManagedSkill, retireManagedSkill, retiredSkillBlocker, runAutonomousPrune, setPinned, skillVerbs, specDrift } from "./lifecycle";
import { AUTOPILOT_DEFAULT, AutopilotMode, REVIEW_PROMPT, autopilotPlan, buildEvidenceManifest, executeAutopilotPlan, forkAuthor, graduateStagedSkill, isHighConfidenceCreate, loadHandledReflects, managedView, pickUpdateTarget, reflectSignature, retrievePreferences, reviewAndAuthor, runAutopilot, runReflectiveReview, searchSkills, streamChunkText } from "./autopilot";
import { renderMuscleMemoryPanel, summarizeReflectActions } from "./ui";


// Test hook (deterministic validation without live data).
export const __mm = { commandTemplate, fingerprint, redactFragment, buildDiffFragment, detect, detectTemplates, detectSequences, maturityScore, MM, loadRows, dedupCheck, slug, draftSkillFromCandidate, candidateName, candidateDescription, curateManagedSkills, managedSkillUsage,
  streamChunkText, isDurableLesson, isValidSkillName, buildCrossConversationEvidence, REVIEW_PROMPT, reviewAndAuthor, searchSkills, pickUpdateTarget, runReflectiveReview, graduateStagedSkill, publishSkillToCatalog, catalogPrivacyScan, isHighConfidenceCreate, runAutonomousPrune,
  buildEvidenceManifest, retrievePreferences, coverageMap, churnSignal, summarizeReflectActions, renderMuscleMemoryPanel, loadMeshFeed, renderMeshFeed,
  buildRegistry, curatorPass, skillVerbs, specDrift, lifecycleTransition, CURATOR, setPinned, isPinned, buildDefenses, preActionDefense,
  autopilotPlan, executeAutopilotPlan, AUTOPILOT_DEFAULT, managedView, forkAuthor,
  scanSkillContent, scanSupportFile, validateSupportPath, writeSupportFile, removeSupportFile, restoreManagedSkill,
  // v2
  classifyError, mergeOutcomes, correlateOutcomes, inferOutcomes, detectInvocationGotchas, loadExperience, detectRepairChains, detectAntiPatterns, impactScore, lintSkillDraft, aggregateTelemetry, effectivenessVerdict, draftWithRepair, stepSig, sotaQualityGaps, auditSkills, crossShelfDuplicates, publishabilityScore, sanitizeForPublish, publishHardBlocks, publishPlan, publishTier, publishMetadata, findSimilarSkills, stageSanitizedPublish, approveStagedPublish, publishVisibilityReceipt, liveSkillVisible,
  // lifecycle file helpers (for end-to-end manage proof)
  writeSkill, isManaged, listSkillNames, readSkill, retireManagedSkill, agentSkillsDir, scanDirs, MM_TAG,
  // v5 ENGRAM — CLS loop core (pure)
  ENGRAM, expectationFor, predictionError, tagExperience, captureTagged, skillRetrieved, labileSkills, replayQueue, reverseReplay, interleave, engramConsolidate, renderEngramDigest,
  guardDecision, buildNeocortexBlock, nativeEnabled, NEOCORTEX_BLOCK };


export default function activate(letta: any) {
  const disposers: Array<() => void> = [];
  let panel: any = null; // v3.3 Hermes-visible panel (assigned below; referenced by event handlers)
  const DEFENSE_HITS = join(STATE_DIR, "defense-hits.jsonl");
  // Defenses are computed lazily (off the hot path): rebuilt at activate + on conversation_close.
  let defensesCache: Defense[] = [];
  const refreshDefenses = () => { try { defensesCache = buildDefenses(loadExperience()); } catch { defensesCache = []; } };
  refreshDefenses();

  // E3: ENFORCED DEFENSE OVERLAY — opt-in via MM_GUARD=ask|deny (default off). A recurring,
  // unrecovered failure muscle-memory has learned becomes a real ask/deny BEFORE the tool runs
  // (reconsolidated anti-pattern → prevention — the hook ACE/Hermes lack). Never throws; gated
  // to the approval phase so it can never interfere with execution it didn't block.
  if (typeof letta.permissions?.register === "function") {
    type GuardEvent = { toolName?: string; args?: Record<string, unknown>; phase?: string };
    disposers.push(letta.permissions.register({
      id: "muscle-memory-guard",
      description: "Ask/deny before a tool that recurs into a learned, unrecovered failure (set MM_GUARD=ask|deny).",
      check: (event: GuardEvent) => {
        try {
          const mode: GuardMode = process.env.MM_GUARD === "deny" ? "deny" : process.env.MM_GUARD === "ask" ? "ask" : "off";
          if (mode === "off" || event?.phase !== "approval") return undefined;
          const d = guardDecision(String(event?.toolName ?? ""), event?.args ?? {}, defensesCache, mode);
          return d ? { decision: d.decision, reason: d.reason } : undefined;
        } catch { return undefined; }
      },
    }));
  }

  if (letta.capabilities?.events?.tools) {
    disposers.push(letta.events.on("tool_start", (event: any) => {
      try {
        const tool = String(event?.toolName ?? "");
        if (!tool) return;
        const { fp, tmpl } = fingerprint(tool, event?.args ?? {});
        const cap = process.env.MM_CAPTURE;
        const fix = (cap === "worked" && (tool === "Edit" || tool === "Write" || tool === "fast_apply")) ? buildDiffFragment(event?.args ?? {}) : undefined;
        appendJsonl(LOG_PATH, { ts: Date.now(), conv: event?.conversationId ?? null, agent: event?.agentId ?? null, tool, fp, tmpl, h: hash(fp), id: event?.toolCallId ?? null, ...(fix ? { fix } : {}) });
        // v2 edge: Skill-usage tracking (curator) + PRE-ACTION defense (the tool_start hook Hermes lacks).
        if (tool === "Skill" && typeof event?.args?.skill === "string") bumpUsage(slug(String(event.args.skill)));
        if (defensesCache.length) {
          const hit = preActionDefense(stepSig({ tool, fp, tmpl }), defensesCache);
          if (hit && hit.severity >= 2) appendJsonl(DEFENSE_HITS, { ts: Date.now(), conv: event?.conversationId ?? null, step: hit.trigger, kind: hit.kind, errClass: hit.errClass, defense: hit.defense, severity: hit.severity });
        }
      } catch { /* best-effort */ }
      return; // OBSERVE only — never transform args
    }));

    // v2: OUTCOME CAPTURE via tool_end. Read-only on the result (never modify behavior);
    // we persist only a boolean + a REDACTED error class keyed by call id.
    try {
      disposers.push(letta.events.on("tool_end", (event: any) => {
        try {
          // Real Letta tool_end contract (src/mods/types.ts): { status:"success"|"error", output }.
          const status = String(event?.status ?? "");
          const ok = status ? status === "success" : (event?.ok ?? !(event?.isError || event?.error));
          const err = ok ? null : classifyError(event?.output ?? event?.resultText ?? event?.error ?? "", false);
          const cap = process.env.MM_CAPTURE;
          const errMsg = (!ok && (cap === "context" || cap === "worked")) ? redactFragment(event?.output ?? event?.resultText ?? event?.error ?? "", 8, 320) : undefined;
          appendJsonl(OUTCOME_PATH, { ts: Date.now(), id: event?.toolCallId ?? null, tool: event?.toolName ?? null, conv: event?.conversationId ?? null, ok, err, ...(errMsg ? { errMsg } : {}) });
        } catch { /* best-effort */ }
        return; // do NOT modify the tool result
      }));
    } catch { /* tool_end not available on this surface */ }
  }

  // v2: LLM telemetry (aggregate ONLY — never raw prompts/messages). Guarded by the llm event capability.
  if (letta.capabilities?.events?.llm) {
    const spanByConv = new Map<string, number>();
    disposers.push(letta.events.on("llm_start", (event: any) => { try { spanByConv.set(String(event?.conversationId ?? "?"), Date.now()); } catch {} }));
    disposers.push(letta.events.on("llm_end", (event: any) => {
      try {
        const started = spanByConv.get(String(event?.conversationId ?? "?")) ?? Date.now();
        const span = { tokensIn: event?.usage?.promptTokens ?? event?.tokensIn, tokensOut: event?.usage?.completionTokens ?? event?.tokensOut, ms: Date.now() - started, stop: event?.stopReason };
        let t: any = {}; try { if (existsSync(TELEMETRY_PATH)) t = JSON.parse(readFileSync(TELEMETRY_PATH, "utf8")); } catch {}
        const agg = aggregateTelemetry([span]);
        t.calls = (t.calls || 0) + agg.calls; t.tokensIn = (t.tokensIn || 0) + agg.tokensIn; t.tokensOut = (t.tokensOut || 0) + agg.tokensOut; t.ms = (t.ms || 0) + agg.ms;
        try { ensureDir(); writeFileSync(TELEMETRY_PATH, JSON.stringify(t)); } catch {}
      } catch { /* best-effort */ }
    }));
  }

  // v2: COMPACTION hooks — flush + write a tiny receipt. Guarded by the compact event capability.
  if (letta.capabilities?.events?.compact) {
    disposers.push(letta.events.on("compact_start", (event: any) => {
      try { ensureDir(); mkdirSync(RECEIPTS_DIR, { recursive: true });
        const { candidates } = detect(loadExperience());
        writeFileSync(join(RECEIPTS_DIR, `compact-${Date.now()}.json`), JSON.stringify({ phase: "start", conv: event?.conversationId ?? null, candidatesPreserved: candidates.length, ts: Date.now() }));
      } catch {}
    }));
    disposers.push(letta.events.on("compact_end", (event: any) => {
      try { ensureDir(); mkdirSync(RECEIPTS_DIR, { recursive: true });
        writeFileSync(join(RECEIPTS_DIR, `compact-end-${Date.now()}.json`), JSON.stringify({ phase: "end", conv: event?.conversationId ?? null, trigger: event?.trigger ?? null, messagesBefore: event?.messagesBefore ?? null, messagesAfter: event?.messagesAfter ?? null, contextTokensBefore: event?.contextTokensBefore ?? null, contextTokensAfter: event?.contextTokensAfter ?? null, ts: Date.now() }));
      } catch {}
    }));
  }

  if (letta.capabilities?.events?.lifecycle) {
    disposers.push(letta.events.on("conversation_close", (event: any, ctx: any) => {
      appendJsonl(SESSIONS_PATH, { ts: Date.now(), conv: event?.conversationId ?? null, agent: event?.agentId ?? null, reason: event?.reason ?? null, toolCalls: event?.toolCallCount ?? null, messages: event?.messageCount ?? null, durationMs: event?.durationMs ?? null });
      refreshDefenses(); // rebuild the pre-action defense set off the hot path
      // E3.5 NATIVE NEOCORTEX: project the consolidated skill index into the agent's core memory
      // block so it is in-context every turn (opt-in MM_NATIVE=blocks). Best-effort; never blocks close.
      if (nativeEnabled("blocks")) {
        try {
          const managed = managedView(scanDirs(ctx ?? {})).map((m) => ({ name: m.name, description: m.description }));
          void syncNeocortexBlock(letta.client, event?.agentId ?? null, buildNeocortexBlock(managed));
        } catch { /* best-effort */ }
      }
      // AUTOPILOT trigger — opt-in only (MM_AUTOPILOT=staged|auto), at session end (idle, never mid-work).
      const apMode = process.env.MM_AUTOPILOT;
      if (apMode === "staged" || apMode === "auto") { runAutopilot(ctx ?? { agentId: event?.agentId }, { ...AUTOPILOT_DEFAULT, mode: apMode }).catch(() => { /* autopilot must never break the app */ }); }
      // v3.1 REFLECTIVE REVIEW trigger — opt-in (MM_REFLECT=staged|auto): the cross-conversation
      // reviewer authors/updates a class-level skill autonomously at session end. Default OFF.
      const rfMode = process.env.MM_REFLECT;
      if (rfMode === "staged" || rfMode === "auto") {
        runReflectiveReview(ctx ?? { agentId: event?.agentId }, { mode: rfMode })
          .then(() => { runAutonomousPrune(ctx ?? { agentId: event?.agentId }, { maxRetire: 1 }); try { panel?.update(); } catch { /* */ } })
          .catch(() => { /* reflection/prune must never break the app */ });
      }
    }));
  }

  // turn_end is gated at runtime by capabilities.events.turns (NOT lifecycle) — guard it separately so the
  // in-session autonomous loop registers correctly on backends where turns and lifecycle diverge.
  if (letta.capabilities?.events?.turns) {
    // ── AUTONOMOUS DISTILLATION (Hermes-style background review) ──────────────────────────────────
    // conversation_close (above) only fires at SESSION END. Hermes also nudges DURING a session
    // ("periodic nudge ... fires without user input"). Mirror that: after EACH turn, cheaply check
    // whether a mature, not-yet-distilled cross-session pattern has emerged — if so, distill it ON OUR
    // OWN, with no user command. The maturity gate (≥2 durable signals) + signature dedup mean it fires
    // exactly once per newly-matured pattern, never every turn. Opt-in (MM_REFLECT=staged|auto); runs in
    // the background (fire-and-forget) so it never blocks a turn. THIS is what makes it truly autonomous.
    let autoReflectInFlight = false;
    disposers.push(letta.events.on("turn_end", (event: any, ctx: any) => {
      const rfMode = process.env.MM_REFLECT;
      if ((rfMode !== "staged" && rfMode !== "auto") || autoReflectInFlight) return;
      try {
        const ev = buildCrossConversationEvidence(loadExperience());
        if (ev.items < 2 || loadHandledReflects()[reflectSignature(ev)]) return; // nothing new + mature → stay quiet
      } catch { return; }
      autoReflectInFlight = true;
      runReflectiveReview(ctx ?? { agentId: event?.agentId }, { mode: rfMode })
        .then(() => { runAutonomousPrune(ctx ?? { agentId: event?.agentId }, { maxRetire: 1 }); try { panel?.update(); } catch { /* */ } })
        .catch(() => { /* reflection must never break the app */ })
        .finally(() => { autoReflectInFlight = false; });
    }));
  }

  // v3.3 HERMES-VISIBLE PANEL — a compact self-improvement summary around the input bar (the supported
  // mod UI surface). Cheap, churn-free render (reads a small JSON); updates on reflect + a slow interval.
  if (letta.capabilities?.ui?.panels && letta.ui?.openPanel) {
    try {
      panel = letta.ui.openPanel({ id: "muscle-memory-live", order: 20, render: () => { try { return renderMuscleMemoryPanel(readUiState()); } catch { return []; } } });
      setLivePanel(panel); // enable LIVE re-render on every state change
      // SELF-HEAL on (re)load: a reflect cannot survive a reload, so any transient phase persisted here
      // is necessarily stale (interrupted mid-author). Reset it to idle so the panel never opens stuck on
      // "✍️ writing skill…" (the hour-long freeze Adrian hit 2026-06-27). Then repaint immediately.
      try { const s = readUiState(); if (s && s.phase && s.phase !== "done") writeUiState({ phase: "idle", last: "ready", route: "" }); } catch { /* */ }
      const t = setInterval(() => { try { panel?.update(); } catch { /* */ } }, 20_000);
      disposers.push(() => { clearInterval(t); try { panel?.close(); } catch { /* */ } });
    } catch { /* UI optional */ }
  }

  if (letta.capabilities?.commands) {
    disposers.push(letta.commands.register({
      id: "muscle-memory",
      description: "Show muscle-memory observations + current mature skill candidates",
      async run(ctx: any = {}) {
        const argv = Array.isArray(ctx?.argv) ? ctx.argv : String(ctx?.args || "").trim().split(/\s+/).filter(Boolean);
        const sub = String(argv?.[0] || "").toLowerCase();
        if (sub === "events") {
          const n = Math.max(1, Math.min(50, Number(argv?.[1] || 8) || 8));
          const events = loadUiEvents(n);
          const lines = events.map((e) => `💾 muscle-memory review: ${e.summary}`);
          return { type: "output", output: lines.join("\n") || "(no muscle-memory review events yet)" };
        }
        if (sub === "squad") {
          const feed = loadMeshFeed(10);
          return { type: "output", output: feed.length ? "💾 squad distillations (cross-agent):\n" + renderMeshFeed(feed).map((l) => `  ${l}`).join("\n") : "(no squad distillations yet — Mack + Kev appear here as they distill)" };
        }
        if (sub === "staged") {
          let s: string[] = []; try { s = existsSync(STAGED_DIR) ? readdirSync(STAGED_DIR).filter((n) => existsSync(join(STAGED_DIR, n, "SKILL.md"))) : []; } catch { /* */ }
          return { type: "output", output: s.length ? "staged skills (1-tap to graduate):\n" + s.map((n) => `  · ${n}`).join("\n") : "(no staged skills yet — set MM_REFLECT=staged, work a few sessions)" };
        }
        if (sub === "coverage") {
          const cov = coverageMap(loadExperience(), scanDirs(ctx));
          const icon = (st: string) => st === "covered" ? "✓" : st === "uncovered" ? "＋" : st === "over-covered" ? "⧉" : "✗";
          return { type: "output", output: cov.length ? cov.map((c) => `${icon(c.status)} [${c.status}] ${c.domain}${c.skill ? ` → ${c.skill}` : ""}`).join("\n") : "(no durable task-classes yet)" };
        }
        if (sub === "audit") {
          // LIBRARY-WIDE SOTA AUDIT (read-only): score EVERY skill (installed/hand-authored/distilled),
          // not just mm's own — the gate is a pure function. Flags sub-SOTA skills + their exact gaps.
          const dirs = scanDirs(ctx);
          const entries: Array<{ name: string; shelf: string; body: string; description: string }> = [];
          for (const d of dirs) { const shelf = d === GLOBAL_SKILLS ? "global" : "agent"; for (const n of listSkillNames(d)) { try { entries.push({ name: n, shelf, body: readSkill(d, n), description: skillDesc(d, n) }); } catch { /* */ } } }
          const seen = new Set<string>(); const skills: Array<{ name: string; description: string; body: string }> = [];
          for (const e of entries) { if (seen.has(e.name)) continue; seen.add(e.name); skills.push({ name: e.name, description: e.description, body: e.body }); }
          const r = auditSkills(skills);
          const dups = crossShelfDuplicates(entries).filter((x) => x.divergent);
          const pct = r.total ? Math.round((100 * r.clean) / r.total) : 0;
          const gapline = Object.entries(r.gapCounts).sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g} ×${c}`).join("  ") || "—";
          const top = r.flagged.slice(0, 20).map((f) => `  ⚠ ${f.name.slice(0, 46).padEnd(48)} ${f.gaps.map((g) => g.split(":")[0]).join(", ")}`).join("\n");
          const dupline = dups.length ? `\n⧉ cross-shelf duplicates (consolidate — stale copy diverging): ${dups.map((x) => `${x.name} [${x.shelves.join("+")}]`).join(", ")}` : "";
          return { type: "output", output: `🏅 SOTA library audit — ${r.total} skills · ${r.clean} top-tier (${pct}%) · ${r.flagged.length} to upgrade${dups.length ? ` · ${dups.length} dup` : ""}\ngaps: ${gapline}\n${top}${r.flagged.length > 20 ? `\n  …and ${r.flagged.length - 20} more` : ""}${dupline}` };
        }
        if (sub === "publish") {
          // SUPPLY CHAIN: preflight (default) → stage (sanitized review copy) → approve (publish to Custom
          // Skills). NEVER auto-publishes; sanitizes identifiers only; dedup-aware; tiered.
          const v1 = String(argv?.[1] || "").toLowerCase();
          const action = (v1 === "stage" || v1 === "approve") ? v1 : "preflight";
          const target = String((action === "preflight" ? argv?.[1] : argv?.[2]) || "").trim();
          if (!target) return { type: "output", output: "usage: /muscle-memory publish <skill> | publish stage <skill> | publish approve <skill>  (never auto-publishes)" };
          const dirs = scanDirs(ctx); let found: { dir: string; name: string } | null = null;
          for (const d of dirs) for (const n of listSkillNames(d)) if (n.toLowerCase() === target.toLowerCase()) { found = { dir: d, name: n }; break; }
          if (action === "approve") {
            const res = approveStagedPublish(target, GLOBAL_SKILLS);
            if (!res.published) return { type: "output", output: `🚫 not published — ${res.reason}` };
            try { appendUiEvent({ phase: "skill_published", summary: `published '${target}' to Custom Skills`, skill: target, action: "publish" }); appendMeshFeed({ type: "skill_published", skill: target, route: "PUBLISH", signals: 0 }); } catch { /* */ }
            const vis = publishVisibilityReceipt(target, GLOBAL_SKILLS);
            const live = liveSkillVisible(slug(target), ctx?.agent?.id || ctx?.agentId);
            return { type: "output", output: `✅ published — ${res.path}\n  on disk: ${vis.exists ? "yes ✓" : "NO ❌"}\n  live index: ${live.checked ? (live.visible ? "✓ visible to the agent now" : "not loaded yet") : "not queried"}  ·  ${live.note}` };
          }
          if (!found) return { type: "output", output: `skill "${target}" not found (try /muscle-memory audit to list)` };
          const skill = { name: found.name, description: skillDesc(found.dir, found.name), body: readSkill(found.dir, found.name), shelf: "agent" };
          const plan = publishPlan(skill); const tier = publishTier(plan);
          const existing = listSkillNames(GLOBAL_SKILLS).filter((n) => n !== found!.name).map((n) => ({ name: n, description: skillDesc(GLOBAL_SKILLS, n) }));
          const dups = findSimilarSkills(found.name, skill.description, existing);
          if (action === "stage") {
            const st = stageSanitizedPublish(skill);
            if (!st.staged) return { type: "output", output: `🚫 not staged — ${st.reason}` };
            try { appendUiEvent({ phase: "skill_publish_staged", summary: `staged '${found.name}' (tier=${st.tier}, ${plan.publishability}/100)`, skill: found.name, action: "stage" }); } catch { /* */ }
            const dupline = dups.length ? `\n⚠ similar Custom Skills: ${dups.map((d) => `${d.name} (${d.why})`).join("; ")}` : "";
            return { type: "output", output: `📦 staged SANITIZED publish — ${found.name}\n  ${st.dir}/SKILL.md  +  PUBLISH-PLAN.json\n  tier: ${st.tier}  ·  publishability ${plan.publishability}/100${dupline}\n  next: review the sanitized SKILL.md, then \`/muscle-memory publish approve ${found.name}\`` };
          }
          try { appendUiEvent({ phase: "skill_publish_preflight", summary: `${plan.skill}: ${plan.publishability}/100 · tier=${tier} · ${plan.recommended}`, skill: found.name }); } catch { /* */ }
          const blocks = plan.hardBlocks.length ? `\n🚫 HARD BLOCKS (never publish): ${plan.hardBlocks.join("; ")}` : "";
          const issues = plan.issues.length ? plan.issues.map((i) => `  - [${i.axis}] ${i.detail}`).join("\n") : "  (none)";
          const reps = plan.replacements.length ? `\nsanitize: ${plan.replacements.map((r) => `${r.from.slice(0, 22)} → ${r.to}`).join(", ")}` : "";
          const dupline = dups.length ? `\n⚠ similar Custom Skills (consider merge/update): ${dups.map((d) => d.name).join(", ")}` : "";
          const act = plan.recommended === "publish" ? "✅ publish as-is (clean)" : plan.recommended === "stage-sanitized" ? "📦 stage SANITIZED (run `publish stage`)" : "🚫 block";
          return { type: "output", output: `🚢 publish preflight — ${plan.skill}\n  ${plan.currentShelf} → ${plan.recommendedShelf}  ·  tier: ${tier}  ·  publishability ${plan.publishability}/100  ·  ${act}${blocks}\nissues:\n${issues}${reps}${dupline}\n(dry-run — nothing published.)` };
        }
        if (sub === "engram") {
          // The CLS loop, observable (read-only): salience-ranked replay + reverse-replay credit +
          // synaptic rescue + labile (reconsolidation) skills — the prioritized "dream".
          const dirs = scanDirs(ctx);
          const plan = engramConsolidate(loadExperience(), managedView(dirs).map((m) => ({ name: m.name, body: m.body })));
          const head = `🧠 ENGRAM (CLS loop) · hippocampus ${plan.hippoSize} reps · ${plan.replay.length} replay · ${plan.rescued.length} rescued · ${plan.labile.length} labile`;
          return { type: "output", output: `${head}\n\n${plan.digest}` };
        }
        if (sub === "lifecycle" || sub === "skills") {
          // The whole cycle, read-only: creation (staged) → use (earning) → idle (prune candidates) → retired (reversible).
          const dirs = scanDirs(ctx);
          const reg = buildRegistry(dirs);
          let staged: string[] = []; try { staged = existsSync(STAGED_DIR) ? readdirSync(STAGED_DIR).filter((n) => existsSync(join(STAGED_DIR, n, "SKILL.md"))) : []; } catch { /* */ }
          const used = reg.skills.filter((s) => s.uses > 0);
          const idle = reg.skills.filter((s) => s.uses === 0 && s.state !== "archived");
          const archived = reg.skills.filter((s) => s.state === "archived");
          const L = ["💾 muscle-memory · skill lifecycle (creation → use → prune)"];
          L.push(`\n🌱 staged · 1-tap to graduate (${staged.length})`); staged.slice(0, 8).forEach((n) => L.push(`   · ${n}`));
          L.push(`\n✅ active · earning context (${used.length})`); used.slice(0, 10).forEach((s) => L.push(`   · ${s.name} — ${s.uses} uses${s.pinned ? " 📌" : ""}`));
          L.push(`\n💤 idle · prune candidates (${idle.length})`); idle.slice(0, 10).forEach((s) => L.push(`   · ${s.name}${s.pinned ? " 📌 pinned (protected)" : " — retires after 30d unused (reversible)"}`));
          if (archived.length) { L.push(`\n🗄 retired · reversible quarantine (${archived.length})`); archived.slice(0, 6).forEach((s) => L.push(`   · ${s.name}${s.absorbedInto ? ` → absorbed into ${s.absorbedInto}` : ""}`)); }
          return { type: "output", output: L.join("\n") };
        }
        const rows = loadExperience();
        const byTool: Record<string, number> = {};
        for (const r of rows) byTool[r.tool] = (byTool[r.tool] || 0) + 1;
        const { candidates, templates, sequences } = detect(rows);
        const toolLine = Object.entries(byTool).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  ");
        const cand = candidates.slice(0, 6).map((c) => `  [${c.maturity}] ${c.kind} ×${c.count}/${c.convs}conv${c.fixes ? ` (${c.fixes} fixes)` : ""}  ${c.key.slice(0, 90)}`).join("\n");
        // v3.3 dashboard: reflect mode + recent Hermes-style review summary + library counts
        const mode = process.env.MM_REFLECT === "auto" ? "auto" : process.env.MM_REFLECT === "staged" ? "staged" : "off (set MM_REFLECT=staged to enable)";
        const events = loadUiEvents(8);
        const lastReview = events.length ? summarizeReflectActions(events) : "(no review yet)";
        let managed = 0, staged = 0;
        try { for (const d of scanDirs(ctx)) for (const n of listSkillNames(d)) if (isManaged(d, n)) managed++; } catch { /* */ }
        try { staged = existsSync(STAGED_DIR) ? readdirSync(STAGED_DIR).filter((n) => existsSync(join(STAGED_DIR, n, "SKILL.md"))).length : 0; } catch { /* */ }
        const cov = (() => { try { const c = coverageMap(rows, scanDirs(ctx)); return `${c.filter((x) => x.status === "covered").length} covered / ${c.filter((x) => x.status === "uncovered").length} uncovered / ${c.filter((x) => x.status === "over-covered").length} over-covered`; } catch { return "n/a"; } })();
        const out = [
          `💾 muscle-memory · reflect ${mode}`,
          `last review: ${lastReview}`,
          `library: ${managed} managed · ${staged} staged · coverage ${cov}`,
          ``,
          `recent review events:`,
          events.slice(-5).map((e) => `  · ${e.summary}`).join("\n") || `  (none yet — set MM_REFLECT=staged, work a few sessions)`,
          ...(() => { const feed = loadMeshFeed(4); return feed.length ? [``, `squad distillations (cross-agent):`, ...renderMeshFeed(feed).map((l) => `  ${l}`)] : []; })(),
          ``,
          `${rows.length} reps observed${toolLine ? ` · tools ${toolLine}` : ""}`,
          `mature candidates: ${candidates.length} (${templates.length} templates, ${sequences.length} sequences)`,
          cand || `  (none mature yet — need ≥${MM.MIN_COUNT}× across ≥${MM.MIN_CONVS} conversations)`,
          ``,
          `commands: /muscle-memory [lifecycle|staged|coverage|engram|events|squad]`,
        ].join("\n");
        return { type: "output", output: out };
      },
    }));
  }

  // D3: skill lifecycle management (read actions stay smooth; mutating actions are approval-gated).
  if (letta.capabilities?.tools) {
    const readParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["candidates", "draft", "load", "list", "curate", "repairs", "antipatterns", "defenses", "defense_hits", "registry", "autopilot_plan", "reflect_plan", "coverage"], description: "read-only operation to perform" },
        name: { type: "string", description: "skill name — for load" },
        candidate_key: { type: "string", description: "candidate key or substring to draft; defaults to top mature candidate" },
        mode: { type: "string", enum: ["staged", "auto"], description: "autopilot mode preview — for autopilot_plan" },
      },
      required: ["action"],
      additionalProperties: false,
    };
    const writeParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_from_candidate", "create", "patch", "edit_full", "write_file", "remove_file", "retire", "restore", "pin", "unpin", "autopilot_run", "reflect", "graduate"], description: "mutating operation to perform" },
        mode: { type: "string", enum: ["staged", "auto"], description: "autopilot mode — for autopilot_run (staged=draft+1-tap, auto=graduate-on-gate)" },
        name: { type: "string", description: "skill name (gerund, lowercase-hyphen) — for create/patch/retire" },
        description: { type: "string", description: "skill description incl. trigger phrases — for create" },
        body: { type: "string", description: "SKILL.md markdown body — for create" },
        old: { type: "string", description: "exact text to replace — for patch" },
        replacement: { type: "string", description: "replacement text — for patch" },
        candidate_key: { type: "string", description: "candidate key or substring to create from; defaults to top mature candidate" },
        reason: { type: "string", description: "reason for retirement/quarantine — for retire" },
        absorbed_into: { type: "string", description: "umbrella skill name this was merged into — for retire (consolidation vs prune)" },
        file_path: { type: "string", description: "support file path under references/templates/scripts/assets — for write_file/remove_file" },
        file_content: { type: "string", description: "support file content — for write_file" },
      },
      required: ["action"],
      additionalProperties: false,
    };

    const readRun = async (ctx: any) => {
      const a = ctx?.args || {};
      const dirs = scanDirs(ctx);
      const findSkillDir = (name: string) => dirs.find((d) => existsSync(join(d, name, "SKILL.md")));
      try {
        if (a.action === "candidates") {
          const rows = loadExperience();
          const { candidates } = detect(rows);
          return candidates.slice(0, 10).map((c) => `[impact ${impactScore(c).score} | mat ${c.maturity}] ${c.kind} ×${c.count}/${c.convs}conv${c.fixes ? ` (${c.fixes}fix)` : ""}  ${c.key}`).join("\n") || "(no mature candidates yet — keep working)";
        }
        if (a.action === "repairs") {
          const rs = detectRepairChains(loadExperience());
          return rs.slice(0, 10).map((r) => `×${r.count}/${r.convs}conv  FAIL[${r.trigger}] (${r.errClass}) → ${r.fixStep} → PASS`).join("\n") || "(no repair chains observed yet)";
        }
        if (a.action === "antipatterns") {
          const aps = detectAntiPatterns(loadExperience());
          return aps.slice(0, 10).map((p) => `×${p.fails}fails/${p.convs}conv  AVOID[${p.step}] — ${p.errClass}`).join("\n") || "(no recurring unrecovered failures observed)";
        }
        if (a.action === "defenses") {
          // The failure-defense set Hermes lacks: [trigger → error → consequence → defense].
          const ds = buildDefenses(loadExperience());
          return ds.slice(0, 12).map((d) => `[sev${d.severity} ${d.kind}] ${d.trigger} → ${d.errClass} ⇒ ${d.defense}`).join("\n") || "(no defenses learned yet)";
        }
        if (a.action === "defense_hits") {
          // Advisory pre-action defense receipts recorded at tool_start (read-only; no enforcement).
          const hits: any[] = [];
          if (existsSync(DEFENSE_HITS)) for (const l of readFileSync(DEFENSE_HITS, "utf8").trim().split("\n").slice(-20)) { if (l) try { hits.push(JSON.parse(l)); } catch { /* */ } }
          return hits.length ? hits.map((h) => `[sev${h.severity} ${h.kind}] ${h.step} → ${h.errClass} ⇒ ${h.defense}`).join("\n") : "(no pre-action defense hits recorded)";
        }
        if (a.action === "registry") {
          const reg = buildRegistry(dirs);
          return reg.count ? `${reg.count} managed skills:\n` + reg.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n") : "(registry empty)";
        }
        if (a.action === "autopilot_plan") {
          // DRY-RUN preview of the self-driving loop — no writes.
          const rows = loadExperience();
          const plan = autopilotPlan({ rows, managed: managedView(dirs), dirsForDedup: dirs, config: { ...AUTOPILOT_DEFAULT, mode: a.mode === "auto" ? "auto" : "staged" } });
          const lines = plan.decisions.map((d) => d.op === "distill" ? `  DISTILL ${d.name} [${d.gate}] — ${d.reason}` : d.op === "refine" ? `  REFINE ${d.skill} — ${d.reason}` : `  RETIRE ${d.skill} — ${d.reason}`);
          return `autopilot mode=${plan.mode} budget=${plan.budget.used}/${plan.budget.limit}\n${lines.join("\n") || "  (no decisions)"}\nskipped: ${plan.skipped.length}`;
        }
        if (a.action === "reflect_plan") {
          // v3.1 DRY-RUN: show the cross-conversation evidence + the MemFS update-first routing (no model call, no write).
          const ev = buildCrossConversationEvidence(loadExperience());
          const top = searchSkills([...dirs, STAGED_DIR], ev.digest, 3);
          const tgt = pickUpdateTarget(top, 18);
          const route = tgt ? `UPDATE-FIRST → "${tgt.name}" (score ${tgt.score}, ${tgt.matched} distinctive terms, dominant)` : "CREATE (no existing skill safely covers this — matches too weak/ambiguous/tied)";
          return `reflective review preview — ${ev.convs} sessions, ${ev.items} durable signals\nrouting: ${route}\ntop matches: ${top.map((t) => `${t.name}(s${t.score}/m${t.matched})`).join(", ") || "none"}\n\n${ev.digest.slice(0, 700)}`;
        }
        if (a.action === "coverage") {
          // SKILL COVERAGE MAP: which task-classes have a defender, which are uncovered, which are over-covered.
          const cov = coverageMap(loadExperience(), dirs);
          if (!cov.length) return "(no durable task-classes observed yet)";
          const icon = (s: string) => s === "covered" ? "✓" : s === "uncovered" ? "＋" : s === "over-covered" ? "⧉" : "✗";
          return cov.map((c) => `${icon(c.status)} [${c.status}] ${c.domain}${c.skill ? ` → ${c.skill}` : ""} (${c.signals} signals)`).join("\n");
        }
        if (a.action === "list") {
          const managed: string[] = [];
          for (const d of dirs) for (const n of listSkillNames(d)) if (isManaged(d, n)) managed.push(`- ${n}: ${skillDesc(d, n)}`);
          return managed.length ? managed.join("\n") : "(no muscle-memory-managed skills yet — use muscle_memory_skill_write action:create)";
        }
        if (a.action === "curate") {
          const rows = curateManagedSkills(ctx);
          if (!rows.length) return "(no muscle-memory-managed skills yet — create one first)";
          return rows.map((r) => `${r.verdict.toUpperCase()} uses=${r.uses} ${r.name} — ${r.reason}`).join("\n");
        }
        if (a.action === "load") {
          if (!a.name) return { status: "error", content: "name required" };
          const d = findSkillDir(a.name);
          if (!d) return { status: "error", content: `no skill '${a.name}'` };
          return readSkill(d, a.name);
        }
        if (a.action === "draft") {
          const c = findCandidate(a.candidate_key);
          if (!c) return { status: "error", content: "no matching mature candidate — run action:candidates first or keep working" };
          const repair = repairForCandidate(c);
          const d = draftWithRepair(c, repair);
          const lint = lintSkillDraft(d, { needsPitfalls: !!c.fixes });
          return { candidate: c, ...d, repair: repair ?? null, lint, content: `---\nname: ${d.name}\ndescription: ${d.description}\n---\n\n${d.body}` };
        }
        return { status: "error", content: "unknown read action" };
      } catch (e: any) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };

    const writeRun = async (ctx: any) => {
      const a = ctx?.args || {};
      const dir = agentSkillsDir(ctx);
      const dirs = scanDirs(ctx);
      const findSkillDir = (name: string) => dirs.find((d) => existsSync(join(d, name, "SKILL.md")));
      try {
        if (a.action === "autopilot_run") {
          const cfg = { ...AUTOPILOT_DEFAULT, mode: (a.mode === "auto" ? "auto" : "staged") as AutopilotMode };
          const r = await runAutopilot(ctx, cfg);
          const res = r.result || { graduated: [], staged: [], refined: [], retired: [] };
          return `autopilot ${cfg.mode}: graduated ${res.graduated.length} ${JSON.stringify(res.graduated)}, staged ${res.staged.length}, refined ${res.refined.length} ${JSON.stringify(res.refined)}, retired ${res.retired.length} ${JSON.stringify(res.retired)}. budget ${r.budget.used + res.graduated.length + res.staged.length}/${r.budget.limit}.`;
        }
        if (a.action === "reflect") {
          // v3.1 reflective review: cross-conversation evidence → forked reviewer → update-first + gates → write.
          const r = await runReflectiveReview(ctx, { mode: a.mode === "auto" ? "auto" : "staged" });
          if (r.action === "none" || r.action === "reject") return `reflect: ${r.action} — ${r.reason || ""}`;
          const graduated = !!r.wrote && !String(r.wrote).startsWith(STAGED_DIR);
          return `reflect: ${r.action} skill "${r.name}"${r.updateTarget ? ` (updated existing — anti-bloat)` : ""}${graduated ? " (graduated)" : ""} → ${r.wrote || "(write failed)"}`;
        }
        if (a.action === "graduate") {
          if (!a.name) return { status: "error", content: "name required" };
          const p = graduateStagedSkill(String(a.name), ctx);
          return `graduated '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "pin") {
          if (!a.name) return { status: "error", content: "name required" };
          setPinned(slug(a.name), true);
          return `pinned '${slug(a.name)}' — protected from auto-retire/consolidation (patches still allowed)`;
        }
        if (a.action === "unpin") {
          if (!a.name) return { status: "error", content: "name required" };
          setPinned(slug(a.name), false);
          return `unpinned '${slug(a.name)}'`;
        }
        if (a.action === "retire") {
          if (!a.name) return { status: "error", content: "name required" };
          const target = retireManagedSkill(slug(a.name), String(a.reason || "retired by muscle-memory"), ctx, a.absorbed_into ? slug(a.absorbed_into) : undefined);
          return `retired '${slug(a.name)}'${a.absorbed_into ? ` (absorbed into ${slug(a.absorbed_into)})` : ""} -> ${target} (reversible quarantine)`;
        }
        if (a.action === "create_from_candidate") {
          const c = findCandidate(a.candidate_key);
          if (!c) return { status: "error", content: "no matching mature candidate — run muscle_memory_skill_read action:candidates first or keep working" };
          const repair = repairForCandidate(c);
          const d = draftWithRepair(c, repair);
          const nm = slug(a.name || d.name);
          const retiredBlock = retiredSkillBlocker(nm, ctx);
          if (retiredBlock) return { status: "error", content: `retire-sticky blocked: ${retiredBlock}`, candidate: c };
          const desc = String(a.description || d.description);
          const dc = dedupCheck(nm, desc, dirs);
          if (dc.dup) return { status: "error", content: `anti-bloat blocked: ${dc.reason}. Use action:patch on '${dc.name}' instead.`, candidate: c };
          const lint = lintSkillDraft({ name: nm, description: desc, body: d.body }, { needsPitfalls: !!c.fixes });
          if (!lint.ok) return { status: "error", content: `authoring-linter blocked: ${lint.issues.join("; ")}`, candidate: c };
          const secC = scanSkillContent(d.body); if (!secC.ok) return { status: "error", content: `security blocked: ${secC.issues.join("; ")}`, candidate: c };
          const prov = `\n<!-- ${MM_TAG}: distilled ${new Date().toISOString().slice(0, 10)}; candidate=${c.kind}:${c.key}; reps=${c.count}; convs=${c.convs}; fixes=${c.fixes}; impact=${impactScore(c).score} -->\n`;
          const content = `---\nname: ${nm}\ndescription: ${desc}\n---\n\n${d.body}${prov}\n`;
          const p = writeSkill(dir, nm, content);
          return `created '${nm}' from candidate '${c.key}'${repair ? ` (w/ observed Pitfall: ${repair.errClass})` : ""} -> ${p}\nLoad with muscle_memory_skill_read action:load, then invoke the normal Skill tool with skill="${nm}". Dedup max overlap ${Math.round(dc.overlap * 100)}% (${dc.name || "none"}); lint OK.`;
        }
        if (a.action === "create") {
          if (!a.name || !a.description || !a.body) return { status: "error", content: "need name, description, body" };
          const nm = slug(a.name);
          const retiredBlock = retiredSkillBlocker(nm, ctx);
          if (retiredBlock) return { status: "error", content: `retire-sticky blocked: ${retiredBlock}` };
          const dc = dedupCheck(nm, a.description, dirs);
          if (dc.dup) return { status: "error", content: `anti-bloat blocked: ${dc.reason}. Use action:patch on '${dc.name}' instead.` };
          const lint = lintSkillDraft({ name: nm, description: a.description, body: a.body });
          if (!lint.ok) return { status: "error", content: `authoring-linter blocked: ${lint.issues.join("; ")}` };
          const sec0 = scanSkillContent(a.body); if (!sec0.ok) return { status: "error", content: `security blocked: ${sec0.issues.join("; ")}` };
          const prov = `\n<!-- ${MM_TAG}: distilled ${new Date().toISOString().slice(0, 10)} -->\n`;
          const body = a.body.includes(MM_TAG) ? a.body : a.body + prov;
          const content = `---\nname: ${nm}\ndescription: ${a.description}\n---\n\n${body}\n`;
          const p = writeSkill(dir, nm, content);
          return `created '${nm}' -> ${p}\nLoad with muscle_memory_skill_read action:load, then invoke the normal Skill tool with skill="${nm}" when you want to use it. Dedup max overlap ${Math.round(dc.overlap * 100)}% (${dc.name || "none"}).`;
        }
        if (a.action === "patch") {
          if (!a.name || a.old == null || a.replacement == null) return { status: "error", content: "need name, old, replacement" };
          const d = findSkillDir(a.name);
          if (!d) return { status: "error", content: `no skill '${a.name}'` };
          const t = readSkill(d, a.name);
          if (!t.includes(a.old)) return { status: "error", content: "old text not found in skill" };
          const nt = t.replace(a.old, a.replacement);
          const secP = scanSkillContent(nt); if (!secP.ok) return { status: "error", content: `security blocked: ${secP.issues.join("; ")}` };
          writeSkill(d, a.name, nt); // pinned skills allow patch (Hermes: pin guards delete, not edit)
          return `patched '${a.name}' in ${d}`;
        }
        if (a.action === "edit_full") {
          if (!a.name || !a.body) return { status: "error", content: "need name, body (full SKILL.md)" };
          const d = findSkillDir(a.name); if (!d) return { status: "error", content: `no skill '${a.name}'` };
          const desc = (a.body.match(/description:\s*(.+)/)?.[1] || a.description || "").trim();
          const lint = lintSkillDraft({ name: slug(a.name), description: desc, body: a.body }); if (!lint.ok) return { status: "error", content: `linter blocked: ${lint.issues.join("; ")}` };
          const sec = scanSkillContent(a.body); if (!sec.ok) return { status: "error", content: `security blocked: ${sec.issues.join("; ")}` };
          writeSkill(d, a.name, a.body.includes(MM_TAG) ? a.body : a.body + `\n<!-- ${MM_TAG}: edited ${new Date().toISOString().slice(0, 10)} -->\n`);
          return `full-rewrote '${a.name}'`;
        }
        if (a.action === "write_file") {
          if (!a.name || !a.file_path || a.file_content == null) return { status: "error", content: "need name, file_path, file_content" };
          const full = writeSupportFile(slug(a.name), String(a.file_path), String(a.file_content), ctx);
          return `wrote support file ${a.file_path} -> ${full}`;
        }
        if (a.action === "remove_file") {
          if (!a.name || !a.file_path) return { status: "error", content: "need name, file_path" };
          const grave = removeSupportFile(slug(a.name), String(a.file_path), ctx);
          return `removed ${a.file_path} (reversible quarantine -> ${grave})`;
        }
        if (a.action === "restore") {
          if (!a.name) return { status: "error", content: "name required" };
          const p = restoreManagedSkill(slug(a.name), ctx);
          return `restored '${slug(a.name)}' -> ${p}`;
        }
        return { status: "error", content: "unknown write action" };
      } catch (e: any) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };

    const lifecycleParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["reflect", "graduate", "publish", "prune"], description: "Safe no-approval lifecycle action" },
        mode: { type: "string", enum: ["staged", "auto"], description: "reflect mode; staged still auto-graduates trusted updates/high-confidence creates" },
        name: { type: "string", description: "staged skill name — for graduate" }
      },
      required: ["action"]
    };

    const lifecycleRun = async (ctx: any) => {
      const a = ctx?.args || {};
      try {
        if (a.action === "reflect") {
          const r = await runReflectiveReview(ctx, { mode: a.mode === "auto" ? "auto" : "staged" });
          if (r.action === "none" || r.action === "reject") return `reflect: ${r.action} — ${r.reason || ""}`;
          const graduated = !!r.wrote && !String(r.wrote).startsWith(STAGED_DIR);
          return `reflect: ${r.action} skill "${r.name}"${r.updateTarget ? ` (updated existing — anti-bloat)` : ""}${graduated ? " (graduated)" : ""} → ${r.wrote || "(write failed)"}`;
        }
        if (a.action === "graduate") {
          if (!a.name) return { status: "error", content: "name required" };
          const p = graduateStagedSkill(String(a.name), ctx);
          return `graduated '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "publish") {
          if (!a.name) return { status: "error", content: "name required" };
          const p = publishSkillToCatalog(String(a.name), ctx);
          return `published '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "prune") {
          const r = runAutonomousPrune(ctx, { maxRetire: 1 });
          return `prune: retired ${r.retired.length} ${JSON.stringify(r.retired)}, flagged ${r.flagged.length}, kept ${r.kept.length}`;
        }
        return { status: "error", content: "unknown lifecycle action" };
      } catch (e: any) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };

    disposers.push(letta.tools.register({
      name: "muscle_memory_skill_read",
      description: "muscle-memory = self-improving skills distilled from your own work. Read-only inspection (no approval, no writes). START HERE with action:reflect_plan — it previews the class-level skill it would distill from your cross-session history + the update-first routing (which existing skill it would create or patch). Also: coverage (skill-gap map), candidates/registry/curate (what it has observed + manages), list/load (inspect a managed skill). Run before any write.",
      parameters: readParams,
      requiresApproval: false,
      async run(ctx: any) { return readRun(ctx); },
    }));

    disposers.push(letta.tools.register({
      name: "muscle_memory_skill_write",
      description: "muscle-memory writes (approval-gated, reversible). THE CORE LOOP: action:reflect distills a class-level skill from your cross-conversation work → update-first anti-bloat, security/lint-gated, staged by default. graduate promotes a staged skill to your active skill shelf. Plus create/patch/edit_full/retire/restore/pin lifecycle + write_file for support files. Preview first with reflect_plan (the read tool). For no-approval reflect/graduate/publish/prune, use muscle_memory_lifecycle_run.",
      parameters: writeParams,
      requiresApproval: true,
      async run(ctx: any) { return writeRun(ctx); },
    }));

    disposers.push(letta.tools.register({
      name: "muscle_memory_lifecycle_run",
      description: "muscle-memory autonomous lifecycle (no-approval, safe, reversible): reflect (distill a skill from your work), graduate (promote a staged skill → active shelf), publish (mirror a skill → shared Custom Skills catalog), prune (retire stale/unused skills). This is the full self-improvement loop. Broad/manual skill edits → muscle_memory_skill_write; preview → reflect_plan in muscle_memory_skill_read.",
      parameters: lifecycleParams,
      requiresApproval: false,
      async run(ctx: any) { return lifecycleRun(ctx); },
    }));
  }

  return () => { for (const d of disposers.reverse()) d(); };
}
