// Tests for parseFrontmatter extracted from mods/index.ts.
//
// Documents the parser constraints and the behaviors we depend on at the
// OKF bundle surface. If you change parseFrontmatter, update this file
// and keep the steward-schema.md constraints in sync.

import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../mods/lib/frontmatter.ts";

const FM = (s: string | undefined) => ({ fm: s });
const TMP = (s: string | undefined) => ({ tmp: s });

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("parseFrontmatter — happy paths", () => {
  it("extracts fields from a simple frontmatter block", () => {
    const input = `---\ntype: Rule\ntitle: Hello\n---\n# Hello\n\nbody\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter.type).toBe("Rule");
    expect(frontmatter.title).toBe("Hello");
    expect(body).toBe("# Hello\n\nbody\n");
  });

  it("preserves multi-line body verbatim", () => {
    const input = `---\ntype: Rule\n---\nline one\nline two\n\nline three\n`;
    const { body } = parseFrontmatter(input);
    expect(body).toBe("line one\nline two\n\nline three\n");
  });

  it("captures all well-known fields", () => {
    const input = `---
type: Rule
title: My title
description: My description
tags: [a, b, c]
timestamp: 2026-07-06T10:00:00.000Z
trigger: pr-review
trigger-description: fired on PR review activity
ttl: 8
cacheable: true
---
body
`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter).toMatchObject({
      type: "Rule",
      title: "My title",
      description: "My description",
      tags: ["a", "b", "c"],
      timestamp: "2026-07-06T10:00:00.000Z",
      trigger: "pr-review",
      "trigger-description": "fired on PR review activity",
      ttl: 8,
      cacheable: true,
    });
  });

  it("falls back to returning the full input as body when the lazy regex doesn't find a closing fence", () => {
    // `---\n---\nbody content\n` has two `---\n` lines but no lines
    // between them, so the lazy match `[\s\S]*?\r?\n---\r?\n` cannot
    // find anything to put in `[group 1]`. The whole string is then
    // returned as the body, with no frontmatter. This matches the
    // "no opening fence" behavior — it's a stable fallback, not a parser
    // bug.
    const input = `---\n---\nbody content\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — input shape
// ---------------------------------------------------------------------------

describe("parseFrontmatter — edge cases", () => {
  it("returns empty frontmatter and the original content when no opening fence is present", () => {
    const input = `no frontmatter here\njust body\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it("returns empty frontmatter and the original content when opening fence has no closing fence", () => {
    const input = `---\ntype: Rule\nno closing fence\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it("handles empty input string", () => {
    const { frontmatter, body } = parseFrontmatter("");
    expect(frontmatter).toEqual({});
    expect(body).toBe("");
  });

  it("tolerates CRLF line endings (Windows-checked-out files)", () => {
    const input = "---\r\ntype: Rule\r\ntitle: CRLF Title\r\n---\r\nbody\r\n";
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter.type).toBe("Rule");
    expect(frontmatter.title).toBe("CRLF Title");
    expect(body).toBe("body\r\n");
  });

  it("tolerates mixed LF and CRLF line endings", () => {
    const input = "---\r\ntype: Rule\ntitle: Mixed\r\n---\nbody\r\n";
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter.type).toBe("Rule");
    expect(frontmatter.title).toBe("Mixed");
    expect(body).toBe("body\r\n");
  });
});

// ---------------------------------------------------------------------------
// Field-level parsing
// ---------------------------------------------------------------------------

describe("parseFrontmatter — YAML list parsing", () => {
  it("parses [a, b, c] into a string array", () => {
    const input = `---\ntags: [a, b, c]\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("strips surrounding quotes from list items", () => {
    const input = `---\ntags: ["a", 'b', c]\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("filters empty list entries (trailing comma)", () => {
    const input = `---\ntags: [a, b, ,]\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.tags).toEqual(["a", "b"]);
  });

  it("treats a single-item list as a one-element array", () => {
    const input = `---\ntags: [only]\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.tags).toEqual(["only"]);
  });
});

describe("parseFrontmatter — quoted string parsing", () => {
  it("strips surrounding double-quotes", () => {
    const input = `---\ntitle: "Quoted Title"\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.title).toBe("Quoted Title");
  });

  it("preserves inner whitespace inside quotes", () => {
    const input = `---\ndescription: "two  spaces  inside"\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.description).toBe("two  spaces  inside");
  });

  it("uses an unbalanced quote verbatim because there is no lower-fence to refuse on", () => {
    // The lazy regex matches the first `---\n` after the opener, even if
    // the title has no closing quote. Document that behavior: we don't
    // refuse to parse; we just take whatever the line says.
    const input = `---\ntitle: "start but no end\n---\nbody\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter.title).toBe('"start but no end');
    expect(body).toBe("body\n");
  });

  it("returns empty frontmatter when there is no closing fence anywhere", () => {
    const input = `---\ntitle: "start but no end\nbody\n`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });
});

describe("parseFrontmatter — numeric and boolean coercion", () => {
  it("parses ttl as a number when value is a plain integer string", () => {
    const input = `---\nttl: 12\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.ttl).toBe(12);
    expect(typeof frontmatter.ttl).toBe("number");
  });

  it("sets ttl to undefined when value is not a finite integer", () => {
    const input = `---\nttl: not-a-number\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.ttl).toBeUndefined();
  });

  it("treats cacheable: true as boolean true", () => {
    const input = `---\ncacheable: true\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(true);
  });

  it("treats cacheable: yes as boolean true", () => {
    const input = `---\ncacheable: yes\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(true);
  });

  it("treats cacheable: 1 as boolean true", () => {
    const input = `---\ncacheable: 1\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(true);
  });

  it("treats cacheable: false as boolean false", () => {
    const input = `---\ncacheable: false\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(false);
  });

  it("treats cacheable: 0 as boolean false", () => {
    const input = `---\ncacheable: 0\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(false);
  });

  it("treats cacheable: TRUE (uppercase) as boolean true", () => {
    const input = `---\ncacheable: TRUE\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(true);
  });

  it("treats cacheable: arbitrary-string as boolean false", () => {
    const input = `---\ncacheable: maybe\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.cacheable).toBe(false);
  });
});

describe("parseFrontmatter — dotted/hyphenated keys", () => {
  it("supports the trigger-description hyphenated key", () => {
    const input = `---\ntrigger-description: fired on PR review activity\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter["trigger-description"]).toBe("fired on PR review activity");
  });

  it("ignores unknown keys without erroring", () => {
    const input = `---\nunknown-key: some value\nfictional: another\ntype: Rule\n---\nbody\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.type).toBe("Rule");
    // Unknown keys are dropped, not preserved — this is the documented
    // behavior because the type is closed.
    expect((frontmatter as Record<string, unknown>)["unknown-key"]).toBeUndefined();
    expect((frontmatter as Record<string, unknown>)["fictional"]).toBeUndefined();
  });
});
