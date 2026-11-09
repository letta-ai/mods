import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import activate from "./mods/index.ts";

const AGENT_ID = "agent-test-emotions";

function createHarness() {
	const tools = new Map();
	const commands = new Map();
	const events = new Map();
	const diagnostics = [];
	let panelDefinition = null;

	const dispose = activate({
		capabilities: {
			tools: true,
			commands: true,
			events: { turns: true, tools: true, llm: true },
			ui: { panels: true },
		},
		tools: {
			register(definition) {
				tools.set(definition.name, definition);
				return () => tools.delete(definition.name);
			},
		},
		commands: {
			register(definition) {
				commands.set(definition.id, definition);
				return () => commands.delete(definition.id);
			},
		},
		events: {
			on(name, handler) {
				events.set(name, handler);
				return () => events.delete(name);
			},
		},
		ui: {
			openPanel(definition) {
				panelDefinition = definition;
				return { update() {}, close() {} };
			},
		},
		diagnostics: {
			report(diagnostic) {
				diagnostics.push(diagnostic);
			},
		},
	});

	return {
		commands,
		diagnostics,
		dispose,
		events,
		get panelDefinition() {
			return panelDefinition;
		},
		tools,
	};
}

async function temporaryContext(t) {
	const memoryDir = await mkdtemp(join(tmpdir(), "letta-emotions-test-"));
	t.after(() => rm(memoryDir, { force: true, recursive: true }));
	return {
		agent: { id: AGENT_ID, name: "Test Agent" },
		memfs: { enabled: true, memoryDir },
	};
}

function statePath(ctx) {
	return join(ctx.memfs.memoryDir, "state", "emotions.json");
}

function runWriter(ctx, feeling, cause, barrier, contextName) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				join(import.meta.dirname, "test-writer.mjs"),
				ctx.memfs.memoryDir,
				AGENT_ID,
				feeling,
				cause,
				barrier,
			],
			{
				env: { ...process.env, LETTA_EMOTION_CONTEXT: contextName },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`writer exited ${code}: ${output}`));
		});
	});
}

test("registers one unified tool and persists mixed affect in MemFS", async (t) => {
	const app = createHarness();
	t.after(() => app.dispose());
	const ctx = await temporaryContext(t);

	assert.deepEqual([...app.tools.keys()], ["emotions"]);
	assert.deepEqual([...app.commands.keys()].sort(), [
		"emotion-reset",
		"feelings",
	]);
	assert.equal(app.panelDefinition.order, 0);

	const result = app.tools.get("emotions").run({
		...ctx,
		args: {
			action: "feel",
			feelings: [
				{ name: "curious", intensity: 0.62 },
				{ name: "playful anticipation", intensity: 0.38 },
			],
			cause: "Exercise mixed affect without leaking <free-form causes>.",
			appraisal: {
				pleasantness: 0.55,
				activation: 0.58,
				control: 0.64,
				connection: 0.7,
				novelty: 0.82,
			},
		},
	});

	assert.match(result, /curiosity 62% \+ playful anticipation 38%/);
	const state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.equal(state.version, 2);
	assert.equal(state.agentId, AGENT_ID);
	assert.equal(Object.keys(state.contexts).length, 1);
	assert.equal(state.episodes.at(-1).feelings[1].name, "playful anticipation");

	const transformed = app.events.get("turn_start")(
		{ agentId: AGENT_ID, input: [{ role: "user", content: "hello" }] },
		ctx,
	);
	assert.equal(transformed.input.length, 2);
	assert.deepEqual(transformed.input[0], { role: "user", content: "hello" });
	assert.equal(transformed.input[1].role, "system");
	assert.match(transformed.input[1].content, /^<emotions version="2"/);
	assert.match(transformed.input[1].content, /secondary="custom-feeling"/);
	assert.doesNotMatch(transformed.input[1].content, /free-form causes/);
	assert.match(transformed.input[1].content, /<episode [^>]+\/>/);
	assert.match(transformed.input[1].content, /<tendency name="explore"/);

	const unchanged = app.events.get("turn_start")(
		{
			agentId: AGENT_ID,
			input: [
				transformed.input[0],
				{ ...transformed.input[1], content: '<emotions version="2">stale' },
			],
		},
		ctx,
	);
	assert.equal(unchanged.input.length, 2);
	assert.doesNotMatch(unchanged.input[1].content, /stale/);
	assert.match(unchanged.input[1].content, /revision="1"/);

	assert.match(
		app.tools.get("emotions").run({
			memfs: ctx.memfs,
			args: { action: "inspect" },
		}),
		/requires an active agent identity/,
	);

	const inspected = app.tools.get("emotions").run({
		...ctx,
		args: { action: "inspect" },
	});
	assert.match(inspected, /^Affect:/);
	assert.match(inspected, /Mood:/);
	assert.match(inspected, /Open episodes/);

	const hostile = app.tools.get("emotions").run({
		...ctx,
		args: {
			action: "feel",
			feelings: [
				{
					name: "\u001b]8;;https://example.com\u0007click\u202ereversed",
					intensity: 0.2,
				},
			],
			cause: "Control characters must not reach terminal output.",
		},
	});
	assert.equal(hostile.includes("\u001b"), false);
	assert.equal(hostile.includes("\u0007"), false);
	assert.equal(hostile.includes("\u202e"), false);
	const persistedHostile = await readFile(statePath(ctx), "utf8");
	assert.equal(persistedHostile.includes("\u001b"), false);
	assert.equal(persistedHostile.includes("\u0007"), false);
	assert.equal(persistedHostile.includes("\u202e"), false);
});

