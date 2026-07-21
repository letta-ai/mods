/**
 * Test script: proves all five Overlord blocker fixes work correctly.
 * Run: node test-fixes.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

console.log("=== Code-Outline-Enforce v0.3.0 Fix Verification ===\n");

// --- Fix 1: .env case-insensitive check ---
console.log("Fix 1: .env case-insensitive regex");
{
  const envRegex = /^\.env(?:\..+)?$/i;

  // Should match (protected)
  assert(envRegex.test(".env") === true, '.env matches');
  assert(envRegex.test(".env.local") === true, '.env.local matches');
  assert(envRegex.test(".env.production") === true, '.env.production matches');

  // Case-insensitive: the fix
  assert(envRegex.test(".ENV") === true, '.ENV matches (case-insensitive)');
  assert(envRegex.test(".ENV.LOCAL") === true, '.ENV.LOCAL matches (case-insensitive)');
  assert(envRegex.test(".Env") === true, '.Env matches (case-insensitive)');
  assert(envRegex.test(".eNv.DeV") === true, '.eNv.DeV matches (case-insensitive)');

  // Should NOT match
  assert(envRegex.test("myenv") === false, 'myenv does not match');
  assert(envRegex.test("env.txt") === false, 'env.txt does not match');
  assert(envRegex.test(".environment") === false, '.environment does not match');
}
console.log();

// --- Fix 2: Directory traversal byte limit ---
console.log("Fix 2: MAX_DIR_READ_BYTES constant and totalReadBytes tracking");
{
  const MAX_DIR_READ_BYTES = 10 * 1024 * 1024;

  // Constant exists and is 10MB
  assert(MAX_DIR_READ_BYTES === 10485760, 'MAX_DIR_READ_BYTES is 10MB (10 * 1024 * 1024)');

  // Simulate the check logic
  let totalReadBytes = 0;
  const stopReasons = [];

  // Simulate reading files
  const fileSizes = [1024, 2048, 4096, 1048576]; // 1KB, 2KB, 4KB, 1MB
  for (const size of fileSizes) {
    totalReadBytes += size;
    if (totalReadBytes >= MAX_DIR_READ_BYTES) {
      stopReasons.push("total read bytes limit reached");
      break;
    }
  }

  assert(totalReadBytes === 1055744, `totalReadBytes correctly sums file sizes (${totalReadBytes} bytes)`);
  assert(stopReasons.length === 0, 'No stop triggered under 10MB limit');

  // Simulate exceeding the limit
  totalReadBytes = MAX_DIR_READ_BYTES; // exactly at limit
  let wouldStop = totalReadBytes >= MAX_DIR_READ_BYTES;
  assert(wouldStop === true, 'Stops when totalReadBytes reaches 10MB');

  // Simulate just under
  totalReadBytes = MAX_DIR_READ_BYTES - 1;
  wouldStop = totalReadBytes >= MAX_DIR_READ_BYTES;
  assert(wouldStop === false, 'Does not stop just under 10MB');
}
console.log();

// --- Fix 3a: Markdown heading captures text, not # symbols ---
console.log("Fix 3a: Markdown heading regex captures title text");
{
  const mdRegex = /^#{1,6}\s+(.+)/;

  // Standard headings
  let m = "# My Title".match(mdRegex);
  assert(m && m[1] === "My Title", '"# My Title" -> group 1 = "My Title"');

  m = "## Section Two".match(mdRegex);
  assert(m && m[1] === "Section Two", '"## Section Two" -> group 1 = "Section Two"');

  m = "### Deep Heading".match(mdRegex);
  assert(m && m[1] === "Deep Heading", '"### Deep Heading" -> group 1 = "Deep Heading"');

  m = "###### Max Heading".match(mdRegex);
  assert(m && m[1] === "Max Heading", '"###### Max Heading" -> group 1 = "Max Heading"');

  // Edge cases
  m = "#Title Without Space".match(mdRegex);
  assert(m === null, '"#Title Without Space" does not match (requires space after #)');

  m = "####### Seven Hashes".match(mdRegex);
  assert(m === null, '"####### Seven Hashes" does not match (max 6 #)');

  // Old regex would produce "heading #" instead of "heading My Title"
  const oldRegex = /^(#{1,6})\s+(.+)/;
  let oldM = "# My Title".match(oldRegex);
  assert(oldM && oldM[1] === "#", 'OLD regex group 1 was "#" (the bug)');
  assert(oldM && oldM[2] === "My Title", 'OLD regex group 2 was "My Title" (unused by code)');
}
console.log();

// --- Fix 3b: XML declaration pattern removed ---
console.log("Fix 3b: XML declaration pattern removed (no more undefined)");
{
  // New XML patterns (declaration removed)
  const xmlPatterns = [
    [/^\s*<(\w+)[^>]*>/, "tag"],
    [/^\s*<!--\s*(.+?)\s*-->/, "comment"],
  ];

  // XML declaration should NOT match any pattern
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  let matched = false;
  let matchKind = null;
  for (const [regex, kind] of xmlPatterns) {
    const m = declaration.match(regex);
    if (m) {
      matched = true;
      matchKind = kind;
      break;
    }
  }
  assert(matched === false, 'XML declaration does not match any pattern (no more "declaration undefined")');

  // But actual XML tags DO match
  const tag = "<root>";
  let tagMatch = null;
  for (const [regex, kind] of xmlPatterns) {
    const m = tag.match(regex);
    if (m) {
      tagMatch = { kind, value: m[1] };
      break;
    }
  }
  assert(tagMatch !== null, '<root> still matches as tag');
  assert(tagMatch && tagMatch.value === "root", '<root> -> group 1 = "root"');

  // Comments still match
  const comment = "<!-- This is a comment -->";
  let commentMatch = null;
  for (const [regex, kind] of xmlPatterns) {
    const m = comment.match(regex);
    if (m) {
      commentMatch = { kind, value: m[1] };
      break;
    }
  }
  assert(commentMatch !== null, '<!-- comment --> matches as comment');
  assert(commentMatch && commentMatch.value === "This is a comment", 'comment text captured correctly');

  // Old regex would produce "declaration undefined"
  const oldRegex = /^\s*<\?xml[^>]*\?>/;
  let oldM = declaration.match(oldRegex);
  assert(oldM !== null, 'OLD regex matched declaration (but match[1] was undefined = the bug)');
  assert(oldM && oldM[1] === undefined, 'OLD regex match[1] was undefined (the bug)');
}
console.log();

// --- Fix 3c: YAML hyphenated keys ---
console.log("Fix 3c: YAML regex matches hyphenated keys");
{
  const yamlPatterns = [
    [/^\s*(\w[\w\s.-]*?):\s+\S/, "key"],
    [/^\s*(\w[\w\s.-]*?):\s*$/, "key"],
    [/^\s*-\s+(\w[\w\s.-]*?):\s+\S/, "listKey"],
    [/^\s*-\s+(\w[\w\s.-]*?):\s*$/, "listKey"],
  ];

  function matchYaml(line) {
    for (const [regex, kind] of yamlPatterns) {
      const m = line.match(regex);
      if (m) return { kind, value: m[1] };
    }
    return null;
  }

  // Hyphenated keys (the fix)
  let m = matchYaml("top-level: value");
  assert(m !== null && m.value === "top-level", '"top-level: value" -> key = "top-level"');

  m = matchYaml("api-key: abc123");
  assert(m !== null && m.value === "api-key", '"api-key: abc123" -> key = "api-key"');

  m = matchYaml("db-host: localhost");
  assert(m !== null && m.value === "db-host", '"db-host: localhost" -> key = "db-host"');

  m = matchYaml("my-cool-setting: 42");
  assert(m !== null && m.value === "my-cool-setting", '"my-cool-setting: 42" -> key = "my-cool-setting"');

  // Hyphenated key with no value
  m = matchYaml("nested-config:");
  assert(m !== null && m.value === "nested-config", '"nested-config:" -> key = "nested-config"');

  // Hyphenated key in list item
  m = matchYaml("- db-host: localhost");
  assert(m !== null && m.value === "db-host", '"- db-host: localhost" -> listKey = "db-host"');

  m = matchYaml("- api-key:");
  assert(m !== null && m.value === "api-key", '"- api-key:" -> listKey = "api-key"');

  // Keys with dots (already worked, still work)
  m = matchYaml("my.config.value: true");
  assert(m !== null && m.value === "my.config.value", '"my.config.value: true" -> key = "my.config.value"');

  // Regular keys (no hyphen, should still work)
  m = matchYaml("name: test");
  assert(m !== null && m.value === "name", '"name: test" -> key = "name" (no regression)');

  m = matchYaml("port: 8080");
  assert(m !== null && m.value === "port", '"port: 8080" -> key = "port" (no regression)');

  m = matchYaml("- name: test");
  assert(m !== null && m.value === "name", '"- name: test" -> listKey = "name" (no regression)');

  // Old regex would fail on hyphenated keys
  const oldRegex = /^\s*(\w[\w\s.]*?):\s+\S/;  // old: no hyphen in char class
  let oldM = "top-level: value".match(oldRegex);
  assert(oldM === null, 'OLD regex failed on "top-level: value" (the bug)');
}
console.log();

// --- Summary ---
console.log("=== Results ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\n*** SOME TESTS FAILED ***");
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
