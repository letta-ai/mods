/**
 * Waiting Room FM / Jukebox mod
 *
 * Commands:
 *   /jb <keyword|mood|random|next|stop|now|list|pin|unpin|loop|cache|setup|setkey|source>
 *   /jukebox <same>
 *
 * Stages:
 *   1. /jb setup      — step-by-step guide to get a Jamendo API key
 *   2. /jb setkey <id> — save your Jamendo Client ID
 *   3. /jb <keyword>   — search Jamendo by keyword, stream a random match
 *   4. /jb <mood>      — mood-based Jamendo playback
 *
 * Music source:
 *   - Jamendo API (CC-licensed, requires free Client ID)
 *   - No procedural synth fallback — Jamendo only
 *
 * Config: ~/.letta/mods/jukebox-config.json
 * Cache:  ~/.letta/mods/jukebox-cache/
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, statSync, readdirSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { get } from "node:https";

const MOD_ID = "waiting-room-fm";
const CACHE_DIR = join(homedir(), ".letta", "mods", "jukebox-cache");
const CONFIG_PATH = join(homedir(), ".letta", "mods", "jukebox-config.json");
const DEFAULT_CACHE_MAX_SIZE_MB = 200;
const DEFAULT_CACHE_MAX_FILES = 50;

// ── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (_) {}
  return { jamendoClientId: "" };
}

function saveConfig(cfg) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (_) {}
}

function getJamendoClientId() {
  return loadConfig().jamendoClientId || "";
}

// ── Mood definitions ─────────────────────────────────────────────────────────

const MOODS = {
  focus: {
    station: "Focus Room",
    title: "Soft Circuit",
    line: "Keeping it quiet. Low bass, clear head.",
    wave: "soft",
    tags: ["focus"],
  },
  chill: {
    station: "Command Line Cafe",
    title: "Low Battery Latte",
    line: "Slow mode. Nothing has to sprint right now.",
    wave: "soft",
    tags: ["chill"],
  },
  deadline: {
    station: "Deadline Disco",
    title: "Tiny Panic Beat",
    line: "This is not music. This is survival equipment.",
    wave: "sharp",
    tags: ["electronic"],
  },
  victory: {
    station: "Ship It Radio",
    title: "Merge Button Confetti",
    line: "Victory detected. Dropping the tiny confetti beat.",
    wave: "bright",
    tags: ["upbeat"],
  },
  tired: {
    station: "Low Battery Radio",
    title: "Gentle Compile",
    line: "Low power mode. Small volume, long endurance.",
    wave: "soft",
    tags: ["ambient"],
  },
  invoice: {
    station: "Invoice Blues",
    title: "Paid Net 30 Someday",
    line: "The invoice is nervous, but it is still going out.",
    wave: "soft",
    tags: ["jazz"],
  },
  "scope-creep": {
    station: "Scope Creep FM",
    title: "Boundary Funk",
    line: "Someone said just a small change. Raising shields.",
    wave: "funk",
    tags: ["funk"],
  },
  panic: {
    station: "Tiny Panic Radio",
    title: "Everything Is Fine Probably",
    line: "Everything is fine. Probably. Keep moving.",
    wave: "sharp",
    tags: ["rock"],
  },
};

const ALIASES = {
  deepwork: "focus", coding: "focus", design: "focus", writing: "focus",
  calm: "chill", sad: "tired", exhausted: "tired", sleepy: "tired",
  anxious: "panic", blocked: "panic", "tiny-panic": "panic",
  "client-feedback": "scope-creep", client: "scope-creep", revision: "scope-creep",
  tax: "invoice", paid: "invoice", ship: "victory", "ship-it": "victory", win: "victory",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isMoodKeyword(input) {
  const lower = input.toLowerCase();
  return !!MOODS[lower] || !!ALIASES[lower];
}

function normalizeMood(raw) {
  const input = String(raw || "").trim().toLowerCase();
  if (!input || input === "random") return pick(Object.keys(MOODS));
  if (MOODS[input]) return input;
  if (ALIASES[input]) return ALIASES[input];
  if (input.includes("deadline")) return "deadline";
  if (input.includes("scope") || input.includes("client") || input.includes("revision")) return "scope-creep";
  if (input.includes("tired") || input.includes("sleepy") || input.includes("exhausted")) return "tired";
  if (input.includes("focus") || input.includes("deep")) return "focus";
  if (input.includes("panic") || input.includes("anxious") || input.includes("blocked")) return "panic";
  if (input.includes("victory") || input.includes("success") || input.includes("done") || input.includes("ship")) return "victory";
  if (input.includes("invoice") || input.includes("tax") || input.includes("paid")) return "invoice";
  return null;
}

function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}

// ── Cache management ────────────────────────────────────────────────────────

function getCacheSettings() {
  const cfg = loadConfig();
  const cache = cfg.cache || {};
  const maxSizeMB = Number(cache.maxSizeMB || cache.maxSizeMb || DEFAULT_CACHE_MAX_SIZE_MB);
  const maxFiles = Number(cache.maxFiles || DEFAULT_CACHE_MAX_FILES);
  return {
    maxSizeMB: Number.isFinite(maxSizeMB) && maxSizeMB > 0 ? maxSizeMB : DEFAULT_CACHE_MAX_SIZE_MB,
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : DEFAULT_CACHE_MAX_FILES,
  };
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function isCacheAudioFile(name) {
  return /^jamendo-.*\.mp3$/i.test(name);
}

function isTempEnvelopeFile(name) {
  return /-env\.wav$/i.test(name);
}

function isOldGeneratedWav(name) {
  return /\.wav$/i.test(name) && !isTempEnvelopeFile(name);
}

function listCacheEntries() {
  ensureCacheDir();
  const entries = [];
  try {
    for (const item of readdirSync(CACHE_DIR, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const path = join(CACHE_DIR, item.name);
      let stat;
      try { stat = statSync(path); } catch (_) { continue; }
      entries.push({
        name: item.name,
        path,
        size: stat.size || 0,
        mtimeMs: stat.mtimeMs || 0,
        isAudio: isCacheAudioFile(item.name),
        isTemp: isTempEnvelopeFile(item.name),
        isOldWav: isOldGeneratedWav(item.name),
      });
    }
  } catch (_) {}
  return entries;
}

function touchCacheFile(path) {
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch (_) {}
}

function safeDeleteCacheFile(entry, keepPath) {
  if (!entry?.path) return { deleted: false, bytes: 0 };
  if (keepPath && entry.path === keepPath) return { deleted: false, bytes: 0 };
  try {
    unlinkSync(entry.path);
    return { deleted: true, bytes: entry.size || 0 };
  } catch (_) {
    return { deleted: false, bytes: 0 };
  }
}

function getCacheStats() {
  const entries = listCacheEntries();
  const totalBytes = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  return {
    entries,
    totalBytes,
    totalFiles: entries.length,
    audioFiles: entries.filter((e) => e.isAudio).length,
    tempFiles: entries.filter((e) => e.isTemp).length,
    oldWavFiles: entries.filter((e) => e.isOldWav).length,
  };
}

function pruneCache({ keepPath = null } = {}) {
  const settings = getCacheSettings();
  const maxSizeBytes = settings.maxSizeMB * 1024 * 1024;
  let deletedFiles = 0;
  let deletedBytes = 0;

  // Remove temporary envelope WAVs and old generated WAVs first. Jukebox is
  // Jamendo-only now, so these files should not accumulate in public usage.
  for (const entry of listCacheEntries()) {
    if (!entry.isTemp && !entry.isOldWav) continue;
    const result = safeDeleteCacheFile(entry, keepPath);
    if (result.deleted) {
      deletedFiles += 1;
      deletedBytes += result.bytes;
    }
  }

  let audioEntries = listCacheEntries()
    .filter((e) => e.isAudio)
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // LRU by touched mtime
  let totalAudioBytes = audioEntries.reduce((sum, e) => sum + (e.size || 0), 0);

  while ((audioEntries.length > settings.maxFiles || totalAudioBytes > maxSizeBytes) && audioEntries.length > 0) {
    const idx = audioEntries.findIndex((e) => !keepPath || e.path !== keepPath);
    if (idx === -1) break;
    const [entry] = audioEntries.splice(idx, 1);
    const result = safeDeleteCacheFile(entry, keepPath);
    if (result.deleted) {
      deletedFiles += 1;
      deletedBytes += result.bytes;
      totalAudioBytes -= result.bytes;
    }
  }

  const stats = getCacheStats();
  return {
    ...settings,
    deletedFiles,
    deletedBytes,
    totalFiles: stats.totalFiles,
    audioFiles: stats.audioFiles,
    totalBytes: stats.totalBytes,
  };
}

function clearCache({ keepPath = null } = {}) {
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const entry of listCacheEntries()) {
    const result = safeDeleteCacheFile(entry, keepPath);
    if (result.deleted) {
      deletedFiles += 1;
      deletedBytes += result.bytes;
    }
  }
  const stats = getCacheStats();
  return {
    deletedFiles,
    deletedBytes,
    totalFiles: stats.totalFiles,
    audioFiles: stats.audioFiles,
    totalBytes: stats.totalBytes,
  };
}

function renderCacheStatus() {
  const settings = getCacheSettings();
  const stats = getCacheStats();
  return [
    "Jukebox cache",
    "",
    `Cache dir: ${CACHE_DIR}`,
    `Current size: ${formatBytes(stats.totalBytes)}`,
    `Files: ${stats.totalFiles} total / ${stats.audioFiles} audio`,
    `Limit: ${settings.maxSizeMB} MB / ${settings.maxFiles} audio files`,
    "",
    "Automatic cleanup: enabled (LRU)",
    "Clear cache: /jb cache clear",
  ].join("\n");
}

// ── Jamendo API ──────────────────────────────────────────────────────────────

/**
 * Search Jamendo for tracks matching keywords.
 * Returns an array of track objects: { name, artist, url, license, duration }
 */
