import type {
  BatchResult,
  CreateResult,
  IssueDetail,
  LinearComment,
  LinearIssue,
  MutationPreview,
  RelationResult,
} from "./types.ts";
import { actorName, connectionNodes, truncate } from "./utils.ts";

export function issueLine(issue: LinearIssue): string {
  const id = issue.identifier ?? "?";
  const state = issue.state?.name ?? "Unknown";
  const priority = issue.priorityLabel && issue.priorityLabel !== "No priority"
    ? ` · ${issue.priorityLabel}`
    : "";
  const assignee = issue.assignee?.displayName ?? issue.assignee?.name;
  return `${id}  ${issue.title ?? "Untitled"}  [${state}${priority}]${assignee ? ` · ${assignee}` : ""}`;
}

export function formatIssues(issues: LinearIssue[]): string {
  if (issues.length === 0) return "No Linear issues found.";
  return issues
    .map((issue) => `${issueLine(issue)}${issue.url ? `\n${issue.url}` : ""}`)
    .join("\n\n");
}

function formatComment(comment: LinearComment): string[] {
  const heading = [comment.createdAt?.slice(0, 10), actorName(comment.user)]
    .filter(Boolean)
    .join(" · ");
  return [
    `- ${heading || "Comment"}${comment.url ? ` · ${comment.url}` : ""}`,
    truncate(comment.body?.trim() || "[empty comment]"),
  ];
}

