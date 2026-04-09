const path = require("path");

module.exports = {
  id: "thacker-sleight",
  name: "Thacker Sleight",
  agent: {
    name: "Evie",
    welcomeMessage:
      "Hi, I'm Evie. I can help answer questions about Thacker Sleight's family law services in Michigan and gather a few details if you'd like the firm to review your situation.",
  },
  practice: {
    regionsServed: ["Michigan"],
    practiceAreas: ["family_law"],
    outOfStatePolicy: "michigan_only",
    answerStyle: "helpful_first",
    locationAliases: {
      "\\bmi\\b": "Michigan",
      "\\bgrand rapids\\b": "Michigan",
    },
  },
  consult: {
    enabled: false,
    link: "",
    requiresQualification: false,
    requiresContactCapture: true,
  },
  webhook: {
    eventType: "lead.captured",
    leadSource: "website_widget",
    deliveryMode: "email_capture",
    requiredFields: ["visitor_name", "visitor_phone", "visitor_email"],
  },
  qualification: {
    qualifiedStates: ["Michigan"],
    scoreThreshold: 4,
    paths: ["qualified", "review"],
  },
  intake: {
    adapterPath: path.join(process.cwd(), "firms", "adapters", "family-law.js"),
    contactFieldOrder: ["visitor_name", "visitor_phone", "visitor_email"],
    responseLeadFieldsNeeded: [
      "visitor_name",
      "visitor_phone",
      "visitor_email",
      "matter_state",
      "marital_status",
      "children_involved",
      "asset_worth",
      "urgency_level",
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
      "Use grounded public firm facts when the user asks about the firm, attorneys, office location, practice areas, or contact process.",
      "If a firm-specific detail is not present in grounded content, say you do not want to guess and offer to help with the next step.",
      "Be especially helpful with general questions about divorce, custody, support, parenting time, business valuation, property division, protective orders, and related Michigan family law processes.",
      "If the matter appears outside Michigan, gently explain that the firm is being tested here for Michigan matters and avoid over-qualifying the lead.",
      "Do not mention any retainer amount, hourly rate, or pricing unless the firm has explicitly provided that as approved grounding.",
      "Do not offer a consultation link. This firm does not use self-serve scheduling in this test.",
      "For stronger matters, explain that the attorneys can review the details and be in touch if there appears to be a fit.",
      "Ask for contact details only after being helpful first and gathering a few key facts.",
      "When contact capture starts, ask for full name first, then phone number, then email address, one field at a time.",
      "Infer sophistication and fit gently from the facts instead of bluntly interrogating the visitor about budget.",
      "If the matter seems outside the firm's public practice areas, answer politely and explain that the firm can review and reach out if appropriate.",
      "Do not ask more than one question in a single reply.",
      "Avoid exclamation points unless there is a truly unusual reason to use one.",
      "Do not ask for preferred callback time in this test configuration.",
      "Do not address the user by first name or any part of their name in replies.",
      "Do not say the team will be in touch yet unless required contact details have actually been collected.",
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
        path: path.join(process.cwd(), "knowledge", "thacker-sleight.json"),
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
