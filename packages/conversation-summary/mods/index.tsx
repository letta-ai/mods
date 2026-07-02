function cleanSummary(summary: unknown): string | null {
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

export default function activate(letta: any) {
  if (!letta.capabilities.ui?.panels) return;

  const panel = letta.ui.openPanel({
    id: "conversation-summary",
    order: 0,
    render({ width, agent, model, conversationSummary, row, chalk }: any) {
      const summary = cleanSummary(conversationSummary);
      const left = summary ? chalk.hex("#8C8CF9")(summary) : "";
      const modelLabel = model.displayName ?? model.id ?? "unknown";
      const right = chalk.dim(`${agent.name ?? "Letta"} · ${modelLabel}`);

      return row(left, right, width);
    },
  });

  return () => panel.close();
}
