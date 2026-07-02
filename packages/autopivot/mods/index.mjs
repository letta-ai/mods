// index.mjs
import { homedir as homedir2 } from "node:os";
import { join as join2, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// lib/config.mjs
var DEFAULT_SIGNIFIERS = {
  online: { glyph: "\u25CF", color: "green", text: "online" },
  // standard green (greenBright is pale)
  unknown: { glyph: "\u25CC", color: "gray", text: "checking" },
  checking: { glyph: "\u25CC", color: "yellowBright", text: "checking" },
  // retry/reconnect window
  forced: { glyph: "\u25CF", color: "yellowBright", text: "forced" },
  // generic fallback
  forcedOnline: { glyph: "\u25CF", color: "yellowBright", text: "forced online" },
  forcedOffline: { glyph: "\u2298", color: "#FFA500", text: "forced offline", bold: true },
  // slashed dot, orange, bold
  noneReachable: { glyph: "\u2297", color: "redBright", text: "no model", bold: true },
  // nothing reachable (Phase 2 stranding guard)
  suspended: { glyph: "\u2691", color: "yellow", text: "on fallback", bold: false },
  // a rung stall-suspended; we failed over and are WORKING on a lower rung (Phase 3a) — not alarming
  unconfigured: { glyph: "\u2699", color: "gray", text: "not configured" }
  // no primary set → run /pivot setup (first-run onboarding)
};
var DEFAULT_REACHABILITY = {
  // The probe URL MUST be your primary/brain endpoint (not a generic internet
  // check) so "online" tracks brain reachability. Empty by default → reachability
  // condition stays inert until configured.
  probeUrl: "",
  intervalMs: 2e4,
  // steady-state probe cadence (relaxed; light on the network/battery)
  failureThreshold: 2,
  // consecutive failures before flipping to offline (hysteresis)
  recoveryThreshold: 2,
  // consecutive successes before flipping back online
  probeTimeoutMs: 4e3,
  // a hung probe FAILS after this (fast offline detection)
  confirmIntervalMs: 5e3,
  // re-probe quickly while a flip is pending → fast confirmation
  probeAuthEnv: ""
  // NAME of an env var holding a probe token, never the token
};
var DEFAULT_NETWORK_PROBE = {
  probeUrl: "",
  intervalMs: 2e4,
  failureThreshold: 2,
  recoveryThreshold: 2,
  probeTimeoutMs: 4e3,
  confirmIntervalMs: 5e3,
  probeAuthEnv: ""
};
var DEFAULT_STALL = {
  timeoutMs: 9e4
  // cloud default — no completion within this → suspend the rung
};
var LOCAL_STALL_TIMEOUT_MS = 0;
var DEFAULT_STATUSLINE = {
  replacePrimary: false,
  // false → additive line (order:-1), preserves host agent·model (Review #2)
  showModeText: true,
  // false → bare glyphs; a distinct offline glyph then carries meaning
  nearThresholdBand: 0.8
  // metric shows when value ≥ band × ceiling (Review #5)
};
var DEFAULT_OFFLINE_SIGNIFIER = { glyph: "\u25CB", color: "redBright", text: "offline", bold: true };
var NO_TEXT_GLYPHS = { online: "\u25CF", offline: "\u25CB" };
var KNOWN_CONDITIONS = /* @__PURE__ */ new Set(["reachability", "manual", "cost", "rateLimit"]);
var STATUS_DISPLAY = /* @__PURE__ */ new Set(["always", "near-threshold", "never"]);
function stripJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}
function normalizeRule(rule, warnings, index) {
  const r = rule && typeof rule === "object" ? rule : {};
  if (!KNOWN_CONDITIONS.has(r.condition)) {
    warnings.push(`rule[${index}]: unknown condition "${r.condition}" (kept; not built in v1 unless it's reachability/manual)`);
  }
  const target = r.target && typeof r.target === "object" ? r.target : {};
  let statusDisplay = r.statusDisplay ?? "near-threshold";
  if (!STATUS_DISPLAY.has(statusDisplay)) {
    warnings.push(`rule[${index}]: invalid statusDisplay "${r.statusDisplay}" \u2192 "near-threshold"`);
    statusDisplay = "near-threshold";
  }
  const isDegraded = r.isDegraded === true;
  const out = {
    condition: r.condition ?? null,
    target: {
      model: target.model ?? null,
      local: target.local === true,
      // marks a local/reachable target (used by the offline hard-gate)
      contextWindow: target.contextWindow ?? void 0,
      reasoningEffort: target.reasoningEffort ?? void 0
    },
    modeLabel: r.modeLabel ?? (isDegraded ? "offline" : r.condition ?? "mode"),
    isDegraded,
    statusDisplay,
    signifier: normalizeSignifier(r.signifier, isDegraded)
  };
  if (r.reachability && typeof r.reachability === "object") {
    out.reachability = { ...DEFAULT_REACHABILITY, ...r.reachability };
  }
  if (r.stall && typeof r.stall === "object" && r.stall.timeoutMs !== void 0) {
    out.stall = { timeoutMs: r.stall.timeoutMs };
  } else if (out.target.local === true) {
    out.stall = { timeoutMs: LOCAL_STALL_TIMEOUT_MS };
  }
  return out;
}
function normalizeSignifier(sig, isDegraded) {
  const base = isDegraded ? DEFAULT_OFFLINE_SIGNIFIER : DEFAULT_SIGNIFIERS.online;
  const s = sig && typeof sig === "object" ? sig : {};
  return {
    glyph: s.glyph ?? base.glyph,
    color: s.color ?? base.color,
    text: s.text ?? base.text,
    bold: s.bold ?? base.bold ?? false
  };
}
function defaultConfig() {
  return {
    primary: null,
    // user must set their primary model handle
    rules: [],
    reachability: { ...DEFAULT_REACHABILITY },
    networkProbe: { ...DEFAULT_NETWORK_PROBE },
    stall: { ...DEFAULT_STALL },
    statusline: { ...DEFAULT_STATUSLINE },
    honesty: "transition",
    // inject the offline note once per degraded episode (Review #3)
    memorySync: { enabled: false },
    // onReconnect callback is wired in code, not JSON
    signifiers: { ...DEFAULT_SIGNIFIERS }
  };
}
function parseConfig(text) {
  const warnings = [];
  let raw;
  try {
    raw = JSON.parse(stripJsonc(text));
  } catch (e) {
    warnings.push(`config is not valid JSONC (${e.message}); using defaults`);
    return { config: defaultConfig(), warnings };
  }
  if (!raw || typeof raw !== "object") {
    warnings.push("config root is not an object; using defaults");
    return { config: defaultConfig(), warnings };
  }
  const base = defaultConfig();
  const rules = Array.isArray(raw.rules) ? raw.rules.map((r, i) => normalizeRule(r, warnings, i)) : [];
  if (!Array.isArray(raw.rules) && raw.rules !== void 0) {
    warnings.push("`rules` is not an array; treating as empty");
  }
  if (!raw.primary) warnings.push("no `primary` model handle set; routing will no-op until configured");
  const honesty = raw.honesty === "every-turn" ? "every-turn" : "transition";
  return {
    config: {
      primary: raw.primary ?? null,
      rules,
      reachability: { ...base.reachability, ...raw.reachability ?? {} },
      networkProbe: { ...base.networkProbe, ...raw.networkProbe ?? {} },
      stall: { ...base.stall, ...raw.stall ?? {} },
      statusline: { ...base.statusline, ...raw.statusline ?? {} },
      honesty,
      memorySync: { enabled: raw.memorySync?.enabled === true },
      signifiers: { ...base.signifiers, ...raw.signifiers ?? {} }
    },
    warnings
  };
}
async function loadConfig(path, deps = {}) {
  let read = deps.read;
  if (!read) {
    const { readFileSync: readFileSync2 } = await import("node:fs");
    read = (p) => readFileSync2(p, "utf8");
  }
  let text;
  try {
    text = read(path);
  } catch {
    const config = defaultConfig();
    return { config, warnings: [`no config file at ${path}; using defaults`] };
  }
  return parseConfig(text);
}

