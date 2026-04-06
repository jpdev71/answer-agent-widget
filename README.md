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

## Next recommended step

Connect the endpoint to a real model runtime and keep the current structured response fields as the stable contract between the UI and the backend.

## Demo content note

The current content is a product demo inspired by a Georgia personal injury firm website, not legal advice and not a production knowledge system.
