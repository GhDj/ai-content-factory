import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
import { log } from '../utils/logger';
import { getBackground, recordBackgroundUsed } from '../utils/ai-background';
import { getRandomMusicTrack } from '../utils/music';
import type { ScriptWithAudio } from '../db/repository';
import type { Word } from '../utils/transcribe';

const VIDEO_DIR = path.join(process.cwd(), 'output', 'videos');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const COMPOSITION_ID = 'MindShieldVideo';
const FPS = 30;

async function buildBundle(): Promise<string> {
  log.info('  📦 Bundling Remotion composition...');
  await fs.ensureDir(PUBLIC_DIR);
  return bundle({
    entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts'),
    publicDir: PUBLIC_DIR,
    webpackOverride: (config) => config,
  });
}

/**
 * Copy a source asset into ./public with a unique name and return the URL
 * path that the bundled Remotion composition can fetch. `publicDir` contents
 * are snapshotted at bundle() time, so stage BEFORE bundling.
 */
/**
 * Re-encode the Remotion output with a proper GOP (1 keyframe/sec) and
 * TV-range yuv420p. Keeps bitrate ~2 Mbps, keeps audio as-is.
 */
async function normalizePlayback(videoPath: string): Promise<void> {
  const tmpPath = videoPath.replace(/\.mp4$/, '.norm.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2M', '-maxrate', '4M', '-bufsize', '4M',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
    '-movflags', '+faststart',
    '-c:a', 'copy',
    tmpPath,
  ]);
  await fs.move(tmpPath, videoPath, { overwrite: true });
}

async function probeVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

async function stageAsset(srcPath: string, tag: string): Promise<{ url: string; stagedPath: string }> {
  await fs.ensureDir(PUBLIC_DIR);
  const id = `${tag}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${path.extname(srcPath)}`;
  const stagedPath = path.join(PUBLIC_DIR, id);
  await fs.copy(srcPath, stagedPath);
  // Remotion bundle copies publicDir contents to bundle/public/, served at /public/<file>
  return { url: `/public/${id}`, stagedPath };
}

export async function renderVideoWithRemotion(
  script: ScriptWithAudio,
  words: Word[],
  audioDurationSeconds: number,
  platform: 'tiktok' | 'youtube' = 'tiktok',
  backgroundOverride?: string
): Promise<string> {
  await fs.ensureDir(VIDEO_DIR);

  let backgroundPath: string;
  let isBackgroundImage: boolean;
  if (backgroundOverride) {
    if (!(await fs.pathExists(backgroundOverride))) {
      throw new Error(`--background path not found: ${backgroundOverride}`);
    }
    backgroundPath = backgroundOverride;
    isBackgroundImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(backgroundOverride);
    log.info(`  🎨 Using --background override: ${path.basename(backgroundPath)} (${isBackgroundImage ? 'image' : 'video'})`);
  } else {
    log.info(`  🎨 Getting background for ${platform} (FLUX.1 → Pexels fallback)...`);
    const picked = await getBackground(script.topic_title);
    backgroundPath = picked.path;
    isBackgroundImage = picked.isImage;
  }

  // For video backgrounds, probe duration so we can loop them in Remotion
  // when the clip is shorter than the composition.
  let backgroundDurationFrames: number | undefined;
  if (!isBackgroundImage) {
    const seconds = await probeVideoDurationSeconds(backgroundPath);
    if (seconds) {
      backgroundDurationFrames = Math.max(FPS, Math.floor(seconds * FPS));
      log.info(`  ⏱  Background clip duration: ${seconds.toFixed(2)}s (${backgroundDurationFrames} frames)`);
    } else {
      log.warn('  ⏱  Could not probe background duration — using 5s default loop');
    }
  }

  // Stage assets into ./public BEFORE bundling — bundle() snapshots publicDir.
  const staged: string[] = [];
  const bgStaged = await stageAsset(backgroundPath, `bg_${script.id}_${platform}`);
  const audioStaged = await stageAsset(script.audio_path, `audio_${script.id}_${platform}`);
  staged.push(bgStaged.stagedPath, audioStaged.stagedPath);

  // Music only on YouTube — TikTok stays clean for trending-sound overlay
  let musicUrl = '';
  if (platform === 'youtube') {
    const musicTrack = getRandomMusicTrack();
    if (musicTrack) {
      const musicStaged = await stageAsset(musicTrack, `music_${script.id}_${platform}`);
      staged.push(musicStaged.stagedPath);
      musicUrl = musicStaged.url;
      log.info(`  🎵 Background music (youtube): ${path.basename(musicTrack)}`);
    }
  }

  // Stage the brand logo so the Remotion <Watermark /> can fetch it. Optional —
  // if the file is missing, the watermark falls back to text-only.
  let logoUrl = '';
  const logoSrc = path.join(process.cwd(), 'assets', 'branding', 'logo.png');
  if (await fs.pathExists(logoSrc)) {
    const logoStaged = await stageAsset(logoSrc, `logo_${script.id}_${platform}`);
    staged.push(logoStaged.stagedPath);
    logoUrl = logoStaged.url;
  }

  const serveUrl = await buildBundle();

  const inputProps = {
    backgroundPath: bgStaged.url,
    isBackgroundImage,
    backgroundDurationFrames,
    thumbnailText: script.thumbnail_text,
    words,
    audioPath: audioStaged.url,
    audioDurationSeconds,
    musicPath: musicUrl,
    logoPath: logoUrl,
  };

  try {
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
    });

    const outputPath = path.join(VIDEO_DIR, `script_${script.id}_${platform}.mp4`);
    const durationInFrames = Math.ceil(audioDurationSeconds * FPS) + FPS; // +1s tail

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames,
        fps: FPS,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      // NOTE: Remotion rejects `crf` and `videoBitrate` together.
      // Bitrate gives more predictable file size for our 60 s shorts.
      videoBitrate: '2M',
      encodingMaxRate: '4M',
      encodingBufferSize: '4M',
      pixelFormat: 'yuv420p',
      onProgress: ({ progress }) => {
        process.stdout.write(`\r      🎬 Remotion rendering: ${Math.round(progress * 100)}%   `);
      },
    });

    // Post-process: Remotion's internal encoder ignores our GOP override
    // flags (and a JPEG background forces yuvj420p full-range). Players
    // stutter on scrubs when there's only 1 keyframe per clip. Re-mux with
    // explicit keyframe interval + TV-range YUV. ~3-5s overhead per video.
    await normalizePlayback(outputPath);

    // Retire the picked background so it doesn't get reused. Skip when the
    // user explicitly chose one via --background (that's a user-managed file).
    if (!backgroundOverride) {
      await recordBackgroundUsed(backgroundPath);
    }

    process.stdout.write('\n');
    return outputPath;
  } finally {
    for (const p of staged) {
      await fs.remove(p).catch(() => {});
    }
  }
}
