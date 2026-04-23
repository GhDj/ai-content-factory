import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { log } from '../utils/logger';
import {
  getUnpublishedApprovedScripts,
  markScriptPublished,
  type ScriptWithTopic,
} from '../db/repository';
import { publishToYoutube } from './youtube.publisher';
import { publishToTiktok } from './tiktok.publisher';

const VIDEO_DIR = path.join(process.cwd(), 'output', 'videos');
const YT_TOKEN_PATH = path.join(process.cwd(), 'assets', 'youtube-token.json');

function isEmpty(v: string | undefined): boolean {
  return !v || v.trim() === '' || v === 'your_key_here';
}

export async function youtubeConfigured(): Promise<boolean> {
  const hasCreds =
    !isEmpty(process.env.YOUTUBE_CLIENT_ID) &&
    !isEmpty(process.env.YOUTUBE_CLIENT_SECRET);
  const hasToken = await fs.pathExists(YT_TOKEN_PATH);
  return hasCreds && hasToken;
}

export async function tiktokConfigured(): Promise<boolean> {
  // TikTok is always "configured" — we emit a manual-upload guide locally
  return true;
}

interface PublishOutcome {
  youtubeUrl: string | null;
  tiktokPublishId: string | null;
  youtubeDryRun: boolean;
  tiktokDryRun: boolean;
}

function tiktokVideoPath(scriptId: number): string {
  return path.join(VIDEO_DIR, `script_${scriptId}_tiktok.mp4`);
}

function youtubeVideoPath(scriptId: number): string {
  return path.join(VIDEO_DIR, `script_${scriptId}_youtube.mp4`);
}

