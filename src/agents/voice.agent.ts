import axios, { AxiosError } from 'axios';
import fs from 'fs-extra';
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

const AUDIO_DIR = path.join(process.cwd(), 'output', 'audio');

type SynthResult = 'ok' | 'quota' | 'blocked';

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
 * Dark-psychology voice settings — calmer, more mysterious, documentary tone.
 * Read fresh at each synthesize() call so .env edits take effect without restart.
 */
async function synthesize(voiceScript: string, outPath: string): Promise<SynthResult> {
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

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  log.info(`🎙️  ${pending.length} script(s) pending approval · voice=${voiceId?.slice(0, 8)}...`);

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

      const result = await processApproved(s);
      if (result === 'blocked') {
        log.warn('Stopping — fix ElevenLabs credentials and re-run.');
        break;
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Auto-generate audio for the N newest pending scripts of a given platform.
 * Non-interactive — used by the scheduled pipeline.
 */
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
      const result = await processApproved(s);
      if (result === 'ok') processedIds.push(s.id);
      if (result === 'blocked') {
        log.warn('Stopping auto-voice — ElevenLabs blocked.');
        break;
      }
    } catch (err) {
      log.error(`  auto-voice failed for script ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return processedIds;
}

async function processApproved(s: ScriptWithTopic): Promise<SynthResult> {
  const outPath = path.join(AUDIO_DIR, `script_${s.id}_${s.platform}.mp3`);
  const result = await synthesize(s.voice_script, outPath);

  if (result === 'quota') {
    log.warn(`ElevenLabs quota reached. Skipping audio for script ${s.id}.`);
    return result;
  }
  if (result === 'blocked') {
    log.warn(`ElevenLabs blocked (account/permissions). Skipping script ${s.id}.`);
    return result;
  }

  saveAudioFile(s.id, outPath);
  approveScript(s.id);
  log.success(`Audio saved: ${outPath}`);
  return result;
}