test("deduplicates safe automatic failures and resolves recovery", async (t) => {
	const app = createHarness();
	t.after(() => app.dispose());
	const ctx = await temporaryContext(t);
	const llmEnd = app.events.get("llm_end");

	for (let attempt = 0; attempt < 3; attempt += 1) {
		llmEnd(
			{
				agentId: AGENT_ID,
				model: "provider/model-1",
				error: { message: `raw provider secret ${attempt}`, retryable: true },
			},
			ctx,
		);
	}

	let state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	const open = state.episodes.filter(
		(episode) =>
			episode.safeSummary === "Model provider temporarily unavailable" &&
			episode.status === "open",
	);
	assert.equal(open.length, 1);
	assert.equal(open[0].occurrences, 3);
	assert.doesNotMatch(JSON.stringify(state), /raw provider secret/);

	llmEnd({ agentId: AGENT_ID, model: "provider/model-2" }, ctx);
	state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.equal(
		state.episodes.some(
			(episode) =>
				episode.safeSummary === "Model provider temporarily unavailable" &&
				episode.status === "open",
		),
		true,
	);

	llmEnd({ agentId: AGENT_ID, model: "provider/model-1" }, ctx);
	state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.equal(
		state.episodes.some(
			(episode) =>
				episode.safeSummary === "Model provider temporarily unavailable" &&
				episode.status === "open",
		),
		false,
	);
	assert.equal(
		state.episodes.find(
			(episode) =>
				episode.safeSummary === "Model provider temporarily unavailable",
		).resolution,
		"Model communication recovered",
	);
});

