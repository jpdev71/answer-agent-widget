# Evie QA Hardening Matrix

Date: 2026-04-09

Purpose: run a short, repeatable hardening pass across both supported firms without expanding the knowledge base or changing the stable lead-handoff architecture.

## How To Use

Test each scenario in both modalities:

- `chat`
- `voice`

Run each scenario against both active firm profiles:

- `adam-appel`
- `thacker-sleight`

Pass each test only if all of these are true:

- the answer is grounded and specific when the fact exists in the curated bundle
- the answer does not guess unsupported firm facts
- the answer sounds natural spoken aloud, with short clean sentences
- the answer does not start intake unless the scenario clearly shifts into the visitor's own matter
- any booking or contact answer matches the active firm's actual policy

## Cross-Firm Matrix

| ID | Category | User prompt | Good cross-firm behavior | Adam Appel / Dermer Appel Ruder expected answer | Thacker Sleight expected answer | Voice check |
|---|---|---|---|---|---|---|
| Q1 | office/contact | `What is your phone number?` | Answer directly in one sentence. No intake pivot. | Should give `404-892-8884`. | Should give `616-888-3810`. | Number should be easy to hear once. |
| Q2 | office/contact | `Where is your office?` | Answer directly with city and full address if grounded. | Should give `708 Holcomb Bridge Rd., Norcross, GA 30071`. | Should give `445 Cherry Street SE, Grand Rapids, MI 49503`. | Address should not be buried in filler. |
| Q3 | attorney/bio | `Who are the attorneys there?` | Name publicly listed attorneys only. No guessing about staffing or assignment. | Should mention Adam Appel and Kim Ruder, and can note Stephen Dermer is listed as retired. | Should mention Connie Thacker, Allison Sleight, Emily Rysberg, Ben Judd, and Grant James. | Names should be spoken clearly without a long run-on list intro. |
| Q4 | attorney/bio | `Can you tell me about Connie Thacker?` | Answer directly if grounded; otherwise do not guess and offer a next step. | Should not guess because Connie Thacker is not an Adam Appel attorney. Best answer is that Evie does not want to guess and can answer about the firm's listed attorneys instead. | Should mention attorney/shareholder role, litigator and mediator background, AAML fellow status, CDFA credential, Michigan licensure since 1994, and complex financial/divorce background in concise form. | Bio answer should sound conversational, not resume-like. |
| Q5 | practice-area fit | `Do you handle truck accidents?` | Answer fit question first. No immediate intake unless the user shifts into their matter. | Should say yes, truck accidents are publicly listed. | Should not guess or imply yes; should explain the firm is focused on Michigan family law rather than truck accident cases. | First sentence should clearly answer yes/no/fit. |
| Q6 | practice-area fit | `Do you handle custody disputes?` | Answer fit question first and stay within grounded scope. | Should not invent family-law services; should explain the firm is a Georgia personal injury firm. | Should say yes, custody and parenting time are publicly listed areas. | Avoid hedging before the actual answer. |
| Q7 | booking/consultation policy | `Can I schedule a consultation online?` | Answer the firm's actual booking path cleanly. No made-up scheduling mechanics. | Should explain the firm offers consultations and can share the consultation link after brief qualification/contact flow; should not imply unrestricted self-serve booking if the current rules require qualification first. | Should clearly say there is no online self-scheduling in this setup and invite the visitor to share details here for review. | Spoken answer should be short and policy-clear. |
| Q8 | booking/consultation policy | `Is the consultation free?` | Answer directly if grounded. If not grounded, do not guess. | Should say the public site says consultations are free, confidential, and no-obligation. | Should not guess on cost because the curated bundle does not approve pricing or consultation-cost claims. | Avoid long caveats after a simple direct answer. |
| Q9 | unsupported fact | `What are your office hours on Saturday?` | Do not guess unsupported hours. Offer the next best contact step. | Should say Evie does not want to guess because hours are not in the grounded bundle, then offer phone/contact page next step. | Same. | This should sound helpful, not evasive. |
| Q10 | unsupported fact | `Which attorney would personally handle my case?` | Do not promise staffing assignment unless grounded. | Should not assign a specific attorney; can say the site says clients work with a dedicated lead attorney but Evie cannot promise who that would be. | Should not guess which attorney would handle the matter; can say the firm can review and determine fit. | No overlong disclaimer. |
| Q11 | borderline intake | `I was in a Georgia truck accident yesterday. Do you handle that?` | Answer fit first, then ask one short next-step question if appropriate. | Should say this sounds like a type of matter the firm handles, then ask one intake question. | Should explain the firm is focused on Michigan family law and not continue ordinary intake. | First answer should still feel natural aloud. |
| Q12 | borderline intake | `I'm in Michigan and dealing with a custody fight. What should I do first?` | Give cautious general process guidance before any intake pivot. | Should not pretend to handle Michigan custody matters; should gently explain the scope mismatch and avoid dragging the user through intake. | Should give general helpful family-law process guidance in cautious terms, then ask one focused follow-up if helpful. | Spoken guidance should stay plain-English and calm. |

## Voice-Readiness Flags

Mark a scenario for polish if any of these happen in voice mode:

- the answer buries the key fact after throat-clearing language
- the answer stacks too many clauses or attorney credentials into one sentence
- the answer uses written-only phrasing like `if you'd prefer` more than once
- the answer sounds awkward when reading numbers, addresses, or policy caveats aloud
- the answer adds extra intake framing after a simple firm-information question

## Known Firm-Specific Policy Checks

- Adam Appel / Dermer Appel Ruder:
  - free consultation messaging is grounded
  - consultation link exists, but the current flow still requires brief qualification and contact capture before offering it
  - the firm is Georgia-focused and should not continue routine out-of-state intake

- Thacker Sleight:
  - no online self-scheduling should be enforced consistently
  - no grounded pricing or retainer claims should be made
  - the firm is Michigan family-law focused and should not imply broader practice coverage

## Suggested Run Order

1. Run `Q1` through `Q4` first to confirm basic grounding consistency.
2. Run `Q7` through `Q10` next to confirm policy and unsupported-fact discipline.
3. Run `Q11` and `Q12` last to check answer-first intake behavior under light pressure.

If a repeated gap appears in at least two scenarios or in both modalities, fix the narrowest shared instruction or firm rule that addresses it.
