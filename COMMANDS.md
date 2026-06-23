# Commands reference

All commands are run from the project root with `npm run <name>`.

## Quick reference

| Command | What it does |
|---|---|
| `npm run pipeline -- N` | Full end-to-end: research → scripts → voice → videos + carousels + image posts (N topics, default 2) |
| `npm run research` | Scrape + AI-rank topics only |
| `npm run scripts` | Generate scripts from unused topics |
| `npm run voice` | Interactive voice approval (y/n/q) |
| `npm run video` | Render videos for all approved scripts |
| `npm run carousel` | Generate 8-slide carousels for scripts missing one |
| `npm run images` | Generate single image posts for scripts missing one |
| `npm run publish` | Interactive publish (YouTube API + TikTok guide by default) |
| `npm run auto-publish` | Non-interactive publish of oldest unpublished |
| `npm run queue` | Stats table + viral scores |
| `npm run backgrounds` | Pre-cache backgrounds from HuggingFace / Pexels |
| `npm run setup:voice` | Validate F5-TTS + generate a test clip |
| `npm run voice:make-reference` | Synthesize voice reference from ElevenLabs voice id |
| `npm run voice:import-reference <audio>` | Import any audio as F5-TTS reference (auto-transcribed) |
| `npm run scheduler` | Run the 3 daily cron jobs forever |
| `npm run auth:youtube` | One-time Google OAuth |
| `npm run auth:tiktok` | TikTok Playwright session capture (not used by current flow) |

---

## Full pipeline

```bash
# Default: 2 fresh topics, end-to-end
npm run pipeline

# Custom count
npm run pipeline -- 3
```

