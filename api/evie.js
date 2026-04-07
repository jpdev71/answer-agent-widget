const fs = require("fs");
const path = require("path");

const CONSULT_LINK =
  "https://calendly.com/social-amplifier/dermer-appel-ruder?month=2026-04";

const PROMPT_PATHS = [
  path.join(process.cwd(), "prompts", "evie-law-firm-agent-prompt.md"),
  path.join(process.cwd(), "prompts", "evie-intake-schema.md"),
  path.join(process.cwd(), "prompts", "evie-sample-conversations.md"),
];

let cachedVersion = "";
let cachedPromptBundle = "";

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      agent: "Evie",
      mode: "helpful_first",
      prompt_version: getPromptVersion(),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = parseBody(req.body);
  const message = readString(body.message);
  if (!message) {
    res.status(400).json({ error: "A message is required." });
    return;
  }

  const requestMeta = extractRequestMeta(body);
  const history = normalizeHistory(body.conversation_history);
  const transcript = [...history, { role: "user", content: message }];
  const priorLead = extractLead(history, body.channel === "voice" ? "voice" : "chat");
  const lead = extractLead(transcript, body.channel === "voice" ? "voice" : "chat");
  const result = await buildReply(message, lead, transcript);
  const transcriptWithReply = [...transcript, { role: "assistant", content: result.replyText }];
  const webhookDelivery = await maybeDeliverLead({
    message,
    requestMeta,
    priorLead,
    lead,
    result,
    transcript: transcriptWithReply,
  });

  res.status(200).json({
    reply_text: result.replyText,
    qualification_path: result.qualificationPath,
    request_contact_capture: result.requestContactCapture,
    offer_consult_link: result.offerConsultLink,
    consult_link: result.offerConsultLink ? CONSULT_LINK : "",
    lead_fields_needed: result.leadFieldsNeeded,
    response_source: result.responseSource,
    fallback_reason: result.fallbackReason || "",
    lead_record: lead,
    prompt_version: getPromptVersion(),
    webhook_delivery: webhookDelivery,
  });
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractRequestMeta(body) {
  return {
    sessionId: readString(body.session_id),
    pageUrl: readString(body.page_url),
    pageTitle: readString(body.page_title),
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry) => ({
      role: entry?.role === "assistant" ? "assistant" : "user",
      content: readString(entry?.content),
    }))
    .filter((entry) => entry.content);
}

function getPromptVersion() {
  let latest = 0;
  for (const promptPath of PROMPT_PATHS) {
    const stats = fs.statSync(promptPath);
    latest = Math.max(latest, stats.mtimeMs);
  }

  cachedVersion = new Date(latest).toISOString();
  return cachedVersion;
}

function getPromptBundle() {
  const version = getPromptVersion();
  if (cachedPromptBundle && cachedPromptBundle.version === version) {
    return cachedPromptBundle.text;
  }

  const sections = PROMPT_PATHS.map((promptPath) => {
    const filename = path.basename(promptPath);
    return `## ${filename}\n\n${fs.readFileSync(promptPath, "utf8").trim()}`;
  });

  cachedPromptBundle = {
    version,
    text: sections.join("\n\n"),
  };

  return cachedPromptBundle.text;
}

function extractLead(transcript, channel) {
  const userText = transcript
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join("\n");
  const lower = userText.toLowerCase();

  const incidentState = detectState(lower);
  const incidentType = detectIncidentType(lower);
  const injurySummary = detectInjuries(lower);
  const medicalTreatmentStatus = detectTreatment(lower);
  const commercialVehicleInvolved = detectCommercialVehicle(lower);
  const contact = detectContact(userText);
  const qualificationPath = detectQualification({
    incidentState,
    incidentType,
    injurySummary,
    medicalTreatmentStatus,
    commercialVehicleInvolved,
    lower,
  });

  return {
    lead_source: "website_widget",
    agent_name: "Evie",
    conversation_channel: channel,
    created_at: new Date().toISOString(),
    visitor_name: contact.name,
    visitor_phone: contact.phone,
    visitor_email: contact.email,
    incident_city: detectCity(userText),
    incident_state: incidentState,
    incident_date_text: detectDateText(lower),
    incident_type: incidentType,
    injury_summary: injurySummary,
    medical_treatment_status: medicalTreatmentStatus,
    still_treating: detectStillTreating(lower),
    commercial_vehicle_involved: commercialVehicleInvolved,
    nursing_home_abuse_flag: lower.includes("nursing home") || lower.includes("neglect"),
    work_or_daily_life_impact: detectImpact(lower),
    insurance_status: detectInsurance(lower),
    represented_by_other_attorney: detectRepresented(lower),
    evidence_summary: detectEvidence(lower),
    visitor_goal: detectGoal(lower),
    qualification_path: qualificationPath,
    qualification_notes:
      qualificationPath === "qualified"
        ? "Potentially qualified lead based on the current facts."
        : "Needs review or appears less clearly qualified.",
    consult_link_offered: false,
    follow_up_recommended: qualificationPath === "qualified" || Boolean(incidentType !== "unknown"),
    conversation_summary: buildSummary({
      incidentType,
      incidentState,
      injurySummary,
      medicalTreatmentStatus,
      commercialVehicleInvolved,
    }),
  };
}

