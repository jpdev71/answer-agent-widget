const { parseContact } = require("../../lib/contact-parser");

const US_STATE_PATTERNS = [
  { name: "Alabama", patterns: ["alabama", "al"] },
  { name: "Alaska", patterns: ["alaska", "ak"] },
  { name: "Arizona", patterns: ["arizona", "az"] },
  { name: "Arkansas", patterns: ["arkansas", "ar"] },
  { name: "California", patterns: ["california", "ca"] },
  { name: "Colorado", patterns: ["colorado", "co"] },
  { name: "Connecticut", patterns: ["connecticut", "ct"] },
  { name: "Delaware", patterns: ["delaware", "de"] },
  { name: "Florida", patterns: ["florida", "fl"] },
  { name: "Georgia", patterns: ["georgia", "ga"] },
  { name: "Hawaii", patterns: ["hawaii", "hi"] },
  { name: "Idaho", patterns: ["idaho", "id"] },
  { name: "Illinois", patterns: ["illinois", "il"] },
  { name: "Indiana", patterns: ["indiana", "in"] },
  { name: "Iowa", patterns: ["iowa", "ia"] },
  { name: "Kansas", patterns: ["kansas", "ks"] },
  { name: "Kentucky", patterns: ["kentucky", "ky"] },
  { name: "Louisiana", patterns: ["louisiana", "la"] },
  { name: "Maine", patterns: ["maine", "me"] },
  { name: "Maryland", patterns: ["maryland", "md"] },
  { name: "Massachusetts", patterns: ["massachusetts", "ma"] },
  { name: "Michigan", patterns: ["michigan", "mi"] },
  { name: "Minnesota", patterns: ["minnesota", "mn"] },
  { name: "Mississippi", patterns: ["mississippi", "ms"] },
  { name: "Missouri", patterns: ["missouri", "mo"] },
  { name: "Montana", patterns: ["montana", "mt"] },
  { name: "Nebraska", patterns: ["nebraska", "ne"] },
  { name: "Nevada", patterns: ["nevada", "nv"] },
  { name: "New Hampshire", patterns: ["new hampshire", "nh"] },
  { name: "New Jersey", patterns: ["new jersey", "nj"] },
  { name: "New Mexico", patterns: ["new mexico", "nm"] },
  { name: "New York", patterns: ["new york", "ny"] },
  { name: "North Carolina", patterns: ["north carolina", "nc"] },
  { name: "North Dakota", patterns: ["north dakota", "nd"] },
  { name: "Ohio", patterns: ["ohio", "oh"] },
  { name: "Oklahoma", patterns: ["oklahoma", "ok"] },
  { name: "Oregon", patterns: ["oregon", "or"] },
  { name: "Pennsylvania", patterns: ["pennsylvania", "pa"] },
  { name: "Rhode Island", patterns: ["rhode island", "ri"] },
  { name: "South Carolina", patterns: ["south carolina", "sc"] },
  { name: "South Dakota", patterns: ["south dakota", "sd"] },
  { name: "Tennessee", patterns: ["tennessee", "tn"] },
  { name: "Texas", patterns: ["texas", "tx"] },
  { name: "Utah", patterns: ["utah", "ut"] },
  { name: "Vermont", patterns: ["vermont", "vt"] },
  { name: "Virginia", patterns: ["virginia", "va"] },
  { name: "Washington", patterns: ["washington", "wa"] },
  { name: "West Virginia", patterns: ["west virginia", "wv"] },
  { name: "Wisconsin", patterns: ["wisconsin", "wi"] },
  { name: "Wyoming", patterns: ["wyoming", "wy"] },
  { name: "District of Columbia", patterns: ["district of columbia", "washington dc", "dc"] },
];

