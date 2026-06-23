import 'dotenv/config';
import Groq from 'groq-sdk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger';

const execFileP = promisify(execFile);

const REF_DIR = path.join(process.cwd(), 'assets', 'voice');
const REF_WAV = path.join(REF_DIR, 'reference.wav');
const REF_TXT = path.join(REF_DIR, 'reference.txt');

/**
 * Convert any audio file to F5-TTS-friendly reference WAV (24kHz mono),
 * trim to first ~12s (F5-TTS clips longer refs anyway), then transcribe
 * with Groq Whisper to produce reference.txt.
 *
 * Usage: tsx src/scripts/import-reference-from-audio.ts <input-audio>
 */
async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    log.error('Usage: tsx src/scripts/import-reference-from-audio.ts <input-audio-file>');
    process.exit(1);
  }
  if (!(await fs.pathExists(input))) {
    log.error(`Input not found: ${input}`);
    process.exit(1);
  }

  await fs.ensureDir(REF_DIR);

  log.info(`🔊 Converting → 24kHz mono WAV (max 12s)...`);
  await execFileP('ffmpeg', [
    '-y', '-i', input,
    '-t', '12',
    '-ar', '24000', '-ac', '1',
    REF_WAV,
  ]);

  log.info('📝 Transcribing with Groq Whisper...');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const stream = await fs.createReadStream(REF_WAV);
  const tx = await groq.audio.transcriptions.create({
    file: stream as any,
    model: 'whisper-large-v3',
    language: 'en',
    response_format: 'verbose_json',
  });
  const text = (tx as any).text?.trim() ?? '';
  if (!text) {
    log.error('Transcription returned empty text.');
    process.exit(1);
  }

  await fs.writeFile(REF_TXT, text, 'utf8');

  const stat = await fs.stat(REF_WAV);
  log.success(`Reference WAV: ${REF_WAV} (${(stat.size / 1024).toFixed(1)} KB)`);
  log.success(`Reference text: ${REF_TXT}`);
  log.info(`Transcript:\n  "${text}"`);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
