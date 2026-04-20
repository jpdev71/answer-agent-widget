#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_CASES_PATH = path.join(process.cwd(), "qa", "evie-regression-cases.json");

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.baseUrl) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  const casesPath = path.resolve(options.casesPath || DEFAULT_CASES_PATH);
  const raw = fs.readFileSync(casesPath, "utf8");
  const cases = JSON.parse(raw);
  const sessionCookie = await getBypassCookie(options.baseUrl, options.bypassToken);

  const results = [];
  for (const testCase of cases) {
    const output = await invokeEvie(options.baseUrl, sessionCookie, testCase);
    results.push(evaluateCase(testCase, output));
  }

  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({ summary: buildSummary(results), results }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

function parseArgs(args) {
  const options = {
    baseUrl: "",
    casesPath: "",
    bypassToken: process.env.VERCEL_AUTOMATION_BYPASS_TOKEN || "",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--base-url") {
      options.baseUrl = readNextArg(args, ++index, arg);
    } else if (arg === "--cases") {
      options.casesPath = readNextArg(args, ++index, arg);
    } else if (arg === "--bypass-token") {
      options.bypassToken = readNextArg(args, ++index, arg);
    }
  }

  return options;
}

function readNextArg(args, index, flag) {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/run-evie-regression.js --base-url https://preview.vercel.app",
      "",
      "Options:",
      "  --cases <path>          Override the default qa/evie-regression-cases.json file.",
      "  --bypass-token <token>  Optional Vercel automation bypass token.",
      "  --help                  Show this message.",
    ].join("\n"),
  );
}

async function getBypassCookie(baseUrl, bypassToken) {
  if (!bypassToken) {
    return "";
  }

  const response = await fetch(
    `${trimTrailingSlash(baseUrl)}/?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${encodeURIComponent(bypassToken)}`,
    {
      redirect: "manual",
    },
  );

  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(__prerender_bypass|_vercel_jwt|_vercel_sso_nonce|_vercel_share_token|_vercel_live_token|_vercel_.*?bypass.*?)=([^;]+)/i);
  return match ? `${match[1]}=${match[2]}` : "";
}

async function invokeEvie(baseUrl, sessionCookie, testCase) {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/evie`, {
    method: "POST",
    headers: buildHeaders(sessionCookie),
    body: JSON.stringify({
      channel: "chat",
      message: testCase.message,
      conversation_history: Array.isArray(testCase.conversation_history)
        ? testCase.conversation_history
        : [],
    }),
  });

  const text = await response.text();
  const payload = safeJsonParse(text);
  return {
    status: response.status,
    ok: response.ok,
    payload,
    raw: text,
  };
}

function buildHeaders(sessionCookie) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  return headers;
}

function evaluateCase(testCase, output) {
  const failures = [];
  if (!output.ok || !output.payload || typeof output.payload !== "object") {
    failures.push(`Request failed with status ${output.status}.`);
    return buildResult(testCase, output, failures);
  }

  const payload = output.payload;
  const reply = readString(payload.reply_text);
  const expect = testCase.expect || {};

  for (const expectedText of expect.reply_includes || []) {
    if (!reply.toLowerCase().includes(String(expectedText).toLowerCase())) {
      failures.push(`Reply did not include expected text: "${expectedText}".`);
    }
  }

  for (const excludedText of expect.reply_excludes || []) {
    if (reply.toLowerCase().includes(String(excludedText).toLowerCase())) {
      failures.push(`Reply included disallowed text: "${excludedText}".`);
    }
  }

  if (typeof expect.request_contact_capture === "boolean") {
    if (Boolean(payload.request_contact_capture) !== expect.request_contact_capture) {
      failures.push(
        `request_contact_capture expected ${expect.request_contact_capture} but got ${Boolean(payload.request_contact_capture)}.`,
      );
    }
  }

  if (typeof expect.qualification_path === "string") {
    if (readString(payload.qualification_path) !== expect.qualification_path) {
      failures.push(
        `qualification_path expected "${expect.qualification_path}" but got "${readString(payload.qualification_path)}".`,
      );
    }
  }

  if (typeof expect.lead_email_matches === "string") {
    const actualEmail = readString(payload.lead_record?.visitor_email);
    const regex = new RegExp(expect.lead_email_matches, "i");
    if (!regex.test(actualEmail)) {
      failures.push(`visitor_email "${actualEmail}" did not match ${expect.lead_email_matches}.`);
    }
  }

  return buildResult(testCase, output, failures);
}

function buildResult(testCase, output, failures) {
  const payload = output.payload || {};
  return {
    id: testCase.id,
    category: testCase.category || "",
    passed: failures.length === 0,
    failures,
    reply_text: readString(payload.reply_text),
    qualification_path: readString(payload.qualification_path),
    request_contact_capture: Boolean(payload.request_contact_capture),
    lead_fields_needed: Array.isArray(payload.lead_fields_needed) ? payload.lead_fields_needed : [],
    lead_record: payload.lead_record || {},
    status: output.status,
  };
}

function buildSummary(results) {
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