function searchJamendo(clientId, keywords, limit = 20) {
  return new Promise((resolve, reject) => {
    // Jamendo tags search works best with 1-2 tags max.
    // More tags = fewer results (AND logic). Keep it simple.
    const tags = keywords.split(/[\s,]+/).filter(Boolean).slice(0, 2).join("+");

    // Primary: tag search. Fallback: name search if tags yield nothing.
    const tagUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=${limit}&tags=${encodeURIComponent(tags)}&order=popularity_total&include=musicinfo+licenses`;
    const nameUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=${limit}&namesearch=${encodeURIComponent(keywords)}&order=popularity_total&include=musicinfo+licenses`;

    function parseTracks(data) {
      try {
        const json = JSON.parse(data);
        if (json.headers && json.headers.status === "failed") {
          return { error: json.headers.error_message || "request failed", tracks: [] };
        }
        if (!json.results || json.results.length === 0) {
          return { error: null, tracks: [] };
        }
        const tracks = json.results.map((t) => ({
          name: t.name || "Unknown",
          artist: t.artist_name || "Unknown",
          url: t.audiodownload || t.audio || "",
          license: t.license_ccurl || "Unknown",
          duration: t.duration || 0,
          id: t.id || "",
        })).filter((t) => t.url);
        return { error: null, tracks };
      } catch (e) {
        return { error: String(e), tracks: [] };
      }
    }

    function tryNameSearch() {
      get(nameUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          const result = parseTracks(data);
          if (result.error) reject(new Error(`Jamendo API: ${result.error}`));
          else resolve(result.tracks);
        });
        res.on("error", reject);
      }).on("error", reject);
    }

    get(tagUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        const result = parseTracks(data);
        if (result.error) {
          reject(new Error(`Jamendo API: ${result.error}`));
          return;
        }
        if (result.tracks.length > 0) {
          resolve(result.tracks);
        } else {
          // Tag search returned nothing — try name search.
          tryNameSearch();
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Download a track to cache and return the local path.
 */
function downloadTrack(track) {
  return new Promise((resolve, reject) => {
    ensureCacheDir();
    const safeName = String(track.id || track.name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const dest = join(CACHE_DIR, `jamendo-${safeName}.mp3`);
    if (existsSync(dest)) {
      touchCacheFile(dest);
      resolve(dest);
      return;
    }
    writeFileSync(dest, Buffer.alloc(0));
    get(track.url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          writeFileSync(dest, Buffer.concat(chunks));
          touchCacheFile(dest);
          resolve(dest);
        } catch (e) { reject(e); }
      });
      res.on("error", reject);
    }).on("error", (e) => {
      try { unlinkSync(dest); } catch (_) {}
      reject(e);
    });
  });
}

