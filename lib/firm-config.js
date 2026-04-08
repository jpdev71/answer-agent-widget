const fs = require("fs");
const path = require("path");
const defaultFirmConfig = require("../firms/default");
const adamAppelConfig = require("../firms/adam-appel");
const thackerSleightConfig = require("../firms/thacker-sleight");

const ALLOWED_GROUNDING_SOURCE_TYPES = new Set([
  "markdown_file",
  "text_file",
  "inline_text",
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
  const sources = Array.isArray(config.grounding?.sources) ? config.grounding.sources : [];
  const sections = [];
  const summary = [];

  for (const source of sources) {
    const content = readGroundingSource(source);

    if (!content) {
      continue;
    }

    const label = readString(source.label) || readString(source.id) || "Grounding source";
    sections.push(`## ${label}\n\n${content}`);
    summary.push({
      id: source.id,
      label,
      type: source.type,
      usage: readString(source.usage),
      required: Boolean(source.required),
    });
  }

  return {
    text: sections.join("\n\n"),
    summary,
  };
}

function readGroundingSource(source) {
  if (!source || typeof source !== "object") {
    return "";
  }

  if (source.type === "inline_text") {
    return readString(source.text);
  }

  const filePath = readString(source.path);
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8").trim();
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
