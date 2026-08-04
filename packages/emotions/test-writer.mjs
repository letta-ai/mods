import { existsSync } from "node:fs";

import activate from "./mods/index.ts";

const [memoryDir, agentId, feeling, cause, barrier] = process.argv.slice(2);
const tools = new Map();
const dispose = activate({
	capabilities: { tools: true },
	tools: {
		register(definition) {
			tools.set(definition.name, definition);
			return () => tools.delete(definition.name);
		},
	},
	commands: { register() {} },
	events: { on() {} },
	ui: { openPanel() {} },
});

while (!existsSync(barrier)) {
	await new Promise((resolve) => setTimeout(resolve, 5));
}

const result = tools.get("emotions").run({
	agent: { id: agentId },
	memfs: { enabled: true, memoryDir },
	args: {
		action: "feel",
		feelings: [{ name: feeling, intensity: 0.4 }],
		cause,
	},
});

if (String(result).startsWith("Error:")) throw new Error(result);
dispose();
