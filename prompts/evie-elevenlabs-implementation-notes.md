# Evie ElevenLabs Implementation Notes

## Recommended First Integration Model

Use ElevenLabs as the first live voice layer, but keep prompt logic and lead-routing behavior defined in our own project artifacts.

That means:

- Evie's behavior comes from our prompt package
- the UI stays ours
- the qualification logic stays ours
- ElevenLabs provides the voice and conversational runtime layer

## Suggested Implementation Order

1. Finalize the Evie prompt.
2. Finalize the intake schema and output fields.
3. Add a protected server endpoint for ElevenLabs requests.
4. Connect the widget's voice mode to ElevenLabs.
5. Connect chat mode either:
   - to the same backend orchestration layer, or
   - to a simpler first-pass text endpoint that uses the same prompt and schema

## UI Recommendation

Keep the current widget structure:

- chat tab for text interaction
- voice tab for browser microphone activation
- one shared conversation thread

The voice tab should not become a separate product. It should remain an alternate input mode for the same Evie assistant.

## Backend Recommendation

Add a lightweight server layer before using any production credentials.

The server should eventually handle:

- provider authentication
- request forwarding
- prompt injection resistance
- lead record creation
- qualification path tagging
- consult-link decisioning

## First Data Contract

At a minimum, the frontend should send:

```json
{
  "channel": "chat",
  "message": "User text here",
  "session_id": "browser-session-id",
  "conversation_history": []
}
```

The backend should return:

```json
{
  "reply_text": "Evie response",
  "qualification_path": "qualified",
  "request_contact_capture": true,
  "offer_consult_link": false,
  "consult_link": "",
  "lead_fields_needed": ["visitor_name", "visitor_phone", "visitor_email"]
}
```

## Why This Approach

This avoids locking the product logic inside a provider dashboard too early. If the firm later wants to compare ElevenLabs, Retell, or another stack, the core agent behavior and intake schema stay portable.

## Immediate Next Coding Step

Build a small server endpoint that:

- loads the Evie prompt
- accepts conversation input
- returns structured response fields
- leaves the current front-end UI intact

Once that endpoint exists, we can wire:

- chat mode to the endpoint
- voice mode to ElevenLabs with the same core prompt and routing logic