function createLead({ transcript, channel, firm }) {
  const userText = transcript
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join("\n");
  const lower = userText.toLowerCase();

  const incidentState = detectState(lower, firm);
  const incidentType = detectIncidentType(lower);
  const injurySummary = detectInjuries(lower);
  const medicalTreatmentStatus = detectTreatment(lower);
  const commercialVehicleInvolved = detectCommercialVehicle(lower);
  const contact = detectContact(userText);
  const qualificationPath = detectQualification({
    firm,
    incidentState,
    incidentType,
    injurySummary,
    medicalTreatmentStatus,
    commercialVehicleInvolved,
    lower,
  });

  return {
    lead_source: firm.webhook.leadSource || "website_widget",
    agent_name: firm.agent.name,
    conversation_channel: channel,
    created_at: new Date().toISOString(),
    visitor_name: contact.name,
    visitor_phone: contact.phone,
    visitor_email: contact.email,
    incident_city: detectCity(userText, firm),
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

function collectMissingLeadFields(lead, firm) {
  const fields = Array.isArray(firm.intake?.responseLeadFieldsNeeded)
    ? firm.intake.responseLeadFieldsNeeded
    : [];

  return fields.filter((fieldId) => isMissingLeadField(lead, fieldId));
}

function getLeadFieldsNeededEnum(firm) {
  return Array.isArray(firm.intake?.responseLeadFieldsNeeded) &&
    firm.intake.responseLeadFieldsNeeded.length > 0
    ? firm.intake.responseLeadFieldsNeeded
    : ["visitor_name", "visitor_phone", "visitor_email"];
}

function getPromptRuntimeRules(firm) {
  return Array.isArray(firm.prompt?.runtimeRules) ? firm.prompt.runtimeRules : [];
}

function isMissingLeadField(lead, fieldId) {
  const value = lead?.[fieldId];
  if (fieldId === "incident_type") {
    return !value || value === "unknown";
  }

  if (fieldId === "medical_treatment_status") {
    return !value || value === "unknown";
  }

  return !value;
}

function detectQualification(input) {
  let score = 0;
  if (input.firm.qualification?.qualifiedStates?.includes(input.incidentState)) score += 2;
  if (input.incidentType !== "unknown") score += 1;
  if (input.injurySummary) score += 1;
  if (input.medicalTreatmentStatus === "same_day_treatment") score += 2;
  if (input.medicalTreatmentStatus === "delayed_treatment") score += 1;
  if (input.medicalTreatmentStatus === "no_treatment") score -= 1;
  if (input.commercialVehicleInvolved === "yes") score += 2;
  if (/broken|fracture|surgery|hospital|nursing home/.test(input.lower)) score += 2;
  if (/minor soreness|sore for a few days|property damage only/.test(input.lower)) score -= 2;
  return score >= (input.firm.qualification?.scoreThreshold || 4) ? "qualified" : "review";
}

function detectState(lower, firm) {
  for (const state of US_STATE_PATTERNS) {
    for (const pattern of state.patterns) {
      if (new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i").test(lower)) {
        return state.name;
      }
    }
  }

  const aliases = firm.practice?.locationAliases || {};
  for (const [pattern, state] of Object.entries(aliases)) {
    if (new RegExp(pattern, "i").test(lower)) {
      return state;
    }
  }

  return "";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectCity(text, firm) {
  const knownStates = [
    "Georgia",
    "GA",
    "Florida",
    "Alabama",
    "Tennessee",
    "South Carolina",
    "North Carolina",
  ];
  const statePattern = knownStates.join("|");

  const withComma = text.match(
    new RegExp(`\\b(?:in|at)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s*,\\s*(${statePattern})\\b`),
  );
  if (withComma) {
    return withComma[1];
  }

  const withoutComma = text.match(
    new RegExp(`\\b(?:in|at)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s+(${statePattern})\\b`),
  );
  if (withoutComma) {
    return withoutComma[1];
  }

  const aliases = firm.practice?.cityAliases || {};
  for (const [pattern, city] of Object.entries(aliases)) {
    if (new RegExp(pattern, "i").test(text)) {
      return city;
    }
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
  return parseContact(text);
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

module.exports = {
  collectMissingLeadFields,
  createLead,
  getLeadFieldsNeededEnum,
  getPromptRuntimeRules,
};
