const NON_NAME_WORDS = new Set([
  "a",
  "an",
  "and",
  "about",
  "after",
  "around",
  "at",
  "before",
  "best",
  "but",
  "by",
  "call",
  "children",
  "contact",
  "custody",
  "divorce",
  "email",
  "for",
  "from",
  "good",
  "help",
  "hello",
  "hey",
  "how",
  "hi",
  "i",
  "impact",
  "in",
  "is",
  "it",
  "married",
  "matter",
  "me",
  "might",
  "my",
  "of",
  "okay",
  "ok",
  "on",
  "or",
  "our",
  "phone",
  "regarding",
  "right",
  "separated",
  "single",
  "sure",
  "that",
  "the",
  "their",
  "this",
  "time",
  "to",
  "urgent",
  "we",
  "with",
  "worried",
  "would",
  "yes",
  "yep",
  "yup",
  "you",
  "your",
  "divorced",
]);

const LOCATION_TOKENS = new Set([
  "al",
  "alabama",
  "fl",
  "florida",
  "ga",
  "georgia",
  "mi",
  "michigan",
  "nc",
  "north",
  "carolina",
  "sc",
  "south",
  "tn",
  "tennessee",
]);

function parseContact(text) {
  const source = typeof text === "string" ? text : "";
  const email = findEmail(source);
  const phone =
    source.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "";

  const explicitName = findExplicitName(source);
  const standaloneName = explicitName ? "" : findStandaloneNameLine(source, phone, email);
  const nearContactName = explicitName || standaloneName ? "" : findNameNearContact(source, phone, email);

  return {
    name: sanitizeDetectedName(explicitName || standaloneName || nearContactName),
    phone,
    email,
  };
}

function findEmail(text) {
  const source = typeof text === "string" ? text : "";
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const normalizedLine = normalizeSpokenEmailLine(lines[index]);
    const directEmail = normalizedLine.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || "";
    if (directEmail) {
      return directEmail.toLowerCase();
    }
  }

  return "";
}

function normalizeSpokenEmailLine(line) {
  return String(line || "")
    .replace(/\b(?:email|e-mail)\s*(?:is|address is)?\s*/gi, "")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function findExplicitName(text) {
  const match = text.match(
    /(?:my name is|this is|i am|i'm)\s+([A-Za-z][A-Za-z'\u2019-]*(?:\s+[A-Za-z][A-Za-z'\u2019-]*){0,3})\b/i,
  );

  return match && looksLikeHumanName(match[1]) ? match[1] : "";
}

function findNameNearContact(text, phone, email) {
  const contactIndex = findFirstContactIndex(text, phone, email);
  if (contactIndex < 0) {
    return "";
  }

  const windowStart = Math.max(0, contactIndex - 120);
  const prefix = text.slice(windowStart, contactIndex);
  const segment = prefix.split(/[\n.!?]/).pop() || prefix;
  const tokens = (segment.match(/[A-Za-z][A-Za-z'\u2019-]*/g) || []).slice(-4);

  for (let length = Math.min(4, tokens.length); length >= 1; length -= 1) {
    const candidate = tokens.slice(-length).join(" ");
    if (looksLikeHumanName(candidate)) {
      return candidate;
    }
  }

  return "";
}

function findStandaloneNameLine(text, phone, email) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const contactIndex = findFirstContactIndex(text, phone, email);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const lineIndex = text.lastIndexOf(line);
    if (contactIndex >= 0 && lineIndex > contactIndex) {
      continue;
    }

    const labelled = line.match(/^(?:name|full name)\s*[:\-]\s*(.+)$/i)?.[1] || "";
    if (labelled && looksLikeHumanName(labelled)) {
      return labelled;
    }

    const beforeContact = extractNameBeforeInlineContact(line, phone, email);
    if (beforeContact && looksLikeHumanName(beforeContact)) {
      return beforeContact;
    }

    if (looksLikeStandaloneNameLine(line)) {
      return line;
    }
  }

  return "";
}

function extractNameBeforeInlineContact(line, phone, email) {
  const candidates = [];

  if (email && line.includes(email)) {
    candidates.push(line.slice(0, line.indexOf(email)));
  }

  if (phone && line.includes(phone)) {
    candidates.push(line.slice(0, line.indexOf(phone)));
  }

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/(?:^|[,;|\-]\s*)?(?:email|e-mail|phone|cell|mobile)\s*[:\-]?\s*$/i, "")
      .replace(/[,;|\-]\s*$/g, "")
      .trim();

    if (looksLikeHumanName(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function findFirstContactIndex(text, phone, email) {
  const indices = [];

  if (phone) {
    indices.push(text.indexOf(phone));
  }

  if (email) {
    indices.push(text.indexOf(email));
  }

  const valid = indices.filter((index) => index >= 0);
  return valid.length > 0 ? Math.min(...valid) : -1;
}

function looksLikeHumanName(candidate) {
  const cleaned = sanitizeDetectedName(candidate);
  if (!cleaned) {
    return false;
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return tokens.every((token) => {
    const normalized = token.toLowerCase();
    return (
      /^[a-z][a-z'\u2019-]*$/i.test(token) &&
      !NON_NAME_WORDS.has(normalized) &&
      !LOCATION_TOKENS.has(normalized)
    );
  });
}

function looksLikeStandaloneNameLine(line) {
  const cleaned = sanitizeDetectedName(line);
  if (!cleaned || /[@\d]/.test(cleaned)) {
    return false;
  }

  if (/[.!?]/.test(cleaned)) {
    return false;
  }

  return looksLikeHumanName(cleaned) && hasNameLikeCapitalization(cleaned);
}

function hasNameLikeCapitalization(candidate) {
  const tokens = candidate.split(/\s+/).filter(Boolean);
  return tokens.every((token) => /^[A-Z][a-z'\u2019-]*$/.test(token));
}

function sanitizeDetectedName(name) {
  return String(name || "")
    .replace(/^(?:my name is|this is|i am|i'm)\s+/i, "")
    .replace(/[,.]+$/g, "")
    .trim();
}

module.exports = {
  parseContact,
  sanitizeDetectedName,
};
