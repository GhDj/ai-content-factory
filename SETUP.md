# Setup Guide

This project runs the AI Content Factory pipeline end-to-end:
**scrape trending AI topics → rank with an LLM → write scripts → generate voiceover → transcribe for subtitles → assemble vertical video → publish to YouTube & TikTok.**

## What works where

| Step | macOS | Windows | Linux |
|---|:---:|:---:|:---:|
| Scrape + rank topics (Groq) | ✅ | ✅ | ✅ |
| Script generation | ✅ | ✅ | ✅ |
| **Voiceover** (ElevenLabs HTTP API) | ✅ | ✅ | ✅ |
| Subtitles (Whisper) | ✅ | ✅ | ✅ |
| Video assembly (ffmpeg) | ✅ | ✅ | ✅ |
| YouTube publish (API) | ✅ | ✅ | ✅ |
| TikTok publish (manual-upload guide) | ✅ | ✅ | ✅ |

**Fully cross-platform.** Voice is ElevenLabs HTTP API. TikTok is a generated upload guide, not browser automation. No OS-specific subprocesses at runtime — everything runs on Node + ffmpeg + Python whisper.

---

## Prerequisites (all platforms)

- **Node.js 20 or newer** — https://nodejs.org
- **Python 3.9–3.12** (for Whisper transcription) — https://www.python.org/downloads/
- **Google Chrome** — optional (only needed if you switch back to the Playwright TikTok uploader, which ships in the repo but is not wired in)
- **ffmpeg with `drawtext`, `libass`, and `libfreetype`** (see platform sections)
- **Git** (to clone the repo)

---

## Setup on macOS (Intel or Apple Silicon)

### 1. Install Homebrew (if you don't have it)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install system tools
```bash
brew install node python@3.12 ffmpeg-full
# NOTE: use ffmpeg-full, NOT ffmpeg. The default `ffmpeg` formula ships
# without drawtext/libass and will fail at the video-assembly step.
```

### 3. Install Chrome if not already present
Download: https://www.google.com/chrome/

### 4. Install Whisper (Python package)
```bash
python3 -m pip install --user openai-whisper
```

### 5. Clone and install
```bash
git clone <your-repo-url> ai-content-factory
cd ai-content-factory
npm install
```

### 6. Environment variables — see **`.env` section** below

### 7. First run
```bash
npm run pipeline            # scrape → rank → write → 2 scripts → 2 audios → 4 videos
npm run auth:youtube        # one-time Google OAuth (browser opens)
npm run publish             # uploads to YouTube + writes TikTok manual-upload guides
npm run scheduler           # run the daily cron (06:00 pipeline, 07:00/19:55 publish)
npm run backgrounds         # pre-fetch FLUX.1 backgrounds for all topic keys
npm run queue               # show queue stats + viral scores
```

---

## Setup on Windows 10 / 11

### 1. Install Node.js
Download LTS from https://nodejs.org and run the installer. Check "Automatically install necessary tools" (includes Chocolatey).

### 2. Install Python 3.11 or 3.12
Download from https://www.python.org/downloads/ and **check "Add Python to PATH"** during install.

### 3. Install ffmpeg (with libass / drawtext)
The simplest route is the `gyan.dev` "full" build:

1. Download **ffmpeg-release-full.7z** from https://www.gyan.dev/ffmpeg/builds/
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your **System PATH** (Search → "Environment Variables" → Path → New)
4. Open a new PowerShell and verify:
   ```powershell
   ffmpeg -filters | Select-String drawtext
   ```
   Should print a `drawtext` line. If empty, your build is missing libfreetype — grab a different build.

### 4. Install Chrome
https://www.google.com/chrome/

### 5. Install Whisper
```powershell
python -m pip install --user openai-whisper
```
Verify it's on PATH:
```powershell
whisper --version
```
If "command not found", add the Python Scripts dir (e.g. `%APPDATA%\Python\Python312\Scripts`) to PATH and reopen PowerShell.

### 6. Clone and install
```powershell
git clone <your-repo-url> ai-content-factory
cd ai-content-factory
npm install
```

### 7. Environment variables — see **`.env` section** below

### 8. First run (same commands as macOS — nothing Windows-specific)

---

## Setup on Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip ffmpeg libass9 fonts-dejavu
python3 -m pip install --user openai-whisper
git clone <your-repo-url> ai-content-factory
cd ai-content-factory
npm install
```

---

## `.env` setup (all platforms)

Create `.env` in the project root (copy from `.env.example` if present):

```env
# Required — LLM for research + script writing
GROQ_API_KEY=gsk_...

# Required — Pexels stock video backgrounds (fallback when FLUX.1 quota hits)
PEXELS_API_KEY=...

# Required — HuggingFace FLUX.1 for AI-generated backgrounds
HUGGINGFACE_API_KEY=hf_...

# Required — ElevenLabs TTS for voiceover
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=...

# Required if publishing to YouTube — YouTube Data API v3 OAuth creds
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-...
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

### Where to get each key

