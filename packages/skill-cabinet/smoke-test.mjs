import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import activate, { scanCatalog } from "./mods/index.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeSkill(root, id, frontmatter, body = "Instructions live here.") {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
}

async function main() {
  const temp = await mkdtemp(path.join(tmpdir(), "skill-cabinet-test-"));
  const previous = {
    HOME: process.env.HOME,
    LETTA_BUNDLED_SKILLS_DIR: process.env.LETTA_BUNDLED_SKILLS_DIR,
    SKILL_CABINET_DATA_DIR: process.env.SKILL_CABINET_DATA_DIR,
    SKILL_CABINET_COMMAND: process.env.SKILL_CABINET_COMMAND,
    AGENT_ID: process.env.AGENT_ID,
  };

  try {
    const home = path.join(temp, "home");
    const bundled = path.join(temp, "bundled-skills");
    const project = path.join(temp, "project");
    const agentId = "local-agent-test";
    const global = path.join(home, ".letta", "skills");
    const agent = path.join(home, ".letta", "agents", agentId, "memory", "skills");
    const legacyProject = path.join(project, ".skills");
    const primaryProject = path.join(project, ".agents", "skills");
    const data = path.join(temp, "data");

    process.env.HOME = home;
    process.env.LETTA_BUNDLED_SKILLS_DIR = bundled;
    process.env.SKILL_CABINET_DATA_DIR = data;
    delete process.env.SKILL_CABINET_COMMAND;
    delete process.env.AGENT_ID;

    await writeSkill(bundled, "weather", "name: Weather\ndescription: Check live weather forecasts.\ncategory: world");
    await writeSkill(bundled, "image-generation", "name: Image Generation\ndescription: Generate images from prompts.");
    await writeSkill(bundled, "overlap", "name: Bundled Overlap\ndescription: Bundled duplicate.");
    await writeSkill(global, "voice-helper", "name: Voice Helper\ndescription: Speak text aloud.\ncategory: voice");
    await writeSkill(agent, "hidden-helper", "name: Hidden Helper\ndescription: Direct invocation only.\ndisable-model-invocation: true");
    await writeSkill(agent, "agent-memory", "name: Agent Memory\ndescription: Search durable memories.\ntags: [memory, recall]");
    await writeSkill(legacyProject, "project-notes", "name: Project Notes\ndescription: Read project documentation.\ncategory: project-knowledge");
    await writeSkill(primaryProject, "overlap", "name: Project Overlap\ndescription: Selected project duplicate.\ncategory: engineering");

    const registered = { tools: [], commands: [], events: [] };
    let disposed = 0;
    const letta = {
      capabilities: { tools: true, commands: true, events: { tools: true } },
      tools: { register(definition) { registered.tools.push(definition); return () => { disposed += 1; }; } },
      commands: { register(definition) { registered.commands.push(definition); return () => { disposed += 1; }; } },
      events: { on(name, handler) { registered.events.push({ name, handler }); return () => { disposed += 1; }; } },
    };

    const dispose = activate(letta);
    const tool = registered.tools.find((entry) => entry.name === "skill_catalog");
    const command = registered.commands.find((entry) => entry.id === "skills");
    const observer = registered.events.find((entry) => entry.name === "tool_end");
    assert(tool, "skill_catalog tool registered");
    assert(tool.requiresApproval === false, "read-only tool does not require approval");
    assert(tool.parallelSafe === true, "read-only tool is parallel safe");
    assert(command, "/skills command registered");
    assert(observer, "Skill tool observer registered");

    const ctx = {
      args: {},
      cwd: project,
      agent: { id: agentId, name: "Test Agent" },
      conversation: { id: "conv-test" },
    };

    const catalog = await scanCatalog(ctx);
    assert(catalog.installedCount === 7, "all unique fixture skill ids discovered");
    assert(catalog.visibleCount === 5, "disabled and local-excluded skills hidden");
    assert(catalog.duplicates.length === 1, "duplicate skill id audited");
    const overlap = catalog.skills.find((skill) => skill.id === "overlap");
    assert(overlap.name === "Project Overlap", "higher-precedence project skill selected");
    assert(overlap.source === "project", "selected duplicate keeps source provenance");
    const customCategory = catalog.skills.find((skill) => skill.id === "project-notes");
    assert(customCategory.category === "project-knowledge", "custom frontmatter category preserved");
    assert(catalog.skills.find((skill) => skill.id === "agent-memory").category === "memory", "missing category inferred conservatively");
    assert(catalog.skills.find((skill) => skill.id === "hidden-helper").category === "uncategorized", "generic skill wording does not force engineering category");

    let result = await tool.run({ ...ctx, args: { action: "summary" } });
    assert(result.installed === 7 && result.model_visible === 5, "tool summary returns live counts");
    assert(result.by_source.project === 2, "tool summary includes source counts");

    result = await tool.run({ ...ctx, args: { action: "search", query: "duplicate" } });
    assert(result.count === 1 && result.skills[0].id === "overlap", "tool searches selected descriptions");
    assert(!("path" in result.skills[0]), "ordinary tool results omit local paths");

    result = await tool.run({ ...ctx, args: { action: "category", query: "project knowledge" } });
    assert(result.count === 1 && result.skills[0].id === "project-notes", "tool filters custom categories");

    result = await tool.run({ ...ctx, args: { action: "source", query: "agent-owned" } });
    assert(result.count === 1 && result.skills[0].id === "agent-memory", "source aliases work and hidden skills remain excluded");

    let output = await command.run({ ...ctx, args: "" });
    assert(output.type === "output" && output.output.includes("Skill Cabinet"), "summary command returns output");
    assert(output.output.includes("5 model-visible / 7 installed"), "summary command reports counts");

    output = await command.run({ ...ctx, args: "forgotten 8" });
    assert(output.output.includes("observation window"), "dust check states provenance caveat");

    await observer.handler({ toolName: "functions.Skill", args: { skill: "overlap" }, status: "success" }, ctx);
    result = await tool.run({ ...ctx, args: { action: "search", query: "overlap" } });
    assert(result.skills[0].last_used_at, "observer records completed Skill use");
    const state = JSON.parse(await readFile(path.join(data, agentId, "state.json"), "utf8"));
    assert(state.usage.overlap.successful_uses === 1, "successful use count persisted");

    output = await command.run({ ...ctx, args: "audit" });
    assert(output.output.includes("Markdown snapshot"), "audit reports snapshot paths");
    assert(existsSync(path.join(data, agentId, "catalog.md")), "audit writes local Markdown snapshot");
    assert(existsSync(path.join(data, agentId, "catalog.json")), "audit writes local JSON snapshot");
    assert(!existsSync(path.join(home, ".letta", "agents", agentId, "memory", "reference", "skills-index.md")), "audit does not mutate agent memory");

    const markdown = await readFile(path.join(data, agentId, "catalog.md"), "utf8");
    assert(markdown.includes("Never observed"), "snapshot includes provenance language");
    assert(markdown.includes("Project Overlap"), "snapshot contains selected catalog");

    output = await command.run({ ...ctx, agent: {}, args: "" });
    assert(output.output.includes("missing scoped agent id"), "missing agent scope fails closed for state access");

    dispose();
    assert(disposed === 3, "all registrations disposed");
    console.log("Skill Cabinet smoke tests passed.");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
