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
8. [UX] Always let Evie open the widget with her own welcome message because user greetings like "hi" or "hey" add noise and weaken the first conversational turn.
9. [ARCH] Never use the heuristic backend as a conversational fallback because a transparent temporary-unavailable response is better than a fake conversation that breaks trust.
10. [CODE] Always verify that every backend helper referenced in production code is actually defined before deploying because a missing helper caused `/api/evie` to crash and masked the real API path.
11. [UX] Never return browser-side demo responses when the live API fails because canned fallback copy hides production outages and makes debugging harder.
12. [CODE] Always test the OpenAI conversation-history payload across multiple turns because a format that works on turn one can still break as soon as assistant history is included.
13. [UX] Always tell users gently that the firm handles Georgia matters when they describe an out-of-state incident because Evie should set scope clearly without sounding harsh.
14. [UX] Always ask one intake question at a time because single-question follow-up feels better for users and reduces conversational confusion.
15. [UX] Only gather contact information for out-of-state matters when some other fact makes the lead unusually compelling because the firm generally is not interested in ordinary out-of-state leads.
16. [UX] Always collect contact information before offering the consultation link because the firm will want a reachable qualified lead before scheduling.
17. [UX] Never offer the consultation link without some qualification first because only stronger leads that match the firm's profile should be routed to consult scheduling.
18. [UX] Never continue ordinary intake for a routine out-of-state matter after scope is clear because Evie should set expectations instead of dragging the user through unnecessary questions.
19. [UX] Always require a short qualification step before sharing the consultation link on a cold request because contact information alone is not enough to justify scheduling.
20. [ARCH] Always prefer a webhook handoff for lead delivery because Zapier will route Evie's captured data into spreadsheets and notifications across different firms.
21. [ARCH] Always fire webhook delivery when a real contact method is captured because Zapier is the preferred place to filter and route lead quality logic across firms.
22. [ARCH] Always trigger webhook delivery from the current message when contact info appears there because message-level capture is more reliable than inferring freshness from the full transcript.
23. [DATA] Always deduplicate the current user message from the server transcript when the client already sent it in conversation history because double-counting corrupts transcript payloads and contact extraction.
24. [DATA] Always parse contact names case-insensitively because users often write `My name is ...` with capitalization that should still populate the lead record.
25. [DATA] Always prioritize contact-style names near phone and email over earlier conversational phrases because family-member wording like `I'm reaching out for my sister` can otherwise pollute the lead name field.
26. [DATA] Always strip leading declaration phrases like `My name is` from captured contact names because intake messages often present contact details in full sentences and the stored name should contain only the person's actual name.
27. [DATA] Always reject fallback name candidates that contain ordinary sentence words because a blank name is safer than storing a conversational fragment like `worried about how that might impact` as the lead's name.
28. [DATA] Always preserve a clean earlier standalone name answer across later turns because users often provide their name first and contact details afterward.
29. [DATA] Always parse a clean name fragment that appears before an email or phone on the same line because users often send `Name, email` or `Name, phone` in one turn and that should still populate the lead correctly.
30. [ARCH] Always trigger the webhook when a lead becomes fully ready for handoff, even if the final required field is not phone or email, because some firms complete intake with callback preferences or other last-step fields on a later turn.
31. [UX] Always keep Evie in contact-collection mode until required follow-up fields are complete because she should not promise that the firm will reach out while a required email, phone, name, or callback field is still missing.
32. [DATA] Always reject greeting-style phrases like `Hi Evie` or `Hello there` as names because opener text should never start contact-capture mode.
33. [DATA] Always parse natural callback answers like `Friday at 3pm` or `tomorrow afternoon` because users often answer scheduling questions conversationally instead of with labelled phrases.
34. [DATA] Never treat bare city/state answers like `Detroit MI` as names because location replies are common during intake and a blank name is safer than premature contact capture.
35. [DATA] Always require standalone name-only answers to visually look like names because short conversational fragments like `Probably quick` should not start contact capture.
36. [UX] Never ask Thacker Sleight leads for preferred callback time during this test because simpler name-phone-email handoff is more important than extra scheduling detail right now.
37. [DATA] Never treat consent replies like `Okay`, `Sure`, or `Yes` as names because users often confirm contact collection before actually giving their name.
38. [ARCH] Always prefer transcript-first webhook delivery over strict live-parser gating because downstream automation can analyze the full conversation more reliably than brittle in-chat extraction.
39. [ARCH] Always trigger transcript-first webhooks on meaningful lead-state changes rather than every assistant turn because Zapier needs a compact event stream, not a flood of duplicate snapshots.
