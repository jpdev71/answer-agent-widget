const fs = require("fs");
const path = require("path");
const defaultFirmConfig = require("../firms/default");
const adamAppelConfig = require("../firms/adam-appel");
const thackerSleightConfig = require("../firms/thacker-sleight");

const ALLOWED_GROUNDING_SOURCE_TYPES = new Set([
  "markdown_file",
  "text_file",
  "inline_text",
  "json_file",
]);

function getFirmRuntimeConfig() {
  const baseConfig = getSelectedFirmBaseConfig();
  const envOverrides = buildEnvOverrides();
  const config = mergeConfigs(baseConfig, envOverrides);
  const adapter = loadFirmAdapter(config);
  const validationWarnings = validateFirmConfig(config);

  return {
    selectedProfile: getSelectedFirmProfile(),
    adapter,
    config,
    validationWarnings,
  };
}

function getSelectedFirmBaseConfig() {
  const selectedProfile = getSelectedFirmProfile();
  return FIRM_PROFILES[selectedProfile] || defaultFirmConfig;
}

function getSelectedFirmProfile() {
  return readString(process.env.FIRM_PROFILE || process.env.FIRM_SLUG).toLowerCase() || "default";
}

function buildEnvOverrides() {
  const firmId = readString(process.env.FIRM_ID);
  const firmName = readString(process.env.FIRM_NAME);
  const consultLink = readString(process.env.CONSULT_LINK);

  const overrides = {};

  if (firmId || firmName) {
    overrides.id = firmId || defaultFirmConfig.id;
    overrides.name = firmName || defaultFirmConfig.name;
  }

  if (consultLink) {
    overrides.consult = {
      link: consultLink,
      enabled: true,
    };
  }

  return overrides;
}

const FIRM_PROFILES = {
  default: defaultFirmConfig,
  "adam-appel": adamAppelConfig,
  "thacker-sleight": thackerSleightConfig,
};

