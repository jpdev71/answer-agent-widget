const state = {
  provider: "demo",
  isVoiceModeActive: false,
  recognition: null,
};

const providers = {
  demo: {
    label: "Demo Simulator",
    async sendText(message) {
      await sleep(450);
      return `Demo response: I received "${message}". This is where a server-backed answer agent response would appear.`;
    },
    async startVoice() {
      return "Voice simulation enabled. In a live build, this would connect to browser speech capture and the selected provider.";
    },
  },
  elevenlabs: {
    label: "ElevenLabs",
    async sendText() {
      return "ElevenLabs wiring is not connected yet. Next step: add a small server endpoint for agent auth and request forwarding.";
    },
    async startVoice() {
      return "ElevenLabs voice mode is planned. We can connect this once we choose their agent setup and add API credentials.";
    },
  },
  retell: {
    label: "Retell",
    async sendText() {
      return "Retell support is stubbed for now. We can swap this to a Retell-backed call flow or chat flow after the UI is approved.";
    },
    async startVoice() {
      return "Retell voice mode is stubbed. A production version would create a signed session and hand off microphone audio.";
    },
  },
  heygen: {
    label: "HeyGen",
    async sendText() {
      return "HeyGen is best treated as a later avatar layer. This placeholder keeps the UI provider-agnostic for now.";
    },
    async startVoice() {
      return "HeyGen live avatar planning stub. We can pair it with a voice/text engine after the core chat experience feels right.";
    },
  },
};

const launcher = document.querySelector("#widget-launcher");
const widget = document.querySelector("#answer-agent-widget");
const closeButton = document.querySelector("#widget-close");
const providerSelect = document.querySelector("#provider-select");
const messageList = document.querySelector("#message-list");
const composer = document.querySelector("#composer");
const messageInput = document.querySelector("#message-input");
const voiceToggle = document.querySelector("#voice-toggle");
const statusText = document.querySelector("#status-text");

launcher.addEventListener("click", () => {
  const isHidden = widget.classList.toggle("is-hidden");
  launcher.setAttribute("aria-expanded", String(!isHidden));
});

closeButton.addEventListener("click", () => {
  widget.classList.add("is-hidden");
  launcher.setAttribute("aria-expanded", "false");
});

providerSelect.addEventListener("change", (event) => {
  state.provider = event.target.value;
  const provider = providers[state.provider];
  setStatus(`Provider changed to ${provider.label}.`);
  addAgentMessage(`Switched to ${provider.label}.`);
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) {
    setStatus("Enter a message before sending.");
    return;
  }

  addUserMessage(message);
  messageInput.value = "";
  setStatus("Thinking...");

  const response = await providers[state.provider].sendText(message);
  addAgentMessage(response);
  setStatus(`Replied using ${providers[state.provider].label}.`);
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
  paragraph.textContent = content;

  article.append(paragraph);
  messageList.append(article);
  messageList.scrollTop = messageList.scrollHeight;
}

function setStatus(message) {
  statusText.textContent = message;
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
    setStatus("Processing voice transcript...");
    const response = await providers[state.provider].sendText(transcript);
    addAgentMessage(response);
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
