import { describe, expect, test } from "bun:test";
import {
  buildLinearChildEnv,
  formatLinearProcessError,
  LinearClient,
  readLinearTeamKey,
} from "../src/client.ts";
import { registerLinearCommand } from "../src/command.ts";
import { registerLinearTools } from "../src/tools.ts";
import type { LinearRunner, LinearTeam, WriteMetadata } from "../src/types.ts";
import { resolveWriteInput } from "../src/write.ts";

const metadata: WriteMetadata = {
  viewer: { id: "user-self", name: "alex", displayName: "alex", email: "alex@example.com" },
  teams: { nodes: [{ id: "team-eng", key: "ENG", name: "Engineering", activeCycle: { id: "cycle-active", name: "Active", number: 7 } }] },
  projects: { nodes: [{ id: "project-product", name: "Product Work", slugId: "product-work" }] },
  workflowStates: { nodes: [
    { id: "state-review", name: "In Review", type: "started", position: 3, team: { key: "ENG" } },
    { id: "state-progress", name: "In Progress", type: "started", position: 1, team: { key: "ENG" } },
  ] },
  users: { nodes: [{ id: "user-blair", name: "Blair User", displayName: "blair", email: "blair@example.com" }] },
  issueLabels: { nodes: [{ id: "label-bug", name: "Bug", team: null }] },
  issues: { nodes: [{ id: "issue-parent", identifier: "ENG-50", name: "Parent" }] },
  cycles: { nodes: [{ id: "cycle-8", name: "Next Cycle", number: 8, team: { key: "ENG" } }] },
  projectMilestones: { nodes: [{ id: "milestone-one", name: "Milestone One", project: { id: "project-product", name: "Product Work" } }] },
};

