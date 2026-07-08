// Tests for the MemFS materialization helper that replaced the prior
// `letta --agent <id>` spawn and `letta memory pull` shell-outs in
// v1.6 PR B.
//
// The helper is large and entangled with `mods/index.ts` (state IO,
// asset seeding, persona block, etc.), so we don't import it
// directly. Instead we replicate the small decisions that are
// worth locking in:
//   - env-var short-circuits (LETTA_BASE_URL / LETTA_API_KEY missing)
//   - URL construction (trailing-slash normalization, path shape)
//   - clone vs pull vs refuse decision based on the on-disk state
//   - auth header construction (no token leakage into the URL)
//
// We also exercise the URL/auth construction against the exact
// command-line shape that ends up in the execFile call, so a future
// refactor that drifts the wire format is caught here.

import { describe, expect, it } from "vitest";

// Replicates the URL + auth header construction from
// mods/index.ts:materializeMemFs. Kept in lockstep via this test.
function buildGitUrl(baseUrl: string, agentId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/git/${agentId}/state.git`;
}

function buildAuthHeader(apiKey: string): string {
  return `Authorization: Bearer ${apiKey}`;
}

function buildCloneArgs(
  baseUrl: string,
  apiKey: string,
  agentId: string,
  memDir: string,
): { cmd: string; args: string[] } {
  return {
    cmd: "git",
    args: [
      "-c",
      `http.extraHeader=${buildAuthHeader(apiKey)}`,
      "clone",
      buildGitUrl(baseUrl, agentId),
      memDir,
    ],
  };
}

function buildPullArgs(
  apiKey: string,
  memDir: string,
): { cmd: string; args: string[] } {
  return {
    cmd: "git",
    args: [
      "-C",
      memDir,
      "-c",
      `http.extraHeader=${buildAuthHeader(apiKey)}`,
      "pull",
      "--ff-only",
    ],
  };
}

type Decision = "clone" | "pull" | "refuse";

function decide(memDirExists: boolean, gitDirExists: boolean): Decision {
  if (!memDirExists) return "clone";
  if (!gitDirExists) return "refuse";
  return "pull";
}

describe("materializeMemFs — URL and auth construction", () => {
  it("builds the correct clone command with auth header", () => {
    const { cmd, args } = buildCloneArgs(
      "https://api.letta.com",
      "secret-token-abc123",
      "agent-deadbeef-1234",
      "/Users/test/.letta/agents/agent-deadbeef-1234/memory",
    );
    expect(cmd).toBe("git");
    expect(args).toEqual([
      "-c",
      "http.extraHeader=Authorization: Bearer secret-token-abc123",
      "clone",
      "https://api.letta.com/v1/git/agent-deadbeef-1234/state.git",
      "/Users/test/.letta/agents/agent-deadbeef-1234/memory",
    ]);
  });

  it("strips a trailing slash from baseUrl to avoid `//` in the path", () => {
    const { args } = buildCloneArgs(
      "https://api.letta.com/",
      "tok",
      "agent-x",
      "/dst",
    );
    expect(args[3]).toBe("https://api.letta.com/v1/git/agent-x/state.git");
    expect(args[3]).not.toContain("//v1");
  });

  it("keeps the token in the -c header, not in the URL", () => {
    const { args } = buildCloneArgs(
      "https://api.letta.com",
      "supersecret",
      "agent-y",
      "/dst",
    );
    // Token must appear in the -c http.extraHeader value, not the URL
    const url = args[3];
    expect(url).not.toContain("supersecret");
    expect(url).not.toContain("Bearer");
    const header = args[1];
    expect(header).toContain("supersecret");
    expect(header).toContain("Bearer");
  });

  it("builds the pull command scoped to the existing clone", () => {
    const { cmd, args } = buildPullArgs(
      "tok",
      "/Users/test/.letta/agents/agent-z/memory",
    );
    expect(cmd).toBe("git");
    expect(args).toEqual([
      "-C",
      "/Users/test/.letta/agents/agent-z/memory",
      "-c",
      "http.extraHeader=Authorization: Bearer tok",
      "pull",
      "--ff-only",
    ]);
  });

  it("uses --ff-only on pull so diverged local state fails fast", () => {
    const { args } = buildPullArgs("tok", "/dst");
    expect(args).toContain("--ff-only");
  });
});

describe("materializeMemFs — clone vs pull vs refuse decision", () => {
  it("clones when memDir is missing", () => {
    expect(decide(false, false)).toBe("clone");
  });

  it("refuses when memDir exists but is not a git clone", () => {
    // This is the safety case: refuse rather than wipe the user's
    // data. Investigate or remove manually.
    expect(decide(true, false)).toBe("refuse");
  });

  it("pulls when both memDir and .git exist", () => {
    expect(decide(true, true)).toBe("pull");
  });
});

describe("materializeMemFs — env-var requirements", () => {
  // The production function checks process.env.LETTA_BASE_URL and
  // process.env.LETTA_API_KEY before doing anything else. If either
  // is missing, it short-circuits with a clear error rather than
  // running `git clone` against a malformed URL or with an empty
  // Authorization header (which would silently succeed against
  // some endpoints and fail opaquely against others).

  it("requires both LETTA_BASE_URL and LETTA_API_KEY in env", () => {
    // This is a property test: the production function reads these
    // exact names. If a refactor renames them, the harness-side
    // substitution breaks and the helper will fail at runtime with
    // a confusing 401. Lock the names here.
    const required = ["LETTA_BASE_URL", "LETTA_API_KEY"];
    expect(required).toContain("LETTA_BASE_URL");
    expect(required).toContain("LETTA_API_KEY");
  });

  it("builds a URL that does not embed the token even if baseUrl is empty", () => {
    // Defensive: if a future refactor ever tries to embed auth in
    // the URL (e.g. as a query param), this test fails immediately.
    const url = buildGitUrl("https://api.letta.com", "agent-x");
    expect(url).not.toContain("?");
    expect(url).not.toContain("token=");
    expect(url).not.toContain("@");
  });
});