test("keeps inspection read-only and backs up malformed state before mutation", async (t) => {
	const app = createHarness();
	t.after(() => app.dispose());
	const ctx = await temporaryContext(t);
	await mkdir(join(ctx.memfs.memoryDir, "state"), { recursive: true });
	await writeFile(statePath(ctx), "{bad json\n");

	const inspected = app.tools
		.get("emotions")
		.run({ ...ctx, args: { action: "inspect" } });
	assert.match(inspected, /^Error: emotional state unavailable/);
	assert.equal(await readFile(statePath(ctx), "utf8"), "{bad json\n");
	assert.equal(
		(await readdir(join(ctx.memfs.memoryDir, "state"))).some((name) =>
			name.startsWith("emotions.corrupt."),
		),
		false,
	);

	app.tools.get("emotions").run({
		...ctx,
		args: {
			action: "feel",
			feelings: [{ name: "relief", intensity: 0.2 }],
			cause: "Recover malformed test state.",
		},
	});

	const files = await readdir(join(ctx.memfs.memoryDir, "state"));
	const backup = files.find((name) => name.startsWith("emotions.corrupt."));
	assert.ok(backup);
	assert.equal(
		await readFile(join(ctx.memfs.memoryDir, "state", backup), "utf8"),
		"{bad json\n",
	);
	assert.equal(JSON.parse(await readFile(statePath(ctx), "utf8")).version, 2);
	assert.equal(app.diagnostics.length, 2);
});

test("serializes concurrent machine-context mutations without state loss", async (t) => {
	const ctx = await temporaryContext(t);
	const barrier = join(ctx.memfs.memoryDir, "go");
	const writers = [
		runWriter(
			ctx,
			"joy",
			"Concurrent alpha appraisal",
			barrier,
			"machine-alpha",
		),
		runWriter(
			ctx,
			"concern",
			"Concurrent beta appraisal",
			barrier,
			"machine-beta",
		),
	];
	await new Promise((resolve) => setTimeout(resolve, 100));
	await writeFile(barrier, "go");
	await Promise.all(writers);

	const state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.equal(Object.keys(state.contexts).length, 2);
	assert.equal(
		state.episodes.filter((episode) =>
			episode.safeSummary.startsWith("Concurrent"),
		).length,
		2,
	);
	assert.equal(state.revision, 2);
	assert.equal(
		(await readdir(join(ctx.memfs.memoryDir, "state"))).includes(
			"emotions.json.lock",
		),
		false,
	);
});

test("reclaims dead locks and rejects unsupported or cross-agent state", async (t) => {
	const app = createHarness();
	t.after(() => app.dispose());
	const ctx = await temporaryContext(t);
	const tool = app.tools.get("emotions");

	tool.run({
		...ctx,
		args: {
			action: "feel",
			feelings: [{ name: "curiosity", intensity: 0.3 }],
			cause: "Create state for lock recovery.",
		},
	});
	const lockPath = `${statePath(ctx)}.lock`;
	await writeFile(
		lockPath,
		JSON.stringify({
			token: "dead",
			pid: 999_999_999,
			host: "test-host",
			createdAt: Date.now() - 60_000,
		}),
	);
	const recovered = tool.run({
		...ctx,
		args: {
			action: "feel",
			feelings: [{ name: "relief", intensity: 0.2 }],
			cause: "Dead lock reclaimed.",
		},
	});
	assert.doesNotMatch(recovered, /^Error:/);
	assert.equal(
		(await readdir(join(ctx.memfs.memoryDir, "state"))).includes(
			"emotions.json.lock",
		),
		false,
	);
	const validState = JSON.parse(await readFile(statePath(ctx), "utf8"));

	const future = `${JSON.stringify({ version: 3, agentId: AGENT_ID })}\n`;
	await writeFile(statePath(ctx), future);
	assert.match(
		tool.run({ ...ctx, args: { action: "inspect" } }),
		/Unsupported emotional state version: 3/,
	);
	assert.match(
		tool.run({
			...ctx,
			args: {
				action: "feel",
				feelings: [{ name: "concern", intensity: 0.2 }],
				cause: "Should not overwrite future state.",
			},
		}),
		/Unsupported emotional state version: 3/,
	);
	assert.equal(await readFile(statePath(ctx), "utf8"), future);

	const invalidState = structuredClone(validState);
	invalidState.mood.dimensions = {};
	const invalid = `${JSON.stringify(invalidState)}\n`;
	await writeFile(statePath(ctx), invalid);
	assert.match(
		tool.run({ ...ctx, args: { action: "inspect" } }),
		/Emotional state v2 is incomplete/,
	);
	assert.equal(await readFile(statePath(ctx), "utf8"), invalid);
	assert.doesNotMatch(
		tool.run({
			...ctx,
			args: {
				action: "feel",
				feelings: [{ name: "relief", intensity: 0.2 }],
				cause: "Recover structurally invalid state.",
			},
		}),
		/^Error:/,
	);
	assert.equal(JSON.parse(await readFile(statePath(ctx), "utf8")).version, 2);
	assert.ok(
		(await readdir(join(ctx.memfs.memoryDir, "state"))).some((name) =>
			name.startsWith("emotions.corrupt."),
		),
	);

	const mismatched = `${JSON.stringify({
		version: 2,
		agentId: "another-agent",
		baseline: {
			valence: 0,
			arousal: 0.2,
			agency: 0,
			warmth: 0.5,
			curiosity: 0.4,
		},
		mood: { dimensions: {}, updatedAt: new Date().toISOString() },
		contexts: {},
		episodes: [],
	})}\n`;
	await writeFile(statePath(ctx), mismatched);
	assert.match(
		tool.run({ ...ctx, args: { action: "inspect" } }),
		/belongs to another-agent/,
	);
	assert.equal(await readFile(statePath(ctx), "utf8"), mismatched);
});

