import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const errors = [];

function error(message) {
  errors.push(message);
}

function hasFrontmatterValue(markdown, key) {
  if (!markdown.startsWith("---\n")) return false;
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return false;
  const frontmatter = markdown.slice(4, end);
  return new RegExp(`^${key}:\\s*\\S`, "m").test(frontmatter);
}

const packageJsonPath = path.join(root, "package.json");
const readmePath = path.join(root, "README.md");
const modDocPath = path.join(root, "MOD.md");

if (!existsSync(packageJsonPath)) error("missing package.json");
if (!existsSync(readmePath)) error("missing README.md");
if (!existsSync(modDocPath)) error("missing MOD.md");

let packageJson = null;
if (existsSync(packageJsonPath)) {
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (e) {
    error(`invalid package.json: ${e.message}`);
  }
}

if (existsSync(modDocPath)) {
  const modDoc = readFileSync(modDocPath, "utf8");
  if (!hasFrontmatterValue(modDoc, "name")) error("MOD.md frontmatter must include name");
  if (!hasFrontmatterValue(modDoc, "description")) error("MOD.md frontmatter must include description");
}

if (packageJson) {
  const manifest = packageJson.letta;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    error("package.json#letta must be an object");
  } else {
    if (manifest.manifestVersion !== 1) error("letta.manifestVersion must be 1");
    if (!Array.isArray(manifest.mods) || manifest.mods.length === 0) {
      error("letta.mods must be a non-empty array");
    } else {
      for (const rel of manifest.mods) {
        if (typeof rel !== "string" || !rel.startsWith("./") || rel.includes("..")) {
          error(`unsafe mod path: ${String(rel)}`);
          continue;
        }
        const modPath = path.resolve(root, rel);
        if (!existsSync(modPath)) {
          error(`missing declared mod entry: ${rel}`);
          continue;
        }

        // The source is .ts for Letta package convention but intentionally uses plain JS syntax.
        // Copy to .mjs so node --check can parse it without a TypeScript loader.
        const dir = mkdtempSync(path.join(tmpdir(), "cruise-ux-"));
        const temp = path.join(dir, "mod.mjs");
        writeFileSync(temp, readFileSync(modPath, "utf8"));
        const result = spawnSync(process.execPath, ["--check", temp], { encoding: "utf8" });
        rmSync(dir, { recursive: true, force: true });
        if (result.status !== 0) {
          error(`mod source failed syntax check: ${result.stderr || result.stdout}`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}

console.log("cruise-ux package check passed.");
