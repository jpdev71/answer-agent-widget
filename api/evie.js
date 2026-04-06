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

  const history = normalizeHistory(body.conversation_history);
  const transcript = [...history, { role: "user", content: message }];
  const lead = extractLead(transcript, body.channel === "voice" ? "voice" : "chat");
  const result = buildReply(message, lead, transcript);

  res.status(200).json({
    reply_text: result.replyText,
    qualification_path: result.qualificationPath,
    request_contact_capture: result.requestContactCapture,
    offer_consult_link: result.offerConsultLink,
    consult_link: result.offerConsultLink ? CONSULT_LINK : "",
    lead_fields_needed: result.leadFieldsNeeded,
    lead_record: lead,
    prompt_version: getPromptVersion(),
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
  if (cachedVersion) {
    return cachedVersion;
  }

  let latest = 0;
  for (const promptPath of PROMPT_PATHS) {
    const stats = fs.statSync(promptPath);
    latest = Math.max(latest, stats.mtimeMs);
  }

  cachedVersion = new Date(latest).toISOString();
  return cachedVersion;
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

function buildReply(message, lead, transcript) {
  const lower = message.toLowerCase();
  const greetingOnly = isGreeting(lower);

  if (isEmergency(lower)) {
    return {
      replyText:
        "If this is an emergency or you need immediate medical help, please call 911 or seek urgent medical care right away. Once you're safe, I can still help explain the firm's intake process.",
      qualificationPath: "review",
      requestContactCapture: false,
      offerConsultLink: false,
      leadFieldsNeeded: [],
    };
  }

  const parts = [buildAnswer(lower, lead)];
  const directConsultRequest =
    /schedule|book|share (?:the )?link|consultation link|talk to someone|speak with someone|call me/.test(
      lower
    ) || (lower.includes("consult") && lower.includes("link"));
  const offerConsultLink =
    directConsultRequest ||
    (lead.qualification_path === "qualified" &&
      Boolean(lead.incident_state && lead.injury_summary));
  const leadFieldsNeeded = collectMissingLeadFields(lead);
  const missingContact = leadFieldsNeeded.filter((field) =>
    ["visitor_name", "visitor_phone", "visitor_email"].includes(field)
  );
  const requestContactCapture =
    missingContact.length > 0 && (offerConsultLink || lead.qualification_path === "qualified");

  if (offerConsultLink) {
    parts.push(`If you'd like to move ahead, here's the consultation link: ${CONSULT_LINK}`);
  }

  if (requestContactCapture && !directConsultRequest) {
    parts.push(
      "If you'd like the firm to follow up directly, you can also share your full name, phone number, and email."
    );
  } else if (!greetingOnly) {
    const nextQuestion = nextIntakeQuestion(lead, transcript, lower);
    if (nextQuestion) {
      parts.push(nextQuestion);
    }
  }

  return {
    replyText: parts.filter(Boolean).join(" "),
    qualificationPath: lead.qualification_path,
    requestContactCapture,
    offerConsultLink,
    leadFieldsNeeded,
  };
}

function buildAnswer(lower, lead) {
  if (isGreeting(lower)) {
    return "Hello. I'm Evie, the firm's intake assistant. I can help with questions about personal injury matters, consultations, and general next steps.";
  }
  if (/free consultation|is it free/.test(lower)) {
    return "Yes. The firm offers free consultations, and I can also help gather the basics here first if that's easier.";
  }
  if (/what happens.*consultation|during a consultation/.test(lower)) {
    return "A consultation is usually a chance for the firm to learn what happened, ask about injuries and treatment, and decide whether the matter is something they may be able to help with.";
  }
  if (/consultation link|share (?:the )?link|schedule consult|book consult/.test(lower)) {
    return "Absolutely. I can share the consultation link, and if you'd like, you can also send your contact details so the firm can follow up directly.";
  }
  if (/do you handle|do you take|can you help with|practice area|what kinds of cases/.test(lower)) {
    return "The firm reviews Georgia personal injury matters, including vehicle collisions, trucking matters, slip and falls, nursing home abuse, and other injury cases.";
  }
  if (lower.includes("do i have a case")) {
    return "That usually depends on things like fault, injuries, treatment, insurance coverage, and the available evidence. I can't tell you for sure that you do or don't have a claim here, but I can help gather the basics and point you toward a consultation if it looks like a fit.";
  }
  if (/worth|value|settlement|compensation/.test(lower)) {
    return "Case value can vary a lot based on the injuries, treatment, lost income, liability, and available coverage. I can't estimate a number here, but the firm can review the details more closely.";
  }
  if (/insurance adjuster|recorded statement/.test(lower) || (lower.includes("insurance") && lower.includes("statement"))) {
    return "In general, it's smart to be careful with recorded insurance statements because the details can matter later. I can't advise you specifically on what to do, but the firm can review the situation and help you think through next steps.";
  }
  if (/how long do i have|deadline|statute/.test(lower)) {
    return "Many Georgia personal injury claims have a two-year filing deadline, but exceptions and timing details can matter, so it's best not to rely on a general answer alone if timing is important.";
  }
  if (/sign this release|medical release/.test(lower)) {
    return "In general, it's wise to be cautious before signing insurance or medical release forms without understanding what they cover. I can't advise you specifically, but the firm can review the situation with you.";
  }
  if (lead.represented_by_other_attorney === "yes" || lower.includes("already have a lawyer")) {
    return "If you already have an attorney, case-specific decisions are usually best discussed with them directly. I can still answer basic questions about the firm's process if that's helpful.";
  }
  if (lower.includes("phone") || lower.includes("call")) {
    return "If you'd prefer to speak with someone directly, I can help you move toward a consultation and make sure the firm has your contact information for follow-up.";
  }
  if (/what should i do|next step/.test(lower)) {
    return "A good general next step is to get appropriate medical care, preserve photos and records, and avoid making important case decisions based only on a general online answer.";
  }
  if (soundsLikeIncident(lower)) {
    if (lead.incident_state === "Georgia") {
      return "The firm does review Georgia personal injury matters, and I'm sorry you're dealing with that.";
    }
    return "Thank you for sharing that. I'm sorry you're dealing with that.";
  }
  return "I can help with Georgia personal injury questions, consultation details, and next-step intake. If you tell me what happened, I can help you get oriented.";
}

function nextIntakeQuestion(lead, transcript, lower) {
  if (isGreeting(lower) || (!soundsLikeIncident(lower) && detectGoal(lower) === "general_help")) {
    return "";
  }

  const questions = [
    [!lead.incident_state, "What city and state did the incident occur in?"],
    [lead.incident_type === "unknown", "Can you briefly tell me what happened?"],
    [!lead.injury_summary, "What injuries were involved?"],
    [!lead.incident_date_text, "About when did this happen?"],
    [lead.medical_treatment_status === "unknown", "Did you seek medical treatment after it happened?"],
    [
      lead.commercial_vehicle_involved === "unknown" && lead.incident_type.includes("accident"),
      "Was a commercial vehicle or work truck involved?",
    ],
  ];

  const next = questions.find(([missing]) => missing);
  if (!next) {
    return "";
  }

  const askedQuestion = lower.includes("?") && !soundsLikeIncident(lower);
  return askedQuestion
    ? `If you'd like, I can also help with one quick intake question: ${next[1]}`
    : next[1];
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
  if (lower.includes("florida")) return "Florida";
  if (lower.includes("alabama")) return "Alabama";
  if (lower.includes("south carolina")) return "South Carolina";
  if (lower.includes("north carolina")) return "North Carolina";
  if (lower.includes("tennessee")) return "Tennessee";
  return "";
}

function detectCity(text) {
  const match = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,\s*(Georgia|GA|Florida|Alabama|Tennessee|South Carolina|North Carolina)\b/);
  return match ? match[1] : "";
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
    ["fracture", /fracture|fractured/],
    ["laceration", /laceration|lacerations/],
    ["cuts", /cuts|cut on my|cut on her|cut on his/],
    ["back pain", /back pain/],
    ["neck pain", /neck pain/],
    ["brain injury", /brain injury|tbi/],
    ["concussion", /concussion/],
    ["deep cut", /deep cut/],
  ];
  const injuries = patterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([label]) => label);

  return injuries.join(", ");
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

function detectGoal(lower) {
  if (/consult|schedule|book/.test(lower)) return "schedule_consultation";
  if (/do i have a case|worth|deadline|insurance/.test(lower)) return "legal_process_question";
  if (/what happens.*consultation|during a consultation/.test(lower)) return "consultation_process";
  return "general_help";
}

function detectContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "";
  const phone =
    text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";
  const name = text.match(/(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/)?.[1] || "";
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

function soundsLikeIncident(lower) {
  return /i was|my mother|got hurt|accident|injured|crash/.test(lower);
}

function isGreeting(lower) {
  return /^(hello|hi|hey|good morning|good afternoon|good evening)\b[!.? ]*$/.test(lower.trim());
}

function isEmergency(lower) {
  return /can't breathe|bleeding badly|emergency|call 911|immediate danger/.test(lower);
}
