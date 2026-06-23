import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger';
import type { ScriptWithTopic } from '../db/repository';

const GUIDE_DIR = path.join(process.cwd(), 'output', 'ready-to-post');

export interface YoutubeGuideResult {
  url: string;
  guidePath: string;
}

function buildGuide(script: ScriptWithTopic, videoPath: string): string {
  const title = (script.topic_title ?? script.hook ?? `Video ${script.id}`).slice(0, 100);
  const description = [
    script.caption ?? '',
    '',
    script.hashtags ?? '',
  ].filter(Boolean).join('\n');

  return [
    '╔══════════════════════════════════════════╗',
    `║   YOUTUBE SHORTS — Script #${String(script.id).padEnd(13)}║`,
    '╠══════════════════════════════════════════╣',
    '║ Upload via YouTube Studio (Shorts):      ║',
    '║  studio.youtube.com → Create → Short     ║',
    '║                                          ║',
    '║ Visibility: Public                       ║',
    '║ Audience:   Not for kids                 ║',
    '║ Category:   Education                    ║',
    '║ Best time:  7PM-9PM (local)              ║',
    '╚══════════════════════════════════════════╝',
    '',
    'VIDEO FILE (drag this into Studio):',
    `  ${videoPath}`,
    '',
    'TITLE (≤100 chars):',
    title,
    '',
    'DESCRIPTION (paste exactly):',
    description,
    '',
    'HASHTAGS (already in description; paste again in pinned comment if you like):',
    script.hashtags ?? '',
    '',
    'THUMBNAIL TEXT (for cover): ',
    script.thumbnail_text ?? '',
    '',
  ].join('\n');
}

/**
 * Writes a plain-text upload guide alongside the video. Human does the
 * final post via YouTube Studio. Returns a sentinel URL with the
 * `manual_yt_` prefix so downstream code can distinguish it from a real
 * API-published URL.
 */
export async function saveYoutubeGuide(
  videoPath: string,
  script: ScriptWithTopic
): Promise<YoutubeGuideResult> {
  await fs.ensureDir(GUIDE_DIR);
  const guidePath = path.join(GUIDE_DIR, `script_${script.id}_youtube.txt`);
  await fs.writeFile(guidePath, buildGuide(script, videoPath), 'utf8');

  log.info('  📺 YouTube: manual upload required');
  log.info(`  📂 Guide saved: ${guidePath}`);
  log.info(`  🎬 Video file: ${videoPath}`);

  return {
    url: `manual_yt_${Date.now()}`,
    guidePath,
  };
}
