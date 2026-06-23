import 'dotenv/config';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { log } from '../utils/logger';

const execFileP = promisify(execFile);

const REF_DIR = path.join(process.cwd(), 'assets', 'voice');
const REF_WAV = path.join(REF_DIR, 'reference.wav');
const REF_TXT = path.join(REF_DIR, 'reference.txt');

/**
 * ~20–25 seconds when spoken — long enough for F5-TTS to learn cadence,
 * short enough to stay focused. Documentary tone matches our content.
 */
const REFERENCE_TEXT =
  'There is a quiet pattern at work in many of the relationships people accept as normal. ' +
  'It hides behind charm and small acts of care. ' +
  'It rewires how you trust your own memory, your own instincts, your own sense of what is real. ' +
  'Most people never see it until the damage is already done.';

async function main(): Promise<void> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!voiceId || !apiKey) {
    log.error('ELEVENLABS_VOICE_ID or ELEVENLABS_API_KEY missing in .env');
    process.exit(1);
  }

  await fs.ensureDir(REF_DIR);

  log.info(`🎙️  Synthesizing reference audio with ElevenLabs voice ${voiceId.slice(0, 8)}...`);
  const res = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text: REFERENCE_TEXT,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.80,
        style: 0.25,
        use_speaker_boost: true,
      },
    },
    {
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );

  const tmpMp3 = path.join(os.tmpdir(), `ref_${Date.now()}.mp3`);
  await fs.writeFile(tmpMp3, Buffer.from(res.data));

  log.info('🔊 Converting MP3 → 24kHz mono WAV (F5-TTS preferred format)...');
  await execFileP('ffmpeg', [
    '-y', '-i', tmpMp3,
    '-ar', '24000', '-ac', '1',
    REF_WAV,
  ]);
  await fs.remove(tmpMp3).catch(() => {});

  await fs.writeFile(REF_TXT, REFERENCE_TEXT, 'utf8');

  const stat = await fs.stat(REF_WAV);
  log.success(`Reference WAV: ${REF_WAV} (${(stat.size / 1024).toFixed(1)} KB)`);
  log.success(`Reference text: ${REF_TXT}`);
  log.info('Next: run `npm run setup:voice` to generate a test clone.');
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
