import { LinearClient } from "./client.ts";
import { registerLinearCommand } from "./command.ts";
import { registerLinearTools } from "./tools.ts";

export function activateLinearMod(letta: any): () => void {
  const client = new LinearClient();
  const disposers: Array<() => void> = [];
  if (letta.capabilities.commands) disposers.push(...registerLinearCommand(letta, client));
  if (letta.capabilities.tools) disposers.push(...registerLinearTools(letta, client));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
