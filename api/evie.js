const crypto = require("crypto");
const fs = require("fs");
const { parseContact } = require("../lib/contact-parser");
const { buildGroundingBundle, getFirmRuntimeConfig } = require("../lib/firm-config");

let cachedVersion = "";
let cachedGroundingBundle = null;
let cachedBuildInfo = null;

async function handler(req, res) {
  setCorsHeaders(res);
  const runtimeState = getEvieRuntimeState();

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json(buildEvieConfigResponse(runtimeState));
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const payload = await processEvieTurn(req.body, runtimeState);
    res.status(200).json(payload);
  } catch (error) {
    res.status(error?.statusCode || 500).json({ error: error?.message || "Unexpected error." });
  }
}

module.exports = handler;
module.exports.processEvieTurn = processEvieTurn;
module.exports.buildEvieConfigResponse = buildEvieConfigResponse;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getEvieRuntimeState() {
  const runtime = getFirmRuntimeConfig();
  const firm = runtime.config;
  const adapter = runtime.adapter;
  const promptBuild = getPromptBuild(firm);
  const promptVersion = promptBuild.version;
  const groundingBundle = getGroundingBundle(firm, promptVersion);
  const voicePreview = getVoicePreviewConfig(firm);

  return {
    runtime,
    firm,
    adapter,
    promptBuild,
    promptVersion,
    groundingBundle,
    voicePreview,
  };
}

function buildEvieConfigResponse(runtimeState = getEvieRuntimeState()) {
  return {
    ok: true,
    profile: runtimeState.runtime.selectedProfile,
    agent: runtimeState.firm.agent.name,
    welcome_message: runtimeState.firm.agent.welcomeMessage,
    mode: runtimeState.firm.practice.answerStyle || "helpful_first",
    firm: buildFirmResponseSummary(
      runtimeState.firm,
      runtimeState.runtime.validationWarnings,
    ),
    prompt_version: runtimeState.promptVersion,
    live_build: buildLiveBuildResponse(runtimeState.promptBuild),
    voice_preview: runtimeState.voicePreview,
  };
}

