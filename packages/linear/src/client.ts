import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  CONFIGURED_TEAMS_QUERY,
  DEFAULT_LIMIT,
  ISSUE_FULL_QUERY,
  ISSUE_SUMMARY_QUERY,
} from "./config.ts";
import type {
  IssueDetail,
  LinearConnection,
  LinearIssue,
  LinearRunner,
  LinearTeam,
  QueryResult,
} from "./types.ts";
import { compactError, normalizeIssueIdentifier } from "./utils.ts";

const execFileAsync = promisify(execFile);
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SYSTEMROOT",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "SECURITYSESSIONID",
  "NO_COLOR",
] as const;

export function buildLinearChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function readLinearTeamKey(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = source.LINEAR_TEAM_KEY?.trim();
  return value || undefined;
}

export function formatLinearProcessError(error: unknown): string {
  if (!error || typeof error !== "object") return "Linear CLI failed";
  const candidate = error as { stderr?: string; stdout?: string; code?: string | number };
  const output = candidate.stderr?.trim() || candidate.stdout?.trim();
  if (output) return compactError(output);
  if (candidate.code === "ENOENT") return "Linear CLI executable not found";
  return candidate.code !== undefined
    ? `Linear CLI failed (exit ${String(candidate.code)})`
    : "Linear CLI failed";
}

export function createLinearRunner(executable = "linear"): LinearRunner {
  const env = buildLinearChildEnv();
  return async (args, signal) => {
    try {
      const { stdout } = await execFileAsync(executable, args, {
        cwd: homedir(),
        encoding: "utf8",
        env,
        maxBuffer: 16 * 1024 * 1024,
        signal,
        windowsHide: true,
      });
      return stdout.trim();
    } catch (error) {
      throw new Error(formatLinearProcessError(error));
    }
  };
}

export class LinearClient {
  private team: LinearTeam | undefined;

  constructor(
    private readonly run: LinearRunner = createLinearRunner(),
    private readonly configuredTeamKey: string | undefined = readLinearTeamKey(),
  ) {}

  async text(args: string[], signal?: AbortSignal): Promise<string> {
    return this.run(args, signal);
  }

  async api<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const output = await this.run(["api", query, "--variables-json", JSON.stringify(variables)], signal);
    const parsed = JSON.parse(output) as { data?: T; errors?: Array<{ message?: string }> };
    if (parsed.errors?.length) {
      throw new Error(parsed.errors.map((error) => error.message ?? "Linear GraphQL error").join("; "));
    }
    if (!parsed.data) throw new Error("Linear GraphQL response did not include data");
    return parsed.data;
  }

  async queryIssues(options: {
    search?: string;
    state?: string;
    assignee?: string;
    project?: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<LinearIssue[]> {
    const team = await this.getTeam(options.signal);
    const args = [
      "issue",
      "query",
      "--team",
      team.key,
      "--limit",
      String(options.limit ?? DEFAULT_LIMIT),
      "--json",
      "--no-pager",
    ];
    if (options.search) args.push("--search", options.search);
    else args.push("--sort", "priority");
    if (options.state) args.push("--state", options.state);
    if (options.assignee) args.push("--assignee", options.assignee);
    if (options.project) args.push("--project", options.project);

    const output = await this.run(args, options.signal);
    const parsed = JSON.parse(output) as QueryResult;
    return Array.isArray(parsed.nodes) ? parsed.nodes : [];
  }

  async getIssues(identifiers: string[], detail: IssueDetail, signal?: AbortSignal): Promise<LinearIssue[]> {
    const data = await this.api<{ issues?: QueryResult }>(
      detail === "full" ? ISSUE_FULL_QUERY : ISSUE_SUMMARY_QUERY,
      { ids: identifiers },
      signal,
    );
    return Array.isArray(data.issues?.nodes) ? data.issues.nodes : [];
  }

  async getIssue(identifier: string, signal?: AbortSignal): Promise<LinearIssue> {
    const normalized = normalizeIssueIdentifier(identifier);
    const issues = await this.getIssues([normalized], "summary", signal);
    const issue = issues.find((candidate) => candidate.identifier?.toUpperCase() === normalized);
    if (!issue) throw new Error(`Linear issue not found: ${normalized}`);
    return issue;
  }

  async getTeam(signal?: AbortSignal): Promise<LinearTeam> {
    if (this.team) return this.team;
    const filter = this.configuredTeamKey
      ? { key: { eqIgnoreCase: this.configuredTeamKey } }
      : {};
    const data = await this.api<{ teams?: LinearConnection<LinearTeam> }>(
      CONFIGURED_TEAMS_QUERY,
      { filter },
      signal,
    );
    const teams = Array.isArray(data.teams?.nodes) ? data.teams.nodes : [];
    if (teams.length === 0) {
      throw new Error(this.configuredTeamKey
        ? `Linear team not found: ${this.configuredTeamKey}`
        : "No Linear teams found for the authenticated workspace");
    }
    if (!this.configuredTeamKey && teams.length > 1) {
      throw new Error("Set LINEAR_TEAM_KEY when the Linear workspace has multiple teams");
    }
    this.team = teams[0];
    return this.team;
  }
}