function mergeConfigs(baseConfig, overrideConfig) {
  if (!overrideConfig || typeof overrideConfig !== "object") {
    return clone(baseConfig);
  }

  const output = Array.isArray(baseConfig) ? [...baseConfig] : { ...baseConfig };

  for (const [key, value] of Object.entries(overrideConfig)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === "object") {
      const baseValue =
        output[key] && typeof output[key] === "object" && !Array.isArray(output[key])
          ? output[key]
          : {};
      output[key] = mergeConfigs(baseValue, value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function validateFirmConfig(config) {
  const warnings = [];

  if (!readString(config.id)) {
    warnings.push("firm.id is missing.");
  }

  if (!readString(config.name)) {
    warnings.push("firm.name is missing.");
  }

  if (!readString(config.agent?.name)) {
    warnings.push("firm.agent.name is missing.");
  }

  if (!Array.isArray(config.practice?.regionsServed) || config.practice.regionsServed.length === 0) {
    warnings.push("firm.practice.regionsServed should include at least one region.");
  }

  if (config.consult?.enabled && !isLikelyUrl(config.consult?.link)) {
    warnings.push("firm.consult.link should be a valid URL when consults are enabled.");
  }

  const adapterPath = readString(config.intake?.adapterPath);
  if (!adapterPath) {
    warnings.push("firm.intake.adapterPath is missing.");
  } else if (!fs.existsSync(adapterPath)) {
    warnings.push(`firm.intake.adapterPath file was not found: ${adapterPath}`);
  }

  const sharedContext = Array.isArray(config.prompt?.sharedContext) ? config.prompt.sharedContext : [];
  for (const entry of sharedContext) {
    if (!readString(entry?.id)) {
      warnings.push("Each prompt.sharedContext entry needs an id.");
    }

    const entryPath = readString(entry?.path);
    if (!entryPath) {
      warnings.push(`Prompt shared context "${entry?.id || "unknown"}" is missing a file path.`);
      continue;
    }

    if (!fs.existsSync(entryPath)) {
      warnings.push(`Prompt shared context "${entry?.id || "unknown"}" file was not found: ${entryPath}`);
    }
  }

  if (!Array.isArray(config.grounding?.sources) || config.grounding.sources.length === 0) {
    warnings.push("firm.grounding.sources should include at least one source.");
    return warnings;
  }

  const allowedTypes = new Set(
    Array.isArray(config.grounding.allowedSourceTypes) &&
    config.grounding.allowedSourceTypes.length > 0
      ? config.grounding.allowedSourceTypes
      : [...ALLOWED_GROUNDING_SOURCE_TYPES],
  );

  for (const source of config.grounding.sources) {
    if (!readString(source.id)) {
      warnings.push("Each grounding source needs an id.");
    }

    if (!allowedTypes.has(source.type)) {
      warnings.push(`Grounding source "${source.id || "unknown"}" uses unsupported type "${source.type}".`);
    }

    if (!ALLOWED_GROUNDING_SOURCE_TYPES.has(source.type)) {
      warnings.push(`Grounding source "${source.id || "unknown"}" is outside the shared allowed source contract.`);
    }

    if (source.type === "inline_text" && !readString(source.text)) {
      warnings.push(`Grounding source "${source.id || "unknown"}" is missing inline text.`);
    }

    if (source.type !== "inline_text" && !readString(source.path)) {
      warnings.push(`Grounding source "${source.id || "unknown"}" is missing a file path.`);
    }

    if (source.type !== "inline_text" && readString(source.path) && !fs.existsSync(source.path)) {
      warnings.push(`Grounding source "${source.id || "unknown"}" file was not found: ${source.path}`);
    }
  }

  return warnings;
}

function buildGroundingBundle(config) {
  const sharedContextSections = buildSharedContextSections(config);
  const sources = Array.isArray(config.grounding?.sources) ? config.grounding.sources : [];
  const sections = [];
  const summary = [];

  for (const source of sources) {
    const rendered = readGroundingSource(source);

    if (!rendered?.text) {
      continue;
    }

    const label = readString(source.label) || readString(source.id) || "Grounding source";
    sections.push(rendered.text.startsWith("## ") ? rendered.text : `## ${label}\n\n${rendered.text}`);
    summary.push(buildSummaryEntry(source, label, rendered.summary));
  }

  return {
    text: [...sharedContextSections, ...sections].join("\n\n"),
    summary: [...buildSharedContextSummary(config), ...summary],
  };
}

function readGroundingSource(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  if (source.type === "inline_text") {
    const text = readString(source.text);
    return text ? { text, summary: {} } : null;
  }

  const filePath = readString(source.path);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  if (source.type === "json_file") {
    return readJsonGroundingSource(filePath);
  }

  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? { text, summary: {} } : null;
}

function readJsonGroundingSource(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const supportedTopics = Array.isArray(parsed.supported_topics) ? parsed.supported_topics : [];
  const doNotGuess = Array.isArray(parsed.do_not_guess) ? parsed.do_not_guess : [];
  const sourceEntries = Array.isArray(parsed.sources) ? parsed.sources : [];
  const sourceSections = sourceEntries
    .map((entry) => renderKnowledgeSourceEntry(entry))
    .filter(Boolean);

  const lines = [
    `## ${parsed.firm_name || "Firm"} Knowledge Bundle`,
    "",
    "Use these grounded public facts for firm-specific questions.",
    parsed.last_verified_at ? `Last verified: ${parsed.last_verified_at}` : "",
    supportedTopics.length ? "Supported topics:" : "",
    ...supportedTopics.map((topic) => `- ${topic}`),
    doNotGuess.length ? "Do not guess:" : "",
    ...doNotGuess.map((item) => `- ${item}`),
    ...sourceSections,
  ].filter(Boolean);

  return {
    text: lines.join("\n"),
    summary: {
      bundle_version: parsed.bundle_version || 1,
      firm_id: parsed.firm_id || "",
      last_verified_at: parsed.last_verified_at || "",
      supported_topics: supportedTopics,
      do_not_guess: doNotGuess,
      source_count: sourceEntries.length,
      fact_count: sourceEntries.reduce(
        (total, entry) => total + (Array.isArray(entry.facts) ? entry.facts.length : 0),
        0,
      ),
      sources: sourceEntries.map((entry) => ({
        id: entry.id || "",
        label: entry.label || "",
        page_type: entry.page_type || "",
        url: entry.url || "",
        verified_at: entry.verified_at || "",
        fact_count: Array.isArray(entry.facts) ? entry.facts.length : 0,
      })),
    },
  };
}

function renderKnowledgeSourceEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }

  const facts = Array.isArray(entry.facts) ? entry.facts.filter(Boolean) : [];
  if (facts.length === 0) {
    return "";
  }

  const heading = entry.label || entry.id || "Source";
  const meta = [
    entry.page_type ? `Page type: ${entry.page_type}` : "",
    entry.url ? `URL: ${entry.url}` : "",
    entry.verified_at ? `Verified: ${entry.verified_at}` : "",
  ].filter(Boolean);

  return [
    "",
    `### ${heading}`,
    ...meta,
    ...facts.map((fact) => `- ${fact}`),
  ].join("\n");
}

function buildSharedContextSections(config) {
  const sharedContext = Array.isArray(config.prompt?.sharedContext) ? config.prompt.sharedContext : [];
  const sections = [];

  for (const entry of sharedContext) {
    const entryPath = readString(entry?.path);
    if (!entryPath || !fs.existsSync(entryPath)) {
      continue;
    }

    const content = fs.readFileSync(entryPath, "utf8").trim();
    if (!content) {
      continue;
    }

    const label = readString(entry?.label) || readString(entry?.id) || "Shared prompt context";
    sections.push(`## ${label}\n\n${content}`);
  }

  return sections;
}

function buildSharedContextSummary(config) {
  const sharedContext = Array.isArray(config.prompt?.sharedContext) ? config.prompt.sharedContext : [];
  return sharedContext.map((entry) => ({
    id: entry.id,
    label: readString(entry.label) || readString(entry.id) || "Shared prompt context",
    type: "shared_context",
    usage: "prompt_support",
    required: true,
    path: readString(entry.path),
  }));
}

function buildSummaryEntry(source, label, extraSummary) {
  return {
    id: source.id,
    label,
    type: source.type,
    usage: readString(source.usage),
    required: Boolean(source.required),
    ...extraSummary,
  };
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyUrl(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }

  return value;
}

function loadFirmAdapter(config) {
  const adapterPath = readString(config.intake?.adapterPath);
  if (!adapterPath) {
    return buildNoopAdapter();
  }

  const resolvedPath = path.resolve(adapterPath);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(resolvedPath);
}

function buildNoopAdapter() {
  return {
    createLead({ channel, firm }) {
      return {
        lead_source: firm.webhook?.leadSource || "website_widget",
        agent_name: firm.agent?.name || "Evie",
        conversation_channel: channel,
        created_at: new Date().toISOString(),
        qualification_path: "review",
        qualification_notes: "No firm adapter configured.",
        consult_link_offered: false,
        follow_up_recommended: false,
        conversation_summary: "",
      };
    },
    collectMissingLeadFields() {
      return [];
    },
    getLeadFieldsNeededEnum() {
      return ["visitor_name", "visitor_phone", "visitor_email"];
    },
    getPromptRuntimeRules(firm) {
      return Array.isArray(firm.prompt?.runtimeRules) ? firm.prompt.runtimeRules : [];
    },
  };
}

module.exports = {
  ALLOWED_GROUNDING_SOURCE_TYPES: [...ALLOWED_GROUNDING_SOURCE_TYPES],
  buildGroundingBundle,
  getFirmRuntimeConfig,
  validateFirmConfig,
};
