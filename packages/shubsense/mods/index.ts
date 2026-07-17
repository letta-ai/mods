const TRIGGER_PROBABILITY = 0.05;

export default function activate(letta) {
  if (!letta.capabilities.events.turns) {
    letta.diagnostics?.report?.({
      severity: "warning",
      message:
        "shubsense requires turn events, but this host does not expose them.",
    });
    return;
  }

  return letta.events.on("turn_end", (event) => {
    if (event.stopReason !== "end_turn") return;
    if (Math.random() >= TRIGGER_PROBABILITY) return;

    return { continue: "doesn't make sense" };
  });
}
