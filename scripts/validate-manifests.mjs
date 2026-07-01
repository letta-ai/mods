import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(repoRoot, "packages");

const knownCapabilities = new Set([
  "tools",
  "commands",
  "providers",
  "permissions",
  "events.lifecycle",
  "events.turns",
  "events.tools",
  "events.llm",
  "events.compact",
  "ui.panels",
]);
const modExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

const errors = [];

function addError(packageName, message) {
  errors.push(`${packageName}: ${message}`);
}

function isSafeRelativeModPath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.includes("\0")) return false;
  if (value.includes("\\")) return false;
  if (path.posix.isAbsolute(value) || path.isAbsolute(value)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value) || path.win32.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized === "") return false;
  if (normalized === ".." || normalized.startsWith("../")) return false;
  if (normalized.split("/").includes("..")) return false;
  return modExtensions.has(path.posix.extname(normalized));
}

function hasFrontmatterValue(markdown, key) {
  if (!markdown.startsWith("---\n")) return false;
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return false;
  const frontmatter = markdown.slice(4, end);
  return new RegExp(`^${key}:\\s*\\S`, "m").test(frontmatter);
}

function validatePackage(packageDir) {
  const packageName = path.basename(packageDir);
  const packageJsonPath = path.join(packageDir, "package.json");
  const readmePath = path.join(packageDir, "README.md");
  const modDocPath = path.join(packageDir, "MOD.md");

  if (!existsSync(packageJsonPath)) {
    addError(packageName, "missing package.json");
    return;
  }
  if (!existsSync(readmePath)) {
    addError(packageName, "missing README.md");
  }
  if (!existsSync(modDocPath)) {
    addError(packageName, "missing MOD.md");
  } else {
    const modDoc = readFileSync(modDocPath, "utf8");
    if (!hasFrontmatterValue(modDoc, "name")) {
      addError(packageName, "MOD.md frontmatter must include name");
    }
    if (!hasFrontmatterValue(modDoc, "description")) {
      addError(packageName, "MOD.md frontmatter must include description");
    }
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    addError(packageName, `invalid package.json: ${error.message}`);
    return;
  }

  const manifest = packageJson.letta;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    addError(packageName, "package.json#letta must be an object");
    return;
  }
  if (manifest.manifestVersion !== 1) {
    addError(packageName, "letta.manifestVersion must be 1");
  }
  if (!Array.isArray(manifest.mods) || manifest.mods.length === 0) {
    addError(packageName, "letta.mods must be a non-empty array");
  } else {
    for (const modPath of manifest.mods) {
      if (!isSafeRelativeModPath(modPath)) {
        addError(packageName, `unsafe mod path: ${String(modPath)}`);
        continue;
      }
      const absoluteModPath = path.resolve(packageDir, modPath);
      if (!existsSync(absoluteModPath)) {
        addError(packageName, `missing declared mod entry: ${modPath}`);
      }
    }
  }
  if (manifest.capabilities !== undefined) {
    if (!Array.isArray(manifest.capabilities)) {
      addError(packageName, "letta.capabilities must be an array");
    } else {
      for (const capability of manifest.capabilities) {
        if (!knownCapabilities.has(capability)) {
          addError(packageName, `unknown capability: ${String(capability)}`);
        }
      }
    }
  }
}

if (!existsSync(packagesDir)) {
  console.error("Missing packages directory.");
  process.exit(1);
}

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
  validatePackage(path.join(packagesDir, entry.name));
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("All mod package manifests are valid.");