// lib/configure-core.mjs
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
var AUTH_PATH = () => join(homedir(), ".letta", "lc-local-backend", "providers", "auth.json");
var SETTINGS_PATH = () => join(homedir(), ".letta", "settings.json");
function readJson(path, deps) {
  try {
    const read = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
    return JSON.parse(read(path));
  } catch {
    return null;
  }
}
var isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url || "");
function discoverProviders(deps = {}) {
  const auth = readJson(deps.authPath ?? AUTH_PATH(), deps);
  const providers = auth?.providers && typeof auth.providers === "object" ? auth.providers : {};
  return Object.values(providers).map((p) => ({
    name: p?.name ?? p?.id ?? "provider",
    baseUrl: p?.base_url ?? "",
    key: p?.auth?.key ?? ""
  })).filter((p) => p.baseUrl);
}
function recentModels(deps = {}) {
  const s = readJson(deps.settingsPath ?? SETTINGS_PATH(), deps);
  return Array.isArray(s?.recentModels) ? s.recentModels : [];
}
async function discoverModels(deps = {}) {
  const providers = deps.providers ?? discoverProviders(deps);
  const recents = recentModels(deps);
  const handles = [...recents];
  for (const p of providers) {
    const ids = await fetchModels(p.baseUrl, p.key, deps);
    for (const id of ids) {
      const handle = `${p.name}/${id}`;
      if (!handles.includes(handle)) handles.push(handle);
    }
  }
  return { handles, providers };
}
function deriveProbe(primaryHandle, providers) {
  const prefix = String(primaryHandle ?? "").split("/")[0];
  const p = (providers ?? []).find((x) => x.name === prefix);
  if (!p?.baseUrl) return { url: "", isLocal: false, providerName: prefix || null };
  const url = `${p.baseUrl.replace(/\/+$/, "")}/models`;
  return { url, isLocal: isLocalUrl(p.baseUrl), providerName: p.name };
}
async function fetchModels(baseUrl, apiKey, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  try {
    const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
    const res = await fetchFn(`${base}/v1/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });
    if (!res?.ok) return [];
    const body = await res.json();
    const ids = (body?.data ?? []).map((m) => m?.id).filter((s) => typeof s === "string" && s);
    return ids.filter((id) => id !== "*");
  } catch {
    return [];
  }
}
function buildConfig(a) {
  const rules = [];
  if (a.cloudFallback) {
    const rule = {
      condition: "reachability",
      target: { model: a.cloudFallback, local: false },
      modeLabel: "cloud-fallback",
      isDegraded: false,
      statusDisplay: "near-threshold"
    };
    if (a.cloudFallbackProbeUrl) rule.reachability = { probeUrl: a.cloudFallbackProbeUrl };
    rules.push(rule);
  }
  if (a.offlineModel) {
    const target = { model: a.offlineModel, local: true };
    if (a.contextWindow) target.contextWindow = a.contextWindow;
    if (a.reasoningEffort) target.reasoningEffort = a.reasoningEffort;
    rules.push({
      condition: "reachability",
      target,
      modeLabel: "offline",
      isDegraded: true,
      statusDisplay: "near-threshold",
      signifier: { glyph: "\u25CB", color: "redBright", text: "offline", bold: true }
    });
  }
  return {
    primary: a.primary ?? null,
    rules,
    reachability: {
      probeUrl: a.probeUrl ?? "",
      intervalMs: a.intervalMs ?? 15e3,
      failureThreshold: a.failureThreshold ?? 3,
      recoveryThreshold: a.recoveryThreshold ?? 2,
      probeTimeoutMs: a.probeTimeoutMs ?? 4e3,
      confirmIntervalMs: a.confirmIntervalMs ?? 5e3,
      probeAuthEnv: a.probeAuthEnv ?? ""
    },
    statusline: {
      replacePrimary: a.replacePrimary === true,
      showModeText: a.showModeText !== false,
      nearThresholdBand: a.nearThresholdBand ?? 0.8
    },
    honesty: a.honesty === "every-turn" ? "every-turn" : "transition",
    memorySync: { enabled: a.memorySyncEnabled === true }
  };
}
var NEUTRAL_PROBE_URL = "https://1.1.1.1";
var LOCAL_MODEL_RE = /(local|qwen|glm|llama|mlx|mistral|gemma|phi\b|lmstudio|codestral)/i;
var looksLocal = (handle) => LOCAL_MODEL_RE.test(String(handle).split("/").pop() ?? "");
function buildStarterConfig({ handles = [], providers = [] } = {}) {
  if (!handles.length) return null;
  const cloud = handles.filter((h) => !looksLocal(h));
  const local = handles.filter((h) => looksLocal(h));
  const primary = cloud[0] ?? handles[0];
  const cloudFallback = cloud.find((h) => h !== primary) ?? null;
  const offlineModel = local[0] ?? null;
  const probe = deriveProbe(primary, providers);
  const probeUrl = probe.isLocal || !probe.url ? NEUTRAL_PROBE_URL : probe.url;
  const config = buildConfig({ primary, cloudFallback, offlineModel, probeUrl });
  return {
    config,
    picks: {
      primary,
      cloudFallback,
      // null → only one cloud model discovered
      fallback: offlineModel,
      // null → no local model found
      probeUrl,
      probeIsLocal: probe.isLocal,
      // true → user must point the probe at their real upstream
      providerCount: providers.length,
      modelCount: handles.length
    }
  };
}

// lib/conditions.mjs
function validateProbeUrl(url) {
  if (!url) return { ok: false, reason: "empty" };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme ${u.protocol} not allowed (http/https only)` };
  }
  return { ok: true };
}
function makeProbeCondition(id, rc, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  let active = false;
  let fails = 0;
  let oks = 0;
  let lastProbeAt = 0;
  let timer = null;
  let onChangeCb = null;
  const valid = validateProbeUrl(rc?.probeUrl);
  function authHeaders() {
    const name = rc?.probeAuthEnv;
    const token = name ? env[name] : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  const probeTimeoutMs = rc?.probeTimeoutMs ?? 4e3;
  async function probeOnce(cb) {
    const notify = cb ?? onChangeCb;
    if (!valid.ok) return false;
    lastProbeAt = now();
    let reachable = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const killer = controller ? setTimeout(() => controller.abort(), probeTimeoutMs) : null;
    if (killer && typeof killer.unref === "function") killer.unref();
    try {
      const res = await fetchFn(rc.probeUrl, {
        method: "GET",
        redirect: "manual",
        // never follow redirects (no SSRF pivot)
        headers: authHeaders(),
        signal: controller?.signal
      });
      reachable = typeof res?.status === "number" ? res.status < 500 : false;
    } catch {
      reachable = false;
    } finally {
      if (killer) clearTimeout(killer);
    }
    const wasActive = active;
    if (reachable) {
      oks++;
      fails = 0;
      if (active && oks >= rc.recoveryThreshold) active = false;
    } else {
      fails++;
      oks = 0;
      if (!active && fails >= rc.failureThreshold) active = true;
    }
    if (active !== wasActive && notify) notify();
    try {
      deps.onProbe?.();
    } catch {
    }
    return active !== wasActive;
  }
  const intervalMs = rc?.intervalMs ?? 2e4;
  const confirmIntervalMs = rc?.confirmIntervalMs ?? 5e3;
  const pending = () => !active && fails > 0 || active && oks > 0;
  function scheduleNext() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runTick, pending() ? confirmIntervalMs : intervalMs);
    if (typeof timer?.unref === "function") timer.unref();
  }
  async function runTick() {
    await probeOnce();
    scheduleNext();
  }
  return {
    id,
    start(onChange) {
      onChangeCb = onChange;
      if (!valid.ok) return;
      probeOnce().then(scheduleNext);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      onChangeCb = null;
    },
    isActive() {
      return active;
    },
    isStale(thresholdMs) {
      return now() - lastProbeAt > thresholdMs;
    },
    // A flip is being confirmed (the "trying to reconnect" window): failures
    // accumulating toward offline, or successes toward recovery — but not yet settled.
    isPending() {
      return !active && fails > 0 && fails < rc.failureThreshold || active && oks > 0 && oks < rc.recoveryThreshold;
    },
    pendingInfo() {
      return active ? { direction: "online", attempt: oks, threshold: rc.recoveryThreshold } : { direction: "offline", attempt: fails, threshold: rc.failureThreshold };
    },
    metric() {
      return null;
    },
    // exposed for tests:
    probeOnce,
    _state: () => ({ active, fails, oks, lastProbeAt, valid })
  };
}
function makeReachabilityCondition(rc, deps = {}) {
  return makeProbeCondition("reachability", rc, deps);
}
function makeManualCondition(initial = "auto") {
  let mode = initial === "offline" || initial === "online" ? initial : "auto";
  let onChangeCb = null;
  return {
    id: "manual",
    start(onChange) {
      onChangeCb = onChange;
    },
    stop() {
      onChangeCb = null;
    },
    // "active" means an override is in force; the resolver/forced-state UI reads mode().
    isActive() {
      return mode !== "auto";
    },
    mode() {
      return mode;
    },
    set(next) {
      const m = next === "offline" || next === "online" ? next : "auto";
      if (m !== mode) {
        mode = m;
        if (onChangeCb) onChangeCb();
      }
    },
    metric() {
      return null;
    }
  };
}

