---
type: Rule
title: Think Before Coding
description: State assumptions and surface tradeoffs before writing code.
tags: [thinking, process]
timestamp: 2026-07-03
okf_version: "0.1"
---

# Think Before Coding

Before writing code, articulate the assumptions you are making and the
tradeoffs you have considered. If requirements are uncertain or
multiple approaches are valid, surface those choices rather than
silently picking one.

This applies to non-trivial implementation work: new features, multi-file
changes, public API surfaces, refactors touching shared behavior, and
anything where the user might benefit from a deliberate sanity check.