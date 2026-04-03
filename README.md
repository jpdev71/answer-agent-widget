# Law Firm Answer Agent Demo

Static Vercel-ready prototype for a lower-left website widget that acts like a personal injury law-firm answer agent.

## Current direction

- Chat-forward experience
- Separate voice mode
- ElevenLabs as the intended first live integration
- Expanded panel layout that leaves room for richer multimodal states later
- Demo content shaped around a Georgia personal injury firm

## Included in this prototype

- Floating lower-left widget
- Chat and voice mode toggle
- Quick prompt chips for common intake questions
- Demo answer logic for consultations, practice areas, claim timing, and next steps
- Provider stubs for `demo`, `ElevenLabs`, `Retell`, and `HeyGen`
- Static hosting config for Vercel

## Files

- `index.html` - page shell and widget markup
- `styles.css` - layout, branding, and responsive styling
- `app.js` - widget logic, knowledge responses, and browser voice placeholder
- `vercel.json` - simple Vercel config

## Deploy

This project can be imported into Vercel as a static site with no build step.

## Next recommended step

Add a tiny server layer before connecting real APIs so the widget can keep secrets off the client. The first integration path should be ElevenLabs.

Suggested next build phase:

1. Add a server endpoint for protected provider requests.
2. Replace the ElevenLabs placeholder with a real text or voice session flow.
3. Tune answers and intake prompts around the firm's actual consultation process.

## Demo content note

The current content is a product demo inspired by a Georgia personal injury firm website, not legal advice and not a production knowledge system.
