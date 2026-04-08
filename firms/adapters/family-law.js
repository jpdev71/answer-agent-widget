function createLead({ transcript, channel, firm }) {
  const userText = transcript
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.content)
    .join("\n");
  const lower = userText.toLowerCase();

  const matterState = detectState(lower, firm);
  const matterType = detectMatterType(lower);
  const maritalStatus = detectMaritalStatus(lower);
  const childrenInvolved = detectChildrenInvolved(lower);
  const assetWorth = detectAssetWorth(lower);
  const urgencyLevel = detectUrgency(lower);
  const highConflictIndicators = detectHighConflictIndicators(lower);
  const contact = detectContact(userText);
  const qualificationPath = detectQualification({
    firm,
    matterState,
    matterType,
    maritalStatus,
    childrenInvolved,
    assetWorth,
    urgencyLevel,
    highConflictIndicators,
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
    preferred_callback_time: detectPreferredCallbackTime(userText),
    matter_state: matterState,
    matter_type: matterType,
    marital_status: maritalStatus,
    children_involved: childrenInvolved,
    asset_worth: assetWorth,
    urgency_level: urgencyLevel,
    high_conflict_indicators: highConflictIndicators,
    opposing_counsel_involved: detectOpposingCounsel(lower),
    business_interests_involved: detectBusinessInterests(lower),
    qualification_path: qualificationPath,
    qualification_notes:
      qualificationPath === "qualified"
        ? "Potentially strong fit for firm review based on complexity and intake signals."
        : "Needs review or appears less clearly aligned with the firm's focus.",
    consult_link_offered: false,
    follow_up_recommended:
      qualificationPath === "qualified" ||
      Boolean(matterType !== "unknown" || assetWorth !== "unknown" || highConflictIndicators),
    conversation_summary: buildSummary({
      matterState,
      matterType,
      maritalStatus,
      childrenInvolved,
      assetWorth,
      urgencyLevel,
      highConflictIndicators,
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
  if (["matter_type", "marital_status", "asset_worth", "urgency_level"].includes(fieldId)) {
    return !value || value === "unknown";
  }

  if (fieldId === "children_involved") {
    return !value || value === "unknown";
  }

  return !value;
}

function detectQualification(input) {
  let score = 0;
  if (input.firm.qualification?.qualifiedStates?.includes(input.matterState)) score += 2;
  if (input.matterType !== "unknown") score += 1;
  if (input.childrenInvolved === "yes") score += 1;
  if (input.assetWorth === "high") score += 2;
  if (input.assetWorth === "moderate") score += 1;
  if (input.urgencyLevel === "high") score += 1;
  if (input.highConflictIndicators) score += 2;
  if (/business owner|executive|professional|complex estate|complex assets|alienation/.test(input.lower)) {
    score += 2;
  }
  return score >= (input.firm.qualification?.scoreThreshold || 4) ? "qualified" : "review";
}

function detectState(lower, firm) {
  const knownStates = ["Michigan"];

  for (const state of knownStates) {
    if (lower.includes(state.toLowerCase())) {
      return state;
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

function detectMatterType(lower) {
  if (/parental alienation|false claims/.test(lower)) return "parental_alienation";
  if (/custody|parenting time/.test(lower)) return "custody_parenting";
  if (/child support/.test(lower)) return "child_support";
  if (/spousal support|alimony/.test(lower)) return "spousal_support";
  if (/divorce|dissolution/.test(lower)) return "divorce";
  if (/postnuptial|postnuptial agreement/.test(lower)) return "postnuptial_agreement";
  if (/prenuptial|prenup/.test(lower)) return "prenuptial_agreement";
  if (/adoption/.test(lower)) return "adoption";
  if (/paternity/.test(lower)) return "paternity";
  if (/business valuation|property division|asset protection|qualified domestic relation|qdro/.test(lower)) {
    return "financial_business_matter";
  }
  if (/personal protection order|protective order|domestic violence|family crisis/.test(lower)) {
    return "protection_specialized_matter";
  }
  return "unknown";
}

function detectMaritalStatus(lower) {
  if (/married/.test(lower)) return "married";
  if (/separated|separation/.test(lower)) return "separated";
  if (/divorced|finalized divorce/.test(lower)) return "divorced";
  if (/engaged/.test(lower)) return "engaged";
  return "unknown";
}

function detectChildrenInvolved(lower) {
  if (/child|children|daughter|son|parenting time|custody/.test(lower)) return "yes";
  if (/no children|without children/.test(lower)) return "no";
  return "unknown";
}

function detectAssetWorth(lower) {
  if (/business owner|owns a business|business interests|multiple properties|complex estate|complex assets|high net worth|seven figures|million|portfolio|executive|professional/.test(lower)) {
    return "high";
  }
  if (/home|retirement|savings|business/.test(lower)) {
    return "moderate";
  }
  return "unknown";
}

function detectUrgency(lower) {
  if (/hearing next week|trial next week|emergency|urgent|asap|soon|temporary order/.test(lower)) {
    return "high";
  }
  if (/this month|coming up|need help quickly/.test(lower)) {
    return "medium";
  }
  return "unknown";
}

function detectHighConflictIndicators(lower) {
  const indicators = [];
  if (/alienation|parental alienation/.test(lower)) indicators.push("parental alienation");
  if (/false claims|false allegation/.test(lower)) indicators.push("false claims");
  if (/high conflict|volatile|unpredictable/.test(lower)) indicators.push("high conflict");
  if (/domestic violence|stalking|protection order|ppo/.test(lower)) indicators.push("safety concerns");
  return indicators.join(", ");
}

function detectOpposingCounsel(lower) {
  if (/their lawyer|his lawyer|her lawyer|opposing counsel|other side's attorney/.test(lower)) {
    return "yes";
  }
  return "unknown";
}

function detectBusinessInterests(lower) {
  if (/business owner|llc|company|partnership|shares|valuation|practice/.test(lower)) {
    return "yes";
  }
  return "unknown";
}

function detectPreferredCallbackTime(text) {
  const explicit =
    text.match(/best time to call me is\s*([^.!\n]+)/i)?.[1] ||
    text.match(/(?:best time(?: to call)?|preferred callback time)\s+(?:is|would be)?\s*([^.!\n]+)/i)?.[1] ||
    text.match(/call me\s+(?:after|around|before)\s*([^.!\n]+)/i)?.[1];
  return explicit ? explicit.trim() : "";
}

function detectContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "";
  const phone =
    text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";
  const contactLineName =
    text.match(/(?:^|[.!?\n]\s*)(?:certainly\.?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[,.\n]\s*(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}[\s,.\n]+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[1] || "";
  const explicitName =
    text.match(/(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/i)?.[1] || "";
  const leadingName =
    text.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[,.]/)?.[1] || "";
  const name = sanitizeDetectedName(contactLineName || explicitName || leadingName);
  return { name, phone, email };
}

function sanitizeDetectedName(name) {
  return String(name || "")
    .replace(/^(?:my name is|i am|i'm)\s+/i, "")
    .trim();
}

function buildSummary(input) {
  const parts = [];
  if (input.matterType !== "unknown") parts.push(`Visitor described a ${input.matterType.replace(/_/g, " ")}`);
  if (input.matterState) parts.push(`in ${input.matterState}`);
  if (input.maritalStatus !== "unknown") parts.push(`with marital status ${input.maritalStatus}`);
  if (input.childrenInvolved !== "unknown") {
    parts.push(`children involved: ${input.childrenInvolved}`);
  }
  if (input.assetWorth !== "unknown") parts.push(`asset profile appears ${input.assetWorth}`);
  if (input.urgencyLevel !== "unknown") parts.push(`urgency appears ${input.urgencyLevel}`);
  if (input.highConflictIndicators) parts.push(`high-conflict indicators: ${input.highConflictIndicators}`);
  return parts.join(", ");
}

module.exports = {
  collectMissingLeadFields,
  createLead,
  getLeadFieldsNeededEnum,
  getPromptRuntimeRules,
};
