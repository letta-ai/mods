import activate from "../mods/auto.mjs";

// Capture public registrations to exercise the actual mod callbacks. Provider
// requests are never mocked. Real CLI installation is checked separately.
export function host(ui) {
  let command;
  let permission;
  let close;
  const controller = new AbortController();
  const dispose = activate({
    capabilities: { commands: true, permissions: true, events: { lifecycle: true }, ui: { panels: Boolean(ui) } },
    ui,
    commands: { register(value) { command = value; return () => { command = undefined; }; } },
    permissions: { register(value) { permission = value; return () => { permission = undefined; }; } },
    events: { on(_name, callback) { close = callback; return () => { close = undefined; }; } },
  });
  return {
    run(args, conversationId = "conversation-1", agentId = "agent-1") {
      return command.run({ args, agent: { id: agentId }, conversation: { id: conversationId } });
    },
    check(event) { return permission.check(event, { signal: controller.signal }); },
    close(event) { close(event); },
    dispose() { controller.abort(); dispose(); },
  };
}

export function invocation(overrides = {}) {
  return {
    agentId: "agent-1", conversationId: "conversation-1", toolCallId: "call-1",
    toolName: "Bash", args: { command: "git status --short" },
    cwd: "/tmp", workingDirectory: "/tmp", permissionMode: "unrestricted",
    phase: "approval", ...overrides,
  };
}
