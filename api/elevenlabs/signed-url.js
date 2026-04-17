module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const apiKey = readString(process.env.ELEVENLABS_API_KEY);
  const agentId = readString(process.env.ELEVENLABS_AGENT_ID);
  if (!apiKey || !agentId) {
    res.status(400).json({
      error: "Missing ElevenLabs configuration.",
      missing: [
        !apiKey ? "ELEVENLABS_API_KEY" : "",
        !agentId ? "ELEVENLABS_AGENT_ID" : "",
      ].filter(Boolean),
    });
    return;
  }

  const includeConversationId = req.query?.include_conversation_id === "true";
  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
  url.searchParams.set("agent_id", agentId);
  if (includeConversationId) {
    url.searchParams.set("include_conversation_id", "true");
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      res.status(response.status).json({
        error: "Failed to fetch ElevenLabs signed URL.",
        upstream_status: response.status,
        upstream_error: extractUpstreamError(payload),
        upstream_payload: payload,
      });
      return;
    }

    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: "Failed to fetch ElevenLabs signed URL.",
      detail: error instanceof Error ? error.message : "unknown_error",
    });
  }
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractUpstreamError(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail.trim();
  }

  if (payload.detail && typeof payload.detail === "object") {
    if (typeof payload.detail.message === "string" && payload.detail.message.trim()) {
      const status =
        typeof payload.detail.status === "string" && payload.detail.status.trim()
          ? payload.detail.status.trim()
          : "";
      return status ? `${status}: ${payload.detail.message.trim()}` : payload.detail.message.trim();
    }

    if (typeof payload.detail.status === "string" && payload.detail.status.trim()) {
      return payload.detail.status.trim();
    }
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (payload.error && typeof payload.error === "object") {
    if (typeof payload.error.message === "string" && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.error.code === "string" && payload.error.code.trim()) {
      return payload.error.code.trim();
    }
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return "";
}