// ── Process management ───────────────────────────────────────────────────────

function killPidSync(pid) {
  if (!pid) return;
  try { spawnSync("/bin/kill", ["-TERM", String(pid)], { stdio: "ignore" }); } catch (_) {}
  try { spawnSync("/bin/sleep", ["0.05"], { stdio: "ignore" }); } catch (_) {}
  const check = spawnSync("/bin/kill", ["-0", String(pid)], { stdio: "ignore" });
  if (check.status !== 0) return;
  try { spawnSync("/bin/kill", ["-KILL", String(pid)], { stdio: "ignore" }); } catch (_) {}
}

function killAllJukeboxPlayers() {
  try { spawnSync("/usr/bin/pkill", ["-TERM", "-f", "afplay.*jukebox-cache"], { stdio: "ignore" }); } catch (_) {}
  try { spawnSync("/bin/sleep", ["0.06"], { stdio: "ignore" }); } catch (_) {}
  try { spawnSync("/usr/bin/pkill", ["-KILL", "-f", "afplay.*jukebox-cache"], { stdio: "ignore" }); } catch (_) {}
  try {
    const result = spawnSync("/usr/bin/pgrep", ["-f", "afplay.*jukebox-cache"], { encoding: "utf8" });
    if (result.stdout) {
      for (const pidStr of result.stdout.trim().split("\n").filter(Boolean)) {
        const pid = parseInt(pidStr, 10);
        if (pid && !isNaN(pid)) killPidSync(pid);
      }
    }
  } catch (_) {}
}

// ── Amplitude envelope extraction ────────────────────────────────────────────
// Pre-computes a coarse amplitude envelope from the audio file so the
// equalizer bars react to the actual music, not a fake animation.

const envelopeCache = new Map(); // path -> Float32Array (normalized 0..1)

function computeWavEnvelope(filePath) {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
    const sampleRate = buf.readUInt32LE(24);
    const dataOffset = 44;
    const totalSamples = Math.floor((buf.length - dataOffset) / 2);
    if (totalSamples <= 0) return null;
    const bucketsPerSec = 30; // higher resolution for more responsive bars
    const totalBuckets = Math.max(1, Math.floor((totalSamples / sampleRate) * bucketsPerSec));
    const envelope = new Float32Array(totalBuckets);
    const samplesPerBucket = Math.max(1, Math.floor(totalSamples / totalBuckets));
    for (let b = 0; b < totalBuckets; b++) {
      let peak = 0;
      const start = b * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, totalSamples);
      for (let i = start; i < end; i++) {
        const sample = Math.abs(buf.readInt16LE(dataOffset + i * 2)) / 32768;
        if (sample > peak) peak = sample;
      }
      envelope[b] = peak;
    }
    // Normalize to 0..1 using the 95th percentile (not max) to avoid
    // one-loud-spike dominating everything.
    const sorted = Array.from(envelope).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const norm = p95 > 0 ? p95 : 1;
    for (let i = 0; i < envelope.length; i++) {
      // Gamma curve: pow(x, 0.35) makes quiet parts much more visible
      // while keeping loud parts near the top. This is the key to
      // making the bars look dramatic even on quiet tracks.
      envelope[i] = Math.min(1, Math.pow(envelope[i] / norm, 0.35));
    }
    return envelope;
  } catch (_) { return null; }
}

