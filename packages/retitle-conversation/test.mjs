import assert from "node:assert/strict";
import test from "node:test";

import activate from "./mods/index.ts";

function createHarness(capabilities = { tools: true }) {
  let registration;
  let disposed = false;
  const dispose = activate({
    capabilities,
    tools: {
      register(definition) {
        registration = definition;
        return () => {
          disposed = true;
        };
      },
    },
  });

  return {
    dispose,
    get disposed() {
      return disposed;
    },
    get tool() {
      return registration;
    },
  };
}

function conversationContext(options = {}) {
  const updates = [];
  const conversation = {
    id: options.id === undefined ? "conv-test" : options.id,
    async updateTitle(title) {
      updates.push(title);
    },
  };
  if (options.updateTitle === false) delete conversation.updateTitle;

  return {
    ctx: {
      args: { title: options.title ?? "Focused title" },
      conversation,
    },
    updates,
  };
}

test("registers a mutating tool with a strict schema", () => {
  const harness = createHarness();
  assert.equal(harness.tool.name, "retitle_conversation");
  assert.equal(harness.tool.requiresApproval, true);
  assert.equal(harness.tool.parallelSafe, false);
  assert.deepEqual(harness.tool.parameters.required, ["title"]);
  assert.equal(harness.tool.parameters.additionalProperties, false);
  assert.equal(harness.tool.parameters.properties.title.maxLength, 100);

  harness.dispose();
  assert.equal(harness.disposed, true);
});

test("does not register without the tools capability", () => {
  const harness = createHarness({ tools: false });
  assert.equal(harness.tool, undefined);
  assert.equal(harness.dispose, undefined);
});

test("normalizes and persists a safe conversation title", async () => {
  const harness = createHarness();
  const { ctx, updates } = conversationContext({
    title: "  Release\n\t readiness \u0000 review \u202e ",
  });

  const result = await harness.tool.run(ctx);

  assert.deepEqual(updates, ["Release readiness review"]);
  assert.equal(result, 'Conversation title changed to "Release readiness review".');
});

test("accepts 100 Unicode code points and rejects 101", async () => {
  const harness = createHarness();
  const accepted = conversationContext({ title: "😀".repeat(100) });
  const rejected = conversationContext({ title: "😀".repeat(101) });

  await harness.tool.run(accepted.ctx);
  const result = await harness.tool.run(rejected.ctx);

  assert.deepEqual(accepted.updates, ["😀".repeat(100)]);
  assert.deepEqual(rejected.updates, []);
  assert.deepEqual(result, {
    status: "error",
    content: "The conversation title must be 100 characters or fewer.",
  });
});

test("rejects invalid input before mutation", async () => {
  const harness = createHarness();

  for (const title of ["", " \n\t ", 42, null]) {
    const { ctx, updates } = conversationContext({ title });
    ctx.args.title = title;
    const result = await harness.tool.run(ctx);
    assert.deepEqual(result, {
      status: "error",
      content: "The conversation title must not be empty.",
    });
    assert.deepEqual(updates, []);
  }
});

test("reports unavailable conversation state without a partial update", async () => {
  const harness = createHarness();
  const missingId = conversationContext({ id: null });
  const oldHost = conversationContext({ updateTitle: false });

  assert.deepEqual(await harness.tool.run(missingId.ctx), {
    status: "error",
    content: "The current conversation does not have a conversation ID.",
  });
  assert.deepEqual(await harness.tool.run(oldHost.ctx), {
    status: "error",
    content: "Conversation title updates require Letta Code 0.30.21 or later.",
  });
  assert.deepEqual(missingId.updates, []);
  assert.deepEqual(oldHost.updates, []);
});