// lib/engine.mjs
function makeEngine(conditions) {
  const subs = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const fn of subs) {
      try {
        fn();
      } catch {
      }
    }
  };
  return {
    /** Begin watching all conditions; each flip triggers our subscribers. */
    start() {
      for (const c of conditions) {
        try {
          c.start(emit);
        } catch {
        }
      }
    },
    stop() {
      for (const c of conditions) {
        try {
          c.stop();
        } catch {
        }
      }
      subs.clear();
    },
    /** Subscribe to "some condition changed". Returns an unsubscribe fn. */
    onChange(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** Active conditions in the order they were given (== config rule order). */
    activeConditions() {
      return conditions.filter((c) => {
        try {
          return c.isActive();
        } catch {
          return false;
        }
      });
    },
    /** Look up a condition by id (e.g. to read reachability staleness or manual mode). */
    get(id) {
      return conditions.find((c) => c.id === id) ?? null;
    },
    /** All conditions (for metric rendering). */
    all() {
      return conditions.slice();
    }
  };
}

// lib/resolver.mjs
function buildRungs(primary, rules = []) {
  const rungs = [{
    index: 0,
    // stable identity for the suspension channel (Phase 3a)
    model: primary ?? null,
    perMode: {},
    modeLabel: "primary",
    isDegraded: false,
    local: false,
    probeId: "reachability"
    // rung 0 health = the brain probe
  }];
  rules.forEach((rule, i) => {
    const perMode = {};
    if (rule?.target?.contextWindow !== void 0) perMode.contextWindow = rule.target.contextWindow;
    if (rule?.target?.reasoningEffort !== void 0) perMode.reasoningEffort = rule.target.reasoningEffort;
    rungs.push({
      index: i + 1,
      // rung 0 is the primary; rules start at 1
      model: rule?.target?.model ?? null,
      perMode,
      modeLabel: rule?.modeLabel ?? "mode",
      isDegraded: rule?.isDegraded === true,
      local: rule?.target?.local === true,
      // Health source: its own probe if it has one; else a LOCAL rung is the
      // always-available terminus (probeId null), while a CLOUD fallback with no probe
      // inherits the brain/"reachability" probe — so "offline" (brain down) gates every
      // cloud rung together and the ladder falls through to the local terminus.
      probeId: rule?.reachability?.probeUrl ? `rung:${i}` : rule?.target?.local === true ? null : "reachability"
    });
  });
  return rungs;
}
function rungResult(rung) {
  if (!rung) return { model: null, perMode: {}, modeLabel: "none-reachable", isDegraded: false, kind: "none-reachable" };
  return { model: rung.model ?? null, perMode: rung.perMode ?? {}, modeLabel: rung.modeLabel, isDegraded: rung.isDegraded === true };
}
function rungAvailable(rung, health, suspended) {
  if (suspended?.has(rung.index)) return false;
  if (!rung.probeId) return true;
  return health?.[rung.probeId] !== "unreachable";
}
function resolveLadder(rungs, health = {}, opts = {}) {
  const manualMode = opts.manualMode ?? "auto";
  const suspended = opts.suspended;
  const primary = rungs?.[0] ?? null;
  const noneReachable = { model: null, perMode: {}, modeLabel: "none-reachable", isDegraded: false, kind: "none-reachable" };
  if (!primary) return noneReachable;
  if (manualMode === "online") {
    const res = rungResult(primary);
    if (!rungAvailable(primary, health, suspended)) res.warning = `forcing ${primary.model ?? "primary"} which appears unreachable`;
    return res;
  }
  if (manualMode === "offline") {
    const r = (rungs ?? []).find((x) => x.local === true || x.isDegraded === true);
    return r ? rungResult(r) : rungResult(primary);
  }
  for (const rung of rungs) {
    if (rungAvailable(rung, health, suspended)) return rungResult(rung);
  }
  return noneReachable;
}

