const MAX_TITLE_LENGTH = 100;
const UNSAFE_TITLE_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(UNSAFE_TITLE_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleLength(title: string): number {
  return Array.from(title).length;
}

export default function activate(letta: any) {
  if (!letta.capabilities.tools) return;

  return letta.tools.register({
    name: "retitle_conversation",
    description:
      "Change the current conversation title when it is missing, generic, stale, or no longer describes the main work. Choose a short title, usually 2 to 7 words. Do not retitle a conversation when its current title still describes the work.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The new conversation title. Use plain text and usually 2 to 7 words.",
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
    async run(ctx: any) {
      if (!ctx.conversation?.id) {
        return {
          status: "error",
          content: "The current conversation does not have a conversation ID.",
        };
      }

      const title = normalizeTitle(ctx.args?.title);
      if (!title) {
        return {
          status: "error",
          content: "The conversation title must not be empty.",
        };
      }
      if (titleLength(title) > MAX_TITLE_LENGTH) {
        return {
          status: "error",
          content: `The conversation title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
        };
      }
      if (typeof ctx.conversation.updateTitle !== "function") {
        return {
          status: "error",
          content:
            "Conversation title updates require Letta Code 0.30.21 or later.",
        };
      }

      await ctx.conversation.updateTitle(title);
      return `Conversation title changed to "${title}".`;
    },
  });
}
