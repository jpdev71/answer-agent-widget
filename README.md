# Law Firm Answer Agent Demo

Vercel-ready prototype for a lower-left website widget that acts like a personal injury law-firm answer agent.

## Current direction

- Chat-forward experience
- Separate voice mode
- ElevenLabs as the intended first live integration
- Expanded panel layout that leaves room for richer multimodal states later
- Demo content shaped around a Georgia personal injury firm

## Included in this prototype

- Floating lower-left widget
- Chat and voice mode toggle
- `/api/evie` endpoint for helpful-first chat responses and intake routing
- Provider stubs for `demo`, `ElevenLabs`, `Retell`, and `HeyGen`
- Static hosting config for Vercel

## Files

- `index.html` - page shell and widget markup
- `styles.css` - layout, branding, and responsive styling
- `app.js` - widget logic, API client, and browser voice placeholder
- `api/evie.js` - server endpoint for Evie prompt behavior and structured intake output
- `firms/default.js` - default firm alias used by the app at runtime
- `firms/adam-appel.js` - current Adam Appel / Dermer Appel Ruder firm implementation
- `firms/adapters/personal-injury.js` - current PI-specific lead extraction and qualification adapter
- `lib/firm-config.js` - shared firm-config loading, grounding assembly, and validation
- `docs/multi-firm-contract.md` - notes on shared vs firm-specific structure for multi-firm support
- `vercel.json` - simple Vercel config

## Deploy

This project can be imported into Vercel as a static site with no build step.

## Current backend contract

`POST /api/evie`

```json
{
  "channel": "chat",
  "message": "User text here",
  "session_id": "browser-session-id",
  "conversation_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Example response:

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

Optional request fields sent by the widget:

```json
{
  "page_url": "https://example.com/contact",
  "page_title": "Contact Us"
}
```

## Lead webhook delivery

If `LEAD_WEBHOOK_URL` is set, the backend will send a webhook when:

- contact information is newly captured in the conversation
- the lead appears viable for follow-up
- the response came from the full OpenAI path

Recommended environment variables:

- `OPENAI_API_KEY`
- `LEAD_WEBHOOK_URL`
- `FIRM_PROFILE` (`default`, `adam-appel`, or `thacker-sleight`)
- `FIRM_ID` (optional)
- `FIRM_NAME` (optional)
- `CONSULT_LINK` (optional)

Example webhook payload:

```json
{
  "event_type": "lead.captured",
  "delivered_at": "2026-04-07T21:00:00.000Z",
  "firm_id": "dermer-appel-ruder",
  "firm_name": "Dermer Appel Ruder",
  "agent_name": "Evie",
  "session_id": "session-123",
  "source": {
    "channel": "chat",
    "lead_source": "website_widget",
    "page_url": "https://example.com/",
    "page_title": "Homepage"
  },
  "routing": {
    "qualification_path": "qualified",
    "request_contact_capture": false,
    "offer_consult_link": true,
    "consult_link": "https://calendly.com/social-amplifier/dermer-appel-ruder?month=2026-04",
    "response_source": "openai"
  },
  "lead": {
    "visitor_name": "Mike Margol",
    "visitor_phone": "714-434-5927",
    "visitor_email": "mike@jamespublishing.com",
    "incident_state": "Georgia",
    "incident_type": "truck_accident"
  },
  "transcript": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "summary": {
    "conversation_summary": "Visitor described a truck accident in Georgia...",
    "lead_fields_needed": []
  }
}
```

## Next recommended step

Set `LEAD_WEBHOOK_URL`, connect the payload to Zapier, and map the fields into the firm's spreadsheet and notification flow.

## Multi-firm scaffold

The app now has a reusable multi-firm layer. The runtime points at `firms/default.js`, which currently aliases the Adam Appel / Dermer Appel Ruder implementation in `firms/adam-appel.js`. Firm identity, consult policy, grounding sources, and adapter selection now live in the firm config and are validated by `lib/firm-config.js`.

Grounding is intentionally lightweight for now: a firm can point at approved markdown/text sources or inline text blocks, and the API reports validation warnings plus grounding metadata in its response for easier onboarding and debugging. Lead extraction and qualification are now adapter-driven so non-Georgia and non-PI firms are no longer blocked on the shared API shape.

## Demo content note

The current content is a product demo inspired by a Georgia personal injury firm website, not legal advice and not a production knowledge system.
