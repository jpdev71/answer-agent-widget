const state = {
  provider: "evie-api",
  mode: "chat",
  isVoiceModeActive: false,
  isVoiceReplyPlaying: false,
  isVoiceRecognitionStarting: false,
  recognition: null,
  activeSpeechUtterance: null,
  conversationHistory: [],
  hasRenderedWelcome: false,
  lastAssistantReply: "",
  lastVoiceReplyEndedAt: 0,
  voicePreview: {
    enabled: false,
    currentFirmEnabled: false,
    reason: "flag_disabled",
    transport: "browser_native",
    utteranceMode: "single_turn",
    sttProvider: "browser_speech_recognition",
    ttsProvider: "browser_speech_synthesis",
  },
  welcomeMessage:
    "Hi, I'm Evie. You can ask me questions about personal injury matters, consultations, or next steps. Use Chat or Voice to get started.",
};

const providers = {
  "evie-api": {
    label: "Evie API",
    async sendText(message, options = {}) {
      const channel = options.channel === "voice" ? "voice" : state.mode;
      const voiceMeta = normalizeVoiceMeta(options.voiceMeta);

      try {
        const response = await fetch("/api/evie", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel,
            message,
            session_id: getSessionId(),
            page_url: window.location.href,
            page_title: document.title,
            conversation_history: state.conversationHistory,
            voice_meta: voiceMeta,
          }),
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const payload = await response.json();
        return { text: payload.reply_text, meta: payload };
      } catch (error) {
        return {
          text:
            "I'm having trouble reaching the full assistant right now. Please try again in a moment, or share your name, phone number, and email if you'd like the firm to follow up.",
          meta: {
            fallback: true,
            error: error.message,
            response_source: "temporary_unavailable",
            observability: {
              runtime: {
                request_channel: channel,
                response_source: "temporary_unavailable",
                fallback_reason: "network_request_failed",
              },
              voice_transport: voiceMeta,
            },
          },
        };
      }
    },
    async startVoice() {
      if (!state.voicePreview.enabled || !state.voicePreview.currentFirmEnabled) {
        return "Voice preview is not enabled for this firm yet.";
      }

      return "Voice preview is now in live conversation mode. Evie will keep listening until you press Stop Voice.";
    },
  },
};

const launcher = document.querySelector("#widget-launcher");
const widget = document.querySelector("#answer-agent-widget");
const closeButton = document.querySelector("#widget-close");
const messageList = document.querySelector("#message-list");
const composer = document.querySelector("#composer");
const messageInput = document.querySelector("#message-input");
const voiceToggle = document.querySelector("#voice-toggle");
const statusText = document.querySelector("#status-text");
const jumpToWidgetButton = document.querySelector("#jump-to-widget");
const modeChatButton = document.querySelector("#mode-chat");
const modeVoiceButton = document.querySelector("#mode-voice");
const voicePanel = document.querySelector("#voice-panel");
const voiceCopy = document.querySelector(".voice-copy");
const voiceReplayButton = document.querySelector("#voice-replay");

updateVoicePreviewUi();

launcher.addEventListener("click", toggleWidgetVisibility);
closeButton.addEventListener("click", () => {
  widget.classList.add("is-hidden");
  launcher.setAttribute("aria-expanded", "false");
});

jumpToWidgetButton.addEventListener("click", () => {
  widget.classList.remove("is-hidden");
  launcher.setAttribute("aria-expanded", "true");
  ensureWelcomeMessage();
  messageInput.focus();
});

modeChatButton.addEventListener("click", () => setMode("chat"));
modeVoiceButton.addEventListener("click", () => setMode("voice"));
voiceReplayButton.addEventListener("click", async () => {
  if (!state.lastAssistantReply) {
    setStatus("There is no reply available to replay yet.");
    return;
  }

  const playback = await speakReply(state.lastAssistantReply);
  setStatus(
    playback.spoken
      ? "Replaying Evie's last reply aloud."
      : `Replay unavailable (${playback.reason}).`,
  );
});
loadWidgetConfig();

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCurrentMessage();
});

messageInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  await submitCurrentMessage();
});

