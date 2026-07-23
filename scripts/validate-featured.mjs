import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const featuredPath = path.join(repoRoot, "catalog", "featured.json");
const npmPackagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const githubRepoPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/;
const knownTopLevelKeys = new Set(["schemaVersion", "sources"]);
const knownSourceKeys = {
  github: new Set(["type", "repo"]),
  npm: new Set(["type", "package"]),
};
const errors = [];

function addError(message) {
  errors.push(`catalog/featured.json: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value, knownKeys) {
  return Object.keys(value).filter((key) => !knownKeys.has(key));
}

function validateNpmSource(source, index) {
  if (typeof source.package !== "string" || !npmPackagePattern.test(source.package)) {
    addError(`sources[${index}].package must be a valid lowercase npm package name`);
    return null;
  }
  if (source.package.length > 214) {
    addError(`sources[${index}].package exceeds the npm package name length limit`);
  }
  return `npm:${source.package}`;
}

function validateGitHubSource(source, index) {
  if (typeof source.repo !== "string" || !githubRepoPattern.test(source.repo)) {
    addError(`sources[${index}].repo must use the owner/repository format`);
    return null;
  }
  if (source.repo.endsWith(".git")) {
    addError(`sources[${index}].repo must not include a .git suffix`);
  }
  return `github:${source.repo.toLowerCase()}`;
}

let catalog;
try {
  catalog = JSON.parse(readFileSync(featuredPath, "utf8"));
} catch (error) {
  console.error(`- catalog/featured.json: ${error.message}`);
  process.exit(1);
}

if (!isRecord(catalog)) {
  addError("must contain a JSON object");
} else {
  for (const key of unknownKeys(catalog, knownTopLevelKeys)) {
    addError(`unknown top-level key: ${key}`);
  }

  if (catalog.schemaVersion !== 1) {
    addError("schemaVersion must be 1");
  }

  if (!Array.isArray(catalog.sources)) {
    addError("sources must be an array");
  } else {
    const seenSources = new Set();
    for (const [index, source] of catalog.sources.entries()) {
      if (!isRecord(source)) {
        addError(`sources[${index}] must be an object`);
        continue;
      }
      if (source.type !== "npm" && source.type !== "github") {
        addError(`sources[${index}].type must be npm or github`);
        continue;
      }
      for (const key of unknownKeys(source, knownSourceKeys[source.type])) {
        addError(`sources[${index}] has unknown key: ${key}`);
      }

      const sourceKey =
        source.type === "npm"
          ? validateNpmSource(source, index)
          : validateGitHubSource(source, index);
      if (!sourceKey) continue;
      if (seenSources.has(sourceKey)) addError(`duplicate source: ${sourceKey}`);
      seenSources.add(sourceKey);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Featured catalog is valid (${catalog.sources.length} sources).`);
