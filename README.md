# AI Content Factory

A fully automated faceless video content pipeline. Every day it scrapes trending topics, writes short-form video scripts, synthesizes voiceover, assembles 1080×1920 MP4s with AI-generated backgrounds + subtitles + music, then auto-uploads to YouTube Shorts and emits a manual-upload guide for TikTok.

Currently configured for the niche **Dark Psychology** under the handle `@MindShieldDaily`. The niche, prompts, subreddits, and keywords live in `src/config/accounts.ts` — swap them and the pipeline retargets without code changes.

## What it does, end-to-end

1. **Research** — scrapes Reddit (niche-specific subs) + Hacker News + Product Hunt, keyword-filters, asks Groq (Llama 3.3 70B) to pick the top N candidates. Falls back to a curated seed bank when scrapers are thin.
2. **Scripts** — for each chosen topic, Groq writes a TikTok- and a YouTube-optimized 60-second script in documentary-narrator tone, then scores each for viral potential (HIGH/MEDIUM/LOW).
3. **Voice** — ElevenLabs HTTP API renders the voiceover as MP3 (configured for a calm, mysterious tone: stability 0.55, style 0.25).
4. **Video** — for each script, produces **two** MP4 variants:
   - `script_{id}_tiktok.mp4` — voice only, no music (keeps audio track clean so you can overlay a trending TikTok sound)
   - `script_{id}_youtube.mp4` — voice + ambient music bed at 12% volume
   Both variants get:
   - FLUX.1 text-to-image background (cached per topic key to stay under free quota) or Pexels video fallback
   - Whisper-transcribed word-level subtitles with karaoke-style red highlight on the current word
   - Oswald Bold thumbnail banner + MindShieldDaily watermark
   Rendered via Remotion (React-based, primary) with a pure-FFmpeg fallback.
5. **Publish** — YouTube via googleapis (resumable upload, auto metadata). TikTok via a plain-text upload guide at `output/ready-to-post/script_{id}.txt` that tells you the exact caption, hashtags, cover timestamp, and best posting window.

Scheduled by `cron/scheduler.ts`: **06:00** daily pipeline, **07:00** + **19:55** auto-publish.

## Quick start

```bash
git clone https://github.com/GhDj/ai-content-factory.git
cd ai-content-factory
npm install

# 1. Copy the env template and fill in your keys (see .env.example for notes)
cp .env.example .env
$EDITOR .env

# 2. External dependencies (see SETUP.md for platform-specific details)
# macOS:  brew install ffmpeg-full && python3 -m pip install --user openai-whisper
# Linux:  sudo apt install ffmpeg libass9 fonts-dejavu && pip install --user openai-whisper
# Win:    download ffmpeg-full from gyan.dev, add to PATH; pip install openai-whisper

# 3. One-time Google OAuth for YouTube
npm run auth:youtube

# 4. Kick it off
npm run pipeline        # generates 2 videos (default)
npm run publish         # uploads to YouTube + writes TikTok guides
```

Full setup instructions including Windows/Linux steps: [SETUP.md](SETUP.md).

## Commands

| Command | Purpose |
|---|---|
| `npm run pipeline` | Full pipeline: research → scripts → voice → video (2 videos) |
| `npm run pipeline -- 3` | Same, but generate 3 videos |
| `npm run publish` | Interactive publish: YouTube + TikTok guides |
| `npm run auto-publish` | Non-interactive: publish the oldest unpublished |
| `npm run scheduler` | Run the daily cron (foreground, Ctrl+C to stop) |
| `npm run backgrounds` | Pre-cache FLUX.1 backgrounds for every topic key |
| `npm run queue` | Stats table with viral scores |
| `npm run research` / `scripts` / `voice` / `video` | Run a single stage |
| `npm run auth:youtube` | One-time Google OAuth (opens browser) |

## Architecture

