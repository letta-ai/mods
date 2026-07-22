export type IssueDetail = "summary" | "full";
export type ToolArgs = Record<string, unknown>;
export type LinearConnection<T> = { nodes?: T[] } | null;
export type LinearTeam = { id: string; key: string; name?: string };
export type LinearActor = { id?: string; displayName?: string; name?: string } | null;

export type LinearIssueRef = {
  id?: string;
  identifier?: string;
  title?: string;
  url?: string;
  state?: { name?: string } | null;
};

export type LinearIssueRelation = {
  id?: string;
  type?: string;
  issue?: LinearIssueRef | null;
  relatedIssue?: LinearIssueRef | null;
};

export type LinearComment = {
  id?: string;
  body?: string;
  createdAt?: string;
  url?: string;
  user?: LinearActor;
};

export type LinearAttachment = {
  id?: string;
  title?: string;
  url?: string;
  subtitle?: string;
  sourceType?: string;
  createdAt?: string;
};

export type LinearIssue = LinearIssueRef & {
  priority?: number;
  priorityLabel?: string;
  state?: { id?: string; name?: string; type?: string } | null;
  assignee?: LinearActor;
  creator?: LinearActor;
  project?: { id?: string; name?: string; slugId?: string; url?: string } | null;
  projectMilestone?: { id?: string; name?: string } | null;
  cycle?: { id?: string; name?: string; number?: number; startsAt?: string; endsAt?: string } | null;
  description?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  labels?: LinearConnection<{ id?: string; name?: string }>;
  parent?: LinearIssueRef | null;
  children?: LinearConnection<LinearIssueRef>;
  comments?: LinearConnection<LinearComment>;
  attachments?: LinearConnection<LinearAttachment>;
  relations?: LinearConnection<LinearIssueRelation>;
  inverseRelations?: LinearConnection<LinearIssueRelation>;
};

export type QueryResult = { nodes?: LinearIssue[] };

export type CreateItem = {
  key?: string;
  title?: string;
  description?: string;
  project?: string;
  state?: string;
  assignee?: string;
  priority?: number;
  labels?: string[];
  parent?: string;
  due_date?: string;
  estimate?: number;
  milestone?: string;
  cycle?: string;
};

export type UpdateFields = Omit<CreateItem, "key">;
export type ExpectedIssueState = {
  updated_at?: string;
  state?: string;
  assignee?: string;
  unassigned?: boolean;
  project?: string;
  no_project?: boolean;
  priority?: number;
};
export type RelationType = "blocks" | "blocked-by" | "related" | "duplicate";
export type RelationSpec = { from?: string; type?: string; to?: string };

export type BatchResult<T> = {
  identifier: string;
  value?: T;
  error?: string;
};

export type CreatedIssue = {
  key?: string;
  identifier: string;
  url?: string;
  issue: LinearIssue;
};

export type CreateResult = {
  key?: string;
  title?: string;
  issue?: CreatedIssue;
  input?: Record<string, unknown>;
  error?: string;
};

export type RelationResult = {
  from: string;
  type: string;
  to: string;
  relation?: LinearIssueRelation;
  dryRun?: boolean;
  error?: string;
};

export type MutationPreview = {
  identifier: string;
  current: LinearIssue;
  changes?: UpdateFields;
  resolvedChanges?: Record<string, unknown>;
  comment?: string;
  expected?: ExpectedIssueState;
};

export type PanelState = {
  loading: boolean;
  error: string | null;
  issues: LinearIssue[];
  updatedAt: Date | null;
};

export type LinearRunner = (args: string[], signal?: AbortSignal) => Promise<string>;

export type MetadataNode = {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  key?: string;
  slugId?: string;
  type?: string;
  number?: number;
  position?: number;
  identifier?: string;
  activeCycle?: { id?: string; name?: string; number?: number } | null;
  team?: { id?: string; key?: string } | null;
  project?: { id?: string; name?: string; slugId?: string } | null;
};

export type WriteMetadata = {
  viewer: MetadataNode;
  teams: LinearConnection<MetadataNode>;
  projects: LinearConnection<MetadataNode>;
  workflowStates: LinearConnection<MetadataNode>;
  users: LinearConnection<MetadataNode>;
  issueLabels: LinearConnection<MetadataNode>;
  issues: LinearConnection<MetadataNode>;
  cycles: LinearConnection<MetadataNode>;
  projectMilestones: LinearConnection<MetadataNode>;
};