async function publishVideo(script: ScriptWithTopic): Promise<PublishOutcome> {
  const out: PublishOutcome = {
    youtubeUrl: null,
    tiktokPublishId: null,
    youtubeDryRun: false,
    tiktokDryRun: false,
  };

  const ytPath = youtubeVideoPath(script.id);
  const ttPath = tiktokVideoPath(script.id);

  // YouTube — uses _youtube.mp4 (with music)
  if (script.youtube_url) {
    log.info(`  ✓ YouTube already published: ${script.youtube_url} — skipping`);
    out.youtubeUrl = script.youtube_url;
  } else if (!(await fs.pathExists(ytPath))) {
    log.warn(`  ⚠ YouTube video missing: ${path.basename(ytPath)}`);
  } else if (await youtubeConfigured()) {
    try {
      const res = await publishToYoutube(ytPath, script);
      out.youtubeUrl = res.url;
    } catch (err) {
      log.error(`  YouTube upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    log.info(`🧪 DRY RUN: Would publish ${path.basename(ytPath)} to YouTube`);
    out.youtubeDryRun = true;
  }

  // TikTok — writes guide, references _tiktok.mp4 (no music)
  if (script.tiktok_publish_id) {
    log.info(`  ✓ TikTok already published: ${script.tiktok_publish_id} — skipping`);
    out.tiktokPublishId = script.tiktok_publish_id;
  } else if (!(await fs.pathExists(ttPath))) {
    log.warn(`  ⚠ TikTok video missing: ${path.basename(ttPath)}`);
  } else {
    try {
      const res = await publishToTiktok(ttPath, script);
      out.tiktokPublishId = res.publishId;
    } catch (err) {
      log.error(`  TikTok guide failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return out;
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

interface Pending {
  script: ScriptWithTopic;
  tiktokPath: string | null;
  youtubePath: string | null;
  tiktokSize: number;
  youtubeSize: number;
}

async function getPendingPublishes(): Promise<Pending[]> {
  const candidates = getUnpublishedApprovedScripts();
  const pending: Pending[] = [];
  for (const s of candidates) {
    const ttPath = tiktokVideoPath(s.id);
    const ytPath = youtubeVideoPath(s.id);
    const ttExists = await fs.pathExists(ttPath);
    const ytExists = await fs.pathExists(ytPath);
    if (!ttExists && !ytExists) continue;
    pending.push({
      script: s,
      tiktokPath: ttExists ? ttPath : null,
      youtubePath: ytExists ? ytPath : null,
      tiktokSize: ttExists ? (await fs.stat(ttPath)).size : 0,
      youtubeSize: ytExists ? (await fs.stat(ytPath)).size : 0,
    });
  }
  return pending;
}

/**
 * Auto-publish the oldest unpublished video. Non-interactive — used by the
 * scheduler. Publishes to YouTube first, then TikTok. Logs URLs and outcome.
 * If no ready video exists, logs a warning and returns without throwing.
 */
export async function runAutoPublish(): Promise<void> {
  const pending = await getPendingPublishes();
  if (pending.length === 0) {
    log.warn('⚠ Auto-publish: no video ready in queue — skipping.');
    return;
  }

  const next = pending[0]; // oldest (getUnpublishedApprovedScripts orders by id ASC)
  const s = next.script;
  log.info(`🤖 Auto-publishing script ${s.id} — ${s.topic_title}`);
  if (next.youtubePath) log.info(`   yt: ${path.basename(next.youtubePath)} (${(next.youtubeSize / 1024 / 1024).toFixed(2)} MB)`);
  if (next.tiktokPath)  log.info(`   tt: ${path.basename(next.tiktokPath)} (${(next.tiktokSize / 1024 / 1024).toFixed(2)} MB)`);

  const outcome = await publishVideo(s);
  const isDryRun = outcome.youtubeDryRun || outcome.tiktokDryRun;

  if (!isDryRun) {
    markScriptPublished(s.id, outcome.youtubeUrl, outcome.tiktokPublishId);
  }

  log.info('📊 Auto-publish summary');
  log.info(`   YouTube: ${outcome.youtubeUrl ?? (outcome.youtubeDryRun ? 'dry-run' : 'failed')}`);
  const ttLine = outcome.tiktokPublishId
    ? (outcome.tiktokPublishId.startsWith('manual_')
        ? `guide at output/ready-to-post/script_${s.id}.txt`
        : outcome.tiktokPublishId)
    : (outcome.tiktokDryRun ? 'dry-run' : 'failed');
  log.info(`   TikTok:  ${ttLine}`);

  if (outcome.youtubeUrl || outcome.tiktokPublishId) {
    log.success(`Auto-publish complete for script ${s.id}`);
  } else {
    log.warn(`Auto-publish produced no live URLs for script ${s.id}`);
  }
}

export async function runPublish(): Promise<void> {
  const pending = await getPendingPublishes();
  if (pending.length === 0) {
    log.warn('No published-ready videos found. Generate via `npm run video` first.');
    return;
  }

  const ytOK = await youtubeConfigured();
  const ttOK = await tiktokConfigured();
  log.info(
    `📤 ${pending.length} video(s) ready. YouTube=${ytOK ? 'API' : 'DRY-RUN'}  TikTok=MANUAL-GUIDE`
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const summary: Array<{
    id: number;
    youtubeUrl: string | null;
    tiktokPublishId: string | null;
    dryRun: boolean;
  }> = [];

  try {
    for (const p of pending) {
      const s = p.script;
      console.log('');
      console.log(`— [${s.id}] ${s.topic_title}`);
      console.log(`  HOOK: ${s.hook}`);
      if (p.youtubePath) console.log(`  YT:   ${path.basename(p.youtubePath)} (${(p.youtubeSize / 1024 / 1024).toFixed(2)} MB)`);
      if (p.tiktokPath)  console.log(`  TT:   ${path.basename(p.tiktokPath)} (${(p.tiktokSize / 1024 / 1024).toFixed(2)} MB)`);

      const answer = await prompt(rl, '  Publish YouTube + write TikTok guide? (y/n/q): ');
      if (answer === null || answer === 'q') {
        log.info('Quit requested.');
        break;
      }
      if (answer !== 'y') {
        log.info(`Skipped script ${s.id}`);
        continue;
      }

      const outcome = await publishVideo(s);
      const isDryRun = outcome.youtubeDryRun || outcome.tiktokDryRun;

      if (!isDryRun) {
        markScriptPublished(s.id, outcome.youtubeUrl, outcome.tiktokPublishId);
      }

      summary.push({
        id: s.id,
        youtubeUrl: outcome.youtubeUrl,
        tiktokPublishId: outcome.tiktokPublishId,
        dryRun: isDryRun,
      });
    }
  } finally {
    rl.close();
  }

  if (summary.length > 0) {
    console.log('');
    console.log('📊 Publish summary');
    console.log('─────────────────────────────');
    for (const r of summary) {
      const tag = r.dryRun ? '[DRY-RUN]' : '[LIVE]';
      const yt = r.youtubeUrl ?? (r.dryRun ? 'would-publish' : 'failed');
      const tt = r.tiktokPublishId
        ? (r.tiktokPublishId.startsWith('manual_')
            ? `guide at output/ready-to-post/script_${r.id}.txt`
            : r.tiktokPublishId)
        : (r.dryRun ? 'would-publish' : 'failed');
      console.log(`  ${tag} script ${r.id}`);
      console.log(`    YouTube: ${yt}`);
      console.log(`    TikTok:  ${tt}`);
    }
    console.log('─────────────────────────────');
  }
}
