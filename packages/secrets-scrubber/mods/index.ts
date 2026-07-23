import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { scan } from "@sanity-labs/secret-scan";

const REDACTION_PREFIX = "REDACTED";
const MAX_TRACKED_BACKGROUND_FILES = 1_000;
const OVERFLOW_FILE_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/i;
const BACKGROUND_FILE_NAME = /^(?:bash_\d+|task_\d+)\.log$/;
const TASK_ID = /^(?:bash_\d+|task_\d+)$/;
const BREADCRUMB_PATTERNS = [
  /^\[Full output written to: (.+)]$/gm,
  /^Output file: (.+)$/gm,
] as const;
const BACKGROUND_TASK_PATTERN = /^(?:Command|Task) running in background with (?:ID|task ID): ((?:bash_|task_)\d+)$/m;

type ToolStatus = "success" | "error";

export interface ToolEndEvent {
  args: Record<string, unknown>;
  output: string;
  status: ToolStatus;
  toolName: string;
}

export interface LettaModApi {
  capabilities: { events: { tools: boolean } };
  diagnostics?: {
    report(input: { message: string; severity?: "warning" | "error" }): void;
  };
  events: {
    on(
      name: "tool_end",
      handler: (event: ToolEndEvent) => Promise<unknown> | unknown,
    ): () => void;
  };
}

interface FileIdentity {
  dev: bigint | number;
  ino: bigint | number;
  mode: number;
}

interface ScrubResult {
  changed: boolean;
  output: string;
}

interface SecretMatch {
  end: number;
  label: string;
  start: number;
}

const CREDENTIAL_ASSIGNMENT = /\b(?:[a-z][a-z0-9]*[_-])*(?:password|passwd|pwd|api[_-]?key|(?:access|auth|bearer|refresh|session|id|csrf)[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|secret[_-]?key|private[_-]?key|token|secret)\b\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s,;}\]\r\n]+))/gi;
const AUTHORIZATION_HEADER = /\b(?:authorization|proxy-authorization)\s*:\s*(?:basic|bearer|token|api[-_ ]?key)\s+([^\s,;]+)/gi;

function contextualMatches(input: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const pattern of [CREDENTIAL_ASSIGNMENT, AUTHORIZATION_HEADER]) {
    pattern.lastIndex = 0;
    for (const match of input.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || value.startsWith(`[${REDACTION_PREFIX}:`)) continue;
      const offset = match[0].lastIndexOf(value);
      if (match.index === undefined || offset < 0) continue;
      matches.push({
        end: match.index + offset + value.length,
        label: pattern === AUTHORIZATION_HEADER ? "Authorization" : "Credential",
        start: match.index + offset,
      });
    }
  }
  return matches;
}

function allSecretMatches(input: string): SecretMatch[] {
  const candidates: SecretMatch[] = [
    ...scan(input).map((secret) => ({
      end: secret.end,
      label: secret.label,
      start: secret.start,
    })),
    ...contextualMatches(input),
  ].sort((left, right) => left.start - right.start || right.end - left.end);

  const nonOverlapping: SecretMatch[] = [];
  for (const candidate of candidates) {
    const previous = nonOverlapping.at(-1);
    if (previous && candidate.start < previous.end) {
      previous.end = Math.max(previous.end, candidate.end);
      continue;
    }
    nonOverlapping.push(candidate);
  }
  return nonOverlapping;
}

export function scrubText(input: string): ScrubResult {
  const matches = allSecretMatches(input);
  let output = input;
  for (const match of matches.reverse()) {
    output = `${output.slice(0, match.start)}[${REDACTION_PREFIX}: ${match.label}]${output.slice(match.end)}`;
  }
  return { changed: output !== input, output };
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function allowedOverflowPath(path: string): boolean {
  const parent = canonicalPath(dirname(path));
  const agentToolsRoot = canonicalPath(resolve(homedir(), ".letta", "projects"));
  if (!parent || !agentToolsRoot || !isWithin(agentToolsRoot, parent)) return false;

  const parts = relative(agentToolsRoot, parent).split(sep);
  return parts.length === 2 && parts[0].length > 0 && parts[1] === "agent-tools";
}

function allowedBackgroundPath(path: string): boolean {
  const parent = canonicalPath(dirname(path));
  if (!parent) return false;

  const scratchpad = process.env.LETTA_SCRATCHPAD;
  if (scratchpad && parent === canonicalPath(scratchpad)) return true;

  const tempRoot = canonicalPath(tmpdir());
  return Boolean(
    tempRoot &&
      dirname(parent) === tempRoot &&
      /^letta-background-[a-zA-Z0-9]{6}$/.test(basename(parent)),
  );
}

export function isAllowedOutputPath(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const fileName = basename(path);
  if (OVERFLOW_FILE_NAME.test(fileName)) return allowedOverflowPath(path);
  if (BACKGROUND_FILE_NAME.test(fileName)) return allowedBackgroundPath(path);
  return false;
}

export function extractOutputPaths(output: string): string[] {
  const paths = new Set<string>();
  for (const pattern of BREADCRUMB_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of output.matchAll(pattern)) {
      const path = match[1]?.trim();
      if (path) paths.add(path);
    }
  }
  return [...paths];
}

