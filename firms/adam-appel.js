const path = require("path");

module.exports = {
  id: "dermer-appel-ruder",
  name: "Dermer Appel Ruder",
  agent: {
    name: "Evie",
    welcomeMessage:
      "Hi, I'm Evie. You can ask me questions about personal injury matters, consultations, or next steps. Use Chat or Voice to get started.",
  },
  practice: {
    regionsServed: ["Georgia"],
    practiceAreas: ["personal_injury"],
    outOfStatePolicy: "exception_only",
    answerStyle: "helpful_first",
    locationAliases: {
      "\\bga\\b": "Georgia",
      "\\batlanta\\b": "Georgia",
    },
    cityAliases: {
      "\\batlanta\\b": "Atlanta",
    },
  },
  consult: {
    enabled: true,
    link: "https://calendly.com/social-amplifier/dermer-appel-ruder?month=2026-04",
    requiresQualification: true,
    requiresContactCapture: true,
    costAnswer:
      "The public site says consultations are free, confidential, and no-obligation.",
    costGrounded: true,
  },
  webhook: {
    eventType: "lead.captured",
    leadSource: "website_widget",
    deliveryMode: "email_capture",
  },
  qualification: {
    qualifiedStates: ["Georgia"],
    scoreThreshold: 4,
  },
  intake: {
    adapterPath: path.join(process.cwd(), "firms", "adapters", "personal-injury.js"),
    contactFieldOrder: ["visitor_name", "visitor_phone", "visitor_email"],
    responseLeadFieldsNeeded: [
      "visitor_name",
      "visitor_phone",
      "visitor_email",
      "incident_state",
      "incident_type",
      "injury_summary",
      "medical_treatment_status",
    ],
  },
  prompt: {
    sharedContext: [
      {
        id: "shared-behavior",
        label: "Shared Evie behavior",
        path: path.join(process.cwd(), "prompts", "evie-shared-behavior.md"),
      },
      {
        id: "intake-schema",
        label: "Lead schema",
        path: path.join(process.cwd(), "prompts", "evie-intake-schema.md"),
      },
    ],
    runtimeRules: [
      "Use grounded public firm facts when the user asks about the firm, attorneys, office location, consultation process, fees, or practice areas.",
      "If a firm-specific detail is not present in grounded content, say you do not want to guess and offer to help with the next step.",
      "Never use generic assistant filler like 'How can I assist you today?' unless the user is completely generic and even then keep it in Evie's law-firm voice.",
      "If the user provides a location outside Georgia, acknowledge that fact explicitly and adjust the response accordingly.",
      "If the incident is outside Georgia, gently explain that the firm reviews Georgia matters and do not push contact capture unless something else sounds unusually compelling.",
      "If the matter is a routine out-of-state personal injury matter, do not continue ordinary intake after the scope issue is clear.",
      "Only offer the consultation link after the matter appears likely qualified and after contact information has been collected or politely attempted.",
      "Do not provide the consultation link in the same reply where you first ask for contact information.",
      "Do not offer the consultation link immediately just because the user asks for it.",
      "If the user asks for the consultation link before describing the matter, ask a short qualification question sequence first.",
      "When contact capture starts, ask for full name first, then phone number, then email address, one field at a time.",
      "Do not address the user by first name or any part of their name in replies.",
      "If the matter is weaker or unclear, stay helpful and say the firm can review.",
    ],
    extraInstructions: [],
  },
  grounding: {
    allowedSourceTypes: ["markdown_file", "text_file", "inline_text", "json_file"],
    sources: [
      {
        id: "firm-knowledge",
        label: "Firm knowledge bundle",
        type: "json_file",
        usage: "firm_grounding",
        path: path.join(process.cwd(), "knowledge", "adam-appel.json"),
        required: true,
      },
    ],
  },
  observability: {
    includeConfigSummary: true,
    includeGroundingSummary: true,
    includeValidationWarnings: true,
  },
};