voiceToggle.addEventListener("click", async () => {
  if (!state.voicePreview.enabled || !state.voicePreview.currentFirmEnabled) {
    setStatus("Voice preview is not available for this firm.");
    return;
  }

  state.isVoiceModeActive = !state.isVoiceModeActive;
  voiceToggle.classList.toggle("is-active", state.isVoiceModeActive);
  voiceToggle.textContent = state.isVoiceModeActive ? "Stop Voice" : "Start Voice";

  if (!state.isVoiceModeActive) {
    resetVoiceTransport();
    setStatus("Voice mode stopped.");
    return;
  }

  const providerMessage = await providers[state.provider].startVoice();
  addAgentMessage(providerMessage);

  const recognitionStarted = startBrowserRecognition();
  if (recognitionStarted) {
    setStatus("Listening for your next question...");
  } else {
    state.isVoiceModeActive = false;
    voiceToggle.classList.remove("is-active");
    voiceToggle.textContent = "Start Voice";
    setStatus("Voice preview is unavailable because browser speech recognition is not supported here.");
  }
});

function toggleWidgetVisibility() {
  const isHidden = widget.classList.toggle("is-hidden");
  launcher.setAttribute("aria-expanded", String(!isHidden));

  if (!isHidden) {
    ensureWelcomeMessage();
    messageInput.focus();
  }
}

function setMode(mode) {
  if (mode === "voice" && (!state.voicePreview.enabled || !state.voicePreview.currentFirmEnabled)) {
    mode = "chat";
  }

  state.mode = mode;
  const isVoice = mode === "voice";
  modeChatButton.classList.toggle("is-active", !isVoice);
  modeVoiceButton.classList.toggle("is-active", isVoice);
  modeChatButton.setAttribute("aria-selected", String(!isVoice));
  modeVoiceButton.setAttribute("aria-selected", String(isVoice));
  voicePanel.classList.toggle("is-hidden", !isVoice);
  setStatus(isVoice ? "Voice tab selected." : "Chat tab selected.");
}

async function submitCurrentMessage() {
  const message = messageInput.value.trim();
  if (!message) {
    setStatus("Enter a message before sending.");
    return;
  }

  addUserMessage(message);
  state.conversationHistory.push({ role: "user", content: message });
  messageInput.value = "";
  setStatus("Thinking...");

  const channel = state.mode === "voice" ? "voice" : "chat";
  const response = await providers[state.provider].sendText(message, { channel });
  await finalizeAssistantTurn(response, { channel, speakReply: channel === "voice" });
}

function addUserMessage(content) {
  addMessage(content, "user");
}

function addAgentMessage(content) {
  addMessage(content, "agent");
}

function addMessage(content, role) {
  const article = document.createElement("article");
  article.className = `message message-${role}`;

  const paragraph = document.createElement("p");
  appendFormattedMessage(paragraph, content);

  article.append(paragraph);
  messageList.append(article);
  messageList.scrollTop = messageList.scrollHeight;
}

function setStatus(message) {
  statusText.textContent = message;
}

function ensureWelcomeMessage() {
  if (state.hasRenderedWelcome) {
    return;
  }

  addAgentMessage(state.welcomeMessage);
  state.hasRenderedWelcome = true;
}

async function loadWidgetConfig() {
  try {
    const response = await fetch("/api/evie");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (typeof payload.welcome_message === "string" && payload.welcome_message.trim()) {
      state.welcomeMessage = payload.welcome_message.trim();
    }

    state.voicePreview = normalizeVoicePreview(payload.voice_preview);
    updateVoicePreviewUi();
  } catch {
    // Keep the baked-in welcome copy if config loading fails.
    updateVoicePreviewUi();
  }
}

function startBrowserRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  if (!SpeechRecognition) {
    return false;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.lang = "en-US";
  state.recognition.interimResults = false;
  state.recognition.maxAlternatives = 1;
  state.recognition.continuous = false;

  state.recognition.addEventListener("result", async (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (!transcript) {
      return;
    }

    if (shouldIgnoreVoiceTranscript(transcript)) {
      stopBrowserRecognition();
      setStatus("Ignored a likely echo of Evie's own reply. Still listening...");
      queueVoiceRecognitionRestart();
      return;
    }

    addUserMessage(transcript);
    state.conversationHistory.push({ role: "user", content: transcript });
    setStatus("Processing voice transcript...");
    stopBrowserRecognition();
    const response = await providers[state.provider].sendText(transcript, {
      channel: "voice",
      voiceMeta: {
        inputMode: "continuous_session",
        sttProvider: state.voicePreview.sttProvider,
        ttsProvider: state.voicePreview.ttsProvider,
        transport: state.voicePreview.transport,
        utteranceMode: "continuous_session",
      },
    });
    await finalizeAssistantTurn(response, { channel: "voice", speakReply: true });
    queueVoiceRecognitionRestart();
  });

  state.recognition.addEventListener("error", (event) => {
    if (
      state.isVoiceModeActive &&
      event.error !== "aborted" &&
      event.error !== "no-speech" &&
      event.error !== "audio-capture"
    ) {
      state.isVoiceModeActive = false;
      voiceToggle.classList.remove("is-active");
      voiceToggle.textContent = "Start Voice";
    }
    setStatus(`Browser speech recognition error: ${event.error}`);
    if (state.isVoiceModeActive && (event.error === "no-speech" || event.error === "aborted")) {
      queueVoiceRecognitionRestart();
    }
  });

  state.recognition.addEventListener("end", () => {
    state.recognition = null;

    if (state.isVoiceModeActive && !state.isVoiceReplyPlaying) {
      queueVoiceRecognitionRestart();
    }
  });

  state.recognition.start();
  return true;
}

function stopBrowserRecognition() {
  if (!state.recognition) {
    state.isVoiceRecognitionStarting = false;
    return;
  }

  state.recognition.onend = null;
  state.recognition.stop();
  state.recognition = null;
  state.isVoiceRecognitionStarting = false;
}

function stopSpeechPlayback() {
  if (!("speechSynthesis" in window)) {
    state.activeSpeechUtterance = null;
    return;
  }

  window.speechSynthesis.cancel();
  state.activeSpeechUtterance = null;
}

function resetVoiceTransport() {
  stopBrowserRecognition();
  stopSpeechPlayback();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getSessionId() {
  const storageKey = "evie-demo-session-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const sessionId = `session-${crypto.randomUUID()}`;
  window.localStorage.setItem(storageKey, sessionId);
  return sessionId;
}

function appendFormattedMessage(container, content) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlPattern);

  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (urlPattern.test(part)) {
      const link = document.createElement("a");
      link.href = part;
      link.textContent =
        part.includes("calendly.com/social-amplifier/dermer-appel-ruder")
          ? "Schedule a consultation"
          : part;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      container.append(link);
      urlPattern.lastIndex = 0;
      continue;
    }

    container.append(document.createTextNode(part));
    urlPattern.lastIndex = 0;
  }
}

function formatWebhookStatus(webhookMeta) {
  if (!webhookMeta) {
    return "";
  }

  if (webhookMeta.attempted) {
    return webhookMeta.delivered
      ? "Lead webhook delivered."
      : `Lead webhook failed (${webhookMeta.reason || "unknown"}).`;
  }

  return `Lead webhook not sent (${webhookMeta.reason || "conditions_not_met"}).`;
}

function normalizeVoicePreview(voicePreview) {
  return {
    enabled: Boolean(voicePreview?.enabled),
    currentFirmEnabled: Boolean(voicePreview?.current_firm_enabled),
    reason: typeof voicePreview?.reason === "string" ? voicePreview.reason : "flag_disabled",
    transport: typeof voicePreview?.transport === "string" ? voicePreview.transport : "browser_native",
    utteranceMode:
      typeof voicePreview?.utterance_mode === "string"
        ? voicePreview.utterance_mode
        : "single_turn",
    sttProvider:
      typeof voicePreview?.stt_provider === "string"
        ? voicePreview.stt_provider
        : "browser_speech_recognition",
    ttsProvider:
      typeof voicePreview?.tts_provider === "string"
        ? voicePreview.tts_provider
        : "browser_speech_synthesis",
  };
}

