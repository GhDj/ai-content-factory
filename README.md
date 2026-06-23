# AI Content Factory

Automated content pipeline that researches trending topics, writes scripts, generates voiceovers, renders videos, creates carousels and image posts, and publishes to YouTube and TikTok.

Built for the **Mind Shield Daily** dark psychology niche but adaptable to any topic vertical — swap the config in `src/config/accounts.ts` and the pipeline retargets without code changes.

## What it does, end-to-end

1. **Research** — scrapes Reddit (niche-specific subs) + Hacker News + Product Hunt, keyword-filters, asks Groq (Llama 3) to pick the top N candidates. Enforces pillar rotation (no duplicates within a run; avoids pillars used in the last 2 days). Falls back to a curated seed bank when scrapers are thin.
2. **Scripts** — for each topic, Groq writes TikTok + YouTube 60-second scripts in documentary-narrator tone, then scores each for viral potential (1-10, HIGH/MEDIUM/LOW).
3. **Voice** — TTS cascade: **F5-TTS** (local voice clone on Apple Silicon) → **ElevenLabs** (cloud API) → **macOS `say`** (last resort). F5-TTS clones any voice from a 12-30s reference clip.
4. **Video** — two MP4 variants per script:
   - `script_{id}_tiktok.mp4` — voice only (overlay a trending TikTok sound)
   - `script_{id}_youtube.mp4` — voice + ambient music at 12% volume
   Both get: Pexels background (image or video), Whisper-transcribed karaoke subtitles (red highlight on current word), thumbnail banner + watermark.
5. **Carousel** — 8 PNG slides (1080x1920) per script with hook, key points, and CTA.
6. **Image posts** — 1 PNG per script, type rotated by `id % 4`: quote, definition, warning, stat.
7. **Publish** — YouTube via googleapis (resumable upload, auto metadata). TikTok via upload guide at `output/ready-to-post/`. Carousel and image post guides included.

Scheduled by `cron/scheduler.ts`: **06:00** daily pipeline, **07:00** + **19:55** auto-publish.

## Quick start

```bash
git clone <repo-url>
cd ai-content-factory
npm install

# Configure environment
cp .env.example .env
# Edit .env — at minimum set GROQ_API_KEY and PEXELS_API_KEY

# External dependencies
brew install ffmpeg        # required
brew install uv && uv tool install f5-tts   # optional: local voice cloning

# Set up voice cloning (optional but recommended)
npm run setup:voice

# One-time Google OAuth for YouTube auto-upload (optional)
npm run auth:youtube

# Run it
npm run pipeline        # 2 topics end-to-end
npm run publish         # interactive publish
```

## Commands

| Command | Description |
|---|---|
| `npm run pipeline [-- N]` | Full end-to-end: research → scripts → voice → video + carousel + image (N topics, default 2) |
| `npm run research` | Scrape + AI-rank topics only |
| `npm run scripts` | Generate scripts from unused topics |
| `npm run voice` | Interactive voice approval (y/n/q per script) |
| `npm run video` | Render videos for approved scripts with audio |
| `npm run carousel` | Generate 8-slide carousels |
| `npm run images` | Generate single image posts |
| `npm run publish` | Interactive publish |
| `npm run auto-publish` | Non-interactive publish of oldest unpublished |
| `npm run queue` | Stats table + viral scores |
| `npm run backgrounds` | Pre-cache backgrounds from Pexels |
| `npm run setup:voice` | Validate F5-TTS + generate test clip |
| `npm run voice:make-reference` | Clone voice reference from ElevenLabs voice ID |
| `npm run voice:import-reference <audio>` | Import any audio as F5-TTS reference |
| `npm run admin` | Admin API at http://localhost:3333 |
| `npm run scheduler` | Run daily cron jobs |
| `npm run auth:youtube` | One-time Google OAuth |

### Command flags