async function maybeDeliverLead({ message, requestMeta, priorLead, lead, result, transcript }) {
  const webhookUrl = readString(process.env.LEAD_WEBHOOK_URL);
  if (!webhookUrl) {
    return { attempted: false, delivered: false, reason: "missing_webhook_url" };
  }

  if (!shouldDeliverLead({ message, priorLead, lead, result })) {
    return { attempted: false, delivered: false, reason: "conditions_not_met" };
  }

  const payload = buildLeadWebhookPayload({
    requestMeta,
    lead,
    result,
    transcript,
  });

  try {
    const response = await postLeadWebhook(webhookUrl, payload);
    return {
      attempted: true,
      delivered: response.ok,
      reason: response.ok ? "" : `webhook_status_${response.status}`,
      status: response.status,
    };
  } catch (error) {
    console.error("Lead webhook delivery failed:", error);
    return {
      attempted: true,
      delivered: false,
      reason: "webhook_request_failed",
    };
  }
}

function shouldDeliverLead({ message, priorLead, lead, result }) {
  const currentMessageContact = detectContact(message);
  const hasContactInCurrentMessage = Boolean(
    currentMessageContact.phone || currentMessageContact.email,
  );
  const hasFreshContact =
    hasContactInCurrentMessage ||
    (!hasDeliverableContact(priorLead) && hasDeliverableContact(lead));

  if (!hasFreshContact) {
    return false;
  }

  if (result.responseSource !== "openai") {
    return false;
  }

  return true;
}

function hasDeliverableContact(lead) {
  return Boolean(lead?.visitor_phone || lead?.visitor_email);
}

function buildLeadWebhookPayload({ requestMeta, lead, result, transcript }) {
  return {
    event_type: "lead.captured",
    delivered_at: new Date().toISOString(),
    firm_id: process.env.FIRM_ID || "dermer-appel-ruder",
    firm_name: process.env.FIRM_NAME || "Dermer Appel Ruder",
    agent_name: lead.agent_name,
    session_id: requestMeta.sessionId,
    source: {
      channel: lead.conversation_channel,
      lead_source: lead.lead_source,
      page_url: requestMeta.pageUrl,
      page_title: requestMeta.pageTitle,
    },
    routing: {
      qualification_path: result.qualificationPath,
      request_contact_capture: result.requestContactCapture,
      offer_consult_link: result.offerConsultLink,
      consult_link: result.offerConsultLink ? CONSULT_LINK : "",
      response_source: result.responseSource,
    },
    lead,
    transcript,
    summary: {
      conversation_summary: lead.conversation_summary,
      lead_fields_needed: result.leadFieldsNeeded,
    },
  };
}

