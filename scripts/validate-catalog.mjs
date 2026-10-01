import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmPackagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const githubRepoPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/;
const githubOwnerPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const sourceKeys = {
  github: new Set(["type", "repo"]),
  npm: new Set(["type", "package"]),
};
const errors = [];

function addError(file, message) {
  errors.push(`${file}: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value, knownKeys) {
  return Object.keys(value).filter((key) => !knownKeys.has(key));
}

function readCatalog(file) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
  } catch (error) {
    addError(file, error.message);
    return null;
  }
}

function validateNpmPackage(value, file, field) {
  if (typeof value !== "string" || !npmPackagePattern.test(value)) {
    addError(file, `${field} must be a valid lowercase npm package name`);
    return null;
  }
  if (value.length > 214) addError(file, `${field} exceeds the npm package name length limit`);
  return value;
}

function validateSource(source, file, field, { npmOnly = false } = {}) {
  if (!isRecord(source)) {
    addError(file, `${field} must be an object`);
    return null;
  }
  if (source.type !== "npm" && source.type !== "github") {
    addError(file, `${field}.type must be npm or github`);
    return null;
  }
  if (npmOnly && source.type !== "npm") {
    addError(file, `${field}.type must be npm`);
  }
  for (const key of unknownKeys(source, sourceKeys[source.type])) {
    addError(file, `${field} has unknown key: ${key}`);
  }
  if (source.type === "npm") {
    const packageName = validateNpmPackage(source.package, file, `${field}.package`);
    return packageName ? `npm:${packageName}` : null;
  }
  if (typeof source.repo !== "string" || !githubRepoPattern.test(source.repo)) {
    addError(file, `${field}.repo must use the owner/repository format`);
    return null;
  }
  if (source.repo.endsWith(".git")) addError(file, `${field}.repo must not include a .git suffix`);
  return `github:${source.repo.toLowerCase()}`;
}

function validateSourceCatalog(file, { npmOnly = false, sorted = false } = {}) {
  const catalog = readCatalog(file);
  const result = new Set();
  if (!catalog) return result;
  if (!isRecord(catalog)) {
    addError(file, "must contain a JSON object");
    return result;
  }
  for (const key of unknownKeys(catalog, new Set(["schemaVersion", "sources"]))) {
    addError(file, `unknown top-level key: ${key}`);
  }
  if (catalog.schemaVersion !== 1) addError(file, "schemaVersion must be 1");
  if (!Array.isArray(catalog.sources)) {
    addError(file, "sources must be an array");
    return result;
  }

  const orderedKeys = [];
  for (const [index, source] of catalog.sources.entries()) {
    const sourceKey = validateSource(source, file, `sources[${index}]`, { npmOnly });
    if (!sourceKey) continue;
    if (result.has(sourceKey)) addError(file, `duplicate source: ${sourceKey}`);
    result.add(sourceKey);
    orderedKeys.push(sourceKey);
  }
  if (sorted && orderedKeys.join("\n") !== [...orderedKeys].sort().join("\n")) {
    addError(file, "sources must be sorted by source identity");
  }
  return result;
}

function validateRetiredCatalog() {
  const file = "catalog/retired.json";
  const catalog = readCatalog(file);
  const result = new Set();
  if (!catalog) return result;
  if (!isRecord(catalog)) {
    addError(file, "must contain a JSON object");
    return result;
  }
  for (const key of unknownKeys(catalog, new Set(["schemaVersion", "packages"]))) {
    addError(file, `unknown top-level key: ${key}`);
  }
  if (catalog.schemaVersion !== 1) addError(file, "schemaVersion must be 1");
  if (!Array.isArray(catalog.packages)) {
    addError(file, "packages must be an array");
    return result;
  }

  const orderedPackages = [];
  const entryKeys = new Set(["package", "owner", "pullRequest", "replacement"]);
  for (const [index, entry] of catalog.packages.entries()) {
    const field = `packages[${index}]`;
    if (!isRecord(entry)) {
      addError(file, `${field} must be an object`);
      continue;
    }
    for (const key of unknownKeys(entry, entryKeys)) {
      addError(file, `${field} has unknown key: ${key}`);
    }
    const packageName = validateNpmPackage(entry.package, file, `${field}.package`);
    if (packageName) {
      if (result.has(packageName)) addError(file, `duplicate package: ${packageName}`);
      result.add(packageName);
      orderedPackages.push(packageName);
    }
    if (typeof entry.owner !== "string" || !githubOwnerPattern.test(entry.owner)) {
      addError(file, `${field}.owner must be a GitHub login`);
    }
    if (!Number.isSafeInteger(entry.pullRequest) || entry.pullRequest <= 0) {
      addError(file, `${field}.pullRequest must be a positive integer`);
    }
    if (entry.replacement !== undefined) {
      const replacementKey = validateSource(entry.replacement, file, `${field}.replacement`);
      if (packageName && replacementKey === `npm:${packageName}`) {
        addError(file, `${field}.replacement must differ from the retired package`);
      }
    }
  }
  if (orderedPackages.join("\n") !== [...orderedPackages].sort().join("\n")) {
    addError(file, "packages must be sorted by package name");
  }
  return result;
}

function readRepositoryPackages() {
  const packagesDir = path.join(repoRoot, "packages");
  const packageNames = new Set();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof packageJson.name === "string") packageNames.add(packageJson.name);
    } catch {
      // validate-manifests.mjs reports malformed package manifests.
    }
  }
  return packageNames;
}

const featuredSources = validateSourceCatalog("catalog/featured.json");
const officialSources = validateSourceCatalog("catalog/official.json", {
  npmOnly: true,
  sorted: true,
});
const retiredPackages = validateRetiredCatalog();
const repositoryPackages = readRepositoryPackages();
const officialPackages = new Set(
  [...officialSources].filter((source) => source.startsWith("npm:")).map((source) => source.slice(4)),
);

for (const packageName of officialPackages) {
  if (!packageName.startsWith("@letta-ai/")) {
    addError("catalog/official.json", `official package must use the @letta-ai scope: ${packageName}`);
  }
  if (!repositoryPackages.has(packageName)) {
    addError("catalog/official.json", `official package is missing from packages/: ${packageName}`);
  }
  if (retiredPackages.has(packageName)) {
    addError("catalog/retired.json", `package cannot be both official and retired: ${packageName}`);
  }
}
for (const packageName of repositoryPackages) {
  if (!officialPackages.has(packageName)) {
    addError("catalog/official.json", `repository package is not on the official allowlist: ${packageName}`);
  }
}
for (const source of featuredSources) {
  if (source.startsWith("npm:") && retiredPackages.has(source.slice(4))) {
    addError("catalog/featured.json", `featured package is retired: ${source.slice(4)}`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Catalog is valid (${officialSources.size} official, ${featuredSources.size} featured, ${retiredPackages.size} retired).`,
);
