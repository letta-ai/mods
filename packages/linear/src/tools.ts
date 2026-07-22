import { LinearClient } from "./client.ts";
import {
  CREATE_ITEM_SCHEMA,
  DRY_RUN_PROPERTY,
  EXPECTED_ISSUE_SCHEMA,
  IDENTIFIER_PROPERTIES,
  MAX_BATCH_SIZE,
  MAX_CREATE_BATCH_SIZE,
  MAX_FULL_BATCH_SIZE,
  MAX_RELATION_BATCH_SIZE,
  RELATION_ITEM_SCHEMA,
  WRITE_FIELD_PROPERTIES,
} from "./config.ts";
import {
  formatCreateResults,
  formatCreatePreview,
  formatIssue,
  formatIssues,
  formatMutationResults,
  formatMutationPreview,
  formatReadResults,
  formatRelationResults,
} from "./format.ts";
import type {
  CreateItem,
  CreateResult,
  CreatedIssue,
  ExpectedIssueState,
  IssueDetail,
  LinearIssue,
  MutationPreview,
  RelationResult,
  ToolArgs,
} from "./types.ts";
import {
  aliasKey,
  arrayArg,
  compactError,
  createItems,
  expectedIssueFromArgs,
  hasWriteFields,
  identifierArgs,
  invalidIdentifier,
  normalizeIssueIdentifier,
  numberArg,
  relationSpecs,
  runSequential,
  stringArg,
  validateWriteFields,
  validateExpectedIssueState,
  writeFieldsFromArgs,
} from "./utils.ts";
import {
  assertExpectedIssueState,
  buildAliasMap,
  commentIssue,
  createIssue,
  loadWriteMetadata,
  readAndGuardIssue,
  resolveWriteInput,
  runRelations,
  updateIssue,
} from "./write.ts";

function identifierError(identifiers: string[], max = MAX_BATCH_SIZE): string | undefined {
  if (identifiers.length === 0) return "at least one identifier is required";
  if (identifiers.length > max) return `no more than ${max} identifiers are allowed`;
  const invalid = invalidIdentifier(identifiers);
  return invalid ? `invalid Linear issue identifier: ${invalid}` : undefined;
}

function normalizeCreateItem(item: CreateItem): CreateItem {
  return {
    key: stringArg(item.key),
    ...writeFieldsFromArgs(item as ToolArgs),
  };
}

async function previewIssueMutations(
  client: LinearClient,
  identifiers: string[],
  expected: ExpectedIssueState | undefined,
  build: (issue: LinearIssue) => MutationPreview,
  signal?: AbortSignal,
) {
  const issues = await client.getIssues(identifiers, "summary", signal);
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier?.toUpperCase(), issue]));
  return runSequential(identifiers, async (identifier) => {
    const issue = byIdentifier.get(identifier);
    if (!issue) throw new Error(`Linear issue not found: ${identifier}`);
    assertExpectedIssueState(issue, expected);
    return build(issue);
  }, signal);
}

async function loadKnownIssueIdentifiers(
  client: LinearClient,
  identifiers: string[],
  signal?: AbortSignal,
): Promise<Set<string>> {
  const issues: LinearIssue[] = [];
  for (let start = 0; start < identifiers.length; start += MAX_BATCH_SIZE) {
    if (signal?.aborted) break;
    issues.push(...await client.getIssues(identifiers.slice(start, start + MAX_BATCH_SIZE), "summary", signal));
  }
  return new Set(issues
    .map((issue) => issue.identifier?.toUpperCase())
    .filter((identifier): identifier is string => Boolean(identifier)));
}