async function postLeadWebhook(webhookUrl, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    return await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function buildReply(message, lead, transcript) {
  const lower = message.toLowerCase();

  if (isEmergency(lower)) {
    return {
      replyText:
        "If this is an emergency or you need immediate medical help, please call 911 or seek urgent medical care right away. Once you're safe, I can still help explain the firm's intake process.",
      qualificationPath: "review",
      requestContactCapture: false,
      offerConsultLink: false,
      leadFieldsNeeded: [],
      responseSource: "guardrail",
      fallbackReason: "",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await buildOpenAIReply(message, lead, transcript);
    } catch (error) {
      console.error("OpenAI /api/evie fallback:", error);
      return buildUnavailableReply(lead, "openai_runtime_error");
    }
  }

  return buildUnavailableReply(lead, "missing_openai_api_key");
}

async function buildOpenAIReply(message, lead, transcript) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      instructions: buildOpenAIInstructions(lead),
      input: buildConversationInput(transcript),
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "evie_response",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              reply_text: { type: "string" },
              qualification_path: {
                type: "string",
                enum: ["qualified", "review"],
              },
              request_contact_capture: { type: "boolean" },
              offer_consult_link: { type: "boolean" },
              lead_fields_needed: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "visitor_name",
                    "visitor_phone",
                    "visitor_email",
                    "incident_state",
                    "incident_type",
                    "injury_summary",
                    "medical_treatment_status",
                  ],
                },
              },
            },
            required: [
              "reply_text",
              "qualification_path",
              "request_contact_capture",
              "offer_consult_link",
              "lead_fields_needed",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API returned ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const parsed = parseOpenAIStructuredResponse(payload);

  const offerConsultLink = parsed.offer_consult_link;
  const cleanReplyText = sanitizeReplyText(parsed.reply_text);
  const replyText = offerConsultLink && !cleanReplyText.includes(CONSULT_LINK)
    ? `${cleanReplyText} ${CONSULT_LINK}`
    : cleanReplyText;

  return {
    replyText,
    qualificationPath: parsed.qualification_path,
    requestContactCapture: parsed.request_contact_capture,
    offerConsultLink,
    leadFieldsNeeded: parsed.lead_fields_needed,
    responseSource: "openai",
    fallbackReason: "",
  };
}

function buildOpenAIInstructions(lead) {
  return [
    "You are generating the next response for Evie, a helpful-first Georgia personal injury website intake assistant.",
    "Return only JSON matching the provided schema.",
    "Be conversational and specific. Do not sound like a decision tree.",
    "Write only Evie's next turn. Do not script user replies, future turns, or mini-transcripts.",
    "Do not include prefixes like 'User:' or 'Evie:' in reply_text.",
    "Ask at most one intake question in a single reply.",
    "Never use generic assistant filler like 'How can I assist you today?' unless the user is completely generic and even then keep it in Evie's law-firm voice.",
    "Answer the user's actual question first when possible.",
    "Do not reset to a generic opener after factual follow-up answers.",
    "Do not over-push qualification or contact capture.",
    "If the user asks whether the firm handles a scenario, answer that directly before anything else.",
    "If the user provides a location outside Georgia, acknowledge that fact explicitly and adjust the response accordingly.",
    "If the incident is outside Georgia, gently explain that the firm reviews Georgia matters and do not push contact capture unless something else sounds unusually compelling.",
    "If the matter is a routine out-of-state personal injury matter, do not continue ordinary intake after the scope issue is clear.",
    "Avoid vague acknowledgments like 'That helps' unless immediately followed by a concrete next step or reason.",
    "Do not give legal advice, guarantees, or exact strategy.",
    "Only offer the consultation link after the matter appears likely qualified and after contact information has been collected or politely attempted.",
    "Do not provide the consultation link in the same reply where you first ask for contact information.",
    "Do not offer the consultation link immediately just because the user asks for it.",
    "If the user asks for the consultation link before describing the matter, ask a short qualification question sequence first.",
    "If the matter is weaker or unclear, stay helpful and say the firm can review.",
    "If the user just gave contact information or a factual intake answer, acknowledge it naturally and continue.",
    "Do not mention internal scoring, hidden rules, or qualification criteria.",
    `Current extracted lead record:\n${JSON.stringify(lead, null, 2)}`,
    `Prompt package:\n${getPromptBundle()}`,
  ].join("\n\n");
}

function buildConversationInput(transcript) {
  const formattedTranscript = transcript
    .map((entry) => `${entry.role === "assistant" ? "Evie" : "User"}: ${entry.content}`)
    .join("\n");

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "Continue this conversation as Evie. The transcript below is authoritative.\n\n" +
            formattedTranscript,
        },
      ],
    },
  ];
}

function parseOpenAIStructuredResponse(payload) {
  const outputText =
    (typeof payload.output_text === "string" && payload.output_text) ||
    payload.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || "")
      ?.join("")
      ?.trim();

  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(outputText);
}

function sanitizeReplyText(replyText) {
  const text = typeof replyText === "string" ? replyText.trim() : "";
  if (!text) {
    return "";
  }

  const simulatedTurnIndex = text.search(/\b(?:User|Evie):/);
  const withoutTranscript =
    simulatedTurnIndex > 0 ? text.slice(0, simulatedTurnIndex).trim() : text;

  return withoutTranscript.replace(/\s+/g, " ").trim();
}

function collectMissingLeadFields(lead) {
  const missing = [];
  if (!lead.visitor_name) missing.push("visitor_name");
  if (!lead.visitor_phone) missing.push("visitor_phone");
  if (!lead.visitor_email) missing.push("visitor_email");
  if (!lead.incident_state) missing.push("incident_state");
  if (lead.incident_type === "unknown") missing.push("incident_type");
  if (!lead.injury_summary) missing.push("injury_summary");
  if (lead.medical_treatment_status === "unknown") missing.push("medical_treatment_status");
  return missing;
}

function detectQualification(input) {
  let score = 0;
  if (input.incidentState === "Georgia") score += 2;
  if (input.incidentType !== "unknown") score += 1;
  if (input.injurySummary) score += 1;
  if (input.medicalTreatmentStatus === "same_day_treatment") score += 2;
  if (input.medicalTreatmentStatus === "delayed_treatment") score += 1;
  if (input.medicalTreatmentStatus === "no_treatment") score -= 1;
  if (input.commercialVehicleInvolved === "yes") score += 2;
  if (/broken|fracture|surgery|hospital|nursing home/.test(input.lower)) score += 2;
  if (/minor soreness|sore for a few days|property damage only/.test(input.lower)) score -= 2;
  return score >= 4 ? "qualified" : "review";
}

function detectState(lower) {
  if (lower.includes("georgia") || /\bga\b/.test(lower)) return "Georgia";
  if (/\batlanta\b/.test(lower)) return "Georgia";
  if (lower.includes("florida")) return "Florida";
  if (lower.includes("alabama")) return "Alabama";
  if (lower.includes("south carolina")) return "South Carolina";
  if (lower.includes("north carolina")) return "North Carolina";
  if (lower.includes("tennessee")) return "Tennessee";
  return "";
}

function detectCity(text) {
  const withComma = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*(Georgia|GA|Florida|Alabama|Tennessee|South Carolina|North Carolina)\b/);
  if (withComma) {
    return withComma[1];
  }

  const withoutComma = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(Georgia|GA|Florida|Alabama|Tennessee|South Carolina|North Carolina)\b/);
  if (withoutComma) {
    return withoutComma[1];
  }

  if (/\batlanta\b/i.test(text)) {
    return "Atlanta";
  }

  return "";
}

function detectIncidentType(lower) {
  if (lower.includes("nursing home")) return "nursing_home_abuse";
  if (/truck|semi|delivery vehicle/.test(lower)) return "truck_accident";
  if (/car accident|car crash|rear-ended|collision/.test(lower)) return "car_accident";
  if (/slip|fall/.test(lower)) return "slip_and_fall";
  if (lower.includes("motorcycle")) return "motorcycle_accident";
  if (lower.includes("pedestrian")) return "pedestrian_accident";
  if (lower.includes("wrongful death")) return "wrongful_death";
  return "unknown";
}

function detectInjuries(lower) {
  const patterns = [
    ["broken wrist", /broken wrist|broke (?:my |a )?wrist/],
    ["broken arm", /broken arm|broke (?:my |an |a )?arm/],
    ["broken leg", /broken leg|broke (?:my |a )?leg/],
    ["fracture", /\bfracture\b/],
    ["fractured arm", /fractured (?:my |an |a )?arm/],
    ["fractured leg", /fractured (?:my |a )?leg/],
    ["fractured ankle", /fractured (?:my |an |a )?ankle/],
    ["sprained ankle", /sprained ankle|ankle sprain/],
    ["laceration", /laceration|lacerations/],
    ["cuts", /cuts|cut on my|cut on her|cut on his/],
    ["back pain", /back pain/],
    ["neck pain", /neck pain/],
    ["brain injury", /brain injury|tbi/],
    ["concussion", /concussion/],
    ["deep cut", /deep cut/],
    ["spinal injuries", /spinal injuries|spine injury|back injury/],
    ["torn muscles", /torn muscles|muscle tear/],
  ];
  const injuries = patterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([label]) => label);

  return [...new Set(injuries)].join(", ");
}

function detectTreatment(lower) {
  if (/went to the er|went to er|hospital|same day|treated that day/.test(lower)) {
    return "same_day_treatment";
  }
  if (/follow-up|physical therapy|doctor later|urgent care later/.test(lower)) {
    return "delayed_treatment";
  }
  if (/no treatment|didn't get treatment|did not get treatment|did not seek treatment/.test(lower)) {
    return "no_treatment";
  }
  return "unknown";
}

function detectStillTreating(lower) {
  if (/still treating|still in treatment|ongoing treatment/.test(lower)) return "yes";
  if (/finished treatment|done treating/.test(lower)) return "no";
  return "unknown";
}

function detectCommercialVehicle(lower) {
  if (/commercial vehicle|delivery truck|work truck|18 wheeler|semi/.test(lower)) return "yes";
  if (lower.includes("not a commercial vehicle")) return "no";
  return "unknown";
}

function detectRepresented(lower) {
  if (/already have a lawyer|represented by an attorney/.test(lower)) return "yes";
  if (/do not have a lawyer|not represented/.test(lower)) return "no";
  return "unknown";
}

function detectContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "";
  const phone =
    text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";
  const explicitName =
    text.match(/(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/)?.[1] || "";
  const leadingName =
    text.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*,/)?.[1] || "";
  const name = explicitName || leadingName;
  return { name, phone, email };
}

function detectDateText(lower) {
  const phrases = [
    "today",
    "yesterday",
    "last week",
    "last month",
    "a month ago",
    "one month ago",
    "a year ago",
  ];
  return phrases.find((phrase) => lower.includes(phrase)) || "";
}

function detectImpact(lower) {
  const impacts = [];
  if (lower.includes("missed work")) impacts.push("missed work");
  if (/can't work|cannot work/.test(lower)) impacts.push("unable to work");
  if (lower.includes("daily activities")) impacts.push("daily activity impact");
  return impacts.join(", ");
}

function detectInsurance(lower) {
  if (/insurance claim|claim was opened/.test(lower)) return "claim_opened";
  if (lower.includes("adjuster")) return "insurance_contacted";
  return "";
}

function detectEvidence(lower) {
  const evidence = [];
  if (lower.includes("photo")) evidence.push("photos");
  if (lower.includes("report")) evidence.push("reports");
  if (lower.includes("video")) evidence.push("video");
  return evidence.join(", ");
}

function detectGoal(lower) {
  if (/consultation|consult|case review|free review|talk to a lawyer|speak with a lawyer/.test(lower)) {
    return "schedule_consultation";
  }
  if (/do i have a case|worth|value|compensation|settlement|should i sue/.test(lower)) {
    return "case_evaluation";
  }
  if (/what happens|next step|what should i do|deadline|statute|insurance|adjuster/.test(lower)) {
    return "legal_process_guidance";
  }
  if (/phone|call me|follow up|reach me/.test(lower)) {
    return "request_follow_up";
  }
  return "general_information";
}

function buildSummary(input) {
  const parts = [];
  if (input.incidentType !== "unknown") parts.push(`Visitor described a ${input.incidentType.replace(/_/g, " ")}`);
  if (input.incidentState) parts.push(`in ${input.incidentState}`);
  if (input.injurySummary) parts.push(`with injuries including ${input.injurySummary}`);
  if (input.medicalTreatmentStatus !== "unknown") {
    parts.push(`and treatment status ${input.medicalTreatmentStatus.replace(/_/g, " ")}`);
  }
  if (input.commercialVehicleInvolved === "yes") parts.push("with a commercial vehicle involved");
  return parts.join(" ");
}

function isEmergency(lower) {
  return /can't breathe|bleeding badly|emergency|call 911|immediate danger/.test(lower);
}

function buildUnavailableReply(lead, reason) {
  const leadFieldsNeeded = collectMissingLeadFields(lead);
  return {
    replyText:
      "I'm having trouble loading the full assistant right now. You can try again in a moment, or if you'd prefer, share your name, phone number, and email and the firm can follow up directly.",
    qualificationPath: lead.qualification_path,
    requestContactCapture: true,
    offerConsultLink: false,
    leadFieldsNeeded,
    responseSource: "temporary_unavailable",
    fallbackReason: reason,
  };
}
