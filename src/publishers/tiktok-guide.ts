import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger';
import type { ScriptWithTopic } from '../db/repository';

const GUIDE_DIR = path.join(process.cwd(), 'output', 'ready-to-post');

export interface TikTokGuideResult {
  publishId: string;
  guidePath: string;
}

function buildGuide(script: ScriptWithTopic, videoPath: string): string {
  return [
    '╔══════════════════════════════════════════╗',
    `║     TIKTOK UPLOAD — Script #${String(script.id).padEnd(12)}║`,
    '╠══════════════════════════════════════════╣',
    '║ 🎵 MUSIC TIP:                            ║',
    '║ After uploading, tap Sounds and search:  ║',
    '║ "dark ambient" or "mysterious thriller"  ║',
    '║ Pick the most used trending sound.       ║',
    '║ OR tap a viral dark psych video →        ║',
    '║ spinning disc → Use this sound           ║',
    '╠══════════════════════════════════════════╣',
    `║ VIDEO: ${path.basename(videoPath).padEnd(34)}║`,
    `║ CAPTION: ${(script.caption ?? '').slice(0, 32).padEnd(32)}║`,
    `║ HASHTAGS: ${(script.hashtags ?? '').slice(0, 31).padEnd(31)}║`,
    '║ BEST TIME: 7PM-9PM                       ║',
    '╚══════════════════════════════════════════╝',
    '',
    'FULL VIDEO PATH:',
    `  ${videoPath}`,
    '',
    'FULL CAPTION (copy exactly):',
    script.caption ?? '',
    '',
    'FULL HASHTAGS (copy exactly):',
    script.hashtags ?? '',
    '',
    'COVER: use timestamp 0:02',
    '',
  ].join('\n');
}

/**
 * Writes a plain-text upload guide alongside the video. Human does the
 * final post in the TikTok app with a trending-sound overlay.
 */
export async function saveTiktokGuide(
  videoPath: string,
  script: ScriptWithTopic
): Promise<TikTokGuideResult> {
  await fs.ensureDir(GUIDE_DIR);
  const guidePath = path.join(GUIDE_DIR, `script_${script.id}.txt`);
  await fs.writeFile(guidePath, buildGuide(script, videoPath), 'utf8');

  log.info('  📱 TikTok: manual upload required');
  log.info(`  📂 Guide saved: ${guidePath}`);
  log.info(`  🎬 Video file: ${videoPath}`);

  return {
    publishId: `manual_${Date.now()}`,
    guidePath,
  };
}
