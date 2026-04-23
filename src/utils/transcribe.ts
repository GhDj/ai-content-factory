import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { log } from './logger';

const execFileAsync = promisify(execFile);

export interface Word {
  word: string;
  start: number;
  end: number;
}

function findWhisperBin(): string {
  const candidates: string[] = [];

  // macOS: pip --user installs go here (not always on default PATH)
  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Python', '3.9', 'bin', 'whisper'));
    candidates.push(path.join(os.homedir(), 'Library', 'Python', '3.10', 'bin', 'whisper'));
    candidates.push(path.join(os.homedir(), 'Library', 'Python', '3.11', 'bin', 'whisper'));
    candidates.push(path.join(os.homedir(), 'Library', 'Python', '3.12', 'bin', 'whisper'));
  }

  // Linux / macOS with pipx or homebrew pip
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'whisper'));
  candidates.push('/opt/homebrew/bin/whisper');
  candidates.push('/usr/local/bin/whisper');

  // Windows: pip --user typically installs here
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      for (const ver of ['Python39', 'Python310', 'Python311', 'Python312']) {
        candidates.push(path.join(appData, 'Python', ver, 'Scripts', 'whisper.exe'));
      }
    }
  }

  for (const c of candidates) {
    if (fs.pathExistsSync(c)) return c;
  }

  // Fall back to hoping it's on PATH
  return process.platform === 'win32' ? 'whisper.exe' : 'whisper';
}

const WHISPER_BIN = findWhisperBin();

async function whisperAvailable(): Promise<boolean> {
  try {
    await execFileAsync(WHISPER_BIN, ['--help'], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function runWhisper(
  audioPath: string,
  outDir: string,
  model: 'tiny' | 'base'
): Promise<string> {
  await fs.ensureDir(outDir);
  await execFileAsync(
    WHISPER_BIN,
    [
      audioPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', outDir,
      '--word_timestamps', 'True',
      '--language', 'en',
      '--fp16', 'False',
      '--verbose', 'False',
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000 }
  );

  const base = path.basename(audioPath, path.extname(audioPath));
  const jsonPath = path.join(outDir, `${base}.json`);
  if (!(await fs.pathExists(jsonPath))) {
    throw new Error(`Whisper did not produce ${jsonPath}`);
  }
  return jsonPath;
}

function extractWords(jsonData: any): Word[] {
  const words: Word[] = [];
  for (const seg of jsonData?.segments ?? []) {
    for (const w of seg.words ?? []) {
      const text = String(w.word ?? '').trim();
      if (!text) continue;
      words.push({
        word: text,
        start: Number(w.start),
        end: Number(w.end),
      });
    }
  }
  return words;
}

export async function transcribe(audioPath: string): Promise<Word[]> {
  if (!(await whisperAvailable())) {
    throw new Error(`whisper not available at ${WHISPER_BIN}`);
  }

  const outDir = path.join(process.cwd(), 'output', 'transcripts');
  let jsonPath: string | null = null;

  try {
    jsonPath = await runWhisper(audioPath, outDir, 'tiny');
    const raw = await fs.readFile(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    let words = extractWords(data);

    // Fallback to 'base' if tiny returned almost nothing
    if (words.length < 3) {
      log.warn('tiny model produced < 3 words — retrying with base model');
      await fs.remove(jsonPath);
      jsonPath = await runWhisper(audioPath, outDir, 'base');
      const raw2 = await fs.readFile(jsonPath, 'utf8');
      words = extractWords(JSON.parse(raw2));
    }

    return words;
  } finally {
    if (jsonPath) await fs.remove(jsonPath).catch(() => {});
  }
}