```
src/
├── agents/
│   ├── research.agent.ts          # scrape + rank topics (Groq)
│   ├── script.agent.ts            # write scripts + score viral potential
│   ├── voice.agent.ts             # ElevenLabs TTS
│   ├── video.agent.ts             # dispatcher (Remotion → FFmpeg fallback)
│   └── remotion-video.agent.ts    # Remotion bundle + render
├── remotion/                      # React components for video composition
│   ├── Root.tsx, Video.tsx
│   └── components/                # Background, ThumbnailText, Subtitles, Watermark
├── publishers/
│   ├── youtube.publisher.ts       # googleapis resumable upload
│   ├── tiktok-guide.ts            # emits manual-upload .txt
│   └── index.ts                   # runPublish / runAutoPublish
├── scrapers/                      # Reddit / HN / ProductHunt
├── config/
│   ├── accounts.ts                # active niche, subreddits, keywords
│   ├── darkpsych-seeds.ts         # fallback topic list
│   └── prompts.ts                 # research + script prompt templates
├── db/                            # SQLite schema + repository
├── utils/
│   ├── ai.ts                      # single LLM entry (Groq)
│   ├── ai-background.ts           # FLUX.1 + cache + Pexels fallback
│   ├── backgrounds.ts             # Pexels video picker
│   ├── transcribe.ts              # Whisper subtitle timestamps
│   ├── music.ts                   # music track picker
│   └── logger.ts, retry.ts
└── scripts/
    └── generate-backgrounds.ts    # pre-cache script
cron/
└── scheduler.ts                   # daily cron jobs
assets/
├── fonts/Oswald-Bold.ttf
├── backgrounds/                   # Pexels video clips + FLUX.1 cache
└── music/                         # dark ambient tracks (5 placeholders ship)
```

## Stack

- **Node.js 20+** / **TypeScript** (CommonJS, run with `tsx`)
- **Remotion** (React) for video composition + **FFmpeg** fallback
- **Whisper** (local, Python) for word-level subtitle timestamps
- **Groq** (Llama 3.3 70B) for all LLM calls — `src/utils/ai.ts` is the single entry point
- **HuggingFace FLUX.1-schnell** (via the Inference Providers router → fal-ai) for backgrounds
- **ElevenLabs** for voiceover
- **Pexels** for stock video backgrounds (fallback)
- **googleapis** for YouTube uploads
- **better-sqlite3** for the content queue
- **node-cron** for scheduled runs
- **playwright-extra + stealth** — in the repo but disabled; swapped for a manual-upload guide that avoids TikTok's bot detection

## Cross-platform

Fully works on **macOS, Windows, and Linux**. No OS-specific runtime commands (voiceover is ElevenLabs HTTP; TikTok is a local text file, not browser automation). Platform-specific bits like font paths and Whisper binary locations auto-resolve. See [SETUP.md](SETUP.md) for per-OS install steps.

## Costs

Running two videos per day, end-to-end:

| Service | Tier | Notes |
|---|---|---|
| Groq | free | ~20 LLM calls/day, well under limits |
| Pexels | free | 200 req/hour |
| HuggingFace FLUX.1 | free | ~3-4 images/day; cached per topic key |
| ElevenLabs | free or $5/mo | free = ~10k chars/mo |
| YouTube API | free | 10k units/day, each upload ~1600 units |
| Whisper (local) | free | runs on CPU |
| FFmpeg, Remotion | free | OSS |

**Typical cost: $0/mo** (free tiers). Scale past ~10 videos/day and ElevenLabs is the first line item.

## Branches

- `main` — active development
- `backup-working-version` — snapshot before Remotion/HuggingFace upgrade; safe rollback point

## License

This codebase is not currently licensed. Add a LICENSE file if you intend to distribute it.

Disclaimer: the content niche (dark psychology) is educational / defensive-framed only. Scripts are structured to help viewers **recognize** manipulation tactics, never to teach them how to use any. Prompt rules in `src/config/accounts.ts` enforce this.
