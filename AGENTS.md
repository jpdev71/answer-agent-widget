# Agent Instructions

Read this entire file before starting any task.

## Self-Correcting Rules Engine

This file contains a growing ruleset that improves over time. **At session start, read the entire "Learned Rules" section before doing anything.**

### How it works

1. When the user corrects you or you make a mistake, **immediately append a new rule** to the "Learned Rules" section at the bottom of this file.
2. Rules are numbered sequentially and written as clear, imperative instructions.
3. Format: `N. [CATEGORY] Never/Always do X because Y.`
4. Categories: `[STYLE]`, `[CODE]`, `[ARCH]`, `[TOOL]`, `[PROCESS]`, `[DATA]`, `[UX]`, `[OTHER]`
5. Before starting any task, scan all rules below for relevant constraints.
6. If two rules conflict, the higher-numbered (newer) rule wins.
7. Never delete rules. If a rule becomes obsolete, append a new rule that supersedes it.

### When to add a rule

- User explicitly corrects your output ("no, do it this way")
- User rejects a file, approach, or pattern
- You hit a bug caused by a wrong assumption about this codebase
- User states a preference ("always use X", "never do Y")

### Rule format example

```text
14. [CODE] Always use `bun` instead of `npm` because it is installed globally and preferred by the user.
15. [STYLE] Never add emojis to commit messages because that is the project convention.
16. [ARCH] API routes live in `src/server/routes/`, not `src/api/`, because that is the existing codebase pattern.
```

---

## Learned Rules

<!-- New rules are appended below this line. Do not edit above this section. -->
1. [UX] Always let the law-firm agent answer legal-process questions as helpfully as possible with cautious, general guidance because the user wants it to feel more useful than a rote decision-tree chatbot without crossing into legal advice.
2. [UX] Always prioritize helpful question-answering over lead qualification or consult-link pushing because Evie's usefulness should be her main selling point.
3. [UX] Never let Evie begin intake from a simple greeting alone because low-intent openers should feel welcoming and conversational rather than form-like.
4. [UX] Always let Enter submit the widget message while reserving Shift+Enter for a newline because faster testing and chat-style interaction are preferred for this project.
5. [UX] Always render consultation URLs as clickable links in the widget because copy-paste scheduling links create unnecessary user friction.
6. [UX] Never let Evie reset to a generic opener after the user provides a factual intake answer because follow-up responses should acknowledge the new information and continue the conversation naturally.
7. [PROCESS] Always make fallback behavior visible during testing because silent fallback makes it too hard to tell whether prompt issues are actually backend-runtime failures.
