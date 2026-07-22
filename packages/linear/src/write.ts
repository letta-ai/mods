import { LinearClient } from "./client.ts";
import {
  COMMENT_MUTATION,
  CREATE_ISSUE_MUTATION,
  CREATE_RELATION_MUTATION,
  DELETE_RELATION_MUTATION,
  FIND_RELATION_QUERY,
  UPDATE_ISSUE_MUTATION,
  WRITE_METADATA_QUERY,
} from "./config.ts";
import type {
  CreateItem,
  CreatedIssue,
  ExpectedIssueState,
  LinearComment,
  LinearIssue,
  LinearIssueRelation,
  LinearTeam,
  MetadataNode,
  RelationResult,
  RelationSpec,
  RelationType,
  UpdateFields,
  WriteMetadata,
} from "./types.ts";
import {
  aliasKey,
  compactError,
  connectionNodes,
  emptyIdFilter,
  isUuid,
  normalizeIssueIdentifier,
  resolveIssueRef,
  stringArg,
  uniqueStrings,
} from "./utils.ts";

type WriteInput = Record<string, unknown>;

type RelationRunOptions = {
  dryRun?: boolean;
  validateExisting?: boolean;
  knownIssueIdentifiers?: Set<string>;
  plannedIssueReferences?: Set<string>;
};

function stringOrFilter(field: string, values: string[]): Record<string, unknown> {
  return values.length
    ? { or: values.map((value) => ({ [field]: { eqIgnoreCase: value } })) }
    : emptyIdFilter();
}

function buildMetadataVariables(items: UpdateFields[], team: LinearTeam): Record<string, unknown> {
  const projects = uniqueStrings(items.map((item) => stringArg(item.project)));
  const states = uniqueStrings(items.map((item) => stringArg(item.state)));
  const users = uniqueStrings(items
    .map((item) => stringArg(item.assignee))
    .filter((value) => value !== "self" && value !== "@me"));
  const labels = uniqueStrings(items.flatMap((item) => item.labels ?? []));
  const parents = uniqueStrings(items.map((item) => stringArg(item.parent))).map(normalizeIssueIdentifier);
  const cycles = uniqueStrings(items.map((item) => stringArg(item.cycle)));
  const milestones = uniqueStrings(items.map((item) => stringArg(item.milestone)));

  const projectOr = projects.flatMap((value) => [
    { name: { eq: value } },
    { slugId: { eq: value } },
    ...(isUuid(value) ? [{ id: { eq: value } }] : []),
  ]);
  const stateOr = states.flatMap((value) => [
    { name: { eqIgnoreCase: value } },
    { type: { eqIgnoreCase: value } },
  ]);
  const userOr = users.flatMap((value) => [
    { email: { eqIgnoreCase: value } },
    { displayName: { eqIgnoreCase: value } },
    { name: { containsIgnoreCaseAndAccent: value } },
  ]);
  const cycleOr = cycles.flatMap((value) => [
    ...(value.toLowerCase() === "active" ? [{ isActive: { eq: true } }] : []),
    { name: { eqIgnoreCase: value } },
    ...(/^\d+$/.test(value) ? [{ number: { eq: Number(value) } }] : []),
  ]);

  return {
    teamId: team.id,
    projectFilter: projectOr.length ? { or: projectOr } : emptyIdFilter(),
    stateFilter: stateOr.length
      ? { and: [{ team: { id: { eq: team.id } } }, { or: stateOr }] }
      : emptyIdFilter(),
    userFilter: userOr.length ? { or: userOr } : emptyIdFilter(),
    labelFilter: labels.length
      ? {
          and: [
            stringOrFilter("name", labels),
            { or: [{ team: { id: { eq: team.id } } }, { team: { null: true } }] },
          ],
        }
      : emptyIdFilter(),
    issueFilter: parents.length ? { id: { in: parents } } : emptyIdFilter(),
    cycleFilter: cycleOr.length
      ? { and: [{ team: { id: { eq: team.id } } }, { or: cycleOr }] }
      : emptyIdFilter(),
    milestoneFilter: milestones.length ? stringOrFilter("name", milestones) : emptyIdFilter(),
  };
}

export async function loadWriteMetadata(
  client: LinearClient,
  items: UpdateFields[],
  signal?: AbortSignal,
): Promise<WriteMetadata> {
  const team = await client.getTeam(signal);
  return client.api<WriteMetadata>(WRITE_METADATA_QUERY, buildMetadataVariables(items, team), signal);
}

function findProject(value: string, metadata: WriteMetadata): MetadataNode {
  const lower = value.toLowerCase();
  const project = connectionNodes(metadata.projects).find((node) =>
    node.id === value || node.name?.toLowerCase() === lower || node.slugId?.toLowerCase() === lower);
  if (!project) throw new Error(`Linear project not found: ${value}`);
  return project;
}

