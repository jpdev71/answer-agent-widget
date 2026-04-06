const state = {
  provider: "evie-api",
  mode: "chat",
  isVoiceModeActive: false,
  recognition: null,
  conversationHistory: [],
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
          text: buildDemoResponse(message),
          meta: { fallback: true, error: error.message },
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

  if (response.meta?.response_source === "heuristic_fallback") {
    setStatus("OpenAI fallback engaged. Reply came from heuristic backend.");
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
    state.conversationHistory.push({ role: "user", content: transcript });
    setStatus("Processing voice transcript...");
    const response = await providers[state.provider].sendText(transcript);
    addAgentMessage(response.text);
    state.conversationHistory.push({ role: "assistant", content: response.text });

    if (response.meta?.fallback) {
      setStatus("Voice response completed using local fallback.");
      return;
    }

    if (response.meta?.response_source === "heuristic_fallback") {
      setStatus("Voice reply used heuristic fallback.");
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
      link.textContent = part;
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