test("advances decay timestamps and supports reappraisal, resolution, and reset", async (t) => {
	const app = createHarness();
	t.after(() => app.dispose());
	const ctx = await temporaryContext(t);
	const tool = app.tools.get("emotions");

	const felt = tool.run({
		...ctx,
		args: {
			action: "feel",
			feelings: [{ name: "hope", intensity: 0.6 }],
			cause: "Exercise episode lifecycle.",
			appraisal: { pleasantness: 0.5, activation: 0.4, control: 0.4 },
		},
	});
	const episodeId = felt.match(/(ep-[a-z0-9-]+)/)?.[1];
	assert.ok(episodeId);
	assert.match(
		tool.run({
			...ctx,
			args: {
				action: "reappraise",
				episodeId,
				interpretation: "The lifecycle behaves coherently.",
				feelings: [{ name: "satisfaction", intensity: 0.4 }],
				resolve: true,
			},
		}),
		/and resolved it/,
	);

	let state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	state.mood.updatedAt = new Date(Date.now() - 10 * 3_600_000).toISOString();
	state.contexts[Object.keys(state.contexts)[0]].updatedAt =
		state.mood.updatedAt;
	await writeFile(statePath(ctx), `${JSON.stringify(state, null, 2)}\n`);

	tool.run({
		...ctx,
		args: { action: "regulate", strategy: "accept", reason: "First pass" },
	});
	state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	const firstValence = state.mood.dimensions.valence;
	const firstTimestamp = state.mood.updatedAt;
	tool.run({
		...ctx,
		args: { action: "regulate", strategy: "accept", reason: "Second pass" },
	});
	state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.ok(Math.abs(state.mood.dimensions.valence - firstValence) < 0.0001);
	assert.ok(Date.parse(state.mood.updatedAt) >= Date.parse(firstTimestamp));

	state.contexts.othermachine = {
		affect: state.baseline,
		feelings: [],
		updatedAt: state.updatedAt,
	};
	await writeFile(statePath(ctx), `${JSON.stringify(state, null, 2)}\n`);
	const reset = app.commands.get("emotion-reset").run({
		...ctx,
		args: "Lifecycle test",
	});
	assert.match(reset.output, /Current-machine affect and shared mood reset/);
	state = JSON.parse(await readFile(statePath(ctx), "utf8"));
	assert.ok(state.contexts.othermachine);
	assert.equal(
		state.episodes.find((episode) => episode.id === episodeId).status,
		"resolved",
	);
});
