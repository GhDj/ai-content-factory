import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { log } from '../utils/logger';
import { ensureBackgrounds, getRandomBackground } from '../utils/backgrounds';
import { getRandomMusicTrack } from '../utils/music';
import { transcribe, type Word } from '../utils/transcribe';
import { getApprovedScriptsWithAudio, type ScriptWithAudio } from '../db/repository';

const execFileAsync = promisify(execFile);

const VIDEO_DIR = path.join(process.cwd(), 'output', 'videos');

function resolveFontPath(): string {
  // Prefer the bundled Oswald font shipped with the repo
  const bundled = path.join(process.cwd(), 'assets', 'fonts', 'Oswald-Bold.ttf');
  if (fs.pathExistsSync(bundled)) return bundled;

  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push('/System/Library/Fonts/Supplemental/Arial Bold.ttf');
    candidates.push('/Library/Fonts/Arial Bold.ttf');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Windows\\Fonts\\arialbd.ttf');
    candidates.push('C:\\Windows\\Fonts\\Arial.ttf');
  } else {
    candidates.push('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
    candidates.push('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf');
  }
  for (const c of candidates) {
    if (fs.pathExistsSync(c)) return c;
  }
  throw new Error(
    `No usable font found. Looked in: assets/fonts/Oswald-Bold.ttf, ${candidates.join(', ')}`
  );
}

const FONT_PATH = resolveFontPath();

const VIDEO_W = 1080;
const VIDEO_H = 1920;

// Rough horizontal metrics for Arial Bold at various font sizes
const CHAR_RATIO = 0.55;
const SPACE_RATIO = 0.3;

// Subtitle config — Mind Shield Daily dark-psychology look
// Unified size for all words (no jumping) + fixed chunk position + red karaoke
const SUB_FONT_SIZE = 56;
const SUB_Y_FACTOR = 0.72;                 // 72% from top
const SUB_BOX_H = 75;                      // background box height
const SUB_COLOR_NORMAL = 'white';
const SUB_COLOR_HIGHLIGHT = '0xFF0000';    // pure red
const SUB_WORDS_PER_CHUNK = 3;             // 3 words per chunk
const MAX_CHUNKS = 40;
const MAX_SUBTITLE_TIME = 60;

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return parseFloat(stdout.trim());
}

async function resizeBackground(srcPath: string): Promise<string> {
  const tmp = path.join(
    os.tmpdir(),
    `bg_resized_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`
  );
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-vf', `scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H}`,
    '-c:a', 'copy',
    '-an',
    tmp,
  ]);
  return tmp;
}

async function writeTempText(content: string): Promise<string> {
  const tmp = path.join(
    os.tmpdir(),
    `vid_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`
  );
  await fs.writeFile(tmp, content, 'utf8');
  return tmp;
}

interface Chunk {
  words: Word[];
  start: number;
  end: number;
}

function chunkWords(words: Word[], perChunk: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < words.length; i += perChunk) {
    const group = words.slice(i, i + perChunk);
    if (group.length === 0) continue;
    chunks.push({
      words: group,
      start: group[0].start,
      end: group[group.length - 1].end,
    });
  }
  return chunks;
}

/**
 * Approximate x-layout for each UPPERCASE word in a chunk rendered at `fontSize`.
 * Returns the chunk's total width + each word's left-edge x (within the full frame),
 * assuming the chunk is centered horizontally.
 */
function chunkLayoutUpper(words: string[], fontSize: number): { totalWidth: number; lefts: number[] } {
  const charW = fontSize * CHAR_RATIO;
  const spaceW = fontSize * SPACE_RATIO;
  const widths = words.map((w) => w.length * charW);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (words.length - 1) * spaceW;
  const startX = (VIDEO_W - totalWidth) / 2;
  const lefts: number[] = [];
  let x = startX;
  for (let i = 0; i < words.length; i++) {
    lefts.push(x);
    x += widths[i] + spaceW;
  }
  return { totalWidth, lefts };
}

function buildStaticOverlays(
  thumbFile: string,
  hookFile: string,
  watermarkFile: string,
  opts: { includeTextWatermark?: boolean } = {}
): string {
  // Thumbnail banner at top 15% of frame (y ≈ 0.15 * 1920 ≈ 288)
  const bannerY = 260;
  const bannerH = 220;
  const thumbTextY = bannerY + 70;
  const hookAlpha =
    "if(lt(t,1),0," +
    "if(lt(t,1.5),(t-1)/0.5," +
    "if(lt(t,3.5),1," +
    "if(lt(t,4),(4-t)/0.5,0))))";

  const overlays: string[] = [
    // Semi-transparent dark box behind thumbnail text — opacity 0.75 per spec
    `drawbox=x=0:y=${bannerY}:w=iw:h=${bannerH}:color=black@0.75:t=fill`,
    // Thumbnail text: 78px white bold, centered in the banner
    `drawtext=fontfile='${FONT_PATH}':textfile='${thumbFile}':` +
      `fontsize=78:fontcolor=white:` +
      `x=(w-text_w)/2:y=${thumbTextY}`,
    // Hook fades in 1–1.5s, out 3.5–4s
    `drawtext=fontfile='${FONT_PATH}':textfile='${hookFile}':` +
      `fontsize=44:fontcolor=white:borderw=3:bordercolor=black:` +
      `x=(w-text_w)/2:y=h-420:alpha='${hookAlpha}'`,
  ];
  if (opts.includeTextWatermark !== false) {
    // Watermark fallback (no logo file): "mindshieldaily" 24px white @ 40% opacity
    overlays.push(
      `drawtext=fontfile='${FONT_PATH}':textfile='${watermarkFile}':` +
        `fontsize=24:fontcolor=white@0.40:borderw=1:bordercolor=black@0.40:` +
        `x=w-text_w-30:y=h-60`
    );
  }
  return overlays.join(',');
}

async function buildSubtitleOverlays(
  words: Word[],
  tmpFiles: string[]
): Promise<string> {
  const capped = words.filter((w) => w.start < MAX_SUBTITLE_TIME);
  const chunks = chunkWords(capped, SUB_WORDS_PER_CHUNK).slice(0, MAX_CHUNKS);
  if (chunks.length === 0) return '';

  // White chunk line at y=72%; red "active word" indicator 80px above it.
  const chunkYNum = Math.floor(VIDEO_H * SUB_Y_FACTOR);
  const chunkY = String(chunkYNum);
  const indicatorY = String(chunkYNum - 80);
  const boxY = String(chunkYNum - 10);

  const parts: string[] = [];

  for (const chunk of chunks) {
    // ALL CAPS for every word (psychology content reads better in caps)
    const upperWords = chunk.words.map((w) => w.word.toUpperCase());
    const { totalWidth } = chunkLayoutUpper(upperWords, SUB_FONT_SIZE);

    const chunkText = upperWords.join(' ');
    const chunkFile = await writeTempText(chunkText);
    tmpFiles.push(chunkFile);

    const boxWidth = Math.ceil(totalWidth + 40);
    const boxX = Math.floor((VIDEO_W - boxWidth) / 2);

    // 1) Semi-transparent background box behind the white chunk
    parts.push(
      `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${SUB_BOX_H}:color=black@0.5:t=fill:` +
        `enable='between(t,${chunk.start.toFixed(3)},${chunk.end.toFixed(3)})'`
    );

    // 2) Full chunk in white — fixed position for the chunk's duration
    parts.push(
      `drawtext=fontfile='${FONT_PATH}':textfile='${chunkFile}':` +
        `fontsize=${SUB_FONT_SIZE}:fontcolor=${SUB_COLOR_NORMAL}:` +
        `borderw=3:bordercolor=black:` +
        `x=(w-text_w)/2:y=${chunkY}:` +
        `enable='between(t,${chunk.start.toFixed(3)},${chunk.end.toFixed(3)})'`
    );

    // 3) Red "active word" indicator — always centered, above the chunk.
    //    Same font size so no jumping. Acts as a karaoke marker for the
    //    currently-spoken word without needing exact per-word x alignment.
    for (let i = 0; i < chunk.words.length; i++) {
      const w = chunk.words[i];
      const wordFile = await writeTempText(upperWords[i]);
      tmpFiles.push(wordFile);
      parts.push(
        `drawtext=fontfile='${FONT_PATH}':textfile='${wordFile}':` +
          `fontsize=${SUB_FONT_SIZE}:fontcolor=${SUB_COLOR_HIGHLIGHT}:` +
          `borderw=3:bordercolor=black:` +
          `x=(w-text_w)/2:y=${indicatorY}:` +
          `enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`
      );
    }
  }

  return parts.join(',');
}

async function renderVideoWithFFmpeg(
  script: ScriptWithAudio,
  words: Word[],
  duration: number,
  outPath: string,
  platform: 'tiktok' | 'youtube'
): Promise<void> {
  const bgSrc = await getRandomBackground();
  const resizedBg = await resizeBackground(bgSrc);

  const tmpFiles: string[] = [];
  const thumbFile = await writeTempText(script.thumbnail_text);
  const hookFile = await writeTempText(script.hook);
  const watermarkFile = await writeTempText('mindshieldaily');
  tmpFiles.push(thumbFile, hookFile, watermarkFile);

  const LOGO_FILE = path.join(process.cwd(), 'assets', 'branding', 'logo.png');
  const hasLogo = await fs.pathExists(LOGO_FILE);

  // When the brand logo is available, skip the text-only watermark drawtext —
  // the logo overlay (added below) takes its place with a handle line under it.
  const staticOverlays = buildStaticOverlays(thumbFile, hookFile, watermarkFile, {
    includeTextWatermark: !hasLogo,
  });
  const subtitleOverlays = await buildSubtitleOverlays(words, tmpFiles);
  const vOverlays = subtitleOverlays ? `${staticOverlays},${subtitleOverlays}` : staticOverlays;

  // Music only on YouTube; TikTok stays voice-only for trending-sound overlay
  const musicTrack = platform === 'youtube' ? getRandomMusicTrack() : null;
  const fadeOutStart = Math.max(0, duration - 2);

  try {
    log.info(
      `      bg=${path.basename(bgSrc)} duration=${duration.toFixed(1)}s platform=${platform}` +
        (musicTrack ? ` music=${path.basename(musicTrack)}` : ' music=none') +
        (hasLogo ? ' logo=yes' : ' logo=no')
    );

    const args: string[] = ['-y'];
    // Input 0: looped background video
    args.push('-stream_loop', '-1', '-i', resizedBg);
    // Input 1: voiceover
    args.push('-i', script.audio_path);
    if (musicTrack) {
      // Input 2: music (looped indefinitely so it outlasts any voiceover length)
      args.push('-stream_loop', '-1', '-i', musicTrack);
    }
    // Logo input goes last so audio input indices stay stable.
    let logoIdx = -1;
    if (hasLogo) {
      logoIdx = args.filter((a) => a === '-i').length; // current input count
      args.push('-i', LOGO_FILE);
    }

    // Filter graph: video overlays + (optional) logo overlay + audio mix.
    const audioFilter = musicTrack
      ? `[2:a]volume=0.12,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2[music];` +
        `[1:a]volume=1.0[voice];` +
        `[music][voice]amix=inputs=2:duration=shortest:dropout_transition=0[audio]`
      : '';

    let videoChain: string;
    if (hasLogo) {
      // Scale logo to 80×80, force 30% alpha, overlay bottom-right, then draw
      // the @mindshieldaily handle below it.
      videoChain =
        `[${logoIdx}:v]scale=80:80,format=rgba,colorchannelmixer=aa=0.3[logo];` +
        `[0:v]${vOverlays}[bg0];` +
        `[bg0][logo]overlay=x=W-w-30:y=H-h-80,` +
        `drawtext=fontfile='${FONT_PATH}':text='@mindshieldaily':` +
          `fontsize=20:fontcolor=white@0.3:x=W-text_w-25:y=H-45[v]`;
    } else {
      videoChain = `[0:v]${vOverlays}[v]`;
    }
    const filterComplex = audioFilter ? `${videoChain};${audioFilter}` : videoChain;

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[v]');
    args.push('-map', musicTrack ? '[audio]' : '1:a');
    args.push('-shortest');
    args.push('-t', duration.toFixed(2));
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-preset', 'veryfast', '-crf', '22');
    // 1 keyframe per second — critical for smooth scrubbing on TikTok/YouTube.
    // Default GOP can be the whole clip, which makes the player reset on every seek.
    args.push('-g', '30', '-keyint_min', '30', '-sc_threshold', '0');
    args.push('-c:a', 'aac', '-b:a', '160k', '-r', '30');
    args.push('-movflags', '+faststart');
    args.push(outPath);

    await execFileAsync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024 });
  } finally {
    await fs.remove(resizedBg).catch(() => {});
    for (const f of tmpFiles) await fs.remove(f).catch(() => {});
  }
}

/**
 * Main dispatcher. Transcribe audio (cached across platforms), then for each
 * requested platform: try Remotion (AI bg + React compositor), fall back to
 * FFmpeg on any error. The caller provides the platform-specific outPath.
 */
async function renderVideo(
  script: ScriptWithAudio,
  outPath: string,
  platform: 'tiktok' | 'youtube',
  words: Word[],
  duration: number,
  backgroundOverride?: string
): Promise<'remotion' | 'ffmpeg'> {
  try {
    const { renderVideoWithRemotion } = await import('./remotion-video.agent');
    await renderVideoWithRemotion(script, words, duration, platform, backgroundOverride);
    log.info(`      renderer: remotion (${platform})`);
    return 'remotion';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`      Remotion failed (${msg.slice(0, 160)}), falling back to FFmpeg...`);
  }

  await renderVideoWithFFmpeg(script, words, duration, outPath, platform);
  log.info(`      renderer: ffmpeg (${platform})`);
  return 'ffmpeg';
}

async function transcribeOnce(audioPath: string): Promise<Word[]> {
  try {
    log.info(`      transcribing audio for subtitles...`);
    const words = await transcribe(audioPath);
    log.info(`      got ${words.length} timestamped words`);
    return words;
  } catch (err) {
    log.warn(
      `      whisper failed — continuing without subtitles: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

const VIDEO_PLATFORMS = ['tiktok', 'youtube'] as const;
type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

function videoPathFor(scriptId: number, platform: VideoPlatform): string {
  return path.join(VIDEO_DIR, `script_${scriptId}_${platform}.mp4`);
}

export async function runVideos(
  opts: {
    onlyIds?: number[];
    force?: boolean;
    platforms?: VideoPlatform[];
    backgroundOverride?: string;
  } = {}
): Promise<void> {
  await fs.ensureDir(VIDEO_DIR);
  await ensureBackgrounds();

  const targetPlatforms = opts.platforms ?? [...VIDEO_PLATFORMS];

  const all = getApprovedScriptsWithAudio();
  const scoped = opts.onlyIds
    ? all.filter((s) => opts.onlyIds!.includes(s.id))
    : all;

  // --force: nuke existing renders for the targeted scripts/platforms first
  if (opts.force) {
    for (const s of scoped) {
      for (const p of targetPlatforms) {
        const f = videoPathFor(s.id, p);
        if (await fs.pathExists(f)) {
          await fs.remove(f);
          log.info(`  🗑  removed ${path.basename(f)} (force)`);
        }
      }
    }
  }

  // A script is "pending" if any targeted platform file is missing
  const pending: ScriptWithAudio[] = [];
  for (const s of scoped) {
    const anyMissing = await Promise.all(
      targetPlatforms.map((p) => fs.pathExists(videoPathFor(s.id, p)).then((x) => !x))
    );
    if (anyMissing.some(Boolean)) pending.push(s);
  }

  if (pending.length === 0) {
    log.warn('No scripts with audio awaiting video. Approve scripts via `npm run voice` first.');
    return;
  }

  log.info(`🎬 Building ${pending.length} script(s) × ${VIDEO_PLATFORMS.length} platforms...`);

  let i = 0;
  for (const s of pending) {
    i++;
    log.info(`  [${i}/${pending.length}] script ${s.id} — ${s.topic_title}`);

    // Transcribe once per script — reused across both platform renders
    let words: Word[] = [];
    let duration = 0;
    try {
      duration = await ffprobeDuration(s.audio_path);
      words = await transcribeOnce(s.audio_path);
    } catch (err) {
      log.error(`  Prep failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const platform of targetPlatforms) {
      const outPath = videoPathFor(s.id, platform);
      if (await fs.pathExists(outPath)) {
        log.info(`    ✓ ${platform} already rendered — skipping`);
        continue;
      }
      const start = Date.now();
      try {
        await renderVideo(s, outPath, platform, words, duration, opts.backgroundOverride);
        const took = ((Date.now() - start) / 1000).toFixed(1);
        const size = (await fs.stat(outPath)).size;
        log.success(`🎬 ${platform} video ready: ${outPath} (${(size / 1024 / 1024).toFixed(2)} MB, ${took}s)`);
      } catch (err) {
        log.error(`  ${platform} render failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
