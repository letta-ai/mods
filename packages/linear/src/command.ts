import { LinearClient } from "./client.ts";
import {
  DEFAULT_LIMIT,
  MAX_BATCH_SIZE,
  MAX_FULL_BATCH_SIZE,
  PANEL_LIMIT,
} from "./config.ts";
import { formatIssues, formatReadResults } from "./format.ts";
import type { PanelState } from "./types.ts";
import { compactError } from "./utils.ts";

export function registerLinearCommand(letta: any, client: LinearClient): Array<() => void> {
  const disposers: Array<() => void> = [];
  let panel: { update(): void; close(): void } | null = null;
  const panelState: PanelState = { loading: false, error: null, issues: [], updatedAt: null };

  const closePanel = () => {
    panel?.close();
    panel = null;
  };

  const ensurePanel = () => {
    if (!letta.capabilities.ui.panels || panel) return;
    panel = letta.ui.openPanel({
      id: "linear",
      order: 90,
      render(ctx: any) {
        if (panelState.loading && panelState.issues.length === 0) return "Linear · loading active issues…";
        if (panelState.error) return `Linear · ${panelState.error}`;
        if (panelState.issues.length === 0) return "Linear · no active issues";
        const header = ctx.row(
          "Linear · active",
          panelState.updatedAt
            ? `updated ${panelState.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "",
          ctx.width,
        );
        const rows = panelState.issues.slice(0, PANEL_LIMIT).map((issue) => {
          const id = issue.identifier ?? "?";
          const linkedId = issue.url ? ctx.link(id, issue.url) : id;
          return ctx.row(`${linkedId}  ${issue.title ?? "Untitled"}`, issue.state?.name ?? "", ctx.width);
        });
        return [header, ...rows];
      },
    });
  };

  const refreshPanel = async (signal?: AbortSignal) => {
    panelState.loading = true;
    panelState.error = null;
    panel?.update();
    try {
      panelState.issues = await client.queryIssues({ state: "started", limit: PANEL_LIMIT, signal });
      panelState.updatedAt = new Date();
    } catch (error) {
      panelState.error = compactError(error);
    } finally {
      panelState.loading = false;
      panel?.update();
    }
  };

  disposers.push(
    letta.commands.register({
      id: "linear",
      description: "Browse Linear issues and show the active-work panel",
      args: "[mine|search <text>|full ENG-123 [ENG-456...]|ENG-123 [ENG-456...]|refresh|hide]",
      showInTranscript: false,
      async run(ctx: any) {
        const input = String(ctx.args ?? "").trim();
        const [subcommand, ...rest] = input.split(/\s+/);
        try {
          if (!input || subcommand === "refresh") {
            if (letta.capabilities.ui.panels) {
              ensurePanel();
              await refreshPanel(ctx.signal);
              return { type: "handled" };
            }
            return {
              type: "output",
              output: formatIssues(await client.queryIssues({ state: "started", limit: DEFAULT_LIMIT, signal: ctx.signal })),
            };
          }
          if (subcommand === "hide") {
            closePanel();
            return { type: "output", output: "Linear panel hidden." };
          }
          if (subcommand === "mine") {
            const team = await client.getTeam(ctx.signal);
            const output = await client.text(
              ["issue", "mine", "--team", team.key, "--sort", "priority", "--limit", String(DEFAULT_LIMIT), "--no-pager"],
              ctx.signal,
            );
            return { type: "output", output: output || "No assigned Linear issues found." };
          }
          if (subcommand === "search") {
            const search = rest.join(" ").trim();
            if (!search) return { type: "output", output: "Usage: /linear search <text>" };
            return {
              type: "output",
              output: formatIssues(await client.queryIssues({ search, limit: DEFAULT_LIMIT, signal: ctx.signal })),
            };
          }
          if (subcommand === "full") {
            const identifiers = rest.join(" ").split(/[\s,]+/).map((value) => value.toUpperCase()).filter(Boolean);
            if (
              identifiers.length === 0
              || identifiers.length > MAX_FULL_BATCH_SIZE
              || !identifiers.every((value) => /^[A-Z]+-\d+$/.test(value))
            ) {
              return { type: "output", output: `Usage: /linear full ENG-123 [ENG-456...] (maximum ${MAX_FULL_BATCH_SIZE})` };
            }
            const unique = [...new Set(identifiers)];
            return {
              type: "output",
              output: formatReadResults(unique, await client.getIssues(unique, "full", ctx.signal), "full"),
            };
          }
          const identifiers = input.split(/[\s,]+/).filter(Boolean).map((value) => value.toUpperCase());
          if (
            identifiers.length > 0
            && identifiers.length <= MAX_BATCH_SIZE
            && identifiers.every((value) => /^[A-Z]+-\d+$/.test(value))
          ) {
            const unique = [...new Set(identifiers)];
            return {
              type: "output",
              output: formatReadResults(unique, await client.getIssues(unique, "summary", ctx.signal), "summary"),
            };
          }
          return {
            type: "output",
            output: "Usage: /linear [mine | search <text> | full ENG-123 [ENG-456...] | ENG-123 [ENG-456...] | refresh | hide]",
          };
        } catch (error) {
          return { type: "output", output: `Linear error: ${compactError(error)}` };
        }
      },
    }),
  );

  disposers.push(closePanel);
  return disposers;
}