```bash
# Voice
npm run voice -- --id 157,158,159
F5TTS_SPEED=0.75 npm run voice -- --id 157

# Video
npm run video -- --id 157 --force --platform tiktok
npm run video -- --id 157 --background assets/backgrounds/custom.mp4

# Carousel / Images
npm run carousel -- --id 157 --force
npm run images -- --id 157 --all    # all 4 types for preview

# Publish
npm run publish -- --manual both     # write guides for both platforms
npm run publish -- --manual youtube  # manual YouTube only
```

### Backgrounds

```bash
npm run backgrounds -- --source pexels          # portrait images (free)
npm run backgrounds -- --source pexels-video     # portrait videos
npm run backgrounds -- --source pexels --target 6 --reset
```

Backgrounds are **retired after each render** (file deleted + Pexels ID logged in `assets/backgrounds/used-history.json`) so they never repeat.

## Voice cloning (F5-TTS)

F5-TTS runs locally on Apple Silicon (MPS) and clones any voice from a 12-30s reference audio + its transcript.

**Option A** — Clone from ElevenLabs voice:
```bash
npm run voice:make-reference
```

**Option B** — Clone from any audio file:
```bash
yt-dlp -x --audio-format wav -o /tmp/sample.wav "https://youtube.com/shorts/..."
npm run voice:import-reference /tmp/sample.wav
```

Verify: `npm run setup:voice` — plays a test clip.

The TTS cascade tries F5-TTS first, falls back to ElevenLabs, then macOS `say`. F5-TTS only activates when `assets/voice/reference.wav` and `assets/voice/reference.txt` both exist.

## Admin API

