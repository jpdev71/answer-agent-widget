const crypto = require("crypto");
const evie = require("../evie");

async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      provider: "elevenlabs",
      transport: "custom_llm",
      expects: "openai_chat_completions",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    assertAuthorizedRequest(req);
    const body = parseBody(req.body);
    const messages = normalizeMessages(body.messages);
    const currentMessage = getLastUserMessage(messages);
    if (!currentMessage) {
      res.status(400).json({ error: "A user message is required." });
      return;
    }

    const eviePayload = buildEviePayload(body, messages, currentMessage);
    const evieResponse = await evie.processEvieTurn(eviePayload);

    if (body.stream) {
      streamChatCompletion(res, body, evieResponse.reply_text);
      return;
    }

    res.status(200).json(buildChatCompletion(body, evieResponse.reply_text));
  } catch (error) {
    res.status(error?.statusCode || 500).json({
      error: error?.message || "Unexpected error.",
    });
  }
}

module.exports = handler;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-evie-transport-key",
  );
}

function assertAuthorizedRequest(req) {
  const configuredSecret = readString(process.env.ELEVENLABS_LLM_SHARED_SECRET);
  if (!configuredSecret) {
    return;
  }

  const headerSecret =
    readString(req.headers?.["x-evie-transport-key"]) ||
    readBearerToken(req.headers?.authorization);

  if (headerSecret !== configuredSecret) {
    const error = new Error("Unauthorized.");
    error.statusCode = 401;
    throw error;
  }
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

function readBearerToken(value) {
  const raw = readString(value);
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((entry) => ({
      role: entry?.role === "assistant" ? "assistant" : entry?.role === "user" ? "user" : "system",
      content: flattenContent(entry?.content),
    }))
    .filter((entry) => entry.content);
}

function flattenContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (item?.type === "text" || item?.type === "input_text") {
        return readString(item.text);
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getLastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index].content;
    }
  }

  return "";
}

function buildEviePayload(body, messages, currentMessage) {
  const extra = body?.elevenlabs_extra_body || {};
  const conversationHistory = messages
    .filter((entry) => entry.role === "assistant" || entry.role === "user")
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

  return {
    channel: "voice",
    message: currentMessage,
    session_id:
      readString(body.user_id) ||
      readString(extra.conversation_id) ||
      readString(extra.session_id) ||
      "elevenlabs-session",
    page_url: readString(extra.page_url),
    page_title: readString(extra.page_title),
    conversation_history: conversationHistory,
    voice_meta: {
      input_mode: "dedicated_runtime",
      stt_provider: "elevenlabs",
      tts_provider: "elevenlabs",
      transport: "elevenlabs_custom_llm",
      utterance_mode: "managed_turn_taking",
    },
  };
}

function buildChatCompletion(body, replyText) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: readString(body.model) || "evie-elevenlabs",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: replyText,
        },
      },
    ],
  };
}

function streamChatCompletion(res, body, replyText) {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = readString(body.model) || "evie-elevenlabs";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const roleChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
        },
        finish_reason: null,
      },
    ],
  };

  const contentChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {
          content: replyText,
        },
        finish_reason: null,
      },
    ],
  };

  const doneChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };

  res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
  res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
  res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
