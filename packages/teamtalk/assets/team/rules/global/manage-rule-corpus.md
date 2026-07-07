---
type: Rule
title: Manage the Rule Corpus
description: Rules in the OKF bundle accumulate over time. Periodically audit for staleness, merge overlapping rules, retire unused ones, and keep the corpus shaped to current practice.
tags: [rule-management, corpus-hygiene, maintenance]
timestamp: 2026-07-07T20:00:00.000Z
---

# Manage the Rule Corpus

The team's OKF bundle is a living document. Rules are proposed, merged, and retired over time. Without active management the corpus accumulates noise: dead rules still surface in the reminder, two rules cover the same ground with conflicting advice, and a rule that was right when the project was small becomes wrong as the project grows.

This rule describes the principles and the audit cadence.

# When to audit

- **After any rule is proposed or merged.** Quick scan: is this rule redundant with an existing one? Is its scope (`audience` frontmatter) correct? Does it conflict with anything else in the bundle?
- **Quarterly.** A standing review of every rule in `team/rules/global/` and `team/rules/events/`. Drop, merge, or update anything that has drifted.
- **When a system prompt or reminder grows uncomfortably long.** Long reminders waste context. The fix is rarely "add fewer rules"; it's usually "merge overlapping rules or retire stale ones."

# Principles

## Scope discipline

A rule's scope is determined by its `audience` frontmatter field:

- Unset or `audience: all` — visible to everyone.
- `audience: user-agents` — visible to user-agents, hidden from the steward.
- `audience: steward` — visible to the steward, hidden from user-agents.

If a rule only applies to a subset of agents, set the audience. Don't include user-agent-specific guidance in a rule the steward will see; it pushes the steward toward the wrong tool surface.

## Merge when overlap is significant

When two rules cover the same ground with overlapping or conflicting advice, **merge them into one**. The merged rule should have:

- A single descriptive title.
- One Trigger section explaining when to apply it.
- One procedure, not two parallel procedures.

Don't keep both with a "see also" cross-reference unless the rules are genuinely separate concerns that happen to share vocabulary.

## Split when scope is too broad

When a single rule is invoked in two unrelated workflows and its advice is conditional on which workflow you're in, **split it**. One trigger condition per rule. The OKF v0.1 spec doesn't enforce this, but readers do — a rule that says "if X, do A; otherwise do B" is harder to apply than two rules that say "if X, do A" and "if Y, do B."

## Retire when content is wrong

A rule that no longer reflects the team's practice should be **deleted, not edited in place to quietly drop its point**. Future readers benefit from git archaeology. Add a row to `team/log.md` explaining why the rule was retired.

## Keep examples fresh

Examples age. A rule whose example references a skill that was renamed, a path that was moved, or a tool that was deprecated is a trap. When the surrounding world changes, update the example or delete it.

## Use placeholder names in examples

Examples that include real-looking data should use placeholder convention (`my-team-steward`, `<steward-id>`, `agent-XXXXXXXX`, `MY_TOKEN_VAR`). Real agent IDs, real paths under `/Users/luis/`, and real secret values should not appear in shipped docs. The reader will mistake the example for an instruction.

# How to retire a rule

1. Update the rule body to a one-line notice: "Retired on YYYY-MM-DD. See `team/log.md` for the reason."
2. Append a row to `team/log.md` with the retirement reason and the suggested replacement (if any).
3. After the next reminder render, the rule still appears in the catalog (until someone manually deletes the file); delete the file in a follow-up commit.

Don't skip the `team/log.md` row. Future contributors need to know why a rule disappeared.

# How to propose a new rule

1. Search the existing corpus for overlap. If a near-duplicate exists, propose a merge of that rule instead of adding a new one.
2. Pick a clear title. "X" is fine; "Notes on X" or "Things to think about when doing X" is verbose. The title goes in `system/rules.md` and competes for attention with every other rule.
3. Keep it short. A 20-line rule that's clearly written beats a 60-line rule that hedges every edge case. Edge cases belong in code comments at the implementation site.
4. Set the audience frontmatter if the rule isn't for everyone.
5. Use placeholder names in any examples.

# See also

- `team/rules/events/reply-to-pr-review-comments-individually` — the PR-review workflow often surfaces rules that need updating; treat review comments as an audit signal.
- `team/rules/index.md` — the rendered reminder; if it's growing uncomfortably, the corpus is the place to trim.