function readRegularFile(path: string): { content: string; identity: FileIdentity } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile()) return null;
    return {
      content: readFileSync(fd, "utf8"),
      identity: { dev: stat.dev, ino: stat.ino, mode: Number(stat.mode) & 0o777 },
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function sameFile(path: string, identity: FileIdentity): boolean {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino;
  } catch {
    return false;
  }
}

function atomicReplace(path: string, content: string, identity: FileIdentity): boolean {
  const tempPath = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: identity.mode,
    });
    if (!sameFile(path, identity)) return false;
    renameSync(tempPath, path);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function scrubOutputFile(path: string): "changed" | "unchanged" | "rejected" | "failed" {
  if (!isAllowedOutputPath(path)) return "rejected";

  const original = readRegularFile(path);
  if (!original) return "rejected";

  let scrubbed: ScrubResult;
  try {
    scrubbed = scrubText(original.content);
  } catch {
    return "failed";
  }
  if (!scrubbed.changed) return "unchanged";
  return atomicReplace(path, scrubbed.output, original.identity) ? "changed" : "failed";
}

function backgroundTaskId(event: ToolEndEvent): string | null {
  if (event.args.run_in_background !== true) return null;
  return event.output.match(BACKGROUND_TASK_PATTERN)?.[1] ?? null;
}

function taskIdFromArgs(event: ToolEndEvent): string | null {
  const candidate = event.args.task_id ?? event.args.shell_id;
  return typeof candidate === "string" && TASK_ID.test(candidate) ? candidate : null;
}

function completedTaskOutput(event: ToolEndEvent): boolean {
  if (event.toolName !== "TaskOutput") return false;
  try {
    const parsed = JSON.parse(event.output) as { status?: unknown };
    return parsed.status === "completed" || parsed.status === "failed";
  } catch {
    return false;
  }
}

function rememberBackgroundPath(
  paths: Map<string, string>,
  taskId: string,
  path: string,
): void {
  paths.delete(taskId);
  paths.set(taskId, path);
  while (paths.size > MAX_TRACKED_BACKGROUND_FILES) {
    const oldest = paths.keys().next().value;
    if (typeof oldest !== "string") break;
    paths.delete(oldest);
  }
}

export default function activate(letta: LettaModApi): (() => void) | undefined {
  if (!letta.capabilities.events.tools) return;

  const backgroundOutputPaths = new Map<string, string>();

  return letta.events.on("tool_end", (event) => {
    try {
      const paths = extractOutputPaths(event.output);
      const launchedTaskId = backgroundTaskId(event);
      let fileScanFailed = false;

      for (const path of paths) {
        if (!isAllowedOutputPath(path)) continue;
        if (launchedTaskId && BACKGROUND_FILE_NAME.test(basename(path))) {
          rememberBackgroundPath(backgroundOutputPaths, launchedTaskId, path);
          continue;
        }

        const result = scrubOutputFile(path);
        if (result === "failed" || result === "rejected") fileScanFailed = true;
      }

      const consumedTaskId = taskIdFromArgs(event);
      if (consumedTaskId && completedTaskOutput(event)) {
        const path = backgroundOutputPaths.get(consumedTaskId);
        if (path) {
          const result = scrubOutputFile(path);
          if (result === "failed" || result === "rejected") {
            fileScanFailed = true;
          } else {
            backgroundOutputPaths.delete(consumedTaskId);
          }
        }
      }

      if (fileScanFailed) {
        throw new Error("failed to safely scan a referenced output file");
      }

      const scrubbed = scrubText(event.output);
      if (!scrubbed.changed) return;
      return { result: { status: event.status, output: scrubbed.output } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      letta.diagnostics?.report({
        message: `Secrets scrubber failed closed: ${message}`,
        severity: "error",
      });
      return {
        result: {
          status: event.status,
          output: "[Tool output withheld because the secrets scrubber could not inspect it safely.]",
        },
      };
    }
  });
}