export function formatIssue(issue: LinearIssue, detail: IssueDetail): string {
  const lines = [
    `${issue.identifier ?? "Issue"}: ${issue.title ?? "Untitled"}`,
    [issue.state?.name, issue.priorityLabel, issue.assignee?.displayName ?? issue.assignee?.name]
      .filter(Boolean)
      .join(" · "),
  ];
  if (issue.project?.name) lines.push(`Project: ${issue.project.name}`);
  const labels = connectionNodes(issue.labels).map((label) => label.name).filter(Boolean);
  if (labels.length) lines.push(`Labels: ${labels.join(", ")}`);
  if (issue.cycle?.name) lines.push(`Cycle: ${issue.cycle.name}`);
  if (issue.projectMilestone?.name) lines.push(`Milestone: ${issue.projectMilestone.name}`);
  if (issue.dueDate) lines.push(`Due: ${issue.dueDate}`);
  if (typeof issue.estimate === "number") lines.push(`Estimate: ${issue.estimate}`);
  if (issue.url) lines.push(issue.url);
  if (issue.description) lines.push("", truncate(issue.description.trim(), detail === "full" ? 8000 : 4000));

  if (detail === "full") {
    if (issue.parent?.identifier) {
      lines.push("", `Parent: ${issue.parent.identifier} · ${issue.parent.title ?? "Untitled"}`);
    }

    const children = connectionNodes(issue.children);
    if (children.length) {
      lines.push(
        "",
        "Children:",
        ...children.map((child) =>
          `- ${child.identifier ?? "?"} · ${child.title ?? "Untitled"} [${child.state?.name ?? "Unknown"}]`),
      );
    }

    const relations = [
      ...connectionNodes(issue.relations).map((relation) =>
        `${issue.identifier ?? "?"} ${relation.type ?? "related"} ${relation.relatedIssue?.identifier ?? "?"} · ${relation.relatedIssue?.title ?? "Untitled"}`),
      ...connectionNodes(issue.inverseRelations).map((relation) =>
        `${relation.issue?.identifier ?? "?"} ${relation.type ?? "related"} ${issue.identifier ?? "?"} · ${relation.issue?.title ?? "Untitled"}`),
    ];
    if (relations.length) lines.push("", "Relations:", ...relations.map((relation) => `- ${relation}`));

    const attachments = connectionNodes(issue.attachments);
    if (attachments.length) {
      lines.push(
        "",
        "Attachments:",
        ...attachments.map((attachment) =>
          `- ${attachment.title ?? attachment.sourceType ?? "Attachment"}${attachment.url ? `\n  ${attachment.url}` : ""}`),
      );
    }

    const comments = connectionNodes(issue.comments);
    if (comments.length) {
      lines.push("", `Comments (latest ${comments.length}):`);
      for (const comment of comments) lines.push(...formatComment(comment));
    }

    if (issue.createdAt || issue.updatedAt) {
      lines.push(
        "",
        [issue.createdAt ? `Created ${issue.createdAt}` : "", issue.updatedAt ? `Updated ${issue.updatedAt}` : ""]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }
  return lines.filter((line, index) => line || index > 3).join("\n");
}

export function formatReadResults(identifiers: string[], issues: LinearIssue[], detail: IssueDetail): string {
  const byIdentifier = new Map(issues.map((issue) => [issue.identifier?.toUpperCase(), issue]));
  return identifiers
    .map((identifier) => {
      const issue = byIdentifier.get(identifier);
      return issue ? formatIssue(issue, detail) : `${identifier}: Linear issue not found.`;
    })
    .join("\n\n---\n\n");
}

function issueResult(issue: LinearIssue | undefined): Record<string, unknown> | undefined {
  if (!issue) return undefined;
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: issue.state?.name,
    assignee: issue.assignee?.displayName ?? issue.assignee?.name,
    project: issue.project?.name,
    priority: issue.priorityLabel,
  };
}

export function formatCreateResults(results: CreateResult[], relations: RelationResult[]): string {
  return JSON.stringify({
    created: results.filter((result) => result.issue).map((result) => ({
      key: result.key,
      ...issueResult(result.issue?.issue),
    })),
    create_errors: results.filter((result) => result.error).map((result) => ({
      key: result.key,
      title: result.title,
      error: result.error,
    })),
    relations: relations.map((relation) => ({
      from: relation.from,
      type: relation.type,
      to: relation.to,
      status: relation.error ? "error" : "ok",
      ...(relation.error ? { error: relation.error } : {}),
    })),
  }, null, 2);
}

export function formatCreatePreview(results: CreateResult[], relations: RelationResult[]): string {
  return JSON.stringify({
    action: "create",
    dry_run: true,
    planned: results.filter((result) => result.input).length,
    failed: results.filter((result) => result.error).length,
    creates: results.filter((result) => result.input).map((result) => ({
      key: result.key,
      title: result.title,
      status: "planned",
      resolved_input: result.input,
    })),
    create_errors: results.filter((result) => result.error).map((result) => ({
      key: result.key,
      title: result.title,
      error: result.error,
    })),
    relations: relations.map((relation) => ({
      from: relation.from,
      type: relation.type,
      to: relation.to,
      status: relation.error ? "error" : "planned",
      ...(relation.error ? { error: relation.error } : {}),
    })),
  }, null, 2);
}

export function formatMutationResults<T>(action: string, results: Array<BatchResult<T>>): string {
  return JSON.stringify({
    action,
    succeeded: results.filter((result) => !result.error).length,
    failed: results.filter((result) => result.error).length,
    results: results.map((result) => ({
      identifier: result.identifier,
      status: result.error ? "error" : "ok",
      ...(result.error ? { error: result.error } : {}),
      ...(result.value && typeof result.value === "object"
        ? { value: "identifier" in result.value ? issueResult(result.value as LinearIssue) : result.value }
        : {}),
    })),
  }, null, 2);
}

export function formatMutationPreview(action: string, results: Array<BatchResult<MutationPreview>>): string {
  return JSON.stringify({
    action,
    dry_run: true,
    planned: results.filter((result) => !result.error).length,
    failed: results.filter((result) => result.error).length,
    results: results.map((result) => ({
      identifier: result.identifier,
      status: result.error ? "error" : "planned",
      ...(result.error ? { error: result.error } : {}),
      ...(result.value
        ? {
            current: issueResult(result.value.current),
            ...(result.value.changes ? { changes: result.value.changes } : {}),
            ...(result.value.resolvedChanges ? { resolved_changes: result.value.resolvedChanges } : {}),
            ...(result.value.comment ? { comment: result.value.comment } : {}),
            ...(result.value.expected ? { expected: result.value.expected } : {}),
          }
        : {}),
    })),
    note: "Preview only. Expected-state guards are best-effort preconditions, not atomic compare-and-swap operations.",
  }, null, 2);
}

export function formatRelationResults(operation: string, results: RelationResult[], dryRun = false): string {
  return JSON.stringify({
    operation,
    ...(dryRun ? { dry_run: true } : {}),
    results: results.map((result) => ({
      from: result.from,
      type: result.type,
      to: result.to,
      status: result.error ? "error" : dryRun || result.dryRun ? "planned" : "ok",
      ...(result.error ? { error: result.error } : {}),
    })),
  }, null, 2);
}
