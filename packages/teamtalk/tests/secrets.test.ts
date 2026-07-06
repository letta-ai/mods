// Tests for containsSecret. Each pattern × representative input.
//
// The intent is to lock in coverage so a refactor (e.g., adding a
// pattern, removing a pattern, or changing the policy) is caught
// here. False positives and false negatives both have consequences:
// the runtime refuses a write it shouldn't, or accepts a write it
// shouldn't.

import { describe, expect, it } from "vitest";
import { containsSecret, SECRET_PATTERNS } from "../mods/lib/secrets.ts";

describe("containsSecret — patterns", () => {
  it("detects AWS access keys", () => {
    const result = containsSecret("AKIAIOSFODNN7EXAMPLE");
    expect(result).toBeTruthy();
  });

  it("does not flag near-miss AWS keys (wrong length)", () => {
    const result = containsSecret("AKIAIOSFODNN7EXAMPL"); // 19 chars
    expect(result).toBeNull();
  });

  it("detects OpenAI project keys", () => {
    const result = containsSecret("sk-abcdefghijklmnopqrstuv");
    expect(result).toBeTruthy();
  });

  it("does not flag short sk- strings (under 20 chars)", () => {
    const result = containsSecret("sk-short");
    expect(result).toBeNull();
  });

  it("detects GitHub PATs (ghp_ prefix)", () => {
    const result = containsSecret("ghp_" + "a".repeat(36));
    expect(result).toBeTruthy();
  });

  it("does not flag random tokens without ghp_ prefix", () => {
    const result = containsSecret("ghp_xyz");
    expect(result).toBeNull();
  });

  it("detects Slack bot tokens (xoxb- prefix)", () => {
    const result = containsSecret("xoxb-1234567890-abcdef");
    expect(result).toBeTruthy();
  });

  it("detects PEM private keys", () => {
    const result = containsSecret("-----BEGIN RSA PRIVATE KEY-----");
    expect(result).toBeTruthy();
  });

  it("does not flag PEM public keys (the secret guard only catches private)", () => {
    const result = containsSecret("-----BEGIN PUBLIC KEY-----");
    expect(result).toBeNull();
  });

  it("detects quoted secret assignment (api_key='xxx')", () => {
    const result = containsSecret(`api_key="supersecretvalue"`);
    expect(result).toBeTruthy();
  });

  it("detects .env-style KEY=value", () => {
    const result = containsSecret("API_KEY=abcdef123456");
    expect(result).toBeTruthy();
  });

  it("detects .env-style with quotes", () => {
    const result = containsSecret('PASSWORD="hunter2hunter2"');
    expect(result).toBeTruthy();
  });
});

describe("containsSecret — clean inputs", () => {
  it("does not flag ordinary prose", () => {
    expect(containsSecret("This rule is about clean code style.")).toBeNull();
  });

  it("does not flag technical terminology containing 'key'", () => {
    expect(containsSecret("The hotkey for save is Cmd-S.")).toBeNull();
  });

  it("does not flag short password mentions in body text", () => {
    expect(containsSecret("Make sure to rotate the token every 90 days.")).toBeNull();
  });

  it("does not flag Markdown headings that happen to contain token-like words", () => {
    expect(containsSecret("# Token rotation policy\n\nWe rotate access tokens.")).toBeNull();
  });
});

describe("SECRET_PATTERNS — sanity", () => {
  it("has at least 6 patterns registered", () => {
    // If a pattern is removed, this assertion fires. If a pattern is
    // added, update the assertion AND make sure each is covered above.
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });

  it("every pattern is a regex", () => {
    for (const p of SECRET_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});