export const DEFAULT_LIMIT = 10;
export const PANEL_LIMIT = 4;
export const MAX_BATCH_SIZE = 50;
export const MAX_CREATE_BATCH_SIZE = 20;
export const MAX_FULL_BATCH_SIZE = 5;
export const MAX_RELATION_BATCH_SIZE = 50;

export const CONFIGURED_TEAMS_QUERY = `
query LinearModConfiguredTeams($filter: TeamFilter!) {
  teams(first: 2, filter: $filter) { nodes { id key name } }
}`;

const ISSUE_RESULT_FIELDS = `
  id identifier title url description priority priorityLabel dueDate estimate createdAt updatedAt completedAt canceledAt
  state { id name type }
  assignee { id name displayName }
  creator { id name displayName }
  project { id name slugId url }
  projectMilestone { id name }
  cycle { id name number startsAt endsAt }
  labels(first: 50) { nodes { id name } }
  parent { id identifier title url state { name } }
`;

export const ISSUE_SUMMARY_QUERY = `
query LinearModIssueSummaries($ids: [ID!]!) {
  issues(first: ${MAX_BATCH_SIZE}, filter: { id: { in: $ids } }) {
    nodes { ${ISSUE_RESULT_FIELDS} }
  }
}`;

export const ISSUE_FULL_QUERY = `
query LinearModFullIssues($ids: [ID!]!) {
  issues(first: ${MAX_FULL_BATCH_SIZE}, filter: { id: { in: $ids } }) {
    nodes {
      ${ISSUE_RESULT_FIELDS}
      children(first: 50) { nodes { id identifier title url state { name } } }
      comments(last: 10) { nodes { id body createdAt url user { name displayName } } }
      attachments(first: 20) { nodes { id title url subtitle sourceType createdAt } }
      relations(first: 50) { nodes { id type relatedIssue { id identifier title url state { name } } } }
      inverseRelations(first: 50) { nodes { id type issue { id identifier title url state { name } } } }
    }
  }
}`;

export const WRITE_METADATA_QUERY = `
query LinearModWriteMetadata(
  $teamId: ID!
  $projectFilter: ProjectFilter!
  $stateFilter: WorkflowStateFilter!
  $userFilter: UserFilter!
  $labelFilter: IssueLabelFilter!
  $issueFilter: IssueFilter!
  $cycleFilter: CycleFilter!
  $milestoneFilter: ProjectMilestoneFilter!
) {
  viewer { id name displayName email }
  teams(first: 1, filter: { id: { eq: $teamId } }) { nodes { id key name activeCycle { id name number } } }
  projects(first: 50, filter: $projectFilter) { nodes { id name slugId } }
  workflowStates(first: 50, filter: $stateFilter) { nodes { id name type position team { id key } } }
  users(first: 50, filter: $userFilter) { nodes { id name displayName email } }
  issueLabels(first: 50, filter: $labelFilter) { nodes { id name team { id key } } }
  issues(first: 50, filter: $issueFilter) { nodes { id identifier title } }
  cycles(first: 50, filter: $cycleFilter) { nodes { id name number team { id key } } }
  projectMilestones(first: 50, filter: $milestoneFilter) { nodes { id name project { id name slugId } } }
}`;

export const CREATE_ISSUE_MUTATION = `
mutation LinearModCreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { ${ISSUE_RESULT_FIELDS} }
  }
}`;

export const UPDATE_ISSUE_MUTATION = `
mutation LinearModUpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { ${ISSUE_RESULT_FIELDS} }
  }
}`;

export const COMMENT_MUTATION = `
mutation LinearModCreateComment($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body createdAt url user { name displayName } }
  }
}`;

export const CREATE_RELATION_MUTATION = `
mutation LinearModCreateRelation($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) {
    success
    issueRelation {
      id type
      issue { id identifier title url }
      relatedIssue { id identifier title url }
    }
  }
}`;

export const FIND_RELATION_QUERY = `
query LinearModFindRelation($issueId: String!) {
  issue(id: $issueId) {
    id identifier
    relations(first: 50) {
      nodes { id type relatedIssue { id identifier } }
    }
    inverseRelations(first: 50) {
      nodes { id type issue { id identifier } }
    }
  }
}`;

export const DELETE_RELATION_MUTATION = `
mutation LinearModDeleteRelation($id: String!) {
  issueRelationDelete(id: $id) { success }
}`;

export const IDENTIFIER_PROPERTIES = {
  identifier: { type: "string", description: "One issue identifier. Kept for backward compatibility." },
  identifiers: {
    type: "array",
    items: { type: "string" },
    minItems: 1,
    maxItems: MAX_BATCH_SIZE,
    uniqueItems: true,
    description: `Issue identifiers, for example [\"ENG-123\", \"ENG-456\"]. Summary reads allow ${MAX_BATCH_SIZE}; full reads allow ${MAX_FULL_BATCH_SIZE}.`,
  },
} as const;

export const WRITE_FIELD_PROPERTIES = {
  title: { type: "string" },
  description: { type: "string" },
  project: { type: "string" },
  state: { type: "string" },
  assignee: { type: "string" },
  priority: { type: "integer", minimum: 1, maximum: 4 },
  labels: { type: "array", items: { type: "string" } },
  parent: { type: "string" },
  due_date: { type: "string" },
  estimate: { type: "integer", minimum: 0 },
  milestone: { type: "string" },
  cycle: { type: "string" },
} as const;

export const DRY_RUN_PROPERTY = {
  dry_run: {
    type: "boolean",
    description: "Preview resolved operations and current state without executing mutations.",
  },
} as const;

export const EXPECTED_ISSUE_SCHEMA = {
  type: "object",
  minProperties: 1,
  properties: {
    updated_at: { type: "string", description: "Expected issue updatedAt timestamp from a prior read" },
    state: { type: "string", description: "Expected exact state name or state type" },
    assignee: { type: "string", description: "Expected exact assignee id, name, or display name" },
    unassigned: { type: "boolean", enum: [true], description: "Require the issue to be unassigned" },
    project: { type: "string", description: "Expected exact project id, name, or slug" },
    no_project: { type: "boolean", enum: [true], description: "Require the issue to have no project" },
    priority: { type: "integer", minimum: 0, maximum: 4 },
  },
  additionalProperties: false,
} as const;

export const RELATION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    from: { type: "string", description: "Source issue identifier or local create key" },
    type: { type: "string", enum: ["blocks", "blocked-by", "related", "duplicate"] },
    to: { type: "string", description: "Target issue identifier or local create key" },
  },
  required: ["from", "type", "to"],
  additionalProperties: false,
} as const;

export const CREATE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string", description: "Optional local alias, for example api or ui" },
    ...WRITE_FIELD_PROPERTIES,
  },
  required: ["title"],
  additionalProperties: false,
} as const;