- **Groq** — free, fast, no credit card. https://console.groq.com/keys (takes 30 seconds).
- **Pexels** — free. https://www.pexels.com/api/ → "Request API Key".
- **HuggingFace** — free tier. https://huggingface.co/settings/tokens → Create token with inference scope.
- **ElevenLabs** — https://elevenlabs.io/app/settings/api-keys → API keys tab. Voice ID from the Voices tab (pick any voice you like, the ID is in the URL / settings).
- **YouTube** — Google Cloud Console:
  1. https://console.cloud.google.com → create project "ai-content-factory"
  2. APIs & Services → Library → search "YouTube Data API v3" → Enable
  3. Credentials → Create Credentials → OAuth client ID → **Desktop app**
  4. Copy the client ID + secret into `.env`
  5. Run `npm run auth:youtube` — browser opens, approve → token saved to `assets/youtube-token.json`.
- **TikTok** — no key needed. Publishing writes a manual-upload guide under `output/ready-to-post/` — you copy the caption + hashtags from the guide and upload from the TikTok app.

---

## Running the pipeline

```bash
npm run pipeline              # default: generate 2 videos (research → scripts → voice → 2×video)
npm run pipeline -- 3         # generate 3 videos
npm run publish               # upload to YouTube + write TikTok guide files
npm run auto-publish          # non-interactive: publish oldest in queue
npm run scheduler             # daily cron: 06:00 pipeline, 07:00 publish, 19:55 publish
npm run backgrounds           # pre-cache FLUX.1 backgrounds for all topic keys

npm run queue                 # scored queue table
npm run research              # research step only
npm run scripts               # scripts step only (generates from unused topics)
npm run voice                 # interactive voice approval (optional — pipeline auto-voices)
npm run video                 # video step only (picks up any approved+audio scripts)

npm run auth:youtube          # one-time Google OAuth
```

Typical daily loop:
```
npm run scheduler             # runs forever; generates + publishes 2 videos/day
                              # or run once-off:
npm run pipeline              # generates 2 videos (both _tiktok.mp4 and _youtube.mp4)
npm run publish               # YouTube uploads + TikTok guides written to output/ready-to-post/
```

---

## Troubleshooting

**`Filter 'drawtext' not found` when running `npm run video`**
Your ffmpeg was built without libfreetype. On macOS: `brew uninstall ffmpeg && brew install ffmpeg-full`. On Windows: use the "full" build from gyan.dev, not the "essentials" one.

**`command not found: whisper`**
Python's user bin directory isn't on your PATH.
- macOS: add `~/Library/Python/3.11/bin` (replace with your Python version) to `~/.zshrc`.
- Windows: add `%APPDATA%\Python\Python311\Scripts` to System PATH.
The code auto-checks these paths, but only for a few common Python versions.

**`ModuleNotFoundError: No module named 'whisper'`**
You pip-installed into a different Python than the one Node is calling. Use `python3 -m pip install openai-whisper` with the same `python3` that `whisper` itself uses.

**HuggingFace `402 Payment Required` on first background**
Daily free-tier quota exhausted. The pipeline auto-falls back to Pexels video backgrounds. Run `npm run backgrounds` once each day to pre-cache one image per topic key while the quota is fresh.

**ElevenLabs `401 detected_unusual_activity`**
The free tier flags accounts aggressively. Either buy the $5/mo plan, or switch providers by editing `synthesize()` in `src/agents/voice.agent.ts` to call OpenAI TTS, Azure Speech, or another provider.

**Font missing error at video assembly**
On Windows, Arial is at `C:\Windows\Fonts\arialbd.ttf` — the code looks there. On Linux, install `fonts-dejavu` or edit `resolveFontPath()` in `src/agents/video.agent.ts`.

---

## Files you may need to touch when porting

| File | Why |
|---|---|
| `src/agents/video.agent.ts` `resolveFontPath()` | Add your OS's font path if auto-detection misses it |
| `src/utils/transcribe.ts` `findWhisperBin()` | Add your Python version's install path if auto-detection misses it |

All runtime code uses HTTP APIs (Groq, HuggingFace, ElevenLabs, YouTube, Pexels) or cross-platform subprocesses (ffmpeg, whisper, Remotion's Chromium bundle). There are no OS-specific commands at runtime.

---

## Costs (as of this project)

- **Groq**: free tier, generous limits, zero cost for typical daily use.
- **Pexels**: free, 200 requests/hour.
- **YouTube API**: free up to 10,000 quota units/day; each video upload is ~1,600 units → ~6 uploads/day free.
- **TikTok**: free (manual-upload guide, no API).
- **Whisper (local)**: free, runs on CPU; ~6 s to transcribe a 30 s clip on Apple Silicon.
- **ffmpeg**: free.
- **ElevenLabs**: free tier ~10k chars/month; paid from $5/mo.
- **HuggingFace FLUX.1**: free tier ~3–4 images/day, then 402; cached so 1 image per topic key.

Total: **$0/month** for normal usage volume.