```bash
npm run admin   # http://localhost:3333
```

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stats` | Pipeline statistics |
| GET | `/api/scripts` | All scripts (`?filter=pending` for pending only) |
| GET/PUT | `/api/scripts/:id` | Get or edit a script |
| POST | `/api/scripts/:id/approve` | Approve script |
| POST | `/api/scripts/:id/unapprove` | Unapprove script |
| GET | `/api/topics` | All topics |
| GET | `/api/topics/unused` | Unused topics |
| POST | `/api/run/:command` | Run pipeline command (returns `jobId`) |
| GET | `/api/jobs/:jobId` | Poll job logs + status |
| POST | `/api/jobs/:jobId/stop` | Kill a running job |
| GET/DELETE | `/api/backgrounds/:filename` | List or delete backgrounds |

Static files: `/files/*` serves `output/`, `/bg-files/*` serves `assets/backgrounds/`.

## Project structure

```
src/
  agents/
    research.agent.ts          # Topic scraping + AI ranking
    script.agent.ts            # Script generation + viral scoring
    voice.agent.ts             # TTS cascade (F5-TTS → ElevenLabs → say)
    video.agent.ts             # Orchestrates Remotion renders
    remotion-video.agent.ts    # Remotion bundle + render logic
    carousel.agent.ts          # 8-slide PNG carousel generation
    image-post.agent.ts        # Single image post (4 types)
  admin/
    server.ts                  # Express admin REST API
  config/
    accounts.ts                # Niche config, subreddits, keywords, series
    prompts.ts                 # LLM prompt templates
    darkpsych-seeds.ts         # Seed topic bank (fallback)
  db/
    schema.ts                  # SQLite schema + migrations
    repository.ts              # Database queries
  publishers/
    index.ts                   # Publish orchestration
    youtube.publisher.ts       # YouTube Data API uploader
  remotion/
    Root.tsx                   # Remotion entry point
    Video.tsx                  # Video composition
    components/Watermark.tsx   # Branding overlay
  scripts/
    setup-voice.ts             # F5-TTS validation + test
    generate-reference-voice.ts     # Clone from ElevenLabs
    import-reference-from-audio.ts  # Import any audio as reference
    generate-backgrounds.ts    # Background pre-caching
  utils/
    ai-background.ts           # Background selection + retirement
assets/
  voice/          # reference.wav + reference.txt for F5-TTS
  avatar/         # Channel avatar
  backgrounds/    # Pre-cached backgrounds (images + videos)
  fonts/          # Oswald-Bold.ttf
  branding/       # logo.png
output/           # All generated content (gitignored)
  content.db      # SQLite database
  audio/          # Voiceover files (.m4a, .mp3)
  videos/         # Rendered MP4s
  carousels/      # Carousel slide PNGs
  image-posts/    # Image post PNGs
  ready-to-post/  # Upload guides with captions + hashtags
```

## Database

SQLite at `output/content.db`:

- **topics** — scraped items with AI scores, pillar tags, viral angles
- **scripts** — TikTok + YouTube per topic, viral scoring, approval/publish tracking
- **audio_files** — voiceover file paths linked to scripts

```bash
# Publish queue
sqlite3 output/content.db "SELECT id, platform, hook FROM scripts WHERE approved=1 AND published_at IS NULL ORDER BY id;" -header -column

# Pillar breakdown
sqlite3 output/content.db "SELECT pillar, COUNT(*) FROM topics GROUP BY pillar ORDER BY 2 DESC;" -header -column

# Regenerate a script
ID=157
sqlite3 output/content.db "UPDATE scripts SET approved=0 WHERE id=$ID; DELETE FROM audio_files WHERE script_id=$ID;"
rm -f output/audio/script_${ID}_*.{m4a,mp3} output/videos/script_${ID}_*.mp4 output/carousels/script_${ID}_slide_*.png output/image-posts/script_${ID}_image*.png
npm run voice -- --id $ID && npm run video -- --id $ID && npm run carousel -- --id $ID && npm run images -- --id $ID
```

## Environment variables

### Required

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | LLM calls + Whisper transcription ([console.groq.com](https://console.groq.com/keys)) |
| `PEXELS_API_KEY` | Backgrounds ([pexels.com/api](https://www.pexels.com/api/)) |

### Optional — TTS

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs TTS + voice:make-reference |
| `ELEVENLABS_VOICE_ID` | Voice ID from ElevenLabs voice lab |

### Optional — tuning

| Variable | Default | Description |
|---|---|---|
| `F5TTS_SPEED` | `0.9` | F5-TTS speed (0.5=slow, 1.0=native) |
| `F5TTS_MODEL` | `F5TTS_v1_Base` | F5-TTS model variant |
| `F5TTS_BIN` | auto | Path to `f5-tts_infer-cli` |
| `MAC_SAY_VOICE` | `Daniel` | macOS `say` voice |
| `MAC_SAY_RATE` | `175` | macOS `say` WPM |
| `HUGGINGFACE_API_KEY` | — | HuggingFace FLUX.1 backgrounds |

### Optional — YouTube auto-publish

| Variable | Description |
|---|---|
| `YOUTUBE_CLIENT_ID` | Google Cloud OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `YOUTUBE_REDIRECT_URI` | Default: `http://localhost:3000/oauth2callback` |

## Stack

- **Node.js 18+** / TypeScript (tsx)
- **Groq** (Llama 3) — all LLM calls
- **F5-TTS** — local voice cloning on Apple Silicon
- **ElevenLabs** — cloud TTS fallback
- **Remotion** (React) — programmatic video rendering
- **@napi-rs/canvas** — carousel + image post generation
- **Pexels** — stock backgrounds (image + video)
- **googleapis** — YouTube uploads
- **Express** — admin API
- **better-sqlite3** — content queue
- **node-cron** — scheduling

## Costs

At 2 videos/day:

| Service | Tier | Notes |
|---|---|---|
| Groq | free | ~20 LLM calls/day |
| Pexels | free | 200 req/hour |
| F5-TTS | free | runs locally |
| ElevenLabs | free or $5/mo | free = ~10k chars/mo (fallback only) |
| YouTube API | free | 10k units/day |

**Typical cost: $0/mo** on free tiers.

## License

Not currently licensed. Add a LICENSE file if distributing.

Content niche (dark psychology) is educational/defensive-framed only. Scripts help viewers recognize manipulation tactics, never teach how to use them. Prompt rules in `src/config/accounts.ts` enforce this.