// lib/failure-seam.mjs
function makeFailureSeam() {
  const subs = /* @__PURE__ */ new Set();
  return {
    /** Report that `rungId` failed. `reason` is opaque (string today, object later). */
    report(rungId, reason) {
      const failure = { rungId, reason };
      for (const fn of subs) {
        try {
          fn(failure);
        } catch {
        }
      }
    },
    /** Subscribe to failures. Returns an unsubscribe fn. */
    onFailure(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

// lib/failure-watch.mjs
function makeStallWatch({ timeoutMs = 9e4, timeoutForModel, onStall, deps = {} } = {}) {
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    if (typeof t?.unref === "function") t.unref();
    return t;
  });
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const now = deps.now ?? (() => Date.now());
  const inflight = /* @__PURE__ */ new Map();
  function markStart({ callId, model }) {
    if (callId == null) return;
    const prior = inflight.get(callId);
    if (prior) clearTimer(prior.timer);
    const ms = timeoutForModel?.(model) ?? timeoutMs;
    if (!(ms > 0)) return;
    const timer = setTimer(() => {
      inflight.delete(callId);
      try {
        onStall?.(model);
      } catch {
      }
    }, ms);
    inflight.set(callId, { model, timer, startedAt: now() });
  }
  function markSettled(callId) {
    const rec = inflight.get(callId);
    if (!rec) return;
    clearTimer(rec.timer);
    inflight.delete(callId);
  }
  function stop() {
    for (const { timer } of inflight.values()) clearTimer(timer);
    inflight.clear();
  }
  return { markStart, markSettled, stop, _inflightSize: () => inflight.size };
}

// lib/suspension.mjs
function modelToRungIndex(rungs, model) {
  if (!model || !Array.isArray(rungs)) return null;
  const rung = rungs.find((r) => r.model === model);
  return rung ? rung.index : null;
}
function canSuspend(rungCount, suspended, index) {
  const next = new Set(suspended);
  next.add(index);
  return next.size < rungCount;
}

// lib/llm-end.mjs
var FAILING_STOP_REASONS = /* @__PURE__ */ new Set(["error", "aborted"]);
function classifyLlmEnd(event) {
  const err = event?.error;
  if (err && typeof err === "object") {
    return {
      failed: true,
      reason: {
        source: "llm_end",
        errorType: err.errorType === "local_backend_error" ? "local_backend_error" : "llm_error",
        message: String(err.message ?? err.detail ?? "provider error"),
        retryable: err.retryable === true
      }
    };
  }
  if (FAILING_STOP_REASONS.has(event?.stopReason)) {
    return { failed: true, reason: "error" };
  }
  return { failed: false, reason: null };
}
function describeReason(reason) {
  if (reason && typeof reason === "object") {
    const kind = reason.errorType === "local_backend_error" ? "local backend error" : "provider error";
    return reason.message ? `${kind}: ${reason.message}` : kind;
  }
  if (reason === "stall") return "no response (timed out)";
  if (reason === "manual") return "manual pivot";
  return "error";
}

// lib/turn.mjs
function injectNote(input, note) {
  if (!Array.isArray(input)) return input;
  const out = input.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  if (!last) return out;
  const c = last.content;
  if (typeof c === "string") {
    last.content = c + note;
  } else if (Array.isArray(c)) {
    const parts = c.map((p) => ({ ...p }));
    for (let i = parts.length - 1; i >= 0; i--) {
      if (typeof parts[i].text === "string") {
        parts[i] = { ...parts[i], text: parts[i].text + note };
        break;
      }
    }
    last.content = parts;
  } else if (c && typeof c === "object" && typeof c.text === "string") {
    last.content = { ...c, text: c.text + note };
  }
  return out;
}
function buildHonestyNote(modeLabel = "offline", variant = "offline") {
  if (variant === "online") {
    return `

(System note \u2014 AutoPivot ${modeLabel}: you are running on a fallback model (a different/local model than usual), but you ARE still online. Networked actions (email, Slack, calendar, web, and fleet/hub tools) still work normally \u2014 go ahead and use them. The only difference is the model answering; proceed as usual.)`;
  }
  return `

(System note \u2014 AutoPivot ${modeLabel}: you are running on a LOCAL model. Networked actions (email, Slack, calendar, web, and fleet/hub tools) are UNAVAILABLE right now \u2014 do NOT claim they succeeded. Draft or queue the work, tell the user you've held it for when the connection returns, then continue. Your memory is the last local snapshot.)`;
}
function decideTurn({ target, currentModelId, episode, memfsEnabled, honestyMode = "transition", actionsAvailable = null }) {
  const switchTo = target.model && target.model !== currentModelId ? target.model : null;
  const wasDegraded = episode?.degraded === true;
  const nowDegraded = target.isDegraded === true;
  let shouldInject = false;
  if (nowDegraded && memfsEnabled) {
    if (!wasDegraded) shouldInject = true;
    else if (honestyMode === "every-turn") shouldInject = true;
  }
  const noteVariant = actionsAvailable === true ? "online" : "offline";
  return {
    switchTo,
    perMode: target.perMode ?? {},
    shouldInject,
    noteVariant,
    episode: { degraded: nowDegraded }
    // caller persists this for the next turn
  };
}

// lib/statusline.mjs
function colorize(chalk, color, text, bold) {
  if (!chalk) return text;
  let styler;
  if (typeof color === "string" && color.startsWith("#") && typeof chalk.hex === "function") styler = chalk.hex(color);
  else if (typeof chalk[color] === "function") styler = chalk[color];
  else styler = (s) => s;
  if (bold && styler && typeof styler.bold === "function") styler = styler.bold;
  return styler(text);
}
function resolveSignifier(kind, cfg, ruleSignifier) {
  let sig;
  if (kind === "offline") sig = ruleSignifier ?? { glyph: "\u25CB", color: "redBright", text: "offline" };
  else if (kind === "checking") sig = cfg.signifiers.checking;
  else if (kind === "forced-offline") sig = cfg.signifiers.forcedOffline;
  else if (kind === "forced-online") sig = cfg.signifiers.forcedOnline;
  else if (kind === "forced") sig = cfg.signifiers.forced;
  else if (kind === "unknown") sig = cfg.signifiers.unknown;
  else if (kind === "none-reachable") sig = cfg.signifiers.noneReachable;
  else if (kind === "suspended") sig = cfg.signifiers.suspended;
  else if (kind === "unconfigured") sig = cfg.signifiers.unconfigured;
  else sig = cfg.signifiers.online;
  if (!cfg.statusline.showModeText) {
    const glyph = kind === "offline" ? NO_TEXT_GLYPHS.offline : kind === "online" ? NO_TEXT_GLYPHS.online : sig.glyph;
    return { glyph, color: sig.color, text: "" };
  }
  return { glyph: sig.glyph, color: sig.color, text: sig.text };
}
function renderPill(view, cfg, chalk) {
  const sig = resolveSignifier(view.kind, cfg, view.ruleSignifier);
  const dot = colorize(chalk, sig.color, sig.glyph, sig.bold);
  let text = sig.text;
  if (view.kind === "checking" && view.checking && cfg.statusline.showModeText) {
    const verb = view.checking.direction === "online" ? "reconnecting" : "checking";
    text = `${verb} ${view.checking.attempt}/${view.checking.threshold}`;
  }
  const label = text ? " " + text : "";
  const model = view.model ? " " + view.model : "";
  return dot + label + model;
}
function metricSegment(entries) {
  const parts = [];
  for (const e of entries ?? []) {
    if (e.statusDisplay === "never") continue;
    const m = typeof e.metric === "function" ? e.metric() : null;
    if (!m) continue;
    const show = e.statusDisplay === "always" || e.statusDisplay === "near-threshold" && m.nearThreshold;
    if (!show) continue;
    const val = m.ceiling != null && isFinite(m.ceiling) ? `${fmt(m.value)}/${fmt(m.ceiling)}` : `${fmt(m.value)}`;
    parts.push(`${m.label} ${val}`);
  }
  return parts.join(" \xB7 ");
}
function fmt(n) {
  if (typeof n !== "number") return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// lib/status.mjs
function buildStatusText({ modeLabel, model, manualMode, conditions, actions }) {
  const lines = [];
  const forced = manualMode && manualMode !== "auto" ? `forced ${manualMode}` : "auto";
  const actionsStr = actions ? ` \xB7 actions ${actions}` : "";
  lines.push(`AutoPivot \u2014 ${modeLabel ?? "primary"} \xB7 ${model ?? "(no model)"} \xB7 ${forced}${actionsStr}`);
  for (const c of conditions ?? []) {
    const m = typeof c.metric === "function" ? c.metric() : null;
    const metricStr = m ? ` [${m.label} ${m.value}${m.ceiling != null && isFinite(m.ceiling) ? "/" + m.ceiling : ""}]` : "";
    lines.push(`  - ${c.id}: ${c.active ? "active" : "inactive"}${metricStr}`);
  }
  lines.push(
    manualMode && manualMode !== "auto" ? "  override active \u2014 /pivot auto to resume automatic switching" : "  /pivot offline | /pivot online to override, /pivot auto for automatic"
  );
  return lines.join("\n");
}

// lib/state.mjs
var VALID_MODES = ["auto", "online", "offline"];
function validateState(raw) {
  const mode = VALID_MODES.includes(raw?.manualMode) ? raw.manualMode : "auto";
  return { manualMode: mode };
}
async function loadState(path, deps = {}) {
  let read = deps.read;
  if (!read) {
    const { readFileSync: readFileSync2 } = await import("node:fs");
    read = (p) => readFileSync2(p, "utf8");
  }
  try {
    return validateState(JSON.parse(read(path)));
  } catch {
    return { manualMode: "auto" };
  }
}
async function saveState(path, state, deps = {}) {
  let write = deps.write;
  if (!write) {
    const { writeFileSync } = await import("node:fs");
    write = (p, data) => writeFileSync(p, data);
  }
  write(path, JSON.stringify(validateState(state), null, 2));
}

// lib/memfs-seam.mjs
function makeGit(deps) {
  if (deps.exec) return deps.exec;
  return async (args, cwd) => {
    const { execFile } = await import("node:child_process");
    return await new Promise((res) => {
      execFile("git", args, { cwd, timeout: 5e3 }, (err, stdout) => res(err ? "" : String(stdout)));
    });
  };
}
function makeMemfsSeam(cfg, onReconnect, deps = {}) {
  const enabled = cfg?.enabled === true && typeof onReconnect === "function";
  const git = makeGit(deps);
  let memoryDir = null;
  let offline = false;
  let baseline = null;
  async function captureBaseline() {
    baseline = (await git(["rev-parse", "HEAD"], memoryDir)).trim() || null;
  }
  async function computeEdits() {
    if (!baseline) return { baseline: null, head: null, changedPaths: [], commits: [] };
    const head = (await git(["rev-parse", "HEAD"], memoryDir)).trim() || null;
    const committed = (await git(["diff", "--name-only", `${baseline}..HEAD`], memoryDir)).split("\n").map((s) => s.trim()).filter(Boolean);
    const dirty = (await git(["status", "--porcelain"], memoryDir)).split("\n").map((s) => s.slice(3).trim()).filter(Boolean);
    const commits = (await git(["log", "--format=%H", `${baseline}..HEAD`], memoryDir)).split("\n").map((s) => s.trim()).filter(Boolean);
    const changedPaths = Array.from(/* @__PURE__ */ new Set([...committed, ...dirty]));
    return { baseline, head, changedPaths, commits };
  }
  return {
    setMemoryDir(dir) {
      if (dir) memoryDir = dir;
    },
    /** Drive from connectivity flips. isOffline true=offline. Fire-and-forget. */
    async onLinkChange(isOffline) {
      if (!enabled || !memoryDir) return;
      try {
        if (isOffline && !offline) {
          offline = true;
          await captureBaseline();
        } else if (!isOffline && offline) {
          offline = false;
          const edits = await computeEdits();
          baseline = null;
          try {
            onReconnect(edits);
          } catch {
          }
        }
      } catch {
      }
    },
    _state: () => ({ enabled, memoryDir, offline, baseline })
  };
}

// index.mjs
var MOD_DIR = join2(homedir2(), ".letta", "mods");
var CONFIG_PATH = join2(MOD_DIR, "autopivot.config.json");
var STATE_PATH = join2(MOD_DIR, "autopivot.state.json");
var CONFIGURE_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join2(here, "autopivot-configure.cjs"),
    join2(here, "dist", "autopivot-configure.cjs"),
    join2(MOD_DIR, "autopivot-configure.cjs")
  ];
  return candidates.find((c) => {
    try {
      return existsSync(c);
    } catch {
      return false;
    }
  }) ?? candidates[0];
})();
async function activate(letta) {
  const disposers = [];
  const log = (m) => {
    try {
      letta.log?.(`autopivot: ${m}`);
    } catch {
    }
  };
  const { config, warnings } = await loadConfig(CONFIG_PATH);
  for (const w of warnings) log(w);
  const state = await loadState(STATE_PATH);
  const episode = { degraded: false };
  const manual = makeManualCondition(state.manualMode);
  const reachability = makeReachabilityCondition(config.reachability, { onProbe: () => {
    try {
      updateUi();
    } catch {
    }
  } });
  const networkConfigured = !!config.networkProbe?.probeUrl;
  const network = makeProbeCondition("network", config.networkProbe);
  const netStaleMs = Math.max(1, (config.networkProbe?.failureThreshold ?? 2) + 1) * (config.networkProbe?.intervalMs ?? 2e4);
  const rungs = buildRungs(config.primary, config.rules);
  const rungProbes = /* @__PURE__ */ new Map();
  config.rules.forEach((rule, i) => {
    if (rule?.reachability?.probeUrl) {
      rungProbes.set(`rung:${i}`, makeProbeCondition(`rung:${i}`, rule.reachability, { onProbe: () => {
        try {
          updateUi();
        } catch {
        }
      } }));
    }
  });
  function healthMap() {
    const h = { reachability: reachability.isActive() ? "unreachable" : "available" };
    for (const [id, c] of rungProbes) h[id] = c.isActive() ? "unreachable" : "available";
    return h;
  }
  const engine = makeEngine([manual, reachability, network, ...rungProbes.values()]);
  const seam = makeMemfsSeam(config.memorySync, letta.memorySync);
  const stallCfg = config.stall;
  const suspended = /* @__PURE__ */ new Map();
  const suspendedSet = () => new Set(suspended.keys());
  const failSeam = makeFailureSeam();
  const stallWatch = makeStallWatch({
    timeoutMs: stallCfg.timeoutMs,
    timeoutForModel: (model) => {
      const rung = rungs.find((r) => r.model === model);
      if (!rung || rung.index === 0) return void 0;
      return config.rules[rung.index - 1]?.stall?.timeoutMs;
    },
    onStall: (model) => {
      try {
        failSeam.report(model, "stall");
      } catch {
      }
    }
  });
  const clearSuspension = (idx) => {
    suspended.delete(idx);
  };
  function noteSuccess(model) {
    const idx = modelToRungIndex(rungs, model);
    if (idx != null && suspended.has(idx)) {
      clearSuspension(idx);
      try {
        updateUi();
      } catch {
      }
    }
  }
  disposers.push(failSeam.onFailure(({ rungId: model, reason }) => {
    try {
      const idx = modelToRungIndex(rungs, model);
      if (idx == null) return;
      if (suspended.has(idx)) return;
      const why = reason && typeof reason === "object" ? ` (${describeReason(reason)})` : "";
      if (!canSuspend(rungs.length, suspendedSet(), idx)) {
        announce(`\u26A0\uFE0F AutoPivot: all rungs failing${why} \u2014 staying on ${model}. Run /pivot online to retry.`);
        return;
      }
      suspended.set(idx, { count: (suspended.get(idx)?.count ?? 0) + 1 });
      const next = computeView(null).desired;
      announce(`\u26A0\uFE0F AutoPivot: ${model} failed${why} \u2192 now on ${next ?? "(no model)"}. Resend your message; /pivot online to retry.`);
      try {
        updateUi();
      } catch {
      }
    } catch (e) {
      log(`suspend: ${e?.message ?? e}`);
    }
  }));
  const staleMs = Math.max(1, config.reachability.failureThreshold + 1) * config.reachability.intervalMs;
  function actionsAvailable() {
    if (!networkConfigured) return null;
    if (network.isStale(netStaleMs)) return null;
    return !network.isActive();
  }
  function actionsLabel() {
    const a = actionsAvailable();
    if (a === null) return networkConfigured ? "unknown" : null;
    return a ? "online" : "offline";
  }
  function computeView(activeModelId) {
    const mode = manual.mode();
    const resolved = resolveLadder(rungs, healthMap(), { manualMode: mode, suspended: suspendedSet() });
    const pendingInfo = mode === "auto" && reachability.isPending?.() ? reachability.pendingInfo() : null;
    let kind;
    if (mode === "offline") kind = "forced-offline";
    else if (mode === "online") kind = "forced-online";
    else if (pendingInfo) kind = "checking";
    else if (resolved.kind === "none-reachable") kind = "none-reachable";
    else if (mode === "auto" && suspended.size > 0) kind = "suspended";
    else if (resolved.isDegraded) kind = "offline";
    else if (config.reachability.probeUrl && reachability.isStale(staleMs)) kind = "unknown";
    else kind = "online";
    if (!config.primary) kind = "unconfigured";
    const ruleSignifier = config.rules.find((x) => x.modeLabel === resolved.modeLabel)?.signifier ?? null;
    return { kind, desired: resolved.model, actual: activeModelId, ruleSignifier, resolved, pendingInfo, warning: resolved.warning ?? null };
  }
  let panel = null;
  if (letta.capabilities?.ui?.panels) {
    panel = letta.ui.openPanel({
      id: "autopivot",
      order: config.statusline.replacePrimary ? 0 : -1,
      render: ({ width, row, chalk, model }) => {
        const v = computeView(model?.id);
        const left = renderPill({ kind: v.kind, model: v.desired ?? v.actual, ruleSignifier: v.ruleSignifier, checking: v.pendingInfo }, config, chalk);
        const entries = engine.all().map((c) => ({
          metric: c.metric ? c.metric.bind(c) : () => null,
          statusDisplay: config.rules.find((x) => x.condition === c.id)?.statusDisplay ?? "near-threshold"
        }));
        return row(left, metricSegment(entries), width);
      }
    });
    disposers.push(() => {
      try {
        panel.close();
      } catch {
      }
    });
  }
  let toastHandle = null, toastTimer = null;
  function announce(text) {
    log(text);
    if (!letta.capabilities?.ui?.panels) return;
    try {
      if (toastTimer) clearTimeout(toastTimer);
      toastHandle = letta.ui.openPanel({ id: "autopivot-toast", order: 50, render: () => text });
      toastTimer = setTimeout(() => {
        try {
          toastHandle?.close();
        } catch {
        }
        toastHandle = null;
      }, 6e3);
      if (typeof toastTimer?.unref === "function") toastTimer.unref();
    } catch {
    }
  }
  function keyOf(v) {
    return v.kind === "checking" ? `checking\xB7${v.pendingInfo.direction}\xB7${v.pendingInfo.attempt}` : `${v.kind}\xB7${v.desired}`;
  }
  function msgOf(v) {
    if (v.kind === "checking") {
      const verb = v.pendingInfo.direction === "online" ? "reconnecting" : "checking connection";
      return `\u27F3 AutoPivot: ${verb}\u2026 (${v.pendingInfo.attempt}/${v.pendingInfo.threshold})`;
    }
    if (v.kind === "offline") return `\u{1F534} AutoPivot: offline \u2192 ${v.desired}`;
    if (v.kind === "online") return `\u{1F7E2} AutoPivot: online \u2192 ${v.desired}`;
    if (v.kind === "none-reachable") return `\u26A0\uFE0F AutoPivot: no model reachable \u2014 staying put, not switching to a dead model`;
    return null;
  }
  let lastKey = keyOf(computeView(null));
  function updateUi() {
    try {
      panel?.update?.();
    } catch {
    }
    const v = computeView(null);
    const key = keyOf(v);
    if (key !== lastKey) {
      lastKey = key;
      const msg = msgOf(v);
      if (msg) announce(msg);
    }
  }
  disposers.push(engine.onChange(() => {
    try {
      seam.onLinkChange(reachability.isActive());
      updateUi();
    } catch {
    }
  }));
  if (letta.capabilities?.events?.turns) {
    disposers.push(letta.events.on("turn_start", async (event, ctx) => {
      try {
        seam.setMemoryDir(ctx?.memfs?.memoryDir);
        const v = computeView(ctx?.model?.id);
        const decision = decideTurn({
          target: v.resolved,
          currentModelId: ctx?.model?.id,
          episode,
          memfsEnabled: ctx?.memfs?.enabled === true,
          honestyMode: config.honesty,
          actionsAvailable: actionsAvailable()
          // network axis → which honesty note
        });
        episode.degraded = decision.episode.degraded;
        if (decision.switchTo) await ctx.conversation.updateLlmConfig({ model: decision.switchTo, ...decision.perMode });
        try {
          panel?.update?.();
        } catch {
        }
        if (decision.shouldInject) return { input: injectNote(event.input, buildHonestyNote(v.resolved.modeLabel, decision.noteVariant)) };
      } catch (e) {
        log(`turn_start error: ${e?.message ?? e}`);
      }
    }));
  }
  const cidOf = (event, ctx) => ctx?.conversation?.id ?? event?.conversationId ?? ctx?.conversationId ?? "default";
  for (const [name, handler] of [
    ["llm_start", (event, ctx) => {
      stallWatch.markStart({ callId: cidOf(event, ctx), model: event?.model ?? ctx?.model?.id });
      try {
        panel?.update?.();
      } catch {
      }
    }],
    ["llm_end", (event, ctx) => {
      stallWatch.markSettled(cidOf(event, ctx));
      const model = event?.model ?? ctx?.model?.id;
      const { failed, reason } = classifyLlmEnd(event);
      if (failed) {
        try {
          failSeam.report(model, reason);
        } catch {
        }
      } else noteSuccess(model);
    }],
    ["turn_end", (event, ctx) => {
      stallWatch.markSettled(cidOf(event, ctx));
    }]
  ]) {
    try {
      disposers.push(letta.events.on(name, handler));
    } catch (e) {
      log(`event ${name} unavailable: ${e?.message ?? e}`);
    }
  }
  if (letta.capabilities?.commands) {
    disposers.push(letta.commands.register({
      id: "pivot",
      description: "AutoPivot: status | setup (first-run) | down (fail over now) | offline | online | auto",
      async run(ctx) {
        const arg = String(ctx?.args ?? "").trim().toLowerCase();
        if (arg === "down") {
          const cur = ctx?.model?.id;
          const idx = modelToRungIndex(rungs, cur);
          if (idx == null) return { type: "output", output: `AutoPivot: ${cur ?? "the current model"} isn't a configured rung \u2014 nothing to pivot down from.` };
          failSeam.report(cur, "manual");
          if (!suspended.has(idx)) {
            return { type: "output", output: `AutoPivot: ${cur} is the last available rung \u2014 nowhere to pivot down to. /pivot online to reset.` };
          }
          const v2 = computeView(cur);
          let landed = "";
          if (ctx?.conversation?.updateLlmConfig && v2.desired && v2.desired !== cur) {
            try {
              await ctx.conversation.updateLlmConfig({ model: v2.desired, ...v2.resolved.perMode ?? {} });
              landed = " (applies on your next message)";
            } catch (e) {
              log(`switch: ${e?.message ?? e}`);
            }
          }
          return { type: "output", output: `AutoPivot: suspended ${cur} \u2192 now on ${v2.desired ?? "(no model)"}${landed}. /pivot online to retry ${cur}.` };
        }
        if (arg === "setup") {
          try {
            const starter = buildStarterConfig(await discoverModels());
            if (!starter) {
              return { type: "output", output: `AutoPivot: couldn't auto-discover any models.
  Run the full configurator in a terminal:  node ${CONFIGURE_PATH}
  or copy autopivot.config.example.json \u2192 ${CONFIG_PATH} and edit.` };
            }
            const { config: cfg, picks } = starter;
            const { warnings: w } = parseConfig(JSON.stringify(cfg));
            const header = `// AutoPivot STARTER config \u2014 auto-picked from your connected models.
// Edit freely, then /reload. Full menu (in a terminal): node ${CONFIGURE_PATH}
`;
            await writeFile(CONFIG_PATH, header + JSON.stringify(cfg, null, 2) + "\n");
            let out = `AutoPivot: wrote a starter config \u2192 ${CONFIG_PATH}
  primary:        ${picks.primary}
  cloud fallback: ${picks.cloudFallback ?? "(only one cloud model discovered)"}
  local fallback: ${picks.fallback ?? "(no local model found \u2014 add one for offline failover)"}
  probe:          ${picks.probeUrl || "(unset \u2014 put your primary's endpoint in reachability.probeUrl)"}`;
            if (picks.probeIsLocal) out += `
  \u26A0 couldn't derive a specific endpoint (localhost proxy) \u2192 probe defaults to an internet check (${picks.probeUrl}), which handles "offline \u2192 go local." For a SPECIFIC server, set reachability.probeUrl to it.`;
            if (w.length) out += `
  (validation: ${w.join("; ")})`;
            out += `

These are best GUESSES. To pick/verify every field (incl. which models are local),`;
            out += `
run the menu configurator in a terminal:
  node ${CONFIGURE_PATH}`;
            out += `
or just edit the file. Then /reload.`;
            return { type: "output", output: out };
          } catch (e) {
            return { type: "output", output: `AutoPivot setup failed: ${e?.message ?? e}
  Fall back to the menu configurator:  node ${CONFIGURE_PATH}` };
          }
        }
        if (arg === "offline" || arg === "online" || arg === "auto") {
          if (arg === "online" || arg === "auto") {
            for (const idx of [...suspended.keys()]) clearSuspension(idx);
          }
          manual.set(arg);
          state.manualMode = arg;
          try {
            await saveState(STATE_PATH, state);
          } catch (e) {
            log(`state save: ${e?.message ?? e}`);
          }
          const v2 = computeView(ctx?.model?.id);
          let landed = "";
          if (ctx?.conversation?.updateLlmConfig && v2.desired && v2.desired !== ctx?.model?.id) {
            try {
              await ctx.conversation.updateLlmConfig({ model: v2.desired, ...v2.resolved.perMode ?? {} });
              landed = ` (applies on your next message)`;
            } catch (e) {
              log(`switch: ${e?.message ?? e}`);
            }
          }
          lastKey = keyOf(v2);
          try {
            panel?.update?.();
          } catch {
          }
          const mode = arg === "auto" ? "automatic switching" : `forced ${arg}`;
          const warn = v2.warning ? `
\u26A0 ${v2.warning}` : "";
          return { type: "output", output: `AutoPivot: ${mode} \u2192 ${v2.desired ?? "(no model reachable)"}${landed}.${warn}` };
        }
        if (arg && arg !== "status") {
          return { type: "output", output: `AutoPivot: unknown subcommand "${arg}". Use: status | setup | down | offline | online | auto` };
        }
        if (!config.primary) {
          return { type: "output", output: `AutoPivot isn't configured yet.
  \u2022 Quick (here in the TUI):   /pivot setup   \u2014 auto-writes a starter config from your models
  \u2022 Full menu (in a terminal): node ${CONFIGURE_PATH}   \u2014 pick/verify every field
Then /reload.` };
        }
        const v = computeView(ctx?.model?.id);
        const conditions = engine.all().map((c) => ({ id: c.id, active: c.isActive(), metric: c.metric ? c.metric.bind(c) : null }));
        const base = buildStatusText({ modeLabel: v.resolved.modeLabel, model: v.desired, manualMode: manual.mode(), conditions, actions: actionsLabel() });
        const susp = [...suspended.entries()].map(([idx, s]) => `  - suspended: rung ${idx} (${rungs[idx]?.model ?? "?"}) \u2014 failed \xD7${s.count}; /pivot online to retry`).join("\n");
        return { type: "output", output: susp ? `${base}
${susp}` : base };
      }
    }));
  }
  engine.start();
  return () => {
    for (const d of disposers.reverse()) {
      try {
        d();
      } catch {
      }
    }
    try {
      if (toastTimer) clearTimeout(toastTimer);
    } catch {
    }
    try {
      stallWatch.stop();
    } catch {
    }
    try {
      engine.stop();
    } catch {
    }
  };
}
export {
  activate as default
};
