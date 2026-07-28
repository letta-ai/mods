import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function shortSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "follow-up";
}

export default function activate(letta: any) {
  if (!letta.capabilities.tools) return;

  return letta.tools.register({
    name: "schedule_oath",
    description:
      "Schedule one explicit follow-up only after deliberately committing to deliver something later. Do not call this for work that can be completed in the current turn, casual status narration, speculative ideas, or implicit promises.",
    parameters: {
      type: "object",
      properties: {
        promise: {
          type: "string",
          description: "The concrete result promised to the user.",
        },
        due_at: {
          type: "string",
          description:
            'When the follow-up should run, in letta cron syntax such as "in 30m", "tomorrow at 9am", or an ISO timestamp.',
        },
        delivery_instructions: {
          type: "string",
          description:
            "What to check or do when the oath fires, including the evidence or result the user should receive.",
        },
        runner: {
          type: "string",
          enum: ["cloud", "local"],
          description:
            "Optional scheduler runner. Omit to use the Letta CLI default for the current agent.",
        },
        computer: {
          type: "string",
          description:
            "Optional connected computer device ID for a cloud schedule that needs a particular machine.",
        },
      },
      required: ["promise", "due_at", "delivery_instructions"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,

    async run(ctx: any) {
      const promise = clean(ctx.args.promise);
      const dueAt = clean(ctx.args.due_at);
      const instructions = clean(ctx.args.delivery_instructions);
      const runner = clean(ctx.args.runner);
      const computer = clean(ctx.args.computer);
      const agentId = clean(
        ctx.agent?.id ?? process.env.AGENT_ID ?? process.env.LETTA_AGENT_ID,
      );
      const conversationId = clean(
        ctx.conversation?.id ??
          process.env.CONVERSATION_ID ??
          process.env.LETTA_CONVERSATION_ID,
      );

      if (!promise || !dueAt || !instructions) {
        return {
          status: "error",
          content: "promise, due_at, and delivery_instructions are required",
        };
      }
      if (!agentId || !conversationId) {
        return {
          status: "error",
          content: "could not resolve the current agent or conversation",
        };
      }
      if (computer && runner === "local") {
        return {
          status: "error",
          content: "computer can only be used with the cloud runner",
        };
      }

      const name = `explicit-oath-${shortSlug(promise)}-${Date.now()}`;
      const description = `Deliver explicit promise: ${promise.slice(0, 120)}`;
      const prompt = [
        "[Explicit Oath] You deliberately scheduled this follow-up in an earlier turn.",
        "",
        `Promise: ${promise}`,
        `Delivery instructions: ${instructions}`,
        `Original working directory: ${ctx.cwd}`,
        "",
        "Deliver the promised result now. Use tools and current conversation context as needed. Be concise and specific. If delivery is genuinely blocked, explain the blocker plainly instead of pretending the oath was kept.",
      ].join("\n");

      const args = [
        "cron",
        "add",
        "--name",
        name,
        "--description",
        description,
        "--prompt",
        prompt,
        "--at",
        dueAt,
        "--agent",
        agentId,
        "--conversation",
        conversationId,
      ];
      if (runner) args.push("--runner", runner);
      if (computer) args.push("--computer", computer);

      try {
        const { stdout } = await execFileAsync("letta", args, {
          cwd: ctx.cwd,
          signal: ctx.signal,
        });

        let scheduleId = "";
        try {
          scheduleId = clean(JSON.parse(stdout).id);
        } catch {
          scheduleId = "";
        }

        return scheduleId
          ? `Oath scheduled for ${dueAt} (schedule ${scheduleId}).`
          : `Oath scheduled for ${dueAt}.`;
      } catch (error: any) {
        const detail = clean(error?.stderr || error?.message).slice(0, 300);
        return {
          status: "error",
          content: detail
            ? `could not schedule oath: ${detail}`
            : "could not schedule oath",
        };
      }
    },
  });
}