function issue(identifier: string, title = identifier, overrides: Record<string, unknown> = {}) {
  return {
    id: `uuid-${identifier}`,
    identifier,
    title,
    url: `https://linear.app/example/issue/${identifier}`,
    state: { id: "state-progress", name: "In Progress", type: "started" },
    assignee: { id: "user-blair", name: "Blair User", displayName: "blair" },
    priority: 2,
    priorityLabel: "High",
    project: { id: "project-product", name: "Product Work" },
    labels: { nodes: [{ id: "label-bug", name: "Bug" }] },
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

type FakeOptions = {
  failCreateAt?: number;
  abortAfterCreate?: AbortController;
  issueResults?: Array<ReturnType<typeof issue>>;
  teamResults?: LinearTeam[];
};

function createFakeRunner(options: FakeOptions = {}) {
  const calls: Array<{ args: string[]; variables?: Record<string, any> }> = [];
  let createCount = 0;
  const runner: LinearRunner = async (args) => {
    const variables = args[0] === "api" ? JSON.parse(args[3]) : undefined;
    calls.push({ args, variables });
    if (args[0] === "issue" && args[1] === "query") {
      return JSON.stringify({ nodes: [issue("ENG-10", "Search result")] });
    }
    if (args[0] === "issue" && args[1] === "mine") return "ENG-10  My task";
    const query = args[1] ?? "";
    if (query.includes("LinearModConfiguredTeams")) {
      return JSON.stringify({ data: { teams: { nodes: options.teamResults ?? metadata.teams?.nodes } } });
    }
    if (query.includes("LinearModWriteMetadata")) return JSON.stringify({ data: metadata });
    if (query.includes("LinearModCreateIssue")) {
      createCount += 1;
      if (options.failCreateAt === createCount) {
        return JSON.stringify({ errors: [{ message: "simulated create failure" }] });
      }
      const identifier = `ENG-${99 + createCount}`;
      const response = JSON.stringify({ data: { issueCreate: { success: true, issue: issue(identifier, variables.input.title) } } });
      options.abortAfterCreate?.abort();
      return response;
    }
    if (query.includes("LinearModUpdateIssue")) {
      return JSON.stringify({ data: { issueUpdate: { success: true, issue: issue(variables.id, variables.input.title ?? variables.id) } } });
    }
    if (query.includes("LinearModCreateComment")) {
      return JSON.stringify({ data: { commentCreate: { success: true, comment: { id: "comment-1", body: variables.input.body, url: "https://linear.app/comment/1" } } } });
    }
    if (query.includes("LinearModCreateRelation")) {
      return JSON.stringify({ data: { issueRelationCreate: { success: true, issueRelation: { id: "relation-1", type: variables.input.type } } } });
    }
    if (query.includes("LinearModFindRelation")) {
      return JSON.stringify({ data: { issue: {
        relations: { nodes: [{ id: "relation-1", type: "blocks", relatedIssue: { identifier: "ENG-200" } }] },
        inverseRelations: { nodes: [{ id: "relation-related", type: "related", issue: { identifier: "ENG-300" } }] },
      } } });
    }
    if (query.includes("LinearModDeleteRelation")) {
      return JSON.stringify({ data: { issueRelationDelete: { success: true } } });
    }
    if (query.includes("LinearModIssueSummaries") || query.includes("LinearModFullIssues")) {
      const candidates = options.issueResults ?? [issue("ENG-10", "Read result")];
      const requested = new Set((variables?.ids ?? []).map((value: string) => value.toUpperCase()));
      return JSON.stringify({ data: { issues: {
        nodes: candidates.filter((candidate) => requested.has(candidate.identifier.toUpperCase())),
      } } });
    }
    throw new Error(`unexpected fake Linear call: ${args.join(" ")}`);
  };
  return { calls, client: new LinearClient(runner) };
}

function register(client: LinearClient) {
  const tools = new Map<string, any>();
  const letta = {
    capabilities: { tools: true, commands: false, ui: { panels: false } },
    tools: { register(tool: any) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  };
  const disposers = registerLinearTools(letta, client);
  return { disposers, tools };
}

describe("credential boundary", () => {
  test("passes only operational environment variables to the Linear CLI", () => {
    const env = buildLinearChildEnv({
      PATH: "/bin",
      HOME: "/home/test",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus",
      LINEAR_API_KEY: "lin_secret",
      LETTA_API_KEY: "letta_secret",
      AWS_SECRET_ACCESS_KEY: "aws_secret",
      USER: "private-user",
      LOGNAME: "private-user",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/test",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus",
    });
    expect(readLinearTeamKey({ LINEAR_TEAM_KEY: " ENG " })).toBe("ENG");
    expect(readLinearTeamKey({ LINEAR_API_KEY: "secret" })).toBeUndefined();
    expect(formatLinearProcessError({
      code: 1,
      message: "Command failed: linear api --variables-json private-issue-body",
    })).toBe("Linear CLI failed (exit 1)");
    expect(formatLinearProcessError({ code: "ENOENT", message: "private-command" }))
      .toBe("Linear CLI executable not found");
  });

  test("auto-selects one team and requires configuration for multi-team workspaces", async () => {
    const single = createFakeRunner();
    await expect(single.client.getTeam()).resolves.toMatchObject({ id: "team-eng", key: "ENG" });

    const multiple = createFakeRunner({ teamResults: [
      { id: "team-one", key: "ONE" },
      { id: "team-two", key: "TWO" },
    ] });
    await expect(multiple.client.getTeam()).rejects.toThrow("Set LINEAR_TEAM_KEY when the Linear workspace has multiple teams");
  });
});

describe("structured field resolution", () => {
  test("resolves human-facing fields to GraphQL IDs without reading a secret", () => {
    expect(resolveWriteInput({
      title: "Structured issue",
      project: "Product Work",
      state: "started",
      assignee: "self",
      priority: 2,
      labels: ["Bug"],
      parent: "eng-50",
      due_date: "2026-08-01",
      estimate: 3,
      milestone: "Milestone One",
      cycle: "active",
    }, metadata, { create: true })).toEqual({
      teamId: "team-eng",
      title: "Structured issue",
      projectId: "project-product",
      stateId: "state-progress",
      assigneeId: "user-self",
      priority: 2,
      labelIds: ["label-bug"],
      parentId: "issue-parent",
      dueDate: "2026-08-01",
      estimate: 3,
      projectMilestoneId: "milestone-one",
      cycleId: "cycle-active",
    });
  });

  test("requires an exact assignee match instead of selecting a substring result", () => {
    expect(resolveWriteInput({ assignee: "Blair User" }, metadata, { create: false })).toEqual({
      assigneeId: "user-blair",
    });
    expect(() => resolveWriteInput({ assignee: "Bla" }, metadata, { create: false }))
      .toThrow("Linear user not found: Bla");
  });
});

describe("tool registration", () => {
  test("registers the complete public surface with approval on writes", () => {
    const { tools } = register(createFakeRunner().client);
    expect([...tools.keys()]).toEqual([
      "linear_search",
      "linear_issue",
      "linear_create",
      "linear_relation",
      "linear_update",
      "linear_comment",
    ]);
    expect(tools.get("linear_search").requiresApproval).toBe(false);
    expect(tools.get("linear_issue").parallelSafe).toBe(true);
    for (const name of ["linear_create", "linear_relation", "linear_update", "linear_comment"]) {
      expect(tools.get(name).requiresApproval).toBe(true);
      expect(tools.get(name).parallelSafe).toBe(false);
      expect(tools.get(name).parameters.properties.dry_run.type).toBe("boolean");
    }
    expect(tools.get("linear_update").parameters.properties.expected.type).toBe("object");
    expect(tools.get("linear_comment").parameters.properties.expected.type).toBe("object");
  });
});

describe("structured mutations", () => {
  test("creates a batch, resolves aliases, deduplicates inverse relations, and reports partial failures", async () => {
    const fake = createFakeRunner({ failCreateAt: 2 });
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_create").run({
      args: {
        items: [
          { key: "api", title: "API task", project: "Product Work", priority: 2 },
          { key: "failed", title: "Fail task" },
          { key: "ui", title: "UI task", parent: "ENG-50", estimate: 2 },
        ],
        relations: [
          { from: "api", type: "blocks", to: "ui" },
          { from: "ui", type: "blocked-by", to: "api" },
          { from: "failed", type: "related", to: "api" },
        ],
      },
    }));

    expect(output.created.map((item: any) => item.identifier)).toEqual(["ENG-100", "ENG-102"]);
    expect(output.create_errors).toEqual([{ key: "failed", title: "Fail task", error: "simulated create failure" }]);
    expect(output.relations.filter((item: any) => item.status === "ok")).toHaveLength(1);
    expect(output.relations.some((item: any) => item.error === "duplicate relation in batch")).toBe(true);
    expect(output.relations.some((item: any) => item.error?.includes("unknown local issue key"))).toBe(true);

    const writeCalls = fake.calls.filter((call) => call.args[0] !== "issue");
    expect(writeCalls.every((call) => call.args[0] === "api")).toBe(true);
    const relationInput = writeCalls.find((call) => call.args[1].includes("LinearModCreateRelation"))?.variables?.input;
    expect(relationInput).toEqual({ issueId: "ENG-100", relatedIssueId: "ENG-102", type: "blocks" });
  });

  test("returns normalized update and comment results", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const updated = JSON.parse(await tools.get("linear_update").run({
      args: { identifiers: ["ENG-10", "ENG-11"], title: "New title", project: "Product Work", state: "started" },
    }));
    expect(updated).toMatchObject({ action: "update", succeeded: 2, failed: 0 });
    expect(updated.results[0].value).toMatchObject({ identifier: "ENG-10", title: "New title", state: "In Progress" });

    const commented = JSON.parse(await tools.get("linear_comment").run({
      args: { identifiers: ["ENG-10", "ENG-11"], body: "Status update" },
    }));
    expect(commented).toMatchObject({ action: "comment", succeeded: 2, failed: 0 });
    expect(commented.results[0].value).toMatchObject({ id: "comment-1", body: "Status update" });
  });

  test("deletes blocked-by relations using normalized GraphQL direction", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_relation").run({
      args: { operation: "delete", relations: [{ from: "ENG-200", type: "blocked-by", to: "ENG-100" }] },
    }));
    expect(output.results[0].status).toBe("ok");
    const findCall = fake.calls.find((call) => call.args[1]?.includes("LinearModFindRelation"));
    expect(findCall?.variables).toEqual({ issueId: "ENG-100" });
  });

  test("deduplicates symmetric related pairs and deletes inverse related relations", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const added = JSON.parse(await tools.get("linear_relation").run({
      args: { operation: "add", relations: [
        { from: "ENG-300", type: "related", to: "ENG-400" },
        { from: "ENG-400", type: "related", to: "ENG-300" },
      ] },
    }));
    expect(added.results.filter((item: any) => item.status === "ok")).toHaveLength(1);
    expect(added.results[1].error).toBe("duplicate relation in batch");

    const deleted = JSON.parse(await tools.get("linear_relation").run({
      args: { operation: "delete", relations: [{ from: "ENG-400", type: "related", to: "ENG-300" }] },
    }));
    expect(deleted.results[0].status).toBe("ok");
    const deleteCall = fake.calls.find((call) =>
      call.args[1]?.includes("LinearModDeleteRelation") && call.variables?.id === "relation-related");
    expect(deleteCall).toBeDefined();
  });

  test("stops remaining creates after cancellation", async () => {
    const controller = new AbortController();
    const fake = createFakeRunner({ abortAfterCreate: controller });
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_create").run({
      args: { items: [{ title: "First" }, { title: "Second" }] },
      signal: controller.signal,
    }));
    expect(output.created).toHaveLength(1);
    expect(fake.calls.filter((call) => call.args[1]?.includes("LinearModCreateIssue"))).toHaveLength(1);
  });

  test("keeps the flat single-create call shape compatible", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const output = await tools.get("linear_create").run({ args: { title: "Single task" } });
    expect(output).toContain("ENG-100: Single task");
  });

  test("rejects fractional priority and estimate before metadata or writes", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_create").run({
      args: { items: [{ title: "Bad priority", priority: 1.5 }, { title: "Bad estimate", estimate: 2.5 }] },
    }));
    expect(output.create_errors.map((item: any) => item.error)).toEqual([
      "priority must be an integer between 1 and 4",
      "estimate must be a non-negative integer",
    ]);
    expect(fake.calls).toHaveLength(0);
  });

  test("previews creates and alias relations without executing mutations", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_create").run({
      args: {
        dry_run: true,
        items: [
          { key: "api", title: "API task", project: "Product Work", state: "started" },
          { key: "ui", title: "UI task", parent: "ENG-50" },
        ],
        relations: [{ from: "api", type: "blocks", to: "ui" }],
      },
    }));
    expect(output).toMatchObject({ action: "create", dry_run: true, planned: 2, failed: 0 });
    expect(output.creates[0]).toMatchObject({
      key: "api",
      status: "planned",
      resolved_input: { teamId: "team-eng", projectId: "project-product", stateId: "state-progress" },
    });
    expect(output.relations[0]).toMatchObject({ from: "NEW(api)", type: "blocks", to: "NEW(ui)", status: "planned" });
    expect(fake.calls.some((call) => /LinearMod(CreateIssue|CreateRelation)/.test(call.args[1] ?? ""))).toBe(false);
  });

  test("rejects missing existing relation targets in create previews", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_create").run({
      args: {
        dry_run: true,
        items: [{ key: "new", title: "New task" }],
        relations: [{ from: "new", type: "related", to: "ENG-999" }],
      },
    }));
    expect(output.planned).toBe(1);
    expect(output.relations[0]).toMatchObject({
      from: "new",
      to: "ENG-999",
      status: "error",
      error: "Linear issue not found: ENG-999",
    });
    expect(fake.calls.some((call) => /LinearMod(CreateIssue|CreateRelation)/.test(call.args[1] ?? ""))).toBe(false);
  });

  test("batches update previews and reports stale items without mutating", async () => {
    const fake = createFakeRunner({ issueResults: [
      issue("ENG-10"),
      issue("ENG-11", "Changed", { state: { id: "state-done", name: "Done", type: "completed" } }),
    ] });
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_update").run({
      args: {
        identifiers: ["ENG-10", "ENG-11"],
        title: "Next title",
        state: "started",
        expected: { state: "In Progress", priority: 2, updated_at: "2026-07-22T00:00:00Z" },
        dry_run: true,
      },
    }));
    expect(output).toMatchObject({ action: "update", dry_run: true, planned: 1, failed: 1 });
    expect(output.results[0]).toMatchObject({
      identifier: "ENG-10",
      status: "planned",
      resolved_changes: { title: "Next title", stateId: "state-progress" },
    });
    expect(output.results[1].error).toContain("expected state In Progress, found Done");
    expect(fake.calls.filter((call) => call.args[1]?.includes("LinearModIssueSummaries"))).toHaveLength(1);
    expect(fake.calls.some((call) => call.args[1]?.includes("LinearModUpdateIssue"))).toBe(false);
  });

  test("rechecks expected state per item and preserves partial batch writes", async () => {
    const fake = createFakeRunner({ issueResults: [
      issue("ENG-10"),
      issue("ENG-11", "Changed", { assignee: { id: "user-casey", name: "Casey User", displayName: "casey" } }),
    ] });
    const { tools } = register(fake.client);
    const output = JSON.parse(await tools.get("linear_update").run({
      args: {
        identifiers: ["ENG-10", "ENG-11"],
        priority: 3,
        expected: { assignee: "blair" },
      },
    }));
    expect(output).toMatchObject({ action: "update", succeeded: 1, failed: 1 });
    expect(output.results[1].error).toContain("expected assignee blair, found casey");
    expect(fake.calls.filter((call) => call.args[1]?.includes("LinearModIssueSummaries"))).toHaveLength(2);
    expect(fake.calls.filter((call) => call.args[1]?.includes("LinearModUpdateIssue"))).toHaveLength(1);
  });

  test("previews comments and relations without executing mutations", async () => {
    const fake = createFakeRunner({ issueResults: [issue("ENG-100"), issue("ENG-200")] });
    const { tools } = register(fake.client);
    const comment = await tools.get("linear_comment").run({
      args: { identifiers: ["ENG-100"], body: "Ship it", expected: { unassigned: false }, dry_run: true },
    });
    expect(comment).toEqual({ status: "error", content: "expected.unassigned must be true when provided" });

    const relation = JSON.parse(await tools.get("linear_relation").run({
      args: {
        operation: "delete",
        relations: [{ from: "ENG-100", type: "blocks", to: "ENG-200" }],
        dry_run: true,
      },
    }));
    expect(relation).toMatchObject({ operation: "delete", dry_run: true });
    expect(relation.results[0].status).toBe("planned");
    expect(fake.calls.filter((call) => call.args[1]?.includes("LinearModIssueSummaries"))).toHaveLength(1);
    expect(fake.calls.some((call) => /LinearMod(CreateComment|DeleteRelation)/.test(call.args[1] ?? ""))).toBe(false);
  });

  test("chunks large relation preview endpoint reads at the issue query limit", async () => {
    const identifiers = Array.from({ length: 52 }, (_value, index) => `ENG-${1000 + index}`);
    const fake = createFakeRunner({ issueResults: identifiers.map((identifier) => issue(identifier)) });
    const { tools } = register(fake.client);
    const relations = Array.from({ length: 26 }, (_value, index) => ({
      from: identifiers[index * 2],
      type: "related",
      to: identifiers[index * 2 + 1],
    }));
    const output = JSON.parse(await tools.get("linear_relation").run({
      args: { operation: "add", relations, dry_run: true },
    }));
    expect(output.results.every((result: any) => result.status === "planned")).toBe(true);
    const reads = fake.calls.filter((call) => call.args[1]?.includes("LinearModIssueSummaries"));
    expect(reads).toHaveLength(2);
    expect(reads.map((call) => call.variables?.ids.length)).toEqual([50, 2]);
    expect(fake.calls.some((call) => call.args[1]?.includes("LinearModCreateRelation"))).toBe(false);
  });

  test("previews comments with guards and rejects conflicting guard fields", async () => {
    const fake = createFakeRunner({ issueResults: [issue("ENG-10")] });
    const { tools } = register(fake.client);
    const preview = JSON.parse(await tools.get("linear_comment").run({
      args: { identifiers: ["ENG-10"], body: "Status", expected: { assignee: "blair" }, dry_run: true },
    }));
    expect(preview).toMatchObject({ action: "comment", dry_run: true, planned: 1, failed: 0 });
    expect(preview.results[0]).toMatchObject({ status: "planned", comment: "Status" });

    const invalid = await tools.get("linear_update").run({
      args: { identifiers: ["ENG-10"], state: "started", expected: { assignee: "blair", unassigned: true } },
    });
    expect(invalid).toEqual({ status: "error", content: "expected.assignee and expected.unassigned are mutually exclusive" });
  });
});