function computeMp3Envelope(filePath) {
  try {
    // Convert MP3 to WAV using macOS afconvert, then read real samples.
    const wavPath = filePath.replace(/\.mp3$/, "-env.wav");
    try {
      execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", filePath, wavPath], { stdio: "ignore" });
    } catch (_) { return null; }
    // Read the converted WAV for envelope.
    const env = computeWavEnvelope(wavPath);
    // Clean up temp WAV.
    try { unlinkSync(wavPath); } catch (_) {}
    return env;
  } catch (_) { return null; }
}

function getEnvelope(filePath) {
  // Cache per file path — compute once, reuse across frames.
  // Computing every frame would read the entire WAV file 8x/sec = bottleneck.
  if (envelopeCache.has(filePath)) return envelopeCache.get(filePath);
  let env = null;
  if (filePath.endsWith(".wav")) env = computeWavEnvelope(filePath);
  else if (filePath.endsWith(".mp3")) env = computeMp3Envelope(filePath);
  if (env) envelopeCache.set(filePath, env);
  return env;
}

function clearEnvelopeCache() {
  envelopeCache.clear();
}

// ── UI ──────────────────────────────────────────────────────────────────────

function fit(text, width) {
  const value = String(text);
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + "…";
}

function bars(frame, mood, width, startedAt, currentFilePath) {
  const cfg = MOODS[mood] || MOODS.focus;
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const sharp = cfg.wave === "sharp" || mood === "panic" || mood === "deadline";
  const len = Math.max(8, Math.min(width, 42));

  // Try to get the real amplitude envelope for this file.
  const envelope = currentFilePath ? getEnvelope(currentFilePath) : null;

  const elapsedMs = startedAt ? Date.now() - startedAt : 0;
  const elapsedSec = elapsedMs / 1000;

  let out = "";
  for (let i = 0; i < len; i++) {
    let height;

    if (envelope && envelope.length > 0) {
      // Real envelope: map elapsed time to envelope position.
      const bucketPerSec = 30;
      const currentBucket = Math.floor(elapsedSec * bucketPerSec);
      const baseBucket = Math.min(currentBucket, envelope.length - 1);

      // Each bar reads a different bucket offset for a spectrum-analyzer spread.
      const halfLen = len / 2;
      const distFromCenter = Math.abs(i - halfLen) / halfLen;
      const offset = Math.floor(distFromCenter * 10) * (i < halfLen ? -1 : 1);
      const bucketIdx = Math.max(0, Math.min(envelope.length - 1, baseBucket + offset));
      const amp = envelope[bucketIdx];

      // Amplitude drives 82% of bar height — music dynamics dominate.
      // Small oscillation (10%) adds life on quiet parts without flattening dynamics.
      const freq = 0.3 + (i / len) * 0.8;
      const osc = 0.10 * Math.abs(Math.sin(elapsedMs / (80 + i * 12) + i * 0.5));
      const sharpOsc = sharp ? 0.06 * Math.abs(Math.sin(elapsedMs / 60 + i * 0.9)) : 0;
      const edgeBoost = distFromCenter * 0.08 * (0.5 + 0.5 * Math.sin(elapsedMs / 100 + i * 0.8));

      // Squared amplitude for dramatic contrast: quiet=very low, loud=very high.
      const ampDramatic = amp * amp * 0.5 + amp * 0.5; // blends linear + quadratic

      height = ampDramatic * 0.82 + osc + sharpOsc + edgeBoost;
      height = Math.max(0.03, Math.min(0.99, height));

      // Kick spike on sharp moods — every 5th bar, alternating.
      if (sharp && i % 5 === 0) {
        const kickPhase = Math.floor(elapsedMs / 200) % 2 === 0 ? 0.12 : 0;
        height = Math.min(0.99, height + kickPhase);
      }
    } else {
      // Fallback: fake animation (no envelope available).
      const phase = (i / len) * Math.PI * 2;
      const pulse = 0.5 + 0.5 * Math.sin(elapsedMs / 120 + phase);
      height = sharp
        ? pulse * 0.85 + (i % 3 === 0 ? 0.12 : 0)
        : pulse * 0.6 + 0.12;
      height = Math.max(0.08, Math.min(0.95, height));
    }

    out += blocks[Math.floor(height * (blocks.length - 1))];
  }
  return out;
}

function blueTheme(chalk) {
  if (!chalk) return null;
  return chalk.blueBright || chalk.cyanBright || chalk.cyan || chalk.blue;
}

function colorize(line, chalk, mood) {
  if (!chalk) return line;
  const theme = blueTheme(chalk);
  if (line.includes("WAITING ROOM FM")) return theme.bold ? theme.bold(line) : theme(line);
  if (line.includes("Now playing:")) return chalk.whiteBright ? chalk.whiteBright(line) : line;
  if (line.includes("/jb")) return chalk.dim ? chalk.dim(line) : line;
  if (/^[▁▂▃▄▅▆▇█░▒▓ ]+$/.test(line.trim())) return theme(line);
  return line;
}

