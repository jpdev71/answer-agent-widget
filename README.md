# Answer Agent Widget Prototype

Static prototype for a lower-left website widget that combines text chat today with a path toward voice and avatar integrations later.

## What is included

- A polished lower-left floating widget
- Text chat UI with demo replies
- Browser speech recognition fallback for voice input where supported
- Provider stubs for `demo`, `ElevenLabs`, `Retell`, and `HeyGen`
- Static hosting support for Vercel

## Project structure

- `index.html` - landing page plus widget markup
- `styles.css` - site and widget styling
- `app.js` - widget behavior, provider abstraction, and browser voice handling
- `vercel.json` - lightweight Vercel config

## How to test right now

Because this project is static, it can be served by any local file server or deployed directly to Vercel.

### Option 1: drag-and-drop deploy to Vercel

1. In the Vercel dashboard, create a new project.
2. Choose the option to upload or import local files if available in your dashboard flow.
3. Point Vercel at this folder.
4. Deploy.

### Option 2: GitHub + Vercel

1. Create a new GitHub repository.
2. Push this folder to GitHub once `git` is installed on your machine.
3. In Vercel, import the GitHub repo.
4. Deploy with the default settings.

## Recommended next build step

The current widget is intentionally front-end only. For real provider integrations, add a thin server layer for:

- API key protection
- signed session creation
- request forwarding
- transcripts or analytics

At that point we can choose one of two directions:

1. Keep this as a static widget plus serverless functions.
2. Move to a framework app such as Next.js once Node is installed locally.

## Provider notes

- `ElevenLabs`: strongest candidate for the first real text + voice integration
- `Retell`: strong if voice becomes the primary product experience
- `HeyGen`: likely a phase-two avatar layer rather than the first integration
