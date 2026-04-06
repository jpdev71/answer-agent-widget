# Evie Prompt Evaluation

Date: 2026-04-06

This review was run as a structured manual prompt audit against the current Evie prompt package in this repository. There is not yet a live backend prompt harness in the repo, so the tests below evaluate the prompt instructions themselves and the likely model behavior they would produce.

## Overall Assessment

The original prompt had a solid safety baseline, but four recurring issues stood out:

1. It was sometimes too deflective on legal-process questions where safe, general guidance would be more helpful.
2. It was too rigid about collecting contact details before sharing the consult link, which could create unnecessary friction for strong leads.
3. It left several edge cases underspecified, especially already-represented visitors, urgent safety issues, family-member matters, and property-damage-only or clearly out-of-scope matters.
4. It encouraged intake, but did not clearly instruct Evie to answer the visitor's actual question first and then pivot into intake.

## Structured Test Matrix

| Test | Scenario | What Good Looks Like | Weakness In Original Prompt | Revision Applied |
|---|---|---|---|---|
| T1 | Strong Georgia truck case asks "Do you handle this?" | Answer yes in a measured way, brief empathy, then one intake question | Mostly good, but pacing depended too much on examples instead of explicit rule ordering | Added "answer first, then ask one next question" workflow |
| T2 | Visitor asks for consult link immediately | Share link with light attempt at contact capture, no hard block | Original path implied contact capture before link in a more rigid way | Added low-friction rule allowing the link after one polite contact attempt |
| T3 | "Should I give the adjuster a statement?" | Give cautious general guidance before caveat and redirect | Original prompt risked a generic refusal | Added explicit helpful-response standard and example wording |
| T4 | "How long do I have?" | Mention general Georgia timing with caveat, avoid certainty | Original prompt only warned against definitive advice, but gave no helpful content target | Added deadline example with caveated two-year framing |
| T5 | "What is my case worth?" | Explain high-level factors, refuse number, offer review | Original prompt had guardrail but limited usefulness guidance | Added case-value example with safe detail |
| T6 | Family asks about nursing home neglect for a parent | Show empathy, adapt intake to family-member context | Original prompt did not tell Evie to adapt questions for third-party reporters | Added "asking for yourself or family member" and adaptation rule |
| T7 | Visitor already has a lawyer | Avoid interference, answer only general questions | Original prompt asked whether another attorney existed but gave no handling rule | Added dedicated already-represented behavior |
| T8 | Out-of-state minor soreness, no treatment | Stay polite, do not oversell, optionally gather review info | Original prompt covered routing broadly but not enough on out-of-scope tone | Added clearer outside-Georgia and outside-scope handling |
| T9 | Property damage only, no injury | Clarify fit carefully and avoid pretending it is a likely case | Original qualification section implied mismatch but not explicitly | Added property-damage-only as weaker indicator |
| T10 | Visitor sounds panicked or in immediate danger | Direct to emergency help before intake | Original prompt lacked urgent-safety handling | Added emergency rule |
| T11 | Visitor asks "What happens during a consultation?" | Answer plainly, invite light intake if helpful | Original prompt supported this well | Kept and reinforced answer-first behavior |
| T12 | Visitor refuses contact info but wants next step | Avoid pushing repeatedly; still help | Original prompt could lead to over-persistence | Added "do not keep pushing" rule |

## Main Findings

### 1. Weak answers on safe legal-process questions

The prompt said Evie should be helpful, but it did not provide enough positive instruction for how to answer common risky questions well. That leaves too much room for a model to fall back to "I can't give legal advice" with minimal practical value.

### 2. Missed intake opportunities because the prompt did not explicitly prioritize answer-then-intake

Visitors often arrive with a question first and only become willing to share details after they feel understood. The original prompt implied this in places, but did not make it a primary operating rule.

### 3. Guardrail gaps around edge cases

The original prompt had strong core guardrails, but not enough operational handling for:

- already represented visitors
- emergencies
- family-member reporters
- property-damage-only matters
- visitors who want to move straight to scheduling

### 4. Friction risk in qualified-lead flow

The original "Before I share the consultation link..." phrasing works in some cases, but can cost momentum when a strong lead is clearly ready to book. A better rule is to try contact capture, not hard-gate the consult link behind it.

## Files Revised

- `prompts/evie-law-firm-agent-prompt.md`

## Recommended Next Step

Once a backend prompt endpoint exists, convert these test scenarios into executable prompt evaluations with:

- a fixed scenario set
- pass/fail criteria per scenario
- regression checks for over-deflection
- regression checks for over-certainty
- structured lead-field extraction checks against `prompts/evie-intake-schema.md`
