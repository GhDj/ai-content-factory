import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger';
import { generateWithF5TTS } from '../agents/voice.agent';

const execFileP = promisify(execFile);

const REF_AUDIO = path.join(process.cwd(), 'assets', 'voice', 'reference.wav');
const REF_TEXT_FILE = path.join(process.cwd(), 'assets', 'voice', 'reference.txt');
const TEST_OUT = path.join(process.cwd(), 'output', 'audio', 'voice_test.m4a');

const TEST_TEXT =
  'This is a quick test of the cloned voice. ' +
  'It should sound calm, clear, and slightly mysterious — like a documentary narrator.';

function box(): void {
  console.log(
    '╔══════════════════════════════════════════╗\n' +
    '║     VOICE REFERENCE SETUP                ║\n' +
    '╠══════════════════════════════════════════╣\n' +
    '║ Record 15-30 seconds of your target      ║\n' +
    '║ voice speaking clearly.                  ║\n' +
    '║                                          ║\n' +
    '║ Tips for best results:                   ║\n' +
    '║  • Quiet room, no background noise       ║\n' +
    '║  • Clear, slow, dramatic speech          ║\n' +
    '║  • Deep mysterious tone if possible      ║\n' +
    '║  • Or use any YouTube audio you like     ║\n' +
    '║                                          ║\n' +
    '║ Save the audio as:                       ║\n' +
    '║  assets/voice/reference.wav              ║\n' +
    '║                                          ║\n' +
    '║ Then write the EXACT transcript of       ║\n' +
    '║ what was said in:                        ║\n' +
    '║  assets/voice/reference.txt              ║\n' +
    '╚══════════════════════════════════════════╝'
  );
}

async function f5ttsInstalled(): Promise<boolean> {
  const candidates = [
    process.env.F5TTS_BIN,
    'f5-tts_infer-cli',
    path.join(process.env.HOME ?? '', '.local/bin/f5-tts_infer-cli'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (c.includes('/')) {
        if (await fs.pathExists(c)) return true;
      } else {
        await execFileP('which', [c]);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

async function main(): Promise<void> {
  box();

  if (!(await f5ttsInstalled())) {
    log.error('F5-TTS not installed.');
    log.info('Install with:  brew install uv && uv tool install f5-tts');
    process.exit(1);
  }

  await fs.ensureDir(path.dirname(REF_AUDIO));

  if (!(await fs.pathExists(REF_AUDIO))) {
    log.error(`Missing reference audio: ${REF_AUDIO}`);
    log.info('Record a 15-30s sample and save it to that path, then re-run.');
    process.exit(1);
  }
  if (!(await fs.pathExists(REF_TEXT_FILE))) {
    log.error(`Missing reference transcript: ${REF_TEXT_FILE}`);
    log.info('Write the exact transcript of reference.wav into that file, then re-run.');
    process.exit(1);
  }

  log.info('✓ Reference files found.');
  log.info('Generating test sample (this may take 30-60s on first run while the model warms up)...');

  await fs.ensureDir(path.dirname(TEST_OUT));
  await generateWithF5TTS(TEST_TEXT, TEST_OUT);

  const stat = await fs.stat(TEST_OUT);
  log.success(`Test sample ready: ${TEST_OUT} (${(stat.size / 1024).toFixed(1)} KB)`);

  try {
    await execFileP('open', [TEST_OUT]);
  } catch {
    log.info(`Open manually:  open ${TEST_OUT}`);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
