import type {
  BatchResult,
  CreateItem,
  ExpectedIssueState,
  LinearActor,
  LinearConnection,
  RelationSpec,
  ToolArgs,
  UpdateFields,
} from "./types.ts";

const ISSUE_IDENTIFIER = /^[A-Z]+-\d+$/;

export function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberArg(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

export function arrayArg<T extends object>(value: unknown): T[] {
  return Array.isArray(value)
    ? value.filter((item): item is T => Boolean(item) && typeof item === "object")
    : [];
}

export function connectionNodes<T>(connection: LinearConnection<T> | undefined): T[] {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

export function actorName(actor: LinearActor | undefined): string {
  return actor?.displayName ?? actor?.name ?? "Unknown";
}

export function truncate(text: string, limit = 4000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

export function compactError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const candidate = error as { stderr?: string; stdout?: string; message?: string };
  const text = candidate.stderr || candidate.stdout || candidate.message || String(error);
  return text.trim().split("\n").slice(-4).join("\n").slice(0, 800);
}

export function identifierArgs(args: ToolArgs): string[] {
  const values = [args.identifier, ...(Array.isArray(args.identifiers) ? args.identifiers : [])];
  return [...new Set(values
    .map(stringArg)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase()))];
}

export function invalidIdentifier(identifiers: string[]): string | undefined {
  return identifiers.find((identifier) => !ISSUE_IDENTIFIER.test(identifier));
}

export function normalizeIssueIdentifier(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!ISSUE_IDENTIFIER.test(normalized)) throw new Error(`invalid Linear issue identifier: ${value}`);
  return normalized;
}

export function createItems(args: ToolArgs): CreateItem[] {
  const items = arrayArg<CreateItem>(args.items);
  if (items.length) return items;
  const title = stringArg(args.title);
  if (!title) return [];
  return [{ key: undefined, ...writeFieldsFromArgs(args), title }];
}

export function writeFieldsFromArgs(args: ToolArgs): UpdateFields {
  const labels = Array.isArray(args.labels)
    ? args.labels.map(stringArg).filter((value): value is string => Boolean(value))
    : [];
  return {
    title: stringArg(args.title),
    description: stringArg(args.description),
    project: stringArg(args.project),
    state: stringArg(args.state),
    assignee: stringArg(args.assignee),
    priority: typeof args.priority === "number" ? args.priority : undefined,
    labels: labels.length ? labels : undefined,
    parent: stringArg(args.parent),
    due_date: stringArg(args.due_date),
    estimate: typeof args.estimate === "number" ? args.estimate : undefined,
    milestone: stringArg(args.milestone),
    cycle: stringArg(args.cycle),
  };
}

export function validateWriteFields(fields: UpdateFields, requireTitle = false): string | undefined {
  if (requireTitle && !stringArg(fields.title)) return "title is required";
  if (
    typeof fields.priority === "number"
    && (!Number.isFinite(fields.priority) || fields.priority < 1 || fields.priority > 4 || !Number.isInteger(fields.priority))
  ) {
    return "priority must be an integer between 1 and 4";
  }
  if (typeof fields.estimate === "number" && (!Number.isFinite(fields.estimate) || fields.estimate < 0 || !Number.isInteger(fields.estimate))) {
    return "estimate must be a non-negative integer";
  }
  if (fields.parent && !ISSUE_IDENTIFIER.test(fields.parent.toUpperCase())) return `invalid parent issue identifier: ${fields.parent}`;
  if (fields.milestone && !fields.project) return "milestone requires project";
  return undefined;
}

export function hasWriteFields(fields: UpdateFields): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

export function expectedIssueFromArgs(args: ToolArgs): ExpectedIssueState | undefined {
  if (!args.expected || typeof args.expected !== "object" || Array.isArray(args.expected)) return undefined;
  const expected = args.expected as Record<string, unknown>;
  return {
    updated_at: stringArg(expected.updated_at),
    state: stringArg(expected.state),
    assignee: stringArg(expected.assignee),
    unassigned: typeof expected.unassigned === "boolean" ? expected.unassigned : undefined,
    project: stringArg(expected.project),
    no_project: typeof expected.no_project === "boolean" ? expected.no_project : undefined,
    priority: typeof expected.priority === "number" ? expected.priority : undefined,
  };
}

export function validateExpectedIssueState(expected: ExpectedIssueState | undefined): string | undefined {
  if (!expected) return undefined;
  if (!Object.values(expected).some((value) => value !== undefined)) return "expected must include at least one guard";
  if (expected.assignee && expected.unassigned !== undefined) return "expected.assignee and expected.unassigned are mutually exclusive";
  if (expected.project && expected.no_project !== undefined) return "expected.project and expected.no_project are mutually exclusive";
  if (expected.unassigned === false) return "expected.unassigned must be true when provided";
  if (expected.no_project === false) return "expected.no_project must be true when provided";
  if (expected.updated_at && !Number.isFinite(Date.parse(expected.updated_at))) return "expected.updated_at must be a valid timestamp";
  if (
    expected.priority !== undefined
    && (!Number.isInteger(expected.priority) || expected.priority < 0 || expected.priority > 4)
  ) {
    return "expected.priority must be an integer between 0 and 4";
  }
  return undefined;
}

export function aliasKey(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveIssueRef(value: string, aliases: Map<string, string>): string {
  const alias = aliases.get(aliasKey(value));
  if (alias) return alias;
  try {
    return normalizeIssueIdentifier(value);
  } catch {
    throw new Error(`unknown local issue key or invalid Linear issue identifier: ${value}`);
  }
}

export function relationSpecs(value: unknown): RelationSpec[] {
  return arrayArg<RelationSpec>(value);
}

export async function runSequential<T>(
  identifiers: string[],
  operation: (identifier: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<Array<BatchResult<T>>> {
  const results: Array<BatchResult<T>> = [];
  for (const identifier of identifiers) {
    if (signal?.aborted) break;
    try {
      results.push({ identifier, value: await operation(identifier) });
    } catch (error) {
      results.push({ identifier, error: signal?.aborted ? "operation canceled" : compactError(error) });
      if (signal?.aborted) break;
    }
  }
  return results;
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function emptyIdFilter(): Record<string, unknown> {
  return { id: { in: [] } };
}

export function caseInsensitiveOr(field: string, values: string[]): Record<string, unknown> {
  return values.length
    ? { or: values.map((value) => ({ [field]: { eqIgnoreCase: value } })) }
    : emptyIdFilter();
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
