// TeamTalk mod — skeleton.
//
// This file is intentionally a stub. The intended behavior is documented
// in ../README.md and ../MOD.md. The full implementation will be added
// once the steward-agent pattern has been validated in a real
// environment.
//
// Expected shape (per MOD.md):
//
//   export default function activate(letta) {
//     const disposers = [];
//
//     if (letta.capabilities.commands) {
//       disposers.push(letta.commands.register({
//         id: "teamtalk",
//         // /teamtalk enable | status | search | propose
//       }));
//     }
//
//     if (letta.capabilities.tools) {
//       disposers.push(letta.tools.register({
//         id: "teamtalk_search",
//         // Read steward MemFS, apply keyword/semantic search
//       }));
//       disposers.push(letta.tools.register({
//         id: "teamtalk_propose",
//         // Send PROPOSE_NEW_CONCEPT message to steward
//       }));
//     }
//
//     if (letta.capabilities.events?.turns) {
//       disposers.push(letta.events.turns.onTurnStart(async (event, ctx) => {
//         // Read steward system/rules.md, prepend as transient prefix
//       }));
//     }
//
//     return () => disposers.reverse().forEach((d) => d());
//   }

export default function activate(_letta: unknown): () => void {
  // Stub: no capabilities registered.
  return () => {};
}