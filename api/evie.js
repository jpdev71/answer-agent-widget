const fs = require("fs");
const { parseContact } = require("../lib/contact-parser");
const { buildGroundingBundle, getFirmRuntimeConfig } = require("../lib/firm-config");

let cachedVersion = "";
let cachedGroundingBundle = null;

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  const runtime = getFirmRuntimeConfig();
  const firm = runtime.config;
  const adapter = runtime.adapter;
  const promptVersion = getPromptVersion(firm);
  const groundingBundle = getGroundingBundle(firm, promptVersion);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      profile: runtime.selectedProfile,
      agent: firm.agent.name,
      welcome_message: firm.agent.welcomeMessage,
      mode: firm.practice.answerStyle || "helpful_first",
      firm: buildFirmResponseSummary(firm, runtime.validationWarnings),
      prompt_version: promptVersion,
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
  const transcript = appendCurrentUserMessage(history, message);
  const channel = body.channel === "voice" ? "voice" : "chat";
  const priorLead = extractLead(history, channel, firm, adapter);
  const lead = extractLead(transcript, channel, firm, adapter);
  const result = await buildReply(message, lead, transcript, firm, adapter, groundingBundle.text);
  const transcriptWithReply = [...transcript, { role: "assistant", content: result.replyText }];
  const webhookDelivery = await maybeDeliverLead({
    message,
    requestMeta,
    priorLead,
    lead,
    result,
    transcript: transcriptWithReply,
    firm,
  });

  res.status(200).json({
    reply_text: result.replyText,
    qualification_path: result.qualificationPath,
    request_contact_capture: result.requestContactCapture,
    offer_consult_link: result.offerConsultLink,
    consult_link: result.offerConsultLink ? firm.consult.link : "",
    lead_fields_needed: result.leadFieldsNeeded,
    response_source: result.responseSource,
    fallback_reason: result.fallbackReason || "",
    lead_record: lead,
    prompt_version: promptVersion,
    webhook_delivery: webhookDelivery,
    observability: buildObservabilityPayload(firm, runtime.validationWarnings, groundingBundle.summary),
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

function appendCurrentUserMessage(history, message) {
  const lastEntry = history[history.length - 1];
  if (
    lastEntry &&
    lastEntry.role === "user" &&
    lastEntry.content.trim() === message.trim()
  ) {
    return history;
  }

  return [...history, { role: "user", content: message }];
}

function getPromptVersion(firm) {
  let latest = 0;
  const promptPaths = (firm.grounding?.sources || [])
    .filter((source) => source.type !== "inline_text")
    .map((source) => source.path)
    .filter(Boolean);

  for (const promptPath of promptPaths) {
    const stats = fs.statSync(promptPath);
    latest = Math.max(latest, stats.mtimeMs);
  }

  cachedVersion = latest ? new Date(latest).toISOString() : new Date(0).toISOString();
  return cachedVersion;
}

function getGroundingBundle(firm, version) {
  if (
    cachedGroundingBundle &&
    cachedGroundingBundle.version === version &&
    cachedGroundingBundle.firmId === firm.id
  ) {
    return cachedGroundingBundle;
  }

  const bundle = buildGroundingBundle(firm);
  cachedGroundingBundle = {
    firmId: firm.id,
    version,
    text: bundle.text,
    summary: bundle.summary,
  };

  return cachedGroundingBundle;
}

function extractLead(transcript, channel, firm, adapter) {
  return adapter.createLead({ transcript, channel, firm });
}

async function maybeDeliverLead({ message, requestMeta, priorLead, lead, result, transcript, firm }) {
  const webhookUrl = readString(process.env.LEAD_WEBHOOK_URL);
  if (!webhookUrl) {
    return { attempted: false, delivered: false, reason: "missing_webhook_url" };
  }

  if (!shouldDeliverLead({ message, priorLead, lead, result, firm })) {
    return { attempted: false, delivered: false, reason: "conditions_not_met" };
  }

  const payload = buildLeadWebhookPayload({
    requestMeta,
    lead,
    result,
    transcript,
    firm,
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

function shouldDeliverLead({ message, priorLead, lead, result, firm }) {
  const hasRequiredLeadData = hasRequiredWebhookFields(lead, firm);
  const priorHadRequiredLeadData = hasRequiredWebhookFields(priorLead, firm);
  const becameWebhookReady = !priorHadRequiredLeadData && hasRequiredLeadData;

  if (result.responseSource !== "openai") {
    return false;
  }

  if (!becameWebhookReady) {
    return false;
  }

  return true;
}

function hasDeliverableContact(lead) {
  return Boolean(lead?.visitor_phone || lead?.visitor_email);
}

function hasRequiredWebhookFields(lead, firm) {
  if (!lead) {
    return false;
  }

  const requiredFields = getRequiredWebhookFields(firm);
  return requiredFields.every((field) => {
    const value = lead[field];
    return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
  });
}

function getRequiredWebhookFields(firm) {
  const configured = Array.isArray(firm?.webhook?.requiredFields)
    ? firm.webhook.requiredFields
    : [];

  if (configured.length > 0) {
    return configured;
  }

  return ["visitor_name", "visitor_phone", "visitor_email"];
}

function buildLeadWebhookPayload({ requestMeta, lead, result, transcript, firm }) {
  return {
    event_type: firm.webhook.eventType,
    delivered_at: new Date().toISOString(),
    firm_id: firm.id,
    firm_name: firm.name,
    agent_name: lead.agent_name,
    session_id: requestMeta.sessionId,
    source: {
      channel: lead.conversation_channel,
      lead_source: firm.webhook.leadSource || lead.lead_source,
      page_url: requestMeta.pageUrl,
      page_title: requestMeta.pageTitle,
    },
    routing: {
      qualification_path: result.qualificationPath,
      request_contact_capture: result.requestContactCapture,
      offer_consult_link: result.offerConsultLink,
      consult_link: result.offerConsultLink ? firm.consult.link : "",
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

async function buildReply(message, lead, transcript, firm, adapter, groundingText) {
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
      return await buildOpenAIReply(message, lead, transcript, firm, adapter, groundingText);
    } catch (error) {
      console.error("OpenAI /api/evie fallback:", error);
      return buildUnavailableReply(lead, "openai_runtime_error", firm, adapter);
    }
  }

  return buildUnavailableReply(lead, "missing_openai_api_key", firm, adapter);
}

async function buildOpenAIReply(message, lead, transcript, firm, adapter, groundingText) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      instructions: buildOpenAIInstructions(lead, firm, adapter, groundingText),
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
                enum: firm.qualification?.paths || ["qualified", "review"],
              },
              request_contact_capture: { type: "boolean" },
              offer_consult_link: { type: "boolean" },
              lead_fields_needed: {
                type: "array",
                items: {
                  type: "string",
                  enum: adapter.getLeadFieldsNeededEnum(firm),
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
  const safeOfferConsultLink = Boolean(firm.consult?.enabled && offerConsultLink);
  const replyText =
    safeOfferConsultLink && !cleanReplyText.includes(firm.consult.link)
      ? `${cleanReplyText} ${firm.consult.link}`
      : cleanReplyText;

  return {
    replyText,
    qualificationPath: parsed.qualification_path,
    requestContactCapture: parsed.request_contact_capture,
    offerConsultLink: safeOfferConsultLink,
    leadFieldsNeeded: parsed.lead_fields_needed,
    responseSource: "openai",
    fallbackReason: "",
  };
}

function buildOpenAIInstructions(lead, firm, adapter, groundingText) {
  return [
    `You are generating the next response for ${firm.agent.name}, a helpful-first website intake assistant for ${firm.name}.`,
    "Return only JSON matching the provided schema.",
    "Be conversational and specific. Do not sound like a decision tree.",
    "Write only Evie's next turn. Do not script user replies, future turns, or mini-transcripts.",
    "Do not include prefixes like 'User:' or 'Evie:' in reply_text.",
    "Ask at most one intake question in a single reply.",
    "Answer the user's actual question first when possible.",
    "Do not reset to a generic opener after factual follow-up answers.",
    "Do not over-push qualification or contact capture.",
    "If the user asks whether the firm handles a scenario, answer that directly before anything else.",
    "Use grounded firm facts when available for firm-specific questions such as location, attorneys, practice areas, contact process, and consultation details.",
    "If a user asks for a firm-specific fact that is not grounded here, do not guess. Say you do not want to guess and offer the next best step.",
    "Avoid vague acknowledgments like 'That helps' unless immediately followed by a concrete next step or reason.",
    "Do not give legal advice, guarantees, or exact strategy.",
    "If the user just gave contact information or a factual intake answer, acknowledge it naturally and continue.",
    "Do not mention internal scoring, hidden rules, or qualification criteria.",
    ...adapter.getPromptRuntimeRules(firm),
    `Current firm config:\n${JSON.stringify(buildPromptFirmSummary(firm), null, 2)}`,
    `Current extracted lead record:\n${JSON.stringify(lead, null, 2)}`,
    `Prompt package:\n${groundingText}`,
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

function detectContact(text) {
  return parseContact(text);
}

function isEmergency(lower) {
  return /can't breathe|bleeding badly|emergency|call 911|immediate danger/.test(lower);
}

function buildUnavailableReply(lead, reason, firm, adapter) {
  const leadFieldsNeeded = adapter.collectMissingLeadFields(lead, firm);
  return {
    replyText:
      "I'm having trouble loading the full assistant right now. You can try again in a moment, or if you'd prefer, share your name, phone number, and email and the firm can follow up directly.",
    qualificationPath: lead.qualification_path || "review",
    requestContactCapture: true,
    offerConsultLink: false,
    leadFieldsNeeded,
    responseSource: "temporary_unavailable",
    fallbackReason: reason,
  };
}

function buildFirmResponseSummary(firm, validationWarnings) {
  return {
    id: firm.id,
    name: firm.name,
    agent_name: firm.agent.name,
    regions_served: firm.practice.regionsServed,
    practice_areas: firm.practice.practiceAreas,
    adapter_path: firm.intake?.adapterPath || "",
    consult_enabled: Boolean(firm.consult?.enabled),
    validation_warnings: validationWarnings,
  };
}

function buildObservabilityPayload(firm, validationWarnings, groundingSummary) {
  const payload = {};

  if (firm.observability?.includeConfigSummary) {
    payload.firm = {
      id: firm.id,
      name: firm.name,
      agent_name: firm.agent.name,
      regions_served: firm.practice.regionsServed,
      practice_areas: firm.practice.practiceAreas,
      adapter_path: firm.intake?.adapterPath || "",
    };
  }

  if (firm.observability?.includeGroundingSummary) {
    payload.grounding_sources = groundingSummary;
  }

  if (firm.observability?.includeValidationWarnings) {
    payload.validation_warnings = validationWarnings;
  }

  return payload;
}

function buildPromptFirmSummary(firm) {
  return {
    id: firm.id,
    name: firm.name,
    agent_name: firm.agent.name,
    regions_served: firm.practice.regionsServed,
    practice_areas: firm.practice.practiceAreas,
    out_of_state_policy: firm.practice.outOfStatePolicy,
    qualification_paths: firm.qualification?.paths || ["qualified", "review"],
    consult: {
      enabled: Boolean(firm.consult?.enabled),
      requires_qualification: Boolean(firm.consult?.requiresQualification),
      requires_contact_capture: Boolean(firm.consult?.requiresContactCapture),
      link: firm.consult?.link || "",
    },
    intake: {
      response_lead_fields_needed: firm.intake?.responseLeadFieldsNeeded || [],
    },
  };
}
