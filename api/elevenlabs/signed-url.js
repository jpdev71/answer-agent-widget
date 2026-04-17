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
      res.status(response.status).json(payload);
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
