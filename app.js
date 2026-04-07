const state = {
  provider: "evie-api",
  mode: "chat",
  isVoiceModeActive: false,
  recognition: null,
  conversationHistory: [],
  hasRenderedWelcome: false,
};

const providers = {
  "evie-api": {
    label: "Evie API",
    async sendText(message) {
      try {
        const response = await fetch("/api/evie", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: state.mode,
            message,
            session_id: getSessionId(),
            page_url: window.location.href,
            page_title: document.title,
            conversation_history: state.conversationHistory,
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
          meta: { fallback: true, error: error.message, response_source: "temporary_unavailable" },
        };
      }
    },
    async startVoice() {
      return "Voice mode is still using browser speech recognition as a placeholder. The shared Evie backend now powers the response once your transcript is captured.";
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
  state.isVoiceModeActive = !state.isVoiceModeActive;
  voiceToggle.classList.toggle("is-active", state.isVoiceModeActive);
  voiceToggle.textContent = state.isVoiceModeActive ? "Stop Voice" : "Start Voice";

  if (!state.isVoiceModeActive) {
    stopBrowserRecognition();
    setStatus("Voice mode stopped.");
    return;
  }

  const providerMessage = await providers[state.provider].startVoice();
  addAgentMessage(providerMessage);

  const recognitionStarted = startBrowserRecognition();
  if (recognitionStarted) {
    setStatus("Listening with browser speech recognition.");
  } else {
    setStatus("Voice mode started in placeholder mode. Browser speech recognition is unavailable here.");
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

  const response = await providers[state.provider].sendText(message);
  addAgentMessage(response.text);
  state.conversationHistory.push({ role: "assistant", content: response.text });

  if (response.meta?.fallback) {
    setStatus("API unavailable. Replied using local fallback.");
    return;
  }

  if (response.meta?.response_source === "temporary_unavailable") {
    setStatus("The full assistant is temporarily unavailable.");
    return;
  }

  if (response.meta?.offer_consult_link) {
    setStatus("Replied and offered a consultation path.");
    return;
  }

  setStatus(`Replied using ${providers[state.provider].label}.`);
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

  addAgentMessage(
    "Hi, I'm Evie. You can ask me questions about personal injury matters, consultations, or next steps. Use Chat or Voice to get started."
  );
  state.hasRenderedWelcome = true;
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

  state.recognition.addEventListener("result", async (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (!transcript) {
      return;
    }

    addUserMessage(transcript);
    state.conversationHistory.push({ role: "user", content: transcript });
    setStatus("Processing voice transcript...");
    const response = await providers[state.provider].sendText(transcript);
    addAgentMessage(response.text);
    state.conversationHistory.push({ role: "assistant", content: response.text });

    if (response.meta?.fallback) {
      setStatus("Voice response completed using local fallback.");
      return;
    }

    if (response.meta?.response_source === "temporary_unavailable") {
      setStatus("The full voice assistant is temporarily unavailable.");
      return;
    }

    setStatus(`Voice response completed using ${providers[state.provider].label}.`);
  });

  state.recognition.addEventListener("error", (event) => {
    setStatus(`Browser speech recognition error: ${event.error}`);
  });

  state.recognition.addEventListener("end", () => {
    if (state.isVoiceModeActive && state.recognition) {
      state.recognition.start();
    }
  });

  state.recognition.start();
  return true;
}

function stopBrowserRecognition() {
  if (!state.recognition) {
    return;
  }

  state.recognition.onend = null;
  state.recognition.stop();
  state.recognition = null;
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