function findState(value: string, metadata: WriteMetadata): MetadataNode {
  const lower = value.toLowerCase();
  const states = [...connectionNodes(metadata.workflowStates)].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  );
  const state = states.find((node) => node.name?.toLowerCase() === lower)
    ?? states.find((node) => node.type?.toLowerCase() === lower);
  if (!state) throw new Error(`Linear workflow state not found for the configured team: ${value}`);
  return state;
}

function findUser(value: string, metadata: WriteMetadata): MetadataNode {
  if (value === "self" || value === "@me") return metadata.viewer;
  const lower = value.toLowerCase();
  const users = connectionNodes(metadata.users);
  const user = users.find((node) => node.email?.toLowerCase() === lower)
    ?? users.find((node) => node.displayName?.toLowerCase() === lower)
    ?? users.find((node) => node.name?.toLowerCase() === lower);
  if (!user) throw new Error(`Linear user not found: ${value}`);
  return user;
}

function findLabel(value: string, metadata: WriteMetadata): MetadataNode {
  const lower = value.toLowerCase();
  const label = connectionNodes(metadata.issueLabels).find((node) => node.name?.toLowerCase() === lower);
  if (!label) throw new Error(`Linear label not found for the configured team: ${value}`);
  return label;
}

function findParent(value: string, metadata: WriteMetadata): MetadataNode {
  const identifier = normalizeIssueIdentifier(value);
  const parent = connectionNodes(metadata.issues).find((node) => node.identifier?.toUpperCase() === identifier);
  if (!parent) throw new Error(`Linear parent issue not found: ${identifier}`);
  return parent;
}

function findCycle(value: string, metadata: WriteMetadata): { id: string } {
  const lower = value.toLowerCase();
  if (lower === "active") {
    const active = connectionNodes(metadata.teams)[0]?.activeCycle;
    if (!active?.id) throw new Error("Linear active cycle not found for the configured team");
    return { id: active.id };
  }
  const cycle = connectionNodes(metadata.cycles).find((node) =>
    node.name?.toLowerCase() === lower || String(node.number) === value);
  if (!cycle) throw new Error(`Linear cycle not found for the configured team: ${value}`);
  return cycle;
}

function findMilestone(value: string, projectId: string, metadata: WriteMetadata): MetadataNode {
  const lower = value.toLowerCase();
  const milestone = connectionNodes(metadata.projectMilestones).find((node) =>
    node.name?.toLowerCase() === lower && node.project?.id === projectId);
  if (!milestone) throw new Error(`Linear milestone not found in selected project: ${value}`);
  return milestone;
}

export function resolveWriteInput(
  fields: UpdateFields,
  metadata: WriteMetadata,
  options: { create: boolean },
): WriteInput {
  const input: WriteInput = {};
  const team = connectionNodes(metadata.teams)[0];
  if (options.create) {
    if (!team?.id) throw new Error("Configured Linear team metadata was not returned");
    input.teamId = team.id;
  }
  if (fields.title !== undefined) input.title = fields.title;
  if (fields.description !== undefined) input.description = fields.description;
  if (fields.priority !== undefined) input.priority = Math.trunc(fields.priority);
  if (fields.due_date !== undefined) input.dueDate = fields.due_date;
  if (fields.estimate !== undefined) input.estimate = fields.estimate;

  let projectId: string | undefined;
  if (fields.project) {
    projectId = findProject(fields.project, metadata).id;
    input.projectId = projectId;
  }
  if (fields.state) input.stateId = findState(fields.state, metadata).id;
  if (fields.assignee) input.assigneeId = findUser(fields.assignee, metadata).id;
  if (fields.labels?.length) input.labelIds = fields.labels.map((label) => findLabel(label, metadata).id);
  if (fields.parent) input.parentId = findParent(fields.parent, metadata).id;
  if (fields.cycle) input.cycleId = findCycle(fields.cycle, metadata).id;
  if (fields.milestone) {
    if (!projectId) throw new Error("milestone requires project");
    input.projectMilestoneId = findMilestone(fields.milestone, projectId, metadata).id;
  }
  return input;
}

function matches(value: string | undefined, expected: string): boolean {
  return value?.toLowerCase() === expected.toLowerCase();
}

