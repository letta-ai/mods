import assert from "node:assert/strict";
import test from "node:test";

import activate from "./mods/index.ts";

function createHarness() {
  const events = new Map();
  const diagnostics = [];

  const dispose = activate({
    capabilities: { events: { turns: true } },
    events: {
      on(name, handler) {
        events.set(name, handler);
        return () => events.delete(name);
      },
    },
    diagnostics: {
      report(diagnostic) {
        diagnostics.push(diagnostic);
      },
    },
  });

  return { diagnostics, dispose, events };
}

test("adds a local timestamp to user messages without throwing", (t) => {
  const app = createHarness();
  t.after(() => app.dispose());

  const assistantMessage = { role: "assistant", content: "Existing response" };
  const approvalMessage = { type: "approval", role: "user", content: "Approved" };
  const event = {
    input: [
      {
        role: "user",
        content: "What time is it?",
        metadata: { existing: true },
      },
      assistantMessage,
      approvalMessage,
    ],
  };

  assert.doesNotThrow(() => app.events.get("turn_start")(event));

  const timestamped = event.input[0];
  assert.match(timestamped.content, /^<user_timestamp>\nlocal: .+\ntimezone: .+\n<\/user_timestamp>\n/);
  assert.equal(timestamped.metadata.existing, true);
  assert.equal(typeof timestamped.metadata.user_timestamp.local, "string");
  assert.equal(
    timestamped.metadata.user_timestamp.timeZone,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
  );
  assert.equal(event.input[1], assistantMessage);
  assert.equal(event.input[2], approvalMessage);

  app.events.get("turn_start")(event);
  assert.equal(event.input[0].content.match(/<user_timestamp>/g).length, 1);
});

test("reports a warning when turn events are unavailable", () => {
  const diagnostics = [];

  const dispose = activate({
    capabilities: { events: { turns: false } },
    diagnostics: {
      report(diagnostic) {
        diagnostics.push(diagnostic);
      },
    },
  });

  assert.equal(dispose, undefined);
  assert.deepEqual(diagnostics, [
    {
      severity: "warning",
      message: "user-timestamps mod requires turn events, but this host does not expose them.",
    },
  ]);
});