function normalizeVoiceMeta(voiceMeta) {
  if (!voiceMeta || typeof voiceMeta !== "object") {
    return null;
  }

  return {
    input_mode: typeof voiceMeta.inputMode === "string" ? voiceMeta.inputMode : "",
    stt_provider: typeof voiceMeta.sttProvider === "string" ? voiceMeta.sttProvider : "",
    tts_provider: typeof voiceMeta.ttsProvider === "string" ? voiceMeta.ttsProvider : "",
    transport: typeof voiceMeta.transport === "string" ? voiceMeta.transport : "",
    utterance_mode: typeof voiceMeta.utteranceMode === "string" ? voiceMeta.utteranceMode : "",
  };
}

function updateVoicePreviewUi() {
  const isEnabled = state.voicePreview.enabled && state.voicePreview.currentFirmEnabled;

  modeVoiceButton.hidden = !isEnabled;
  modeVoiceButton.disabled = !isEnabled;

  if (!isEnabled && state.mode === "voice") {
    setMode("chat");
  }

  if (voiceCopy) {
    voiceCopy.textContent = isEnabled
      ? "Speak one question, and Evie will route the transcript through the same backend used for chat before reading the reply aloud."
      : "Voice preview is currently disabled for this firm. Chat remains the supported path while we compare transport behavior safely.";
  }

  voiceToggle.disabled = !isEnabled;
  voiceReplayButton.disabled = !isEnabled || !state.lastAssistantReply;
  voiceToggle.textContent = "Start Voice";
  voiceToggle.classList.remove("is-active");
  voicePanel.classList.toggle("is-hidden", state.mode !== "voice" || !isEnabled);
}

async function finalizeAssistantTurn(response, options) {
  addAgentMessage(response.text);
  state.lastAssistantReply = response.text;
  voiceReplayButton.disabled = !state.voicePreview.enabled || !state.voicePreview.currentFirmEnabled;
  state.conversationHistory.push({ role: "assistant", content: response.text });

  let playback = { spoken: false, reason: "not_requested" };
  if (options.speakReply) {
    playback = await speakReply(response.text);
  }

  setStatus(buildTurnStatus(response, options, playback));
  console.info("Evie turn observability", response.meta?.observability || {});
  if (options.channel === "voice" && !playback.spoken) {
    console.warn("Evie voice playback unavailable", playback);
  }
}

function buildTurnStatus(response, options, playback = { spoken: false, reason: "not_requested" }) {
  const webhookStatus = formatWebhookStatus(response.meta?.webhook_delivery);
  const runtime = response.meta?.observability?.runtime || {};
  const latencyText =
    Number.isFinite(runtime.latency_ms) && runtime.latency_ms >= 0
      ? ` in ${runtime.latency_ms}ms`
      : "";

  if (response.meta?.fallback) {
    return options.channel === "voice"
      ? `Voice transport fallback${latencyText}.`
      : `API unavailable${latencyText}. Replied using local fallback.`;
  }

  if (response.meta?.response_source === "temporary_unavailable") {
    return options.channel === "voice"
      ? `Voice response unavailable${latencyText} (${runtime.fallback_reason || "temporary_unavailable"}).`
      : `The full assistant is temporarily unavailable${latencyText}.`;
  }

  if (options.channel === "voice") {
    const spokenSuffix = options.speakReply
      ? playback.spoken
        ? " Reply spoken aloud. Still listening."
        : ` Reply text is in the thread, but audio did not start (${playback.reason}).`
      : "";
    return webhookStatus
      ? `Voice turn completed via ${providers[state.provider].label}${latencyText}.${spokenSuffix} ${webhookStatus}`
      : `Voice turn completed via ${providers[state.provider].label}${latencyText}.${spokenSuffix}`;
  }

  if (response.meta?.offer_consult_link) {
    return webhookStatus
      ? `Replied and offered a consultation path${latencyText}. ${webhookStatus}`
      : `Replied and offered a consultation path${latencyText}.`;
  }

  return webhookStatus
    ? `Replied using ${providers[state.provider].label}${latencyText}. ${webhookStatus}`
    : `Replied using ${providers[state.provider].label}${latencyText}.`;
}