describe("read behavior", () => {
  test("reads multiple issues and expands search results", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const read = await tools.get("linear_issue").run({ args: { identifiers: ["ENG-10", "ENG-11"] } });
    expect(read).toContain("ENG-10: Read result");
    expect(read).toContain("ENG-11: Linear issue not found");

    const search = await tools.get("linear_search").run({ args: { search: "result", detail: "full" } });
    expect(search).toContain("ENG-10: Read result");
    expect(fake.calls.some((call) => call.args[0] === "issue" && call.args[1] === "query")).toBe(true);
  });

  test("enforces the full-detail batch limit at the cross-field validation boundary", async () => {
    const fake = createFakeRunner();
    const { tools } = register(fake.client);
    const result = await tools.get("linear_issue").run({
      args: { identifiers: ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5", "ENG-6"], detail: "full" },
    });
    expect(result).toEqual({ status: "error", content: "no more than 5 identifiers are allowed" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("slash command", () => {
  test("supports rich comma-separated reads, search, mine, and empty-input guards", async () => {
    const fake = createFakeRunner();
    const commands = new Map<string, any>();
    const letta = {
      capabilities: { commands: true, ui: { panels: false } },
      commands: { register(command: any) { commands.set(command.id, command); return () => commands.delete(command.id); } },
    };
    const disposers = registerLinearCommand(letta, fake.client);
    const command = commands.get("linear");

    const full = await command.run({ args: "full ENG-10,ENG-11" });
    expect(full.output).toContain("ENG-10: Read result");
    expect(full.output).toContain("ENG-11: Linear issue not found");
    expect((await command.run({ args: "search result" })).output).toContain("Search result");
    expect((await command.run({ args: "mine" })).output).toBe("ENG-10  My task");
    expect((await command.run({ args: ",,," })).output).toStartWith("Usage: /linear");

    for (const dispose of disposers.reverse()) dispose();
    expect(commands.size).toBe(0);
  });
});