export function assertExpectedIssueState(issue: LinearIssue, expected: ExpectedIssueState | undefined): void {
  if (!expected) return;
  const identifier = issue.identifier ?? "issue";
  const mismatch = (field: string, wanted: unknown, actual: unknown): never => {
    throw new Error(`guard failed for ${identifier}: expected ${field} ${String(wanted)}, found ${String(actual)}`);
  };

  if (expected.updated_at) {
    const expectedTime = Date.parse(expected.updated_at);
    const actualTime = issue.updatedAt ? Date.parse(issue.updatedAt) : Number.NaN;
    if (expectedTime !== actualTime) mismatch("updated_at", expected.updated_at, issue.updatedAt ?? "missing");
  }
  if (
    expected.state
    && !matches(issue.state?.name, expected.state)
    && !matches(issue.state?.type, expected.state)
    && !matches(issue.state?.id, expected.state)
  ) {
    mismatch("state", expected.state, issue.state?.name ?? "none");
  }
  if (expected.unassigned && issue.assignee) mismatch("assignee", "unassigned", issue.assignee.displayName ?? issue.assignee.name ?? issue.assignee.id ?? "assigned");
  if (
    expected.assignee
    && !matches(issue.assignee?.id, expected.assignee)
    && !matches(issue.assignee?.name, expected.assignee)
    && !matches(issue.assignee?.displayName, expected.assignee)
  ) {
    mismatch("assignee", expected.assignee, issue.assignee?.displayName ?? issue.assignee?.name ?? "unassigned");
  }
  if (expected.no_project && issue.project) mismatch("project", "none", issue.project.name ?? issue.project.slugId ?? issue.project.id ?? "assigned");
  if (
    expected.project
    && !matches(issue.project?.id, expected.project)
    && !matches(issue.project?.name, expected.project)
    && !matches(issue.project?.slugId, expected.project)
  ) {
    mismatch("project", expected.project, issue.project?.name ?? "none");
  }
  if (expected.priority !== undefined && (issue.priority ?? 0) !== expected.priority) {
    mismatch("priority", expected.priority, issue.priority ?? 0);
  }
}

export async function readAndGuardIssue(
  client: LinearClient,
  identifier: string,
  expected: ExpectedIssueState | undefined,
  signal?: AbortSignal,
): Promise<LinearIssue> {
  const issue = await client.getIssue(identifier, signal);
  assertExpectedIssueState(issue, expected);
  return issue;
}

export async function createIssue(
  client: LinearClient,
  item: CreateItem,
  metadata: WriteMetadata,
  signal?: AbortSignal,
): Promise<CreatedIssue> {
  const data = await client.api<{
    issueCreate?: { success?: boolean; issue?: LinearIssue | null };
  }>(CREATE_ISSUE_MUTATION, { input: resolveWriteInput(item, metadata, { create: true }) }, signal);
  if (!data.issueCreate?.success || !data.issueCreate.issue?.identifier) {
    throw new Error("Linear issue creation failed without returning an issue");
  }
  return {
    key: stringArg(item.key),
    identifier: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
    issue: data.issueCreate.issue,
  };
}

export async function updateIssue(
  client: LinearClient,
  identifier: string,
  fields: UpdateFields,
  metadata: WriteMetadata,
  signal?: AbortSignal,
): Promise<LinearIssue> {
  const data = await client.api<{
    issueUpdate?: { success?: boolean; issue?: LinearIssue | null };
  }>(UPDATE_ISSUE_MUTATION, {
    id: normalizeIssueIdentifier(identifier),
    input: resolveWriteInput(fields, metadata, { create: false }),
  }, signal);
  if (!data.issueUpdate?.success || !data.issueUpdate.issue?.identifier) {
    throw new Error(`Linear update failed for ${identifier}`);
  }
  return data.issueUpdate.issue;
}

export async function commentIssue(
  client: LinearClient,
  identifier: string,
  body: string,
  signal?: AbortSignal,
): Promise<LinearComment> {
  const data = await client.api<{
    commentCreate?: { success?: boolean; comment?: LinearComment | null };
  }>(COMMENT_MUTATION, {
    input: { issueId: normalizeIssueIdentifier(identifier), body },
  }, signal);
  if (!data.commentCreate?.success || !data.commentCreate.comment) {
    throw new Error(`Linear comment failed for ${identifier}`);
  }
  return data.commentCreate.comment;
}

function normalizeRelation(from: string, type: RelationType, to: string): {
  issueId: string;
  relatedIssueId: string;
  type: Exclude<RelationType, "blocked-by">;
} {
  return type === "blocked-by"
    ? { issueId: to, relatedIssueId: from, type: "blocks" }
    : { issueId: from, relatedIssueId: to, type };
}

async function addRelation(
  client: LinearClient,
  from: string,
  type: RelationType,
  to: string,
  signal?: AbortSignal,
): Promise<LinearIssueRelation> {
  const input = normalizeRelation(from, type, to);
  const data = await client.api<{
    issueRelationCreate?: { success?: boolean; issueRelation?: LinearIssueRelation | null };
  }>(CREATE_RELATION_MUTATION, { input }, signal);
  if (!data.issueRelationCreate?.success || !data.issueRelationCreate.issueRelation) {
    throw new Error(`Linear relation creation failed: ${from} ${type} ${to}`);
  }
  return data.issueRelationCreate.issueRelation;
}

