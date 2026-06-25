// Adds current-time metadata to every user message before it is sent to the model.
// The visible timestamp block is intentionally short so the agent always knows the local time.

function timestampMetadata(date = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return {
    local: date.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "long",
      timeZoneName: "short",
    }),
    timeZone,
  };
}

function timestampBlock(meta) {
  return [
    "<user_timestamp>",
    `local: ${meta.local}`,
    `timezone: ${meta.timeZone}`,
    "</user_timestamp>",
    "",
  ].join("\n");
}

function hasTimestampText(content) {
  if (typeof content === "string") return content.includes("<user_timestamp>");
  if (!Array.isArray(content)) return false;
  return content.some(
    (part) =>
      part?.type === "text" &&
      typeof part.text === "string" &&
      part.text.includes("<user_timestamp>"),
  );
}

function prependTimestampContent(content, block) {
  if (typeof content === "string") return block + content;

  if (Array.isArray(content)) {
    let inserted = false;
    const next = content.map((part) => {
      if (!inserted && part?.type === "text" && typeof part.text === "string") {
        inserted = true;
        return { ...part, text: block + part.text };
      }
      return part;
    });

    if (!inserted) next.unshift({ type: "text", text: block });
    return next;
  }

  return block;
}

export default function activate(letta) {
  if (!letta.capabilities.events.turns) {
    letta.diagnostics?.report?.({
      severity: "warning",
      message: "user-timestamps mod requires turn events, but this host does not expose them.",
    });
    return;
  }

  return letta.events.on("turn_start", (event) => {
    const meta = timestampMetadata();
    const block = timestampBlock(meta);

    event.input = event.input.map((item) => {
      if (item.type === "approval" || item.role !== "user") return item;

      const existingMetadata =
        item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? item.metadata
          : {};

      return {
        ...item,
        metadata: {
          ...existingMetadata,
          user_timestamp: meta,
        },
        content: hasTimestampText(item.content)
          ? item.content
          : prependTimestampContent(item.content, block),
      };
    });
  });
}