function speakReply(text) {
  stopSpeechPlayback();

  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
    return Promise.resolve({ spoken: false, reason: "speech_synthesis_unavailable" });
  }

  return new Promise((resolve) => {
    const utterance = new window.SpeechSynthesisUtterance(text);
    let started = false;
    let settled = false;
    state.isVoiceReplyPlaying = true;

    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.addEventListener("start", () => {
      started = true;
    });
    utterance.addEventListener("error", (event) => {
      if (!settled) {
        settled = true;
        resolve({ spoken: false, reason: event.error || "speech_synthesis_error" });
      }
      state.isVoiceReplyPlaying = false;
      state.lastVoiceReplyEndedAt = Date.now();
      if (state.activeSpeechUtterance === utterance) {
        state.activeSpeechUtterance = null;
      }
    });
    utterance.addEventListener("end", () => {
      if (!settled) {
        settled = true;
        resolve({
          spoken: started,
          reason: started ? "" : "speech_synthesis_ended_without_start",
        });
      }
      state.isVoiceReplyPlaying = false;
      state.lastVoiceReplyEndedAt = Date.now();
      if (state.activeSpeechUtterance === utterance) {
        state.activeSpeechUtterance = null;
      }
    });

    state.activeSpeechUtterance = utterance;

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      state.isVoiceReplyPlaying = false;
      state.activeSpeechUtterance = null;
      resolve({
        spoken: false,
        reason: error instanceof Error ? error.message : "speech_synthesis_exception",
      });
      return;
    }

    window.setTimeout(() => {
      if (settled) {
        return;
      }

      if (started || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        return;
      }

      settled = true;
      state.isVoiceReplyPlaying = false;
      state.lastVoiceReplyEndedAt = Date.now();
      if (state.activeSpeechUtterance === utterance) {
        state.activeSpeechUtterance = null;
      }
      resolve({
        spoken: false,
        reason: "speech_synthesis_not_started",
      });
    }, 1800);
  });
}

function queueVoiceRecognitionRestart() {
  if (!state.isVoiceModeActive || state.isVoiceReplyPlaying || state.recognition || state.isVoiceRecognitionStarting) {
    return;
  }

  state.isVoiceRecognitionStarting = true;
  window.setTimeout(() => {
    state.isVoiceRecognitionStarting = false;
    if (!state.isVoiceModeActive || state.isVoiceReplyPlaying || state.recognition) {
      return;
    }

    const restarted = startBrowserRecognition();
    if (restarted) {
      setStatus("Listening for your next question...");
      return;
    }

    state.isVoiceModeActive = false;
    voiceToggle.classList.remove("is-active");
    voiceToggle.textContent = "Start Voice";
    setStatus("Voice preview stopped because browser speech recognition is unavailable.");
  }, 1400);
}

function shouldIgnoreVoiceTranscript(transcript) {
  const now = Date.now();
  const normalizedTranscript = normalizeSpeechForComparison(transcript);
  const normalizedReply = normalizeSpeechForComparison(state.lastAssistantReply);

  if (!normalizedTranscript) {
    return false;
  }

  const withinCooldown =
    state.lastVoiceReplyEndedAt > 0 && now - state.lastVoiceReplyEndedAt < 2500;

  if (withinCooldown && normalizedReply && areSpeechStringsSimilar(normalizedTranscript, normalizedReply)) {
    return true;
  }

  return false;
}

function normalizeSpeechForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areSpeechStringsSimilar(transcript, reply) {
  if (!transcript || !reply) {
    return false;
  }

  if (reply.includes(transcript) || transcript.includes(reply)) {
    return true;
  }

  const transcriptWords = transcript.split(" ").filter(Boolean);
  const replyWords = reply.split(" ").filter(Boolean);

  if (transcriptWords.length === 0 || replyWords.length === 0) {
    return false;
  }

  const transcriptSet = new Set(transcriptWords);
  let overlapCount = 0;
  for (const word of replyWords) {
    if (transcriptSet.has(word)) {
      overlapCount += 1;
    }
  }

  const overlapRatio = overlapCount / Math.max(1, transcriptWords.length);
  return overlapRatio >= 0.7;
}