What runs (in order):
1. **Research** — scrape Reddit/HN/PH → niche filter → AI rank, or fall back to seed bank. Enforces pillar rotation (no duplicates within a run; avoid pillars used in the last 2 days; today's priority pillars first).
2. **Scripts** — TikTok + YouTube versions per topic, viral-scored, written to `output/scripts/`.
3. **Voice (tiktok only)** — N newest tiktok scripts voiced via F5-TTS → ElevenLabs → `say` cascade.
4. **Videos** — both `_tiktok.mp4` (no music) + `_youtube.mp4` (with music) per voiced script.
5. **Carousels** — 8 PNG slides per voiced script.
6. **Image posts** — one PNG per voiced script (type rotated by `id % 4`).

---

## Individual stages

### Research

```bash
npm run research
```

Pulls trending items, AI-ranks, saves topics to DB. No script/voice/video work. Pillar-aware.

### Scripts

```bash
npm run scripts
```

Generates TikTok + YouTube script pairs for every unused topic in DB. Includes viral scoring (1-10 HIGH/MEDIUM/LOW).

### Voice

```bash
# Interactive — list pending scripts, ask y/n/q for each
npm run voice

# Voice only specific scripts
npm run voice -- --id 157,158,159

# Override TTS engine speed (F5-TTS)
F5TTS_SPEED=0.75 npm run voice -- --id 157

# Force a specific say voice (last-resort fallback)
MAC_SAY_VOICE=Alex npm run voice
```

TTS cascade: F5-TTS (local, mps) → ElevenLabs → macOS `say`. F5-TTS only fires if `assets/voice/reference.wav` + `assets/voice/reference.txt` exist (see `setup:voice`).

### Video

```bash
# Render all scripts with audio that don't yet have video
npm run video

# Specific IDs (comma-separated, repeatable --id)
npm run video -- --id 157,158

# Force re-render even if .mp4 exists
npm run video -- --id 157 --force

# Single platform only
npm run video -- --id 157 --platform tiktok
npm run video -- --id 157 --platform youtube

# Override the background (any image or video file)
npm run video -- --id 157 --background assets/backgrounds/dark-rain-window-night-moody-1.mp4
```

Backgrounds picked from the per-key pool are **retired after a successful render** (file deleted, Pexels ID logged in `assets/backgrounds/used-history.json`) so they never reappear. Backgrounds supplied via `--background` are NOT retired.

### Carousel

```bash
# Generate for every tiktok script missing a carousel
npm run carousel

# Specific IDs
npm run carousel -- --id 157

# Regenerate even if slides exist
npm run carousel -- --id 157 --force
```

Outputs 8 PNGs at `output/carousels/script_<id>_slide_{1..8}.png` and an upload guide at `output/ready-to-post/script_<id>_carousel.txt`.

### Image posts

```bash
# Generate for every tiktok script missing an image
npm run images

# Specific IDs
npm run images -- --id 157

# Force regenerate
npm run images -- --id 157 --force

# Render ALL 4 types (Quote/Definition/Warning/Stat) for preview
npm run images -- --id 157 --all
```

Default mode picks one type by `id % 4` rotation. `--all` writes 4 files suffixed by type: `script_<id>_image_{quote,definition,warning,stat}.png`.

---

## Backgrounds

```bash
# Default: HuggingFace FLUX.1 (currently paid-locked)
npm run backgrounds

# Pexels portrait images (recommended — free)
npm run backgrounds -- --source pexels

# Pexels portrait videos
npm run backgrounds -- --source pexels-video

# Reset only this source's files first (deletes matching files + drops from cache)
npm run backgrounds -- --source pexels --reset

# Override per-key pool size (default 4)
npm run backgrounds -- --source pexels --target 6
```

Sources don't interfere: each refers to a different filename pattern (`bg_<key>_<ts>_<rand>.png` for HF, `bg_<key>_pexels_<id>.jpg` for Pexels images, `bg_<key>_pexvid_<id>.mp4` for Pexels videos). `--reset` only wipes files matching the named source.

---

## Voice reference setup (F5-TTS)

F5-TTS needs a 12-30s reference audio clip + its exact transcript so it can clone the voice.

### Option A — clone from an ElevenLabs voice id

```bash
# Uses ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID from .env
npm run voice:make-reference

# Or override the voice id inline
ELEVENLABS_VOICE_ID=onwK4e9Z... npm run voice:make-reference
```

### Option B — clone from any audio file (YouTube, recording, etc.)

```bash
# First grab audio (example using yt-dlp)
yt-dlp -x --audio-format wav --audio-quality 0 -o /tmp/sample.wav "https://www.youtube.com/shorts/PUB3GsWYubM"

# Import it: trims to 12s, converts to 24kHz mono, transcribes via Groq Whisper
npm run voice:import-reference /tmp/sample.wav
```

### Then verify

```bash
npm run setup:voice
# Opens output/audio/voice_test.m4a — listen to confirm clone quality
```

### Tune speed

```bash
# 0.9 = default (natural-ish documentary pace)
# 0.7 = noticeably slower
# 0.5 = very slow — long render time, may distort
# 1.0 = native model speed (fast)
F5TTS_SPEED=0.75 npm run setup:voice
```

---

## Publishing

```bash
# Interactive (default behavior: TikTok = manual guide, YouTube = API upload if configured)
npm run publish

# Manual mode for BOTH platforms (writes guides for both)
npm run publish -- --manual both

# Manual YouTube only (still writes TikTok guide as default)
npm run publish -- --manual youtube

# Auto-publish the oldest unpublished approved script
npm run auto-publish
npm run auto-publish -- --manual both
```

Guides land in `output/ready-to-post/`:
- `script_<id>.txt` — TikTok video guide
- `script_<id>_youtube.txt` — YouTube video guide
- `script_<id>_carousel.txt` — TikTok carousel guide
- `script_<id>_image.txt` — TikTok image post guide

Each guide contains the video/image file path, full caption, hashtags, and posting tips ready to copy-paste.

After uploading a video manually, record the live URL in the DB:

```bash
sqlite3 output/content.db "UPDATE scripts SET youtube_url = 'https://youtube.com/shorts/XYZ' WHERE id = 157;"
```

---

## Queue inspection

```bash
# Stats + last 10 scripts with viral scores
npm run queue

# Raw DB query
sqlite3 output/content.db "SELECT id, platform, approved, published_at IS NOT NULL AS published, hook FROM scripts ORDER BY id DESC LIMIT 20;" -header -column

# What's in the publish queue right now
sqlite3 output/content.db "SELECT id, platform, hook FROM scripts WHERE approved=1 AND published_at IS NULL ORDER BY id;" -header -column

# Pillar breakdown of recent topics
sqlite3 output/content.db "SELECT pillar, COUNT(*) FROM topics GROUP BY pillar ORDER BY 2 DESC;" -header -column
```

---

## Scheduler

```bash
# Run continuously (3 cron jobs: 06:00 pipeline, 07:00 publish #1, 19:55 publish #2)
npm run scheduler

# Dev: trigger one job immediately for testing
npm run scheduler -- --now
```

---

## Common one-off operations

### Regenerate everything for a single script (e.g. you don't like the voice)

```bash
ID=157
sqlite3 output/content.db "UPDATE scripts SET approved=0 WHERE id=$ID; DELETE FROM audio_files WHERE script_id=$ID;"
rm -f output/audio/script_${ID}_*.{m4a,mp3} output/videos/script_${ID}_*.mp4 \
      output/carousels/script_${ID}_slide_*.png output/image-posts/script_${ID}_image*.png \
      output/ready-to-post/script_${ID}*.txt
npm run voice -- --id $ID
npm run video -- --id $ID
npm run carousel -- --id $ID
npm run images -- --id $ID
```

### Skip an unpublished script (shelve, keep DB record)

```bash
sqlite3 output/content.db "UPDATE scripts SET approved=0 WHERE id IN (X, Y, Z);"
```

### Show the publish-ready text for a script

```bash
cat output/ready-to-post/script_157*.txt
```

### Delete a topic + its scripts entirely

```bash
TID=78
sqlite3 output/content.db "DELETE FROM audio_files WHERE script_id IN (SELECT id FROM scripts WHERE topic_id=$TID);
                           DELETE FROM scripts WHERE topic_id=$TID;
                           DELETE FROM topics WHERE id=$TID;"
```

---

## Environment variables

Required:

| Var | Used by |
|---|---|
| `GROQ_API_KEY` | All LLM calls + Whisper transcription on Groq |
| `PEXELS_API_KEY` | Pexels backgrounds + voice reference import |

Optional (one of these for TTS fallback):

| Var | Used by |
|---|---|
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | ElevenLabs TTS + voice:make-reference |

Optional (tuning):

| Var | Default | What it tunes |
|---|---|---|
| `F5TTS_SPEED` | `0.9` | F5-TTS playback speed (0.5 = slow, 1.0 = native) |
| `F5TTS_MODEL` | `F5TTS_v1_Base` | F5-TTS model variant |
| `F5TTS_BIN` | auto | Explicit path to `f5-tts_infer-cli` |
| `MAC_SAY_VOICE` | `Daniel` | macOS `say` voice (run `say -v '?'` to list) |
| `MAC_SAY_RATE` | `175` | macOS `say` words-per-minute |
| `HUGGINGFACE_API_KEY` | — | Only needed for `npm run backgrounds` default source |

For YouTube API auto-publish (skip if using `--manual youtube`):

| Var |
|---|
| `YOUTUBE_CLIENT_ID` |
| `YOUTUBE_CLIENT_SECRET` |
| `YOUTUBE_REDIRECT_URI` |