async function processEvieTurn(bodyInput, runtimeState = getEvieRuntimeState()) {
  const requestStartedAt = Date.now();
  const { runtime, firm, adapter, promptBuild, promptVersion, groundingBundle, voicePreview } =
    runtimeState;
  const body = parseBody(bodyInput);
  const message = readString(body.message);
  if (!message) {
    throw createHttpError(400, "A message is required.");
  }

  const requestMeta = extractRequestMeta(body);
  const voiceMeta = extractVoiceMeta(body.voice_meta);
  const history = normalizeHistory(body.conversation_history);
  const historyBeforeCurrentMessage = removeTrailingCurrentUserMessage(history, message);
  const transcript = appendCurrentUserMessage(history, message);
  const channel = body.channel === "voice" ? "voice" : "chat";
  const priorLead = extractLead(historyBeforeCurrentMessage, channel, firm, adapter);
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
  const latencyMs = Date.now() - requestStartedAt;

  return {
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
    observability: buildObservabilityPayload(
      firm,
      runtime.validationWarnings,
      groundingBundle.summary,
      promptBuild,
      {
        message,
        transcript: transcriptWithReply,
        channel,
        requestMeta,
        voiceMeta,
        latencyMs,
        result,
        webhookDelivery,
        voicePreview,
      },
    ),
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

function extractVoiceMeta(voiceMeta) {
  if (!voiceMeta || typeof voiceMeta !== "object") {
    return {};
  }

  return {
    input_mode: readString(voiceMeta.input_mode),
    stt_provider: readString(voiceMeta.stt_provider),
    tts_provider: readString(voiceMeta.tts_provider),
    transport: readString(voiceMeta.transport),
    utterance_mode: readString(voiceMeta.utterance_mode),
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

function removeTrailingCurrentUserMessage(history, message) {
  const lastEntry = history[history.length - 1];
  if (
    lastEntry &&
    lastEntry.role === "user" &&
    lastEntry.content.trim() === message.trim()
  ) {
    return history.slice(0, -1);
  }

  return history;
}

function getPromptBuild(firm) {
  const inputs = buildPromptBuildInputs(firm);
  const fingerprint = buildHash(inputs);
  const version = `${firm.id}:${fingerprint.slice(0, 12)}`;

  if (
    cachedBuildInfo &&
    cachedBuildInfo.firmId === firm.id &&
    cachedBuildInfo.fingerprint === fingerprint
  ) {
    cachedVersion = cachedBuildInfo.version;
    return cachedBuildInfo;
  }

  const buildInfo = {
    firmId: firm.id,
    version,
    fingerprint,
    inputCount: inputs.length,
    inputs,
  };

  cachedVersion = version;
  cachedBuildInfo = buildInfo;
  return buildInfo;
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

function getVoicePreviewConfig(firm) {
  const globalEnabled = readBooleanEnv(process.env.EVIE_VOICE_PREVIEW_ENABLED);
  const previewFirmIds = readCsvEnv(
    process.env.EVIE_VOICE_PREVIEW_FIRM_IDS || "dermer-appel-ruder",
  );
  const currentFirmEnabled = globalEnabled && previewFirmIds.includes(firm.id);
  const hasElevenLabsRuntime =
    Boolean(readString(process.env.ELEVENLABS_API_KEY)) &&
    Boolean(readString(process.env.ELEVENLABS_AGENT_ID));

  return {
    enabled: globalEnabled,
    current_firm_enabled: currentFirmEnabled,
    reason: globalEnabled
      ? currentFirmEnabled
        ? "preview_enabled"
        : "firm_not_in_preview"
      : "flag_disabled",
    preview_firm_ids: previewFirmIds,
    transport: hasElevenLabsRuntime ? "elevenlabs_widget" : "browser_native",
    utterance_mode: hasElevenLabsRuntime ? "managed_turn_taking" : "single_turn",
    stt_provider: hasElevenLabsRuntime ? "elevenlabs" : "browser_speech_recognition",
    tts_provider: hasElevenLabsRuntime ? "elevenlabs" : "browser_speech_synthesis",
  };
}

function buildPromptBuildInputs(firm) {
  const promptSnapshot = {
    firm_id: firm.id,
    firm_name: firm.name,
    consult_enabled: Boolean(firm.consult?.enabled),
    consult_requires_qualification: Boolean(firm.consult?.requiresQualification),
    consult_requires_contact_capture: Boolean(firm.consult?.requiresContactCapture),
    webhook_delivery_mode: readString(firm.webhook?.deliveryMode),
    response_lead_fields_needed: Array.isArray(firm.intake?.responseLeadFieldsNeeded)
      ? firm.intake.responseLeadFieldsNeeded
      : [],
    contact_field_order: Array.isArray(firm.intake?.contactFieldOrder)
      ? firm.intake.contactFieldOrder
      : [],
    runtime_rules: Array.isArray(firm.prompt?.runtimeRules) ? firm.prompt.runtimeRules : [],
    extra_instructions: Array.isArray(firm.prompt?.extraInstructions)
      ? firm.prompt.extraInstructions
      : [],
  };

  const inputs = [
    buildInlineBuildInput("firm-config", promptSnapshot),
  ];

  const sharedContext = Array.isArray(firm.prompt?.sharedContext) ? firm.prompt.sharedContext : [];
  for (const entry of sharedContext) {
    const label = readString(entry?.label) || readString(entry?.id) || "shared-context";
    inputs.push(buildFileBuildInput(`shared:${label}`, readString(entry?.path)));
  }

  if (readString(firm.intake?.adapterPath)) {
    inputs.push(buildFileBuildInput("adapter", readString(firm.intake.adapterPath)));
  }

  const groundingSources = Array.isArray(firm.grounding?.sources) ? firm.grounding.sources : [];
  for (const source of groundingSources) {
    const label = readString(source?.label) || readString(source?.id) || "grounding-source";
    if (source?.type === "inline_text") {
      inputs.push(buildInlineBuildInput(`grounding:${label}`, readString(source?.text)));
      continue;
    }

    inputs.push(buildFileBuildInput(`grounding:${label}`, readString(source?.path)));
  }

  return inputs;
}

function buildInlineBuildInput(label, value) {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return {
    label,
    kind: "inline",
    size: content.length,
    content_hash: buildHash(content),
  };
}

function buildFileBuildInput(label, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      label,
      kind: "file",
      path: filePath || "",
      missing: true,
      content_hash: "",
      size: 0,
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  return {
    label,
    kind: "file",
    path: filePath,
    missing: false,
    size: Buffer.byteLength(content, "utf8"),
    content_hash: buildHash(content),
  };
}

function extractLead(transcript, channel, firm, adapter) {
  return adapter.createLead({ transcript, channel, firm });
}

async function maybeDeliverLead({ message, requestMeta, priorLead, lead, result, transcript, firm }) {
  const webhookUrl = readString(process.env.LEAD_WEBHOOK_URL);
  if (!webhookUrl) {
    return { attempted: false, delivered: false, reason: "missing_webhook_url" };
  }

  const deliveryDecision = getWebhookDeliveryDecision({ message, priorLead, lead, result, firm });
  if (!deliveryDecision.shouldDeliver) {
    return { attempted: false, delivered: false, reason: deliveryDecision.reason || "conditions_not_met" };
  }

  const payload = buildLeadWebhookPayload({
    requestMeta,
    lead,
    priorLead,
    result,
    transcript,
    firm,
    deliveryDecision,
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

function getWebhookDeliveryDecision({ message, priorLead, lead, result, firm }) {
  const deliveryMode = getWebhookDeliveryMode(firm);

  if (result.responseSource !== "openai") {
    return { shouldDeliver: false, reason: "non_openai_response" };
  }

  switch (deliveryMode) {
    case "every_openai_turn":
      return { shouldDeliver: true, reason: "openai_turn" };
    case "email_capture":
      return getEmailCaptureDecision(priorLead, lead, result);
    case "contact_update":
      return getContactUpdateDecision(priorLead, lead, firm);
    case "required_fields_ready":
    default: {
      const hasRequiredLeadData = hasRequiredWebhookFields(lead, firm);
      const priorHadRequiredLeadData = hasRequiredWebhookFields(priorLead, firm);
      return {
        shouldDeliver: !priorHadRequiredLeadData && hasRequiredLeadData,
        reason: !priorHadRequiredLeadData && hasRequiredLeadData ? "required_fields_ready" : "conditions_not_met",
      };
    }
  }
}

function hasDeliverableContact(lead) {
  return Boolean(lead?.visitor_phone || lead?.visitor_email);
}

function getEmailCaptureDecision(priorLead, lead, result) {
  const priorEmail = normalizeLeadValue(priorLead?.visitor_email);
  const currentEmail = normalizeLeadValue(lead?.visitor_email);
  const isContactFlowActive = Boolean(
    result?.requestContactCapture ||
    lead?.follow_up_recommended ||
    normalizeLeadValue(lead?.visitor_name) ||
    normalizeLeadValue(lead?.visitor_phone),
  );

  if (!currentEmail) {
    return { shouldDeliver: false, reason: "email_not_captured" };
  }

  if (!isContactFlowActive) {
    return { shouldDeliver: false, reason: "email_without_contact_flow" };
  }

  if (priorEmail === currentEmail) {
    return { shouldDeliver: false, reason: "email_already_delivered" };
  }

  return {
    shouldDeliver: true,
    reason: priorEmail ? "email_changed" : "email_captured",
  };
}

function getContactUpdateDecision(priorLead, lead, firm) {
  const currentState = buildDeliveryState(lead, firm);
  const previousState = buildDeliveryState(priorLead, firm);

  if (!currentState.hasDeliverableContact) {
    return { shouldDeliver: false, reason: "no_deliverable_contact" };
  }

  if (!previousState.hasDeliverableContact) {
    return { shouldDeliver: true, reason: "first_contact_captured" };
  }

  if (currentState.contactFingerprint !== previousState.contactFingerprint) {
    return { shouldDeliver: true, reason: "contact_fields_changed" };
  }

  if (
    currentState.qualificationPath &&
    currentState.qualificationPath !== previousState.qualificationPath
  ) {
    return { shouldDeliver: true, reason: "qualification_changed" };
  }

  if (currentState.requiredFieldsComplete && !previousState.requiredFieldsComplete) {
    return { shouldDeliver: true, reason: "required_fields_completed" };
  }

  return { shouldDeliver: false, reason: "no_meaningful_lead_change" };
}

function buildDeliveryState(lead, firm) {
  const contactSnapshot = {
    visitor_name: normalizeLeadValue(lead?.visitor_name),
    visitor_phone: normalizeLeadValue(lead?.visitor_phone),
    visitor_email: normalizeLeadValue(lead?.visitor_email),
  };

  return {
    hasDeliverableContact: Boolean(contactSnapshot.visitor_phone || contactSnapshot.visitor_email),
    contactFingerprint: buildHash(contactSnapshot),
    qualificationPath: normalizeLeadValue(lead?.qualification_path),
    requiredFieldsComplete: hasRequiredWebhookFields(lead, firm),
  };
}

function normalizeLeadValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function getWebhookDeliveryMode(firm) {
  const configuredMode = readString(firm?.webhook?.deliveryMode);
  if (configuredMode) {
    return configuredMode;
  }

  return "required_fields_ready";
}

function getMissingRequiredWebhookFields(lead, firm) {
  return getRequiredWebhookFields(firm).filter((field) => {
    const value = lead?.[field];
    return typeof value === "string" ? !value.trim() : !value;
  });
}

function getContactFieldOrder(firm) {
  const configured = Array.isArray(firm?.intake?.contactFieldOrder)
    ? firm.intake.contactFieldOrder
    : [];

  if (configured.length > 0) {
    return configured;
  }

  return ["visitor_name", "visitor_phone", "visitor_email"];
}

function getMissingContactFields(lead, firm) {
  return getContactFieldOrder(firm).filter((field) => {
    const value = lead?.[field];
    return typeof value === "string" ? !value.trim() : !value;
  });
}

function shouldForceRequiredFieldFollowUp(lead, missingRequiredFields) {
  if (!lead?.follow_up_recommended) {
    return false;
  }

  if (missingRequiredFields.length === 0) {
    return false;
  }

  return Boolean(lead.visitor_name || lead.visitor_phone || lead.visitor_email);
}

function shouldForceContactFieldFollowUp(lead, firm, requestContactCapture, message) {
  if (!requestContactCapture) {
    return false;
  }

  if (shouldPauseContactCaptureForUserQuestion(message, lead)) {
    return false;
  }

  return getMissingContactFields(lead, firm).length > 0;
}

function buildRequiredFieldFollowUpReply(field) {
  switch (field) {
    case "visitor_email":
      return "Thank you. Could you also share your email address? That will help the firm follow up with you.";
    case "visitor_phone":
      return "Thank you. Could you also share the best phone number to reach you?";
    case "visitor_name":
      return "Thank you. Could you also share your full name so the firm can note it correctly?";
    case "preferred_callback_time":
      return "Thank you. What would be the best time for a follow-up call?";
    default:
      return "Thank you. Could you also share that last detail so the firm can follow up?";
  }
}

function maybeBuildAlreadyCapturedFieldReply(message, lead, firm) {
  const lower = readString(message).toLowerCase();
  if (!lower) {
    return "";
  }

  const isClarifyingPriorCapture =
    /\bi thought i (?:already )?(?:provided|gave|sent|shared)\b/.test(lower) ||
    /\bdid you not get it\b/.test(lower) ||
    /\bdidn'?t you get it\b/.test(lower) ||
    /\byou already have it\b/.test(lower) ||
    /\bi already (?:gave|sent|shared) (?:that|it)\b/.test(lower);

  if (!isClarifyingPriorCapture) {
    return "";
  }

  const hasName = Boolean(normalizeLeadValue(lead?.visitor_name));
  const hasPhone = Boolean(normalizeLeadValue(lead?.visitor_phone));
  const hasEmail = Boolean(normalizeLeadValue(lead?.visitor_email));

  const likelyRefersToPhone =
    hasPhone &&
    !/\bemail\b/.test(lower) &&
    (/\bphone\b/.test(lower) || /\bnumber\b/.test(lower) || !hasEmail);

  if (!likelyRefersToPhone) {
    return "";
  }

  const nextMissingContactField = getMissingContactFields(lead, firm).find(
    (field) => field !== "visitor_phone",
  );

  if (nextMissingContactField === "visitor_email") {
    return "I did get your phone number, thank you. Could you also share your email address so the firm can follow up with you?";
  }

  if (nextMissingContactField === "visitor_name") {
    return "I did get your phone number, thank you. Could you also share your full name so the firm can note it correctly?";
  }

  if (hasName && hasPhone && hasEmail) {
    return "I did get your phone number, thank you.";
  }

  return "I did get your phone number, thank you.";
}

function shouldPauseContactCaptureForUserQuestion(message, lead) {
  const lower = readString(message).toLowerCase();
  if (!lower) {
    return false;
  }

  const contactFlowActive = Boolean(
    normalizeLeadValue(lead?.visitor_name) ||
    normalizeLeadValue(lead?.visitor_phone) ||
    normalizeLeadValue(lead?.visitor_email),
  );

  if (!contactFlowActive) {
    return false;
  }

  const likelyProcessQuestion =
    /\bwhat happens\b/.test(lower) ||
    /\bhow does\b/.test(lower) ||
    /\btypical\b/.test(lower) ||
    /\bcan we talk\b/.test(lower) ||
    /\btell me (?:a little )?more\b/.test(lower) ||
    /\bwhat might happen\b/.test(lower) ||
    /\binjury case\b/.test(lower) ||
    /\bcase like this\b/.test(lower) ||
    /\bwhat should i expect\b/.test(lower) ||
    /\bhow long\b/.test(lower);

  const containsRequestedContactDetail = Boolean(detectContact(message)?.phone || detectContact(message)?.email);

  return likelyProcessQuestion && !containsRequestedContactDetail;
}

function shouldAnswerScenarioQuestionBeforeContactCapture(message, lead) {
  const lower = readString(message).toLowerCase();
  if (!lower) {
    return false;
  }

  const contactFlowActive = Boolean(
    normalizeLeadValue(lead?.visitor_name) ||
    normalizeLeadValue(lead?.visitor_phone) ||
    normalizeLeadValue(lead?.visitor_email),
  );

  if (contactFlowActive) {
    return false;
  }

  const asksForHelpOrFit =
    /\bcould (?:the )?firm help\b/.test(lower) ||
    /\bcan (?:the )?firm help\b/.test(lower) ||
    /\bis that something (?:the )?firm could help with\b/.test(lower) ||
    /\bdo you handle\b/.test(lower);

  const asksForNextStepsOrProcess =
    /\bnext steps\b/.test(lower) ||
    /\bwhat should i do next\b/.test(lower) ||
    /\bwhat would (?:be|the) next steps\b/.test(lower) ||
    /\bwhat happens\b/.test(lower) ||
    /\bwhat would happen\b/.test(lower);

  const describesPotentialMatter =
    /\baccident\b/.test(lower) ||
    /\bcrosswalk\b/.test(lower) ||
    /\bran a stop sign\b/.test(lower) ||
    /\bhit me\b/.test(lower) ||
    /\binjured\b/.test(lower) ||
    /\bpedestrian\b/.test(lower);

  return (asksForHelpOrFit || asksForNextStepsOrProcess) && describesPotentialMatter;
}

function buildScenarioQuestionAnswerFirstReply(lead, firm) {
  const stateText = normalizeLeadValue(lead?.incident_state);
  const stateClause = stateText
    ? ` If this happened in ${stateText}, it sounds like the kind of personal injury matter the firm may be able to review.`
    : " If this happened in Georgia, it sounds like the kind of personal injury matter the firm may be able to review.";

  return (
    "Yes, that sounds like the kind of injury scenario the firm may be able to help with." +
    stateClause +
    " Typical next steps are to get medical care, document what happened, keep records of treatment and expenses, and be careful about detailed insurance statements before the facts are reviewed." +
    " If you'd like, I can ask one short question about where it happened or whether you got medical treatment."
  );
}

function buildLeadWebhookPayload({ requestMeta, lead, priorLead, result, transcript, firm, deliveryDecision }) {
  const currentDeliveryState = buildDeliveryState(lead, firm);
  const previousDeliveryState = buildDeliveryState(priorLead, firm);
  const transcriptFingerprint = buildHash(
    transcript.map((entry) => `${entry.role}:${entry.content}`).join("\n"),
  );
  const lastUserMessage = [...transcript].reverse().find((entry) => entry.role === "user")?.content || "";
  const eventId = buildHash({
    session_id: requestMeta.sessionId || "no-session",
    firm_id: firm.id,
    reason: deliveryDecision.reason,
    lead_hash: currentDeliveryState.contactFingerprint,
    qualification_path: currentDeliveryState.qualificationPath,
    transcript_hash: transcriptFingerprint,
  });

  return {
    event_type: firm.webhook.eventType,
    event_id: eventId,
    delivered_at: new Date().toISOString(),
    firm_id: firm.id,
    firm_name: firm.name,
    firm_profile: firm.id,
    agent_name: lead.agent_name,
    session_id: requestMeta.sessionId,
    source: {
      channel: lead.conversation_channel,
      lead_source: firm.webhook.leadSource || lead.lead_source,
      page_url: requestMeta.pageUrl,
      page_title: requestMeta.pageTitle,
    },
    delivery: {
      mode: getWebhookDeliveryMode(firm),
      trigger_reason: deliveryDecision.reason,
      has_deliverable_contact: currentDeliveryState.hasDeliverableContact,
      required_fields_complete: currentDeliveryState.requiredFieldsComplete,
      lead_fingerprint: currentDeliveryState.contactFingerprint,
      prior_lead_fingerprint: previousDeliveryState.contactFingerprint,
      conversation_hash: transcriptFingerprint,
      conversation_turn_index: transcript.length,
      last_user_message: lastUserMessage,
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

  if (isConsultationCostQuestion(lower)) {
    return buildConsultationCostReply(lead, firm, adapter);
  }

  if (shouldUseNoOnlineBookingGuard(lower, firm)) {
    return buildNoOnlineBookingReply(lead, firm, adapter);
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
  const missingRequiredFields = getMissingRequiredWebhookFields(lead, firm);
  const missingContactFields = getMissingContactFields(lead, firm);

  const offerConsultLink = parsed.offer_consult_link;
  const cleanReplyText = sanitizeReplyText(parsed.reply_text);
  const safeOfferConsultLink = Boolean(firm.consult?.enabled && offerConsultLink);
  let replyText =
    safeOfferConsultLink && !cleanReplyText.includes(firm.consult.link)
      ? `${cleanReplyText} ${firm.consult.link}`
      : cleanReplyText;
  let requestContactCapture = parsed.request_contact_capture;
  const alreadyCapturedFieldReply = maybeBuildAlreadyCapturedFieldReply(message, lead, firm);
  const answerScenarioFirst = shouldAnswerScenarioQuestionBeforeContactCapture(message, lead);

  if (answerScenarioFirst) {
    replyText = buildScenarioQuestionAnswerFirstReply(lead, firm);
    requestContactCapture = false;
  } else if (alreadyCapturedFieldReply) {
    replyText = alreadyCapturedFieldReply;
    requestContactCapture = getMissingContactFields(lead, firm).length > 0;
  } else if (shouldForceContactFieldFollowUp(lead, firm, requestContactCapture, message)) {
    replyText = buildRequiredFieldFollowUpReply(missingContactFields[0]);
    requestContactCapture = true;
  } else if (shouldForceRequiredFieldFollowUp(lead, missingRequiredFields)) {
    replyText = buildRequiredFieldFollowUpReply(missingRequiredFields[0]);
    requestContactCapture = true;
  }

  return {
    replyText,
    qualificationPath: parsed.qualification_path,
    requestContactCapture,
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
    "If the user describes a potential injury scenario and asks whether the firm could help or what the next steps would be, answer that fit-and-process question first before asking for contact details.",
    "If contact capture has started and the user pauses to ask a general question about process, timeline, or what typically happens, answer that question helpfully first instead of repeating the missing contact field immediately.",
    "After answering a mid-intake general question, you may return to the next missing contact field on a later turn rather than in the same sentence.",
    "If the user indicates they already provided a contact detail and the extracted lead record already contains it, acknowledge that you have it and move to the next missing field instead of asking for the same field again.",
    "If the user is asking only for firm information, answer it directly and do not start intake or contact capture unless they shift into their own matter.",
    "Pure firm-information questions include office location, phone number, attorneys, practice areas, consultation availability, consultation cost, contingency-fee messaging, and general contact process.",
    "Questions about whether the user can book, schedule, request, or arrange a consultation are still firm-information questions unless the user also starts describing their own matter.",
    "Questions about whether a consultation is free or what happens during a consultation are still pure firm-information questions unless the user also starts describing their own matter.",
    "For pure firm-information questions, do not ask for contact details, do not ask an intake question, and do not thank the user for information they did not provide.",
    "If a firm-information answer is complete, stop there instead of adding generic filler or an extra prompt to continue.",
    "Keep simple office, contact, attorney, consultation, and practice-area answers to one or two short sentences when possible.",
    "For complete firm-information answers, do not end with another question or an invitation to keep talking unless the user asked for a next step.",
    "Prefer plain spoken phrasing that sounds natural out loud.",
    "Keep attorney bio and staffing answers concise, and avoid stacking too many credentials or caveats into one response.",
    "If the user asks whether the firm handles a scenario, answer that directly before anything else.",
    "Use grounded firm facts when available for firm-specific questions such as location, attorneys, practice areas, contact process, and consultation details.",
    "If a user asks for a firm-specific fact that is not grounded here, do not guess. Say you do not want to guess and offer the next best step.",
    "Never invent office hours, turnaround times, availability, pricing, or booking mechanics that are not explicitly grounded.",
    "Avoid vague acknowledgments like 'That helps' unless immediately followed by a concrete next step or reason.",
    "Do not give legal advice, guarantees, or exact strategy.",
    "If the user just gave contact information or a factual intake answer, acknowledge it naturally and continue.",
    "Do not mention internal scoring, hidden rules, or qualification criteria.",
    ...adapter.getPromptRuntimeRules(firm),
    `Current firm config:\n${JSON.stringify(buildPromptFirmSummary(firm), null, 2)}`,
    `Current extracted lead record:\n${JSON.stringify(lead, null, 2)}`,
    `Grounded runtime bundle:\n${groundingText}`,
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

function shouldUseNoOnlineBookingGuard(lower, firm) {
  if (firm.consult?.enabled) {
    return false;
  }

  if (isConsultationInfoQuestion(lower)) {
    return false;
  }

  return /\b(book|schedule|appointment|meeting)\b/.test(lower)
    || /\b(set up|arrange|request)\b[\w\s]{0,30}\b(consult|consultation|meeting)\b/.test(lower)
    || /\b(consult|consultation)\s+(link|call|meeting)\b/.test(lower);
}

function isConsultationInfoQuestion(lower) {
  return /\bwhat happens\b[\w\s]{0,20}\bconsultation\b/.test(lower)
    || /\bhow does\b[\w\s]{0,20}\bconsultation\b/.test(lower)
    || /\b(is|are)\b[\w\s]{0,20}\bconsultation\b[\w\s]{0,20}\bfree\b/.test(lower)
    || /\bfree consultation\b/.test(lower)
    || /\bconsultation\b[\w\s]{0,20}\b(cost|price|pricing|fee)\b/.test(lower);
}

function isConsultationCostQuestion(lower) {
  return /\b(is|are)\b[\w\s]{0,20}\bconsultation\b[\w\s]{0,20}\bfree\b/.test(lower)
    || /\bfree consultation\b/.test(lower)
    || /\bconsultation\b[\w\s]{0,20}\b(cost|price|pricing|fee)\b/.test(lower)
    || /\bhow much\b[\w\s]{0,20}\bconsultation\b/.test(lower);
}

function buildConsultationCostReply(lead, firm, adapter) {
  const fallbackText = firm.consult?.costGrounded
    ? "The consultation details on the public site indicate that consultations are free."
    : "I don't want to guess about consultation cost or pricing here. The best next step is to contact the firm directly for current details.";

  return {
    replyText: readString(firm.consult?.costAnswer) || fallbackText,
    qualificationPath: lead.qualification_path || "review",
    requestContactCapture: false,
    offerConsultLink: false,
    leadFieldsNeeded: adapter.collectMissingLeadFields(lead, firm),
    responseSource: "policy_guardrail",
    fallbackReason: "",
  };
}

function buildNoOnlineBookingReply(lead, firm, adapter) {
  return {
    replyText:
      "We do not offer online self-scheduling in this setup. If you'd like, you can share a few details here and the firm can review them and reach out if appropriate.",
    qualificationPath: lead.qualification_path || "review",
    requestContactCapture: false,
    offerConsultLink: false,
    leadFieldsNeeded: adapter.collectMissingLeadFields(lead, firm),
    responseSource: "policy_guardrail",
    fallbackReason: "",
  };
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

function buildLiveBuildResponse(promptBuild) {
  return {
    prompt_version: promptBuild.version,
    fingerprint: promptBuild.fingerprint,
    input_count: promptBuild.inputCount,
    sources: promptBuild.inputs,
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

function buildObservabilityPayload(
  firm,
  validationWarnings,
  groundingSummary,
  promptBuild,
  runtimeContext = {},
) {
  const payload = {};

  if (shouldIncludeBuildSummary(firm)) {
    payload.live_build = buildLiveBuildResponse(promptBuild);
  }

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

  payload.runtime = {
    request_channel: runtimeContext.channel || "chat",
    latency_ms: Number.isFinite(runtimeContext.latencyMs) ? runtimeContext.latencyMs : 0,
    response_source: runtimeContext.result?.responseSource || "",
    fallback_reason: runtimeContext.result?.fallbackReason || "",
    webhook_attempted: Boolean(runtimeContext.webhookDelivery?.attempted),
    webhook_delivered: Boolean(runtimeContext.webhookDelivery?.delivered),
  };

  payload.request = {
    session_id_present: Boolean(runtimeContext.requestMeta?.sessionId),
    page_url: runtimeContext.requestMeta?.pageUrl || "",
    page_title: runtimeContext.requestMeta?.pageTitle || "",
    current_message_text: runtimeContext.message || "",
    transcript_turn_count: Array.isArray(runtimeContext.transcript) ? runtimeContext.transcript.length : 0,
    transcript_text: renderTranscriptText(runtimeContext.transcript),
  };

  payload.voice_transport = {
    preview_enabled: Boolean(runtimeContext.voicePreview?.enabled),
    current_firm_enabled: Boolean(runtimeContext.voicePreview?.current_firm_enabled),
    transport: runtimeContext.voiceMeta?.transport || runtimeContext.voicePreview?.transport || "",
    input_mode: runtimeContext.voiceMeta?.input_mode || "",
    utterance_mode:
      runtimeContext.voiceMeta?.utterance_mode || runtimeContext.voicePreview?.utterance_mode || "",
    stt_provider:
      runtimeContext.voiceMeta?.stt_provider || runtimeContext.voicePreview?.stt_provider || "",
    tts_provider:
      runtimeContext.voiceMeta?.tts_provider || runtimeContext.voicePreview?.tts_provider || "",
  };

  return payload;
}

function shouldIncludeBuildSummary(firm) {
  if (typeof firm.observability?.includeBuildSummary === "boolean") {
    return firm.observability.includeBuildSummary;
  }

  return true;
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

function renderTranscriptText(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return "";
  }

  return transcript
    .map((entry) => `${entry.role}: ${readString(entry.content)}`)
    .filter(Boolean)
    .join("\n");
}

function readBooleanEnv(value) {
  const normalized = readString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readCsvEnv(value) {
  const normalized = readString(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