// Gradient equalizer: uses ░▒▓█ block chars for a gradient look.
// The bars function returns plain ▁▂▃▄▅▆▇█, but we prepend ░▒▓ for a
// fade-in effect at the start of the equalizer line.
function gradientBars(frame, mood, width, startedAt, currentFilePath) {
  // Fully animated gradient equalizer.
  // Every character, including both edges, reacts to the current audio envelope.
  const cfg = MOODS[mood] || MOODS.focus;
  const sharp = cfg.wave === "sharp" || mood === "panic" || mood === "deadline";
  const len = Math.max(14, width);
  const elapsedMs = startedAt ? Date.now() - startedAt : 0;
  const elapsedSec = elapsedMs / 1000;
  const envelope = currentFilePath ? getEnvelope(currentFilePath) : null;

  // Quiet/dim -> loud/bright. The first three chars create the gradient feel,
  // but they are no longer static: they are selected by amplitude.
  const chars = ["░", "▒", "▓", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  let out = "";
  for (let i = 0; i < len; i++) {
    let amp;

    if (envelope && envelope.length > 0) {
      const bucketPerSec = 30;
      const currentBucket = Math.floor(elapsedSec * bucketPerSec);
      const center = (len - 1) / 2;
      const offset = Math.round((i - center) * 0.45);
      const bucket = Math.max(0, Math.min(envelope.length - 1, currentBucket + offset));
      amp = envelope[bucket];

      // Add per-column movement so left/right sides visibly animate too.
      const sideMotion = 0.16 * Math.abs(Math.sin(elapsedMs / (sharp ? 65 : 95) + i * 0.72));
      const fineMotion = 0.08 * Math.abs(Math.sin(elapsedMs / (sharp ? 38 : 70) + i * 1.13));
      amp = Math.min(1, amp * 0.76 + sideMotion + fineMotion);
    } else {
      const phase = (i / len) * Math.PI * 2;
      amp = 0.5 + 0.5 * Math.sin(elapsedMs / (sharp ? 80 : 130) + phase);
    }

    // Symmetric gradient shape: edges tend dimmer, center can peak higher,
    // but edges still change because amp drives the final value.
    const centerWeight = 1 - Math.abs(i - (len - 1) / 2) / ((len - 1) / 2); // 0 edge, 1 center
    const gradientBias = centerWeight * 0.22;
    const visual = Math.max(0, Math.min(1, amp * 0.82 + gradientBias));
    const idx = Math.max(0, Math.min(chars.length - 1, Math.floor(visual * (chars.length - 1))));
    out += chars[idx];
  }
  return out;
}

// Mini Player Card + thick border — balanced, information-rich.
// Plain text is padded first, then chalk is applied, so borders stay aligned.
function renderThinFrameVisual(state, width, chalk) {
  if (!state.playing && !state.message) return "";
  const elapsed = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;

  const theme = blueTheme(chalk);
  const dim = chalk?.dim || ((v) => v);
  const white = chalk?.whiteBright || ((v) => v);
  const bold = chalk?.bold || ((v) => v);

  function licenseLabel(url) {
    const value = String(url || "");
    if (!value || value === "Unknown") return "CC license";
    const match = value.match(/licenses\/([^/]+)\/([^/]+)/i);
    if (!match) return "CC license";
    return `CC ${match[1].toUpperCase()} ${match[2]}`;
  }

  function clip(text, w) {
    const t = String(text ?? "");
    if (t.length <= w) return t;
    return w <= 1 ? t.slice(0, w) : t.slice(0, w - 1) + "…";
  }

  function pad(text, w) {
    const t = clip(text, w);
    return t + " ".repeat(Math.max(0, w - t.length));
  }

  function center(text, w) {
    const t = clip(text, w);
    const left = Math.floor((w - t.length) / 2);
    const right = w - t.length - left;
    return " ".repeat(Math.max(0, left)) + t + " ".repeat(Math.max(0, right));
  }

  function line(content, colorFn = null) {
    const plain = pad(content, contentWidth);
    const colored = colorFn ? colorFn(plain) : plain;
    return "║ " + colored + " ║";
  }

  const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const sec = String(elapsed % 60).padStart(2, "0");
  const mode = state.loop ? "LOOP ON" : "AUTO NEXT";
  const source = (state.source || "Jamendo CC").replace(" (CC)", " CC");
  const station = state.station || "Waiting Room FM";
  const license = licenseLabel(state.license);
  const title = state.playing ? state.title : (state.message || "Waiting Room FM");
  const artist = state.playing ? (state.artist || "Unknown") : "";

  const titleLine = `♪ ${title} — ${artist}`;
  const compactMeta = `${min}:${sec} · ${state.loop ? "LOOP" : "AUTO"} · ${source} · ${license}`;
  const compactCmd = `/jb next · /jb stop · /jb ${state.pinned ? "unpin" : "pin"} · loop ${state.loop ? "on" : "off"} · source`;

  // Host panel height is capped, so keep the card to 8 lines total.
  // Width is based on the visible content so the box stays balanced.
  const maxAllowed = Math.max(44, Math.min(width - 4, 64));
  const target = Math.max(
    "NOW PLAYING".length,
    titleLine.length,
    compactMeta.length,
    compactCmd.length,
    44,
  ) + 4;
  const contentWidth = Math.max(44, Math.min(maxAllowed, target));

  const top = "╔" + "═".repeat(contentWidth + 2) + "╗";
  const bottom = "╚" + "═".repeat(contentWidth + 2) + "╝";
  const sep = "╟" + "─".repeat(contentWidth + 2) + "╢";

  const eqWidth = Math.max(20, Math.min(contentWidth - 6, 44));
  const eq = state.playing
    ? gradientBars(state.frame, state.mood, eqWidth, state.startedAt, state.currentFilePath)
    : "";

  const borderTop = theme ? theme(top) : top;
  const borderSep = theme ? theme(sep) : sep;
  const borderBottom = theme ? theme(bottom) : bottom;

  return [
    borderTop,
    line(center("NOW PLAYING", contentWidth), theme ? ((v) => theme(bold(v))) : bold),
    line(center(titleLine, contentWidth), white),
    line(center(eq, contentWidth), theme),
    borderSep,
    line(center(compactMeta, contentWidth), dim),
    line(center(compactCmd, contentWidth), dim),
    borderBottom,
  ];
}

// ── Setup guide ──────────────────────────────────────────────────────────────

const SETUP_GUIDE = [
  "WAITING ROOM FM — Setup Guide",
  "",
  "To stream real music from Jamendo (Creative Commons, free):",
  "",
  "Step 1: Go to https://developer.jamendo.com/",
  "Step 2: Click Sign Up (free account)",
  "Step 3: Fill in your email and create an account",
  "Step 4: After login, go to My Apps > Create a new App",
  "Step 5: Copy your Client ID",
  "Step 6: Run:  /jb setkey YOUR_CLIENT_ID",
  "",
  "That's it. After setkey, /jb <keyword> will search Jamendo",
  "and play real CC-licensed tracks.",
  "",
  "Without a key, /jb cannot play music. Run /jb setup first.",
  "",
  "Current key status: see /jb source",
];

// ── Mod ──────────────────────────────────────────────────────────────────────

export default function activate(letta) {
  const disposers = [];
  const activePids = new Set();
  let currentToken = 0;
  let state = {
    playing: false,
    mood: null,
    title: null,
    artist: null,
    station: null,
    source: null,
    license: null,
    startedAt: 0,
    pinned: false,
    frame: 0,
    message: "",
    currentFilePath: null,
    loop: false,
    lastKeywords: null,
  };
  let visualPanel = null;
  let statusPanel = null;
  let animationTimer = null;
  let transientCloseTimer = null;

  killAllJukeboxPlayers();
  pruneCache();

  function stopTimers() {
    if (animationTimer) clearInterval(animationTimer);
    if (transientCloseTimer) clearTimeout(transientCloseTimer);
    animationTimer = null;
    transientCloseTimer = null;
  }

  function killAllSound() {
    currentToken += 1;
    for (const pid of activePids) killPidSync(pid);
    activePids.clear();
    killAllJukeboxPlayers();
  }

  function closeVisual() {
    if (visualPanel && !state.pinned) {
      try { visualPanel.close(); } catch (_) {}
      visualPanel = null;
    }
    // When the larger visual panel is gone, restore the compact statusline.
    if (state.playing && letta.capabilities.ui.panels && !statusPanel) {
      statusPanel = letta.ui.openPanel({ id: `${MOD_ID}-status`, order: 0, render: renderStatus });
    }
  }

  function closeAllPanels() {
    if (visualPanel) { try { visualPanel.close(); } catch (_) {} visualPanel = null; }
    if (statusPanel) { try { statusPanel.close(); } catch (_) {} statusPanel = null; }
  }

  function renderVisual({ width, chalk }) {
    return renderThinFrameVisual(state, width, chalk);
  }

  function renderStatus({ width, row, chalk, agent, model }) {
    if (!state.playing) return "";
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const sec = String(elapsed % 60).padStart(2, "0");

    // Recreate the built-in statusline shape on the left so /jb does not
    // hide the user's normal agent/model information.
    const agentName = agent?.name || "Letta";
    const modelName = model?.displayName || model?.id || "model";
    const baseLeftRaw = `${agentName} · ${modelName}`;

    // Put jukebox info in the remaining right side.
    const jbRaw = `♪ ${state.title} · ${min}:${sec}`;
    const maxRight = Math.max(12, Math.floor(width * 0.42));
    const rightRaw = fit(jbRaw, maxRight);

    const statusTheme = blueTheme(chalk);
    const left = chalk?.dim ? chalk.dim(fit(baseLeftRaw, Math.max(8, width - rightRaw.length - 3))) : fit(baseLeftRaw, Math.max(8, width - rightRaw.length - 3));
    const right = statusTheme ? statusTheme(rightRaw) : rightRaw;
    return row ? row(left, right, width) : fit(`${baseLeftRaw}  ${rightRaw}`, width);
  }

  function ensurePanels({ transient = false } = {}) {
    if (!letta.capabilities.ui.panels) return;

    const wantsVisual = state.pinned || transient;

    if (wantsVisual) {
      // The host caps total panel height. Close the one-line status panel while
      // the larger player card is visible so the full box can render.
      if (statusPanel) {
        try { statusPanel.close(); } catch (_) {}
        statusPanel = null;
      }
      if (!visualPanel) {
        visualPanel = letta.ui.openPanel({ id: `${MOD_ID}-visual`, order: 80, render: renderVisual });
      } else { visualPanel.update(); }
    } else {
      if (!statusPanel) {
        statusPanel = letta.ui.openPanel({ id: `${MOD_ID}-status`, order: 0, render: renderStatus });
      } else { statusPanel.update(); }
      if (visualPanel) visualPanel.update();
    }

    if (transient && !state.pinned) {
      if (transientCloseTimer) clearTimeout(transientCloseTimer);
      transientCloseTimer = setTimeout(closeVisual, 6000);
    }
    if (!animationTimer) {
      animationTimer = setInterval(() => {
        state.frame += 1;
        if (visualPanel) visualPanel.update();
        if (statusPanel) statusPanel.update();
      }, 120);
    }
  }

  function spawnPlayback(path, token, keywords) {
    if (token !== currentToken || !state.playing) return;
    const proc = spawn("/usr/bin/afplay", [path], { stdio: "ignore" });
    const pid = proc.pid;
    if (pid) activePids.add(pid);

    proc.on("close", () => {
      activePids.delete(pid);
      if (token !== currentToken || !state.playing) return;

      if (state.loop) {
        // Loop mode: replay the same file.
        spawnPlayback(path, token, keywords);
      } else if (keywords) {
        // Auto-next: search Jamendo for another track with the same keywords.
        autoNextTrack(keywords, token);
      } else {
        // No keywords (shouldn't happen, but fallback to replay).
        spawnPlayback(path, token, keywords);
      }
    });
    proc.on("error", () => {
      activePids.delete(pid);
      if (token !== currentToken) return;
      state.playing = false;
      state.message = "Playback failed.";
      if (visualPanel) visualPanel.update();
      if (statusPanel) statusPanel.update();
    });
  }

  async function autoNextTrack(keywords, token) {
    if (token !== currentToken || !state.playing) return;
    const clientId = getJamendoClientId();
    if (!clientId) return;

    try {
      const tracks = await searchJamendo(clientId, keywords);
      if (!tracks || tracks.length === 0) {
        // No more tracks — replay current as fallback.
        spawnPlayback(state.currentFilePath, token, keywords);
        return;
      }
      // Pick a different track if possible.
      let track = pick(tracks);
      if (tracks.length > 1 && track.name === state.title) {
        track = pick(tracks.filter((t) => t.name !== state.title));
        if (!track) track = pick(tracks);
      }
      const localPath = await downloadTrack(track);
      if (token !== currentToken || !state.playing) return; // stale

      killAllSound();
      await new Promise((r) => setTimeout(r, 40));
      const newToken = ++currentToken;

      state = {
        ...state,
        title: track.name,
        artist: track.artist,
        source: "Jamendo (CC)",
        license: track.license,
        startedAt: Date.now(),
        frame: 0,
        currentFilePath: localPath,
        message: `next: ${track.name}`,
      };
      clearEnvelopeCache();
      pruneCache({ keepPath: localPath });
      spawnPlayback(localPath, newToken, keywords);
      if (visualPanel) visualPanel.update();
      if (statusPanel) statusPanel.update();

      setTimeout(() => {
        if (state.playing && state.message?.startsWith("next:")) {
          state.message = "";
          if (visualPanel) visualPanel.update();
        }
      }, 2000);
    } catch (_) {
      // Search failed — replay current.
      spawnPlayback(state.currentFilePath, token, keywords);
    }
  }

  async function startJamendoPlayback(keywords, { transient = true } = {}) {
    const clientId = getJamendoClientId();
    if (!clientId) return { ok: false, reason: "nokey" };

    try {
      const tracks = await searchJamendo(clientId, keywords);
      if (!tracks || tracks.length === 0) {
        return { ok: false, reason: "noresults" };
      }
      const track = pick(tracks);
      killAllSound();
      await new Promise((r) => setTimeout(r, 50));
      const localPath = await downloadTrack(track);
      const token = ++currentToken;

      // Determine mood from keywords for visual theme
      const mood = normalizeMood(keywords) || "focus";
      const cfg = MOODS[mood] || MOODS.focus;

      state = {
        ...state,
        playing: true,
        mood,
        title: track.name,
        artist: track.artist,
        station: cfg.station,
        source: "Jamendo (CC)",
        license: track.license,
        startedAt: Date.now(),
        frame: 0,
        currentFilePath: localPath,
        lastKeywords: keywords,
        message: `tuning... signal locked: ${cfg.station}`,
      };
      clearEnvelopeCache();
      pruneCache({ keepPath: localPath });

      spawnPlayback(localPath, token, keywords);
      ensurePanels({ transient });

      setTimeout(() => {
        if (state.playing && state.message?.startsWith("tuning")) {
          state.message = "";
          if (visualPanel) visualPanel.update();
        }
      }, 1800);

      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error", message: String(e.message || e) };
    }
  }


  async function startPlayback(input, { transient = true } = {}) {
    const clientId = getJamendoClientId();
    if (!clientId) {
      return { ok: false, message: "No Jamendo API key set. Run /jb setup to get started." };
    }

    const mood = normalizeMood(input);
    const searchTerms = mood ? (MOODS[mood].tags.join(" ")) : input;
    const result = await startJamendoPlayback(searchTerms, { transient });

    if (result.ok) return { ok: true };

    if (result.reason === "noresults") {
      state.message = `No Jamendo results for "${input}". Try another keyword.`;
      if (visualPanel) visualPanel.update();
      return { ok: false, message: `No results for "${input}".` };
    }
    if (result.reason === "error") {
      state.message = `Jamendo error: ${result.message || "unknown"}`;
      if (visualPanel) visualPanel.update();
      return { ok: false, message: result.message || "Jamendo error" };
    }
    return result;
  }

  function stopPlayback({ show = true } = {}) {
    state.playing = false;
    state.message = "Playback stopped.";
    killAllSound();
    if (statusPanel) statusPanel.update();
    if (show && letta.capabilities.ui.panels) {
      state.pinned = false;
      if (!visualPanel) visualPanel = letta.ui.openPanel({ id: `${MOD_ID}-visual`, order: 80, render: renderVisual });
      visualPanel.update();
      setTimeout(() => {
        if (visualPanel) { try { visualPanel.close(); } catch (_) {} visualPanel = null; }
        if (statusPanel) { try { statusPanel.close(); } catch (_) {} statusPanel = null; }
        stopTimers();
      }, 2500);
    } else {
      closeAllPanels();
      stopTimers();
    }
  }

  async function handle(args) {
    const input = String(args || "").trim();
    const cmd = input.toLowerCase();

    // ── Setup commands ───────────────────────────────────────────────────────

    if (cmd === "setup" || cmd === "help") {
      const hasKey = !!getJamendoClientId();
      const guide = [...SETUP_GUIDE];
      guide[guide.length - 1] = `Current key status: ${hasKey ? "Jamendo key set" : "No key — run /jb setup"}`;
      return { type: "output", output: guide.join("\n") };
    }

    if (cmd === "setkey" || cmd.startsWith("setkey ")) {
      const key = input.replace(/^setkey\s+/i, "").trim();
      if (!key) {
        return { type: "output", output: "Usage: /jb setkey YOUR_JAMENDO_CLIENT_ID\n\nGet a free key at https://developer.jamendo.com/" };
      }
      const cfg = loadConfig();
      cfg.jamendoClientId = key;
      saveConfig(cfg);
      return { type: "output", output: "Jamendo Client ID saved.\nYou can now use /jb <keyword> to stream real CC-licensed music.\nRun /jb source to verify." };
    }

    if (cmd === "source" || cmd === "info") {
      const hasKey = !!getJamendoClientId();
      const lines = [
        "WAITING ROOM FM — Source Info",
        "",
        `Jamendo API key: ${hasKey ? "Configured" : "Not set — run /jb setup"}`,
        `Config file: ${CONFIG_PATH}`,
        `Cache dir: ${CACHE_DIR}`,
        "",
        "Music source: Jamendo (Creative Commons)",
        "Cache cleanup: automatic LRU (see /jb cache)",
        "",
        "To search by keyword: /jb rainy day focus",
      ];
      if (state.playing) {
        lines.push("", "Currently playing:", `  Title: ${state.title}`, `  Artist: ${state.artist || "N/A"}`, `  Source: ${state.source}`, `  License: ${state.license || "N/A"}`);
      }
      return { type: "output", output: lines.join("\n") };
    }

    if (cmd === "cache") {
      const result = pruneCache({ keepPath: state.currentFilePath });
      const suffix = result.deletedFiles > 0
        ? `\n\nCleaned: ${result.deletedFiles} files (${formatBytes(result.deletedBytes)})`
        : "";
      return { type: "output", output: renderCacheStatus() + suffix };
    }

    if (cmd === "cache clear" || cmd === "clear cache") {
      const result = clearCache({ keepPath: state.currentFilePath });
      return { type: "output", output: [
        "Jukebox cache cleared.",
        `Deleted: ${result.deletedFiles} files (${formatBytes(result.deletedBytes)})`,
        state.currentFilePath ? "Currently playing track was kept." : "",
        "",
        renderCacheStatus(),
      ].filter(Boolean).join("\n") };
    }

    // ── Playback commands ────────────────────────────────────────────────────

    if (!input || cmd === "now") {
      if (!state.playing) {
        return { type: "output", output: "Waiting Room FM is quiet.\nTry /jb focus, /jb deadline, /jb rainy day, /jb setup" };
      }
      ensurePanels({ transient: true });
      return { type: "handled" };
    }

    if (cmd === "list" || cmd === "moods") {
      return { type: "output", output: `Waiting Room FM moods:\n${Object.keys(MOODS).join(", ")}\n\nOr search by keyword: /jb <any words>\n\nCommands: /jb <mood|keyword>, /jb next, /jb stop, /jb pin, /jb unpin, /jb loop [on|off], /jb now, /jb cache, /jb cache clear, /jb setup, /jb setkey, /jb source` };
    }

    if (cmd === "stop" || cmd === "silence") {
      stopPlayback({ show: true });
      return { type: "handled" };
    }

    if (cmd === "pin") {
      state.pinned = true;
      ensurePanels({ transient: true });
      return { type: "handled" };
    }

    if (cmd === "unpin") {
      state.pinned = false;
      closeVisual();
      return { type: "handled" };
    }

    if (cmd === "loop" || cmd === "loop on" || cmd === "loop off") {
      if (cmd === "loop") state.loop = !state.loop; // toggle
      else state.loop = cmd === "loop on";
      ensurePanels({ transient: true });
      return { type: "handled" };
    }

    if (cmd === "next" || cmd === "skip") {
      const choices = Object.keys(MOODS).filter((m) => m !== state.mood);
      const nextMood = pick(choices);
      const result = await startPlayback(nextMood, { transient: true });
      return { type: "handled" };
    }

    // ── Keyword or mood playback ─────────────────────────────────────────────

    const result = await startPlayback(input, { transient: true });
    return { type: "handled" };
  }

  if (letta.capabilities.commands) {
    const spec = {
      description: "Play Jamendo Creative Commons music with a terminal jukebox UI",
      args: "<mood|keyword|next|stop|now|list|pin|unpin|loop|cache|setup|setkey|source>",
      runWhenBusy: true,
      showInTranscript: false,
      async run(ctx) { return handle(ctx.args); },
    };
    disposers.push(letta.commands.register({ id: "jukebox", ...spec }));
    disposers.push(letta.commands.register({ id: "jb", ...spec, description: "Alias for /jukebox" }));
  }

  return () => {
    stopPlayback({ show: false });
    for (const dispose of disposers.reverse()) dispose();
  };
}