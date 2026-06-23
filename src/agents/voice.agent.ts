import axios, { AxiosError } from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { log } from '../utils/logger';
import { withRetry } from '../utils/retry';
import {
  getPendingScripts,
  approveScript,
  saveAudioFile,
  type ScriptWithTopic,
} from '../db/repository';

const execFileP = promisify(execFile);

const AUDIO_DIR = path.join(process.cwd(), 'output', 'audio');
const REF_AUDIO = path.join(process.cwd(), 'assets', 'voice', 'reference.wav');
const REF_TEXT_FILE = path.join(process.cwd(), 'assets', 'voice', 'reference.txt');

type SynthResult = 'ok' | 'quota' | 'blocked';
type Engine = 'f5tts' | 'elevenlabs' | 'say';

function parseAxiosErrBody(err: AxiosError): string {
  const data = err.response?.data;
  if (!data) return err.message;
  if (Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString('utf8'))?.detail?.message ?? data.toString('utf8');
    } catch {
      return data.toString('utf8');
    }
  }
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Pronunciation-fix substitutions before TTS. The brand "Mind Shield Daily"
 * gets read as gibberish when handed to TTS as a single token (legacy
 * 'MindShieldDaily' or the current 'mindshieldaily'). Always force the
 * spaced display form for the voiceover.
 */
const PRONUNCIATION_FIXES: Array<[RegExp, string]> = [
  [/\bMindShieldDaily\b/g, 'Mind Shield Daily'],
  [/\b@MindShieldDaily\b/g, 'Mind Shield Daily'],
  [/\b@?mindshieldaily\b/gi, 'Mind Shield Daily'],
];

function cleanText(text: string): string {
  let out = text.replace(/\[.*?\]/g, '');
  for (const [pat, rep] of PRONUNCIATION_FIXES) out = out.replace(pat, rep);
  return out.replace(/\s+/g, ' ').trim();
}

// ───────────────────────────────────────────────────────────────────
// F5-TTS (primary): local model on Apple Silicon (mps)
// ───────────────────────────────────────────────────────────────────

const F5TTS_CANDIDATES = [
  process.env.F5TTS_BIN,
  'f5-tts_infer-cli',
  path.join(os.homedir(), '.local/bin/f5-tts_infer-cli'),
].filter(Boolean) as string[];

async function resolveF5TTSBin(): Promise<string | null> {
  for (const cand of F5TTS_CANDIDATES) {
    try {
      if (cand.includes('/')) {
        if (await fs.pathExists(cand)) return cand;
      } else {
        await execFileP('which', [cand]);
        return cand;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function f5ttsAvailable(): Promise<boolean> {
  if (!(await resolveF5TTSBin())) return false;
  if (!(await fs.pathExists(REF_AUDIO))) return false;
  if (!(await fs.pathExists(REF_TEXT_FILE))) return false;
  return true;
}

export async function generateWithF5TTS(
  voiceScript: string,
  outPath: string
): Promise<void> {
  const refText = (await fs.readFile(REF_TEXT_FILE, 'utf8')).trim();
  const tmpWav = path.join(os.tmpdir(), `f5tts_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

  const bin = await resolveF5TTSBin();
  if (!bin) throw new Error('f5-tts_infer-cli not found on PATH or ~/.local/bin');

  await fs.ensureDir(path.dirname(outPath));

  const tmpDir = os.tmpdir();
  const tmpName = path.basename(tmpWav);
  // torchcodec inside f5-tts needs ffmpeg's libavutil on macOS — point dyld at Homebrew's lib dir.
  const dyldPath = [
    '/opt/homebrew/lib',
    '/usr/local/lib',
    process.env.DYLD_FALLBACK_LIBRARY_PATH,
  ].filter(Boolean).join(':');

  await execFileP(
    bin,
    [
      '--model', process.env.F5TTS_MODEL ?? 'F5TTS_v1_Base',
      '--ref_audio', REF_AUDIO,
      '--ref_text', refText,
      '--gen_text', cleanText(voiceScript),
      '--output_dir', tmpDir,
      '--output_file', tmpName,
      '--device', 'mps',
      '--speed', process.env.F5TTS_SPEED ?? '0.9',
    ],
    {
      timeout: 900000,
      env: { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: dyldPath },
    }
  );

  try {
    // Convert WAV → M4A (AAC 192k) for compatibility with rest of pipeline.
    await execFileP('ffmpeg', [
      '-y', '-i', tmpWav,
      '-c:a', 'aac', '-b:a', '192k',
      outPath,
    ]);
  } finally {
    await fs.remove(tmpWav).catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────────────
// ElevenLabs (fallback): cloud API
// ───────────────────────────────────────────────────────────────────

async function generateWithElevenLabs(
  voiceScript: string,
  outPath: string
): Promise<SynthResult> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!voiceId || !apiKey) {
    throw new Error('ELEVENLABS_VOICE_ID or ELEVENLABS_API_KEY missing in .env');
  }

  try {
    const res = await withRetry(
      () =>
        axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            text: voiceScript,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.55,
              similarity_boost: 0.80,
              style: 0.25,
              use_speaker_boost: true,
            },
          },
          {
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer',
            timeout: 60000,
          }
        ),
      2,
      2000
    );

    await fs.ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, Buffer.from(res.data));
    return 'ok';
  } catch (err) {
    const aerr = err as AxiosError;
    const status = aerr.response?.status;
    if (status === 429) return 'quota';
    if (status === 401) {
      log.error(`ElevenLabs 401: ${parseAxiosErrBody(aerr)}`);
      return 'blocked';
    }
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────────
// macOS say (last resort)
// ───────────────────────────────────────────────────────────────────

const SAY_VOICE = process.env.MAC_SAY_VOICE ?? 'Daniel';
const SAY_RATE = process.env.MAC_SAY_RATE ?? '175';

async function generateWithSay(voiceScript: string, outPath: string): Promise<void> {
  const tmpAiff = path.join(os.tmpdir(), `say_${Date.now()}_${Math.random().toString(36).slice(2)}.aiff`);
  await fs.ensureDir(path.dirname(outPath));
  try {
    await execFileP('say', ['-v', SAY_VOICE, '-r', SAY_RATE, '-o', tmpAiff, voiceScript]);
    await execFileP('ffmpeg', [
      '-y', '-i', tmpAiff,
      '-c:a', 'aac', '-b:a', '192k',
      outPath,
    ]);
  } finally {
    await fs.remove(tmpAiff).catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────────────
// Cascade entry point
// ───────────────────────────────────────────────────────────────────

interface SynthOutcome {
  engine: Engine;
  outPath: string;
}

async function synthesizeCascade(
  voiceScript: string,
  scriptId: number,
  platform: string
): Promise<SynthOutcome> {
  const m4aPath = path.join(AUDIO_DIR, `script_${scriptId}_${platform}.m4a`);
  const mp3Path = path.join(AUDIO_DIR, `script_${scriptId}_${platform}.mp3`);
  // Apply pronunciation fixes once so all engines benefit (cleanText is also
  // called inside generateWithF5TTS — duplicate substitution is a no-op).
  voiceScript = cleanText(voiceScript);

  // 1) F5-TTS — outputs M4A
  if (await f5ttsAvailable()) {
    try {
      log.info(`  🎙️  F5-TTS (local, mps)...`);
      await generateWithF5TTS(voiceScript, m4aPath);
      return { engine: 'f5tts', outPath: m4aPath };
    } catch (err) {
      log.warn(`  F5-TTS failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) ElevenLabs — outputs MP3
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
    try {
      log.info(`  🎙️  ElevenLabs...`);
      const result = await generateWithElevenLabs(voiceScript, mp3Path);
      if (result === 'ok') return { engine: 'elevenlabs', outPath: mp3Path };
      log.warn(`  ElevenLabs returned ${result}; falling back.`);
    } catch (err) {
      log.warn(`  ElevenLabs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3) macOS say — outputs M4A
  log.info(`  🎙️  macOS say (${SAY_VOICE})...`);
  await generateWithSay(voiceScript, m4aPath);
  return { engine: 'say', outPath: m4aPath };
}

// ───────────────────────────────────────────────────────────────────
// Public agent entry points
// ───────────────────────────────────────────────────────────────────

function prompt(rl: readline.Interface, q: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once('close', onClose);
    try {
      rl.question(q, (a) => {
        rl.off('close', onClose);
        resolve(a.trim().toLowerCase());
      });
    } catch {
      resolve(null);
    }
  });
}

export async function runVoice(opts: { onlyIds?: number[] } = {}): Promise<void> {
  let pending = getPendingScripts();
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    const set = new Set(opts.onlyIds);
    pending = pending.filter((s) => set.has(s.id));
  }
  if (pending.length === 0) {
    log.warn('No pending scripts to approve.');
    return;
  }

  log.info(`🎙️  ${pending.length} script(s) pending approval`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const s of pending) {
      console.log('');
      console.log(`— [${s.id}] [${s.platform}] ${s.topic_title}`);
      console.log(`  HOOK: ${s.hook}`);

      const answer = await prompt(rl, '  Approve? (y/n/q): ');
      if (answer === null || answer === 'q') {
        log.info('Quit requested.');
        break;
      }
      if (answer !== 'y') {
        log.info(`Skipped script ${s.id}`);
        continue;
      }

      await processApproved(s);
    }
  } finally {
    rl.close();
  }
}

export async function runAutoVoice(
  opts: { count: number; platform?: 'tiktok' | 'youtube' } = { count: 2, platform: 'tiktok' }
): Promise<number[]> {
  const platform = opts.platform ?? 'tiktok';
  const pending = getPendingScripts().filter((s) => s.platform === platform);
  pending.sort((a, b) => b.id - a.id);
  const toProcess = pending.slice(0, opts.count);

  if (toProcess.length === 0) {
    log.warn(`No pending ${platform} scripts to auto-voice.`);
    return [];
  }

  log.info(`🎙️  Auto-voicing ${toProcess.length} newest ${platform} script(s)...`);
  const processedIds: number[] = [];
  for (const s of toProcess) {
    try {
      await processApproved(s);
      processedIds.push(s.id);
    } catch (err) {
      log.error(`  auto-voice failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return processedIds;
}

async function processApproved(s: ScriptWithTopic): Promise<void> {
  const outcome = await synthesizeCascade(s.voice_script, s.id, s.platform);
  saveAudioFile(s.id, outcome.outPath);
  approveScript(s.id);
  log.success(`Audio saved (engine=${outcome.engine}): ${outcome.outPath}`);
}