export function registerLinearTools(letta: any, client: LinearClient): Array<() => void> {
  const disposers: Array<() => void> = [];

  disposers.push(letta.tools.register({
    name: "linear_search",
    description: "Search and filter Linear issues when issue context, ownership, status, or duplicates matter.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Full-text search query" },
        state: { type: "string", enum: ["triage", "backlog", "unstarted", "started", "completed", "canceled"] },
        assignee: { type: "string", description: "Assignee username or name" },
        project: { type: "string", description: "Project name" },
        limit: { type: "number", description: "Maximum results, from 1 to 50" },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: `Use full to expand up to ${MAX_FULL_BATCH_SIZE} results with comments, relations, attachments, and hierarchy`,
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: true,
    async run(ctx: any) {
      const args = ctx.args as ToolArgs;
      const detail: IssueDetail = args.detail === "full" ? "full" : "summary";
      const issues = await client.queryIssues({
        search: stringArg(args.search),
        state: stringArg(args.state),
        assignee: stringArg(args.assignee),
        project: stringArg(args.project),
        limit: detail === "full"
          ? Math.min(numberArg(args.limit, 10), MAX_FULL_BATCH_SIZE)
          : numberArg(args.limit, 10),
        signal: ctx.signal,
      });
      if (detail === "summary" || issues.length === 0) return formatIssues(issues);
      const identifiers = [...new Set(issues.map((issue) => issue.identifier).filter((value): value is string => Boolean(value)))];
      return formatReadResults(identifiers, await client.getIssues(identifiers, "full", ctx.signal), "full");
    },
  }));

  disposers.push(letta.tools.register({
    name: "linear_issue",
    description: "Read one or more Linear issues by identifier before acting on or discussing them. Batch related lookups with identifiers.",
    parameters: {
      type: "object",
      properties: {
        ...IDENTIFIER_PROPERTIES,
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: `Full includes recent comments, attachments, relations, labels, parent, and children; maximum ${MAX_FULL_BATCH_SIZE} issues`,
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: true,
    async run(ctx: any) {
      const args = ctx.args as ToolArgs;
      const identifiers = identifierArgs(args);
      const detail: IssueDetail = args.detail === "full" ? "full" : "summary";
      const error = identifierError(identifiers, detail === "full" ? MAX_FULL_BATCH_SIZE : MAX_BATCH_SIZE);
      if (error) return { status: "error", content: error };
      return formatReadResults(identifiers, await client.getIssues(identifiers, detail, ctx.signal), detail);
    },
  }));

  disposers.push(letta.tools.register({
    name: "linear_create",
    description: "Create one or more Linear issues. Use items for batches, local keys for relations, and dry_run to preview resolved inputs without mutations.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_CREATE_BATCH_SIZE,
          description: "Issues to create. A key is a local alias that relations can reference after creation.",
          items: CREATE_ITEM_SCHEMA,
        },
        relations: {
          type: "array",
          maxItems: MAX_RELATION_BATCH_SIZE,
          description: "Relations applied after creation. from/to may be local item keys or existing issue identifiers.",
          items: RELATION_ITEM_SCHEMA,
        },
        ...DRY_RUN_PROPERTY,
        ...WRITE_FIELD_PROPERTIES,
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
    async run(ctx: any) {
      const args = ctx.args as ToolArgs;
      const dryRun = args.dry_run === true;
      const items = createItems(args).map(normalizeCreateItem);
      const relations = relationSpecs(args.relations);
      if (items.length === 0) return { status: "error", content: "title or items is required" };
      if (items.length > MAX_CREATE_BATCH_SIZE) {
        return { status: "error", content: `no more than ${MAX_CREATE_BATCH_SIZE} issues can be created at once` };
      }
      if (relations.length > MAX_RELATION_BATCH_SIZE) {
        return { status: "error", content: `no more than ${MAX_RELATION_BATCH_SIZE} relations are allowed` };
      }
      const keys = items.map((item) => item.key).filter((value): value is string => Boolean(value));
      if (keys.some((key) => /^[A-Za-z]+-\d+$/.test(key))) {
        return { status: "error", content: "local item keys cannot look like Linear issue identifiers" };
      }
      if (new Set(keys.map((key) => key.toLowerCase())).size !== keys.length) {
        return { status: "error", content: "local item keys must be unique" };
      }

      const validation = items.map((item) => validateWriteFields(item, true));
      const validItems = items.filter((_item, index) => !validation[index]);
      const metadata = validItems.length ? await loadWriteMetadata(client, validItems, ctx.signal) : undefined;
      const results: CreateResult[] = [];
      for (let index = 0; index < items.length; index += 1) {
        if (ctx.signal?.aborted) break;
        const item = items[index];
        if (validation[index]) {
          results.push({ key: item.key, title: item.title, error: validation[index] });
          continue;
        }
        try {
          if (dryRun) {
            results.push({
              key: item.key,
              title: item.title,
              input: resolveWriteInput(item, metadata!, { create: true }),
            });
          } else {
            const issue = await createIssue(client, item, metadata!, ctx.signal);
            results.push({ key: item.key, title: item.title, issue });
          }
        } catch (error) {
          results.push({
            key: item.key,
            title: item.title,
            error: ctx.signal?.aborted ? "operation canceled" : compactError(error),
          });
          if (ctx.signal?.aborted) break;
        }
      }

      if (dryRun) {
        const planned = results.filter((result) => result.input);
        const aliases = new Map<string, string>();
        for (const result of planned) {
          if (result.key) aliases.set(aliasKey(result.key), `NEW(${result.key})`);
        }
        const plannedIssueReferences = new Set(aliases.values());
        const existingReferences = [...new Set(relations.flatMap((relation) => [relation.from, relation.to]).flatMap((value) => {
          const text = stringArg(value);
          if (!text || aliases.has(aliasKey(text))) return [];
          try {
            return [normalizeIssueIdentifier(text)];
          } catch {
            return [];
          }
        }))];
        const knownIssueIdentifiers = await loadKnownIssueIdentifiers(client, existingReferences, ctx.signal);
        const relationResults: RelationResult[] = planned.length
          ? await runRelations(client, relations, aliases, "add", ctx.signal, {
              dryRun: true,
              knownIssueIdentifiers,
              plannedIssueReferences,
            })
          : relations.map((relation) => ({
              from: stringArg(relation.from) ?? "?",
              type: stringArg(relation.type) ?? "?",
              to: stringArg(relation.to) ?? "?",
              error: "skipped because no issue creates passed validation",
            }));
        return formatCreatePreview(results, relationResults);
      }

      const created = results.map((result) => result.issue).filter((issue): issue is CreatedIssue => Boolean(issue));
      if (!Array.isArray(args.items) && relations.length === 0 && created.length === 1) {
        return formatIssue(created[0].issue, "summary");
      }
      const relationResults: RelationResult[] = created.length
        ? await runRelations(client, relations, buildAliasMap(created), "add", ctx.signal)
        : relations.map((relation) => ({
            from: stringArg(relation.from) ?? "?",
            type: stringArg(relation.type) ?? "?",
            to: stringArg(relation.to) ?? "?",
            error: "skipped because no issues were created",
          }));
      return formatCreateResults(results, relationResults);
    },
  }));

  disposers.push(letta.tools.register({
    name: "linear_relation",
    description: "Add or delete issue relations in a batch. Use dry_run to verify issues and relation state without mutations.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["add", "delete"] },
        relations: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RELATION_BATCH_SIZE,
          items: RELATION_ITEM_SCHEMA,
        },
        ...DRY_RUN_PROPERTY,
      },
      required: ["operation", "relations"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
    async run(ctx: any) {
      const operation = stringArg(ctx.args.operation);
      const dryRun = ctx.args.dry_run === true;
      if (operation !== "add" && operation !== "delete") {
        return { status: "error", content: "operation must be add or delete" };
      }
      const specs = relationSpecs(ctx.args.relations);
      if (!specs.length) return { status: "error", content: "at least one relation is required" };
      if (specs.length > MAX_RELATION_BATCH_SIZE) {
        return { status: "error", content: `no more than ${MAX_RELATION_BATCH_SIZE} relations are allowed` };
      }
      let knownIssueIdentifiers: Set<string> | undefined;
      if (dryRun) {
        const endpointIds = [...new Set(specs.flatMap((spec) => [spec.from, spec.to]).flatMap((value) => {
          const text = stringArg(value);
          if (!text) return [];
          try {
            return [normalizeIssueIdentifier(text)];
          } catch {
            return [];
          }
        }))];
        knownIssueIdentifiers = await loadKnownIssueIdentifiers(client, endpointIds, ctx.signal);
      }
      return formatRelationResults(
        operation,
        await runRelations(client, specs, new Map(), operation, ctx.signal, { dryRun, knownIssueIdentifiers }),
        dryRun,
      );
    },
  }));

  disposers.push(letta.tools.register({
    name: "linear_update",
    description: "Apply the same field changes to one or more Linear issues. Use dry_run for a batched preview and expected for best-effort stale-state guards.",
    parameters: {
      type: "object",
      properties: {
        ...IDENTIFIER_PROPERTIES,
        ...WRITE_FIELD_PROPERTIES,
        expected: EXPECTED_ISSUE_SCHEMA,
        ...DRY_RUN_PROPERTY,
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
    async run(ctx: any) {
      const args = ctx.args as ToolArgs;
      const dryRun = args.dry_run === true;
      const identifiers = identifierArgs(args);
      const idError = identifierError(identifiers);
      if (idError) return { status: "error", content: idError };
      const fields = writeFieldsFromArgs(args);
      if (!hasWriteFields(fields)) return { status: "error", content: "at least one field to update is required" };
      const fieldError = validateWriteFields(fields);
      if (fieldError) return { status: "error", content: fieldError };
      const expected = expectedIssueFromArgs(args);
      const expectedError = validateExpectedIssueState(expected);
      if (expectedError) return { status: "error", content: expectedError };
      const metadata = await loadWriteMetadata(client, [fields], ctx.signal);
      const resolvedChanges = resolveWriteInput(fields, metadata, { create: false });
      if (dryRun) {
        return formatMutationPreview("update", await previewIssueMutations(
          client,
          identifiers,
          expected,
          (current) => ({ identifier: current.identifier!, current, changes: fields, resolvedChanges, expected }),
          ctx.signal,
        ));
      }
      const results = await runSequential(
        identifiers,
        async (identifier) => {
          if (expected) await readAndGuardIssue(client, identifier, expected, ctx.signal);
          return updateIssue(client, identifier, fields, metadata, ctx.signal);
        },
        ctx.signal,
      );
      return formatMutationResults("update", results);
    },
  }));

  disposers.push(letta.tools.register({
    name: "linear_comment",
    description: "Add the same comment to one or more Linear issues. Use dry_run for a batched preview and expected for best-effort stale-state guards.",
    parameters: {
      type: "object",
      properties: {
        ...IDENTIFIER_PROPERTIES,
        body: { type: "string", description: "Markdown comment body" },
        expected: EXPECTED_ISSUE_SCHEMA,
        ...DRY_RUN_PROPERTY,
      },
      required: ["body"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
    async run(ctx: any) {
      const identifiers = identifierArgs(ctx.args as ToolArgs);
      const dryRun = ctx.args.dry_run === true;
      const idError = identifierError(identifiers);
      if (idError) return { status: "error", content: idError };
      const body = stringArg(ctx.args.body);
      if (!body) return { status: "error", content: "body is required" };
      const expected = expectedIssueFromArgs(ctx.args as ToolArgs);
      const expectedError = validateExpectedIssueState(expected);
      if (expectedError) return { status: "error", content: expectedError };
      if (dryRun) {
        return formatMutationPreview("comment", await previewIssueMutations(
          client,
          identifiers,
          expected,
          (current) => ({ identifier: current.identifier!, current, comment: body, expected }),
          ctx.signal,
        ));
      }
      const results = await runSequential(
        identifiers,
        async (identifier) => {
          if (expected) await readAndGuardIssue(client, identifier, expected, ctx.signal);
          return commentIssue(client, identifier, body, ctx.signal);
        },
        ctx.signal,
      );
      return formatMutationResults("comment", results);
    },
  }));

  return disposers;
}
