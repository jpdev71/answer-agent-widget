# Multi-Firm Contract

This project now separates the shared Evie app shell from firm-specific behavior.

## Shared vs Firm-Specific

Shared application behavior should stay in code:

- widget UI, chat state, and transport to `/api/evie`
- OpenAI request/response handling
- contact detection for webhook freshness checks
- webhook delivery flow
- config validation
- adapter loading
- grounding bundle assembly
- response observability shape

Firm-specific behavior should live in a firm config plus adapter:

- `id`, `name`, and agent display name
- regions served and practice-area scope
- consult-link policy
- lead extraction and intake heuristics
- qualification logic
- grounding source list
- webhook event metadata
- welcome copy or extra prompt instructions

## Config Contract

Current default alias lives in [firms/default.js](/C:/Users/faith/OneDrive/Desktop/CDXprojects/Chatbot%20Answer%20Agent/firms/default.js), and the current Adam Appel / Dermer Appel Ruder implementation lives in [firms/adam-appel.js](/C:/Users/faith/OneDrive/Desktop/CDXprojects/Chatbot%20Answer%20Agent/firms/adam-appel.js).

```js
{
  id: "firm-slug",
  name: "Firm Name",
  agent: {
    name: "Evie",
    welcomeMessage: "..."
  },
  practice: {
    regionsServed: ["Georgia"],
    practiceAreas: ["personal_injury"],
    outOfStatePolicy: "exception_only",
    answerStyle: "helpful_first"
  },
  consult: {
    enabled: true,
    link: "https://...",
    requiresQualification: true,
    requiresContactCapture: true
  },
  webhook: {
    eventType: "lead.captured",
    leadSource: "website_widget"
  },
  qualification: {
    qualifiedStates: ["Georgia"],
    scoreThreshold: 4,
    paths: ["qualified", "review"]
  },
  intake: {
    adapterPath: "/absolute/path/to/firm-adapter.js",
    responseLeadFieldsNeeded: ["visitor_name", "visitor_phone"]
  },
  prompt: {
    runtimeRules: [],
    extraInstructions: []
  },
  grounding: {
    allowedSourceTypes: ["markdown_file", "text_file", "inline_text"],
    sources: [
      { id, label, type, usage, path?, text?, required }
    ]
  },
  observability: {
    includeConfigSummary: true,
    includeGroundingSummary: true,
    includeValidationWarnings: true
  }
}
```

## Adapter Contract

Each firm points at a small adapter module. The current PI adapter lives at [firms/adapters/personal-injury.js](/C:/Users/faith/OneDrive/Desktop/CDXprojects/Chatbot%20Answer%20Agent/firms/adapters/personal-injury.js).

Required adapter exports:

- `createLead({ transcript, channel, firm })`
- `collectMissingLeadFields(lead, firm)`
- `getLeadFieldsNeededEnum(firm)`
- `getPromptRuntimeRules(firm)`

This keeps the shared API generic while letting each firm define:

- how transcript facts become a lead record
- which fields count as missing
- which qualification paths are valid
- which runtime prompt rules are firm-specific

Environment overrides are intentionally lightweight for now:

- `FIRM_PROFILE`
- `FIRM_ID`
- `FIRM_NAME`
- `CONSULT_LINK`

`FIRM_PROFILE` selects the base firm implementation. The others override parts of that selected config without introducing a second config system.

## Grounding Model

Allowed grounding sources are deliberately narrow:

- `markdown_file`
- `text_file`
- `inline_text`

Each source should declare:

- stable `id`
- human-readable `label`
- `usage` such as `system_behavior`, `lead_schema`, or `tone_examples`
- one source payload: `path` for file-backed content or `text` for inline content
- `required` to surface validation warnings when critical material is missing

This keeps the first multi-firm version auditable and easy to diff. It avoids adding retrieval infrastructure before the firm-config boundary is settled.

### Recommended Content Bundle

For this project, keep each firm's knowledge bundle small and curated. The current preferred shape is:

- homepage facts
- about / attorney bio facts
- practice area facts
- contact / consultation facts
- optional internal positioning note

The goal is not to build a broad knowledge system. The goal is to anchor Evie on firm-specific facts she should not guess about while letting the base model handle general conversational reasoning.

## Validation

Minimal per-firm validation currently checks:

- required firm identity fields
- at least one served region
- consult link shape when consults are enabled
- adapter presence and adapter file existence
- grounding source presence and allowed types
- file existence for file-backed grounding content

Warnings are non-fatal so the app can still run during onboarding, but they are exposed in API metadata.

## Observability

`GET /api/evie` now exposes a basic firm summary and prompt version.

`POST /api/evie` now includes:

- `prompt_version`
- `webhook_delivery`
- `observability.firm`
- `observability.grounding_sources`
- `observability.validation_warnings`

That should be enough for initial onboarding, prompt debugging, and "which firm config was active?" questions without building a larger admin layer yet.
