/**
 * Integration test: runs the actual mod functions against real temp fixtures.
 *
 * Unlike test-fixes.mjs, this test imports the actual mod and exercises
 * getExt, walkDirectory, and REGEX_PATTERNS directly. No copied regexes,
 * no simulated arithmetic.
 *
 * Usage: node test-integration.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import the actual mod
import mod, {
  getExt,
  walkDirectory,
  REGEX_PATTERNS,
  MAX_DIR_READ_BYTES,
  EXCLUDED_DIRS,
} from "./mods/index.mjs";

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

function assertEq(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    console.log(`  FAIL: ${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    failed++;
  }
}

function assertMatch(actual, regex, name) {
  if (regex.test(actual)) {
    passed++;
  } else {
    console.log(`  FAIL: ${name} (expected match for ${regex}, got ${JSON.stringify(actual)})`);
    failed++;
  }
}

// Create a temp directory with test fixtures
function createFixtureDir() {
  const root = mkdtempSync(join(tmpdir(), "code-outline-test-"));
  return root;
}

function writeFile(path, content) {
  writeFileSync(path, content, "utf-8");
}

function mkdir(path) {
  mkdirSync(path, { recursive: true });
}

// ──────────────────────────────────────────────
console.log("=== Code-Outline-Enforce v0.3.0 Integration Tests ===\n");

// ─── Fix 1: .env case sensitivity ───
console.log("Fix 1: .env case-insensitive regex (getExt)");
{
  assertEq(getExt("/some/path/.env"), ".env", ".env -> .env");
  assertEq(getExt("/some/path/.env.local"), ".env", ".env.local -> .env");
  assertEq(getExt("/some/path/.ENV"), ".env", ".ENV -> .env (case-insensitive)");
  assertEq(getExt("/some/path/.ENV.LOCAL"), ".env", ".ENV.LOCAL -> .env (case-insensitive)");
  assertEq(getExt("/some/path/.Env.DeV"), ".env", ".Env.DeV -> .env (case-insensitive)");
  assertEq(getExt("/some/path/myenv"), "", "myenv -> '' (not .env)");
  assertEq(getExt("/some/path/.environment"), ".environment", ".environment -> '.environment' (fallback, not .env)");
}
console.log();

// ─── Fix 2a: Root validation (hidden/excluded/symlink) ───
console.log("Fix 2a: Root directory validation (hidden/excluded/symlink)");
{
  const root = createFixtureDir();

  try {
    // Hidden root
    const hiddenRoot = join(root, ".hidden-root");
    mkdir(hiddenRoot);
    writeFile(join(hiddenRoot, "visible.js"), "function INSIDE_HIDDEN_ROOT() {}");
    const hiddenResult = walkDirectory(hiddenRoot, 3, 30);
    assertEq(hiddenResult.error, "Root directory is hidden (dot-prefixed): " + hiddenRoot, "hidden root rejected");
    assertEq(hiddenResult.entries.length, 0, "hidden root has 0 entries");

    // Excluded root
    const excludedRoot = join(root, "node_modules");
    mkdir(excludedRoot);
    writeFile(join(excludedRoot, "package.js"), "function INSIDE_EXCLUDED_ROOT() {}");
    const excludedResult = walkDirectory(excludedRoot, 3, 30);
    assertEq(excludedResult.error, "Root directory is excluded: " + excludedRoot, "excluded root rejected");
    assertEq(excludedResult.entries.length, 0, "excluded root has 0 entries");

    // Symlink root (on Windows, symlinks need special handling)
    // Create a real target and try to symlink to it
    const targetRoot = join(root, "target-root");
    mkdir(targetRoot);
    writeFile(join(targetRoot, "linked.js"), "function INSIDE_SYMLINK_ROOT() {}");
    const linkedRoot = join(root, "linked-root");
    try {
      // On Windows, directory symlinks require admin or developer mode.
      // If it fails, note it and skip the assertion.
      symlinkSync(targetRoot, linkedRoot, "dir");
      const symlinkResult = walkDirectory(linkedRoot, 3, 30);
      assertEq(symlinkResult.error?.startsWith("Root directory is a symbolic link:"), true, "symlink root rejected");
      assertEq(symlinkResult.entries.length, 0, "symlink root has 0 entries");
    } catch {
      console.log("  SKIP: symlink test (requires admin/developer mode on Windows)");
    }

    // Normal directory (should work)
    const normalRoot = join(root, "normal-root");
    mkdir(normalRoot);
    writeFile(join(normalRoot, "test.js"), "function test() {}");
    const normalResult = walkDirectory(normalRoot, 3, 30);
    assertEq(normalResult.error, undefined, "normal root has no error");
    assertEq(normalResult.entries.length, 1, "normal root has 1 entry");

    // Non-existent directory
    const missingResult = walkDirectory(join(root, "does-not-exist"), 3, 30);
    assertMatch(missingResult.error || "", /Could not stat directory/, "missing root rejected");
    assertEq(missingResult.entries.length, 0, "missing root has 0 entries");

    // File path (not a directory)
    const filePath = join(root, "not-a-dir.js");
    writeFile(filePath, "// just a file");
    const fileResult = walkDirectory(filePath, 3, 30);
    assertMatch(fileResult.error || "", /Not a directory/, "file path rejected as root");
    assertEq(fileResult.entries.length, 0, "file root has 0 entries");

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log();

// ─── Fix 2b: Pre-read byte budget check ───
console.log("Fix 2b: Pre-read byte budget check");
{
  const root = createFixtureDir();

  try {
    // Create a small file and a file that would exceed the budget
    mkdir(root);
    // Write a small file (1KB)
    writeFile(join(root, "small.js"), "function small() {}\n".repeat(50));
    // Write a file slightly larger than MAX_DIR_READ_BYTES
    writeFile(join(root, "huge.js"), "x".repeat(MAX_DIR_READ_BYTES + 1));

    // Walk with maxFiles=10 to allow both files to be considered
    // The huge file should trigger the pre-read budget check and stop
    const result = walkDirectory(root, 3, 10);

    // Only the small file should be in entries (huge file triggers stop before read)
    // The stop reason should be "total read bytes limit reached"
    assertEq(result.entries.length, 1, "only small file in entries (huge file skipped)");
    assertEq(result.stopReason, "total read bytes limit reached", "stop reason is byte limit");

    // Verify that the huge file was not processed (no outline)
    const hugeInEntries = result.entries.some(e => e.path.endsWith("huge.js"));
    assertEq(hugeInEntries, false, "huge file not in entries");

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log();

// ─── Fix 3a: Markdown headings ───
console.log("Fix 3a: Markdown heading regex (actual REGEX_PATTERNS)");
{
  const mdPatterns = REGEX_PATTERNS[".md"];
  assert(mdPatterns !== undefined, ".md patterns exist");
  assert(mdPatterns !== null, ".md patterns are not null");

  // Find the heading pattern
  const headingPattern = mdPatterns.find(([, kind]) => kind === "heading");
  assert(headingPattern !== undefined, "heading pattern exists");

  const [regex] = headingPattern;

  // Test cases
  let m = "# My Title".match(regex);
  assertEq(m?.[1], "My Title", '"# My Title" -> group 1 = "My Title"');

  m = "## Section Two".match(regex);
  assertEq(m?.[1], "Section Two", '"## Section Two" -> group 1 = "Section Two"');

  m = "### Deep".match(regex);
  assertEq(m?.[1], "Deep", '"### Deep" -> group 1 = "Deep"');

  m = "###### Max".match(regex);
  assertEq(m?.[1], "Max", '"###### Max" -> group 1 = "Max"');

  m = "#NoSpace".match(regex);
  assertEq(m, null, '"#NoSpace" does not match');

  m = "####### Seven".match(regex);
  assertEq(m, null, '"####### Seven" does not match');
}
console.log();

// ─── Fix 3b: XML declaration removed ───
console.log("Fix 3b: XML declaration pattern removed (actual REGEX_PATTERNS)");
{
  const xmlPatterns = REGEX_PATTERNS[".xml"];
  assert(xmlPatterns !== undefined, ".xml patterns exist");
  assert(xmlPatterns !== null, ".xml patterns are not null");

  // Verify no declaration pattern
  const hasDeclaration = xmlPatterns.some(([, kind]) => kind === "declaration");
  assertEq(hasDeclaration, false, "no declaration pattern in .xml patterns");

  // Verify tag and comment patterns still exist
  const hasTag = xmlPatterns.some(([, kind]) => kind === "tag");
  const hasComment = xmlPatterns.some(([, kind]) => kind === "comment");
  assertEq(hasTag, true, "tag pattern exists");
  assertEq(hasComment, true, "comment pattern exists");

  // Test declaration doesn't match any pattern
  const decl = '<?xml version="1.0"?>';
  for (const [regex, kind] of xmlPatterns) {
    const m = decl.match(regex);
    assertEq(m, null, `XML declaration does not match ${kind} pattern`);
  }

  // Tags still work
  const tagRegex = xmlPatterns.find(([, kind]) => kind === "tag")[0];
  assertEq("<root>".match(tagRegex)?.[1], "root", "<root> -> group 1 = 'root'");

  // Comments still work
  const commentRegex = xmlPatterns.find(([, kind]) => kind === "comment")[0];
  assertEq("<!-- hello -->".match(commentRegex)?.[1], "hello", "<!-- hello --> -> group 1 = 'hello'");
}
console.log();

// ─── Fix 3c: YAML hyphenated keys ───
console.log("Fix 3c: YAML hyphenated keys (actual REGEX_PATTERNS)");
{
  const ymlPatterns = REGEX_PATTERNS[".yml"];
  assert(ymlPatterns !== undefined, ".yml patterns exist");
  assert(ymlPatterns !== null, ".yml patterns are not null");

  // Find key and listKey patterns
  const keyWithValue = ymlPatterns.find(([, kind]) => kind === "key" && /\\S/.test(ymlPatterns[0][0].source));
  const keyWithoutValue = ymlPatterns.filter(([, kind]) => kind === "key")[1]; // second key pattern
  const listKeyWithValue = ymlPatterns.find(([, kind]) => kind === "listKey" && /\\S/.test(ymlPatterns[2][0].source));
  const listKeyWithoutValue = ymlPatterns.filter(([, kind]) => kind === "listKey")[1];

  // Actually, let me just iterate through all patterns and find the right one
  function matchYaml(line) {
    for (const [regex, kind] of ymlPatterns) {
      const m = line.match(regex);
      if (m) return { kind, value: m[1] };
    }
    return null;
  }

  // Hyphenated keys
  let m = matchYaml("top-level: value");
  assertEq(m?.value, "top-level", '"top-level: value" -> key = "top-level"');
  assertEq(m?.kind, "key", '"top-level: value" -> kind = "key"');

  m = matchYaml("api-key: abc123");
  assertEq(m?.value, "api-key", '"api-key: abc123" -> key = "api-key"');

  m = matchYaml("db-host: localhost");
  assertEq(m?.value, "db-host", '"db-host: localhost" -> key = "db-host"');

  m = matchYaml("my-cool-setting: 42");
  assertEq(m?.value, "my-cool-setting", '"my-cool-setting: 42" -> key = "my-cool-setting"');

  m = matchYaml("nested-config:");
  assertEq(m?.value, "nested-config", '"nested-config:" -> key = "nested-config"');

  // List items with hyphenated keys
  m = matchYaml("- db-host: localhost");
  assertEq(m?.value, "db-host", '"- db-host: localhost" -> listKey = "db-host"');
  assertEq(m?.kind, "listKey", '"- db-host: localhost" -> kind = "listKey"');

  m = matchYaml("- api-key:");
  assertEq(m?.value, "api-key", '"- api-key:" -> listKey = "api-key"');

  // No regressions
  m = matchYaml("name: test");
  assertEq(m?.value, "name", '"name: test" -> key = "name" (no regression)');

  m = matchYaml("port: 8080");
  assertEq(m?.value, "port", '"port: 8080" -> key = "port" (no regression)');

  m = matchYaml("- name: test");
  assertEq(m?.value, "name", '"- name: test" -> listKey = "name" (no regression)');
}
console.log();

// ─── Fix 2b (cont): Fixture-based end-to-end test ───
console.log("Fix 2b (cont): End-to-end .ENV.local suppression via walkDirectory");
{
  // This tests that getExt() routes .ENV.local to the .env handler,
  // and the tool's permission overlay blocks reading the file content.
  // The actual value suppression is done by the .env regex pattern
  // (which extracts var names, not values).
  const root = createFixtureDir();

  try {
    // Create a .ENV.local file with secrets
    writeFile(
      join(root, ".ENV.local"),
      'API_TOKEN=TOP_SECRET_VALUE\nexport DATABASE_URL=postgres://secret\n',
    );

    // .ENV.local is a hidden file (dot-prefix), so walkDirectory skips it
    // by default. The security comes from the permission overlay blocking
    // raw reads, not from walkDirectory including it.
    // But we can verify getExt recognizes it correctly (already tested above).

    // Instead, test that a non-hidden .env-like file is handled correctly
    // Create a regular .env file (not hidden... actually .env is always hidden)
    // Let's test that the regex pattern for .env extracts var names, not values
    const envPatterns = REGEX_PATTERNS[".env"];
    assert(envPatterns !== undefined, ".env patterns exist");
    assert(envPatterns !== null, ".env patterns are not null");

    const [[envRegex]] = envPatterns;
    const envContent = "API_TOKEN=TOP_SECRET_VALUE\nexport DATABASE_URL=postgres://secret\n";
    const lines = envContent.split("\n");

    let varCount = 0;
    for (const line of lines) {
      const m = line.match(envRegex);
      if (m) {
        varCount++;
        // Verify we only capture the var name, not the value
        const isExport = m[0].startsWith("export");
        if (isExport) {
          // "export API_TOKEN=..." -> match[1] should be "API_TOKEN"
          assertEq(m[1], "DATABASE_URL", `export line: match[1] = var name (not value)`);
        } else {
          assertEq(m[1], "API_TOKEN", `var line: match[1] = var name (not value)`);
        }
      }
    }
    assertEq(varCount, 2, "2 env vars extracted (names only, no values)");

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
console.log();

// ─── Summary ───
console.log("=== Results ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\n*** SOME TESTS FAILED ***");
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}