const state = {
  provider: "demo",
  mode: "chat",
  isVoiceModeActive: false,
  recognition: null,
};

const knowledgeBase = {
  consultation:
    "Yes. This demo firm offers free consultations and encourages potential clients to reach out promptly after an accident.",
  location:
    "This demo is modeled on a Georgia personal injury practice serving the Norcross area and nearby counties.",
  practiceAreas:
    "The firm handles personal injury matters such as car accidents, truck accidents, slip and falls, pedestrian injuries, motorcycle collisions, catastrophic injuries, nursing home abuse, and wrongful death matters.",
  deadline:
    "For demo purposes, the assistant explains that many Georgia personal injury claims have a two-year filing deadline, but visitors should speak with a lawyer quickly because exceptions can affect timing.",
  value:
    "Claim value depends on facts like medical bills, lost income, future care, pain and suffering, and how strongly liability can be proven.",
  nextSteps:
    "A helpful first step is to get medical care, preserve photos and records, avoid detailed insurer statements without counsel, and request a consultation with the firm.",
  differentiators:
    "This demo emphasizes attorney-led representation, experience dealing with insurers, trial readiness, and a relationship-focused approach rather than handing clients off to a generic case manager.",
  disclaimer:
    "This assistant is a demo and should not provide legal advice or promise outcomes. Urgent or high-stakes matters should be escalated to the firm directly.",
};

const promptResponses = [
  {
    match: ["free consultation", "consultation", "case review", "cost"],
    response:
      `${knowledgeBase.consultation} If you want, I can also help explain what information a firm usually asks for during an intake conversation.`,
  },
  {
    match: ["what kinds of cases", "practice areas", "handle", "car accident", "truck accident", "slip and fall"],
    response:
      `${knowledgeBase.practiceAreas} If you tell me what happened, I can suggest which practice area best matches the issue.`,
  },
  {
    match: ["how long", "deadline", "statute", "file a claim", "two years"],
    response:
      `${knowledgeBase.deadline} The safest guidance for a visitor is to contact the firm as soon as possible rather than waiting.`,
  },
  {
    match: ["what should i do", "after a car accident", "after an accident", "next step"],
    response:
      `${knowledgeBase.nextSteps} If the visitor wants, the assistant can help prepare them for a consultation by organizing the timeline and injuries.`,
  },
  {
    match: ["worth", "value", "settlement", "compensation"],
    response:
      `${knowledgeBase.value} A good assistant should avoid guessing a dollar figure and instead invite a lawyer review.`,
  },
  {
    match: ["why choose", "why hire", "why your firm", "difference"],
    response:
      `${knowledgeBase.differentiators} That tone works well for a law-firm intake assistant because it is confident without sounding pushy.`,
  },
];

const providers = {
  demo: {
    label: "Demo simulator",
    async sendText(message) {
      await sleep(350);
      return buildDemoResponse(message);
    },
    async startVoice() {
      return "Voice mode is active in demo form. Speak naturally and I will turn the transcript into a chat response.";
    },
  },
  elevenlabs: {
    label: "ElevenLabs",
    async sendText(message) {
      await sleep(220);
      return `ElevenLabs is selected as the primary integration path. For now this is still using demo logic underneath. Your message was: "${message}". The next step is adding a protected server endpoint so the widget can create or forward real agent requests without exposing the API key.`;
    },
    async startVoice() {
      return "ElevenLabs voice mode is the intended first live integration. This placeholder keeps the UX intact while we decide the exact auth and session flow.";
    },
  },
  retell: {
    label: "Retell",
    async sendText() {
      await sleep(220);
      return "Retell is available as a future option, but this demo is currently optimized around an ElevenLabs-first path.";
    },
    async startVoice() {
      return "Retell voice mode is stubbed for comparison testing later if we want to benchmark another voice stack.";
    },
  },
  heygen: {
    label: "HeyGen planning",
    async sendText() {
      await sleep(220);
      return "HeyGen is being treated as a later avatar layer rather than the first production integration for this demo.";
    },
    async startVoice() {
      return "HeyGen planning mode is active. If we add it later, it will likely sit on top of a chat or voice engine rather than replace one.";
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
const jumpToWidgetButton = document.querySelector("#jump-to-widget");
const modeChatButton = document.querySelector("#mode-chat");
const modeVoiceButton = document.querySelector("#mode-voice");
const voicePanel = document.querySelector("#voice-panel");
const promptChips = document.querySelector("#prompt-chips");

launcher.addEventListener("click", toggleWidgetVisibility);
closeButton.addEventListener("click", () => {
  widget.classList.add("is-hidden");
  launcher.setAttribute("aria-expanded", "false");
});

jumpToWidgetButton.addEventListener("click", () => {
  widget.classList.remove("is-hidden");
  launcher.setAttribute("aria-expanded", "true");
  messageInput.focus();
});

providerSelect.addEventListener("change", (event) => {
  state.provider = event.target.value;
  setStatus(`Provider changed to ${providers[state.provider].label}.`);
  addAgentMessage(`Switched to ${providers[state.provider].label}.`);
});

modeChatButton.addEventListener("click", () => setMode("chat"));
modeVoiceButton.addEventListener("click", () => setMode("voice"));

promptChips.addEventListener("click", async (event) => {
  const button = event.target.closest(".prompt-chip");
  if (!button) {
    return;
  }

  const prompt = button.dataset.prompt;
  messageInput.value = prompt;
  await submitCurrentMessage();
});

composer.addEventListener("submit", async (event) => {
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
  messageInput.value = "";
  setStatus("Thinking...");

  const response = await providers[state.provider].sendText(message);
  addAgentMessage(response);
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
  paragraph.textContent = content;

  article.append(paragraph);
  messageList.append(article);
  messageList.scrollTop = messageList.scrollHeight;
}

function setStatus(message) {
  statusText.textContent = message;
}

function buildDemoResponse(message) {
  const normalized = message.toLowerCase();
  const matchedPrompt = promptResponses.find((entry) =>
    entry.match.some((term) => normalized.includes(term)),
  );

  if (matchedPrompt) {
    return matchedPrompt.response;
  }

  if (normalized.includes("phone") || normalized.includes("call")) {
    return "This demo can surface a prominent call option for urgent matters, especially when the visitor seems ready to speak with the firm directly.";
  }

  if (normalized.includes("attorney") || normalized.includes("lawyer")) {
    return `The assistant can explain that the firm emphasizes direct attorney involvement and experience dealing with insurers. ${knowledgeBase.disclaimer}`;
  }

  return "This demo assistant is designed to answer common personal injury questions, guide visitors toward a consultation, and avoid overpromising. A strong next step is to tune the responses around the firm's exact intake language and contact flow.";
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