async function findRelation(
  client: LinearClient,
  from: string,
  type: RelationType,
  to: string,
  signal?: AbortSignal,
): Promise<LinearIssueRelation | undefined> {
  const normalized = normalizeRelation(from, type, to);
  const found = await client.api<{
    issue?: {
      relations?: { nodes?: LinearIssueRelation[] };
      inverseRelations?: { nodes?: LinearIssueRelation[] };
    } | null;
  }>(FIND_RELATION_QUERY, { issueId: normalized.issueId }, signal);
  const relation = connectionNodes(found.issue?.relations).find((candidate) =>
    candidate.type === normalized.type
      && candidate.relatedIssue?.identifier?.toUpperCase() === normalized.relatedIssueId)
    ?? (normalized.type === "related"
      ? connectionNodes(found.issue?.inverseRelations).find((candidate) =>
          candidate.type === "related"
          && candidate.issue?.identifier?.toUpperCase() === normalized.relatedIssueId)
      : undefined);
  return relation;
}

async function deleteRelation(
  client: LinearClient,
  from: string,
  type: RelationType,
  to: string,
  signal?: AbortSignal,
): Promise<LinearIssueRelation> {
  const relation = await findRelation(client, from, type, to, signal);
  if (!relation?.id) throw new Error(`Linear relation not found: ${from} ${type} ${to}`);
  const deleted = await client.api<{ issueRelationDelete?: { success?: boolean } }>(
    DELETE_RELATION_MUTATION,
    { id: relation.id },
    signal,
  );
  if (!deleted.issueRelationDelete?.success) throw new Error(`Linear relation deletion failed: ${from} ${type} ${to}`);
  return relation;
}

export async function runRelations(
  client: LinearClient,
  specs: RelationSpec[],
  aliases: Map<string, string>,
  operation: "add" | "delete",
  signal?: AbortSignal,
  options: RelationRunOptions = {},
): Promise<RelationResult[]> {
  const allowed = new Set<RelationType>(["blocks", "blocked-by", "related", "duplicate"]);
  const seen = new Set<string>();
  const results: RelationResult[] = [];
  for (const spec of specs) {
    if (signal?.aborted) break;
    const rawFrom = stringArg(spec.from) ?? "?";
    const rawType = stringArg(spec.type)?.toLowerCase() ?? "?";
    const rawTo = stringArg(spec.to) ?? "?";
    try {
      if (!allowed.has(rawType as RelationType)) {
        throw new Error("relation type must be blocks, blocked-by, related, or duplicate");
      }
      const type = rawType as RelationType;
      const from = resolveIssueRef(rawFrom, aliases);
      const to = resolveIssueRef(rawTo, aliases);
      if (from === to) throw new Error("an issue cannot be related to itself");
      const normalized = normalizeRelation(from, type, to);
      const relationKey = normalized.type === "related"
        ? `${[normalized.issueId, normalized.relatedIssueId].sort().join("|")}|related`
        : `${normalized.issueId}|${normalized.type}|${normalized.relatedIssueId}`;
      if (seen.has(relationKey)) throw new Error("duplicate relation in batch");
      seen.add(relationKey);
      if (options.dryRun) {
        let relation: LinearIssueRelation | undefined;
        if (options.validateExisting !== false) {
          if (options.knownIssueIdentifiers) {
            const fromPlanned = options.plannedIssueReferences?.has(from) ?? false;
            const toPlanned = options.plannedIssueReferences?.has(to) ?? false;
            if (!fromPlanned && !options.knownIssueIdentifiers.has(from)) throw new Error(`Linear issue not found: ${from}`);
            if (!toPlanned && !options.knownIssueIdentifiers.has(to)) throw new Error(`Linear issue not found: ${to}`);
            if (!fromPlanned && !toPlanned) relation = await findRelation(client, from, type, to, signal);
          } else {
            await client.getIssue(from, signal);
            await client.getIssue(to, signal);
            relation = await findRelation(client, from, type, to, signal);
          }
          if (operation === "add" && relation) throw new Error(`Linear relation already exists: ${from} ${type} ${to}`);
          if (operation === "delete" && !relation) throw new Error(`Linear relation not found: ${from} ${type} ${to}`);
        }
        results.push({ from, type, to, relation, dryRun: true });
        continue;
      }
      const relation = operation === "add"
        ? await addRelation(client, from, type, to, signal)
        : await deleteRelation(client, from, type, to, signal);
      results.push({ from, type, to, relation });
    } catch (error) {
      results.push({ from: rawFrom, type: rawType, to: rawTo, error: compactError(error) });
      if (signal?.aborted) break;
    }
  }
  return results;
}

export function buildAliasMap(created: CreatedIssue[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const issue of created) {
    if (issue.key) aliases.set(aliasKey(issue.key), issue.identifier);
  }
  return aliases;
}
