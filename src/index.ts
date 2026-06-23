import 'dotenv/config';
import { log } from './utils/logger';
import { runResearch } from './agents/research.agent';
import { runScripts } from './agents/script.agent';
import { runVoice, runAutoVoice } from './agents/voice.agent';
import { runVideos } from './agents/video.agent';
import { runCarousel } from './agents/carousel.agent';
import { runImages } from './agents/image-post.agent';
import { runPublish, runAutoPublish } from './publishers';
import { authenticateYouTube } from './auth/youtube-auth';
import { authenticateTikTok } from './auth/tiktok-auth';
import { getStats, getAllScripts, getScriptsByIds, type ScriptWithTopic } from './db/repository';

const command = process.argv[2];

function verdictBadge(v?: string | null): string {
  if (v === 'HIGH')   return '🔥 HIGH';
  if (v === 'MEDIUM') return '✅ MED ';
  if (v === 'LOW')    return '🔴 LOW ';
  return '—      ';
}

function scoreCell(score?: number | null): string {
  if (score == null) return '  —  ';
  return `${String(score).padStart(2)}/10`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s.padEnd(n) : s.slice(0, n - 1) + '…';
}

/**
 * --manual <youtube|tiktok|both|none>
 *   default: tiktok-only manual (existing behavior).
 *   `youtube` adds youtube manual on top of tiktok manual.
 *   `both` is identical to `youtube` here for clarity.
 *   `none` disables manual mode for both (uses APIs / dry-run).
 *   `tiktok` is the default and listed for symmetry.
 */
function parsePublishOpts(args: string[]): { youtubeManual?: boolean; tiktokManual?: boolean } {
  const opts: { youtubeManual?: boolean; tiktokManual?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manual' && args[i + 1]) {
      const v = args[++i].trim().toLowerCase();
      if (v === 'youtube' || v === 'yt') opts.youtubeManual = true;
      else if (v === 'tiktok' || v === 'tt') opts.tiktokManual = true;
      else if (v === 'both' || v === 'all') { opts.youtubeManual = true; opts.tiktokManual = true; }
      else if (v === 'none') { opts.youtubeManual = false; opts.tiktokManual = false; }
    }
  }
  return opts;
}

function renderScriptTable(scripts: ScriptWithTopic[]): string {
  const HEAD = ['ID', 'Platform', 'Score', 'Verdict', 'Hook'];
  const W = [4, 8, 5, 8, 27];
  const sep = '─';
  const topBar    = `┌${W.map((w) => sep.repeat(w + 2)).join('┬')}┐`;
  const midBar    = `├${W.map((w) => sep.repeat(w + 2)).join('┼')}┤`;
  const bottomBar = `└${W.map((w) => sep.repeat(w + 2)).join('┴')}┘`;

  const row = (cells: string[]) =>
    '│ ' + cells.map((c, i) => c.padEnd(W[i])).join(' │ ') + ' │';

  const lines: string[] = [];
  lines.push(topBar);
  lines.push(row(HEAD));
  lines.push(midBar);
  for (const s of scripts) {
    lines.push(
      row([
        String(s.id),
        s.platform,
        scoreCell(s.viral_score),
        verdictBadge(s.viral_verdict),
        truncate(s.hook, W[4]),
      ])
    );
  }
  lines.push(bottomBar);
  return lines.join('\n');
}

function printQueue() {
  const s = getStats();
  console.log('📊 Content Queue');
  console.log('─────────────────────────────');
  console.log(`Topics total:    ${s.topics_total}`);
  console.log(`Topics unused:   ${s.topics_unused}`);
  console.log(`Scripts total:   ${s.scripts_total}`);
  console.log(`Scripts pending: ${s.scripts_pending}`);
  console.log(`Audio files:     ${s.audio_files}`);
  console.log('─────────────────────────────');

  const recent = getAllScripts().slice(0, 10);
  if (recent.length > 0) {
    console.log('');
    console.log('Recent scripts (last 10):');
    console.log(renderScriptTable(recent));
  }
}

async function main() {
  switch (command) {
    case 'pipeline': {
      // Optional count arg: `npm run pipeline -- 3` or `tsx src/index.ts pipeline 3`
      const raw = process.argv[3];
      const count = raw && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 2;

      log.info(`🚀 Pipeline starting (target: ${count} video${count === 1 ? '' : 's'})...`);
      await runResearch(count);
      const producedIds = await runScripts();
      const voicedIds = await runAutoVoice({ count, platform: 'tiktok' });
      await runVideos({ onlyIds: voicedIds });
      // Generate matching photo carousels for the same scripts.
      if (voicedIds.length > 0) {
        log.info(`🖼️  Generating carousels for ${voicedIds.length} script(s)...`);
        await runCarousel({ onlyIds: voicedIds });
        log.info(`📸 Generating image posts for ${voicedIds.length} script(s)...`);
        await runImages({ onlyIds: voicedIds });
      }

      // Quality breakdown on scripts generated in this run
      const produced = getScriptsByIds(producedIds);
      const byVerdict = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
      const highs: ScriptWithTopic[] = [];
      for (const p of produced) {
        if (p.viral_verdict && byVerdict[p.viral_verdict] !== undefined) {
          byVerdict[p.viral_verdict]++;
        }
        if (p.viral_verdict === 'HIGH') highs.push(p);
      }

      const s = getStats();
      console.log('');
      log.info(
        `📊 Queue summary: ${s.topics_total} topics, ${s.scripts_total} scripts, ${s.audio_files} audio files`
      );
      log.info(`🔥 HIGH quality scripts (take to InVideo): ${byVerdict.HIGH}`);
      log.info(`✅ MEDIUM — run automated pipeline:         ${byVerdict.MEDIUM}`);
      if (byVerdict.LOW > 0) {
        log.info(`🔴 LOW — consider regenerating:             ${byVerdict.LOW}`);
      }
      for (const h of highs) {
        log.info(
          `⭐ INVIDEO RECOMMENDED — copy script from output/scripts/${h.id}_${h.platform}.txt  (score ${h.viral_score}/10)`
        );
      }
      log.info('🧾 Videos awaiting review: `npm run voice` to approve audio → `npm run publish` to post.');
      log.success(`Done! ${count} video${count === 1 ? '' : 's'} queued for publishing.`);
      break;
    }
    case 'auto-publish':
      await runAutoPublish(parsePublishOpts(process.argv.slice(3)));
      break;
    case 'research':
      await runResearch();
      break;
    case 'scripts':
      await runScripts();
      break;
    case 'voice': {
      const args = process.argv.slice(3);
      const ids: number[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--id' && args[i + 1]) {
          for (const part of args[++i].split(',')) {
            const n = parseInt(part.trim(), 10);
            if (Number.isFinite(n)) ids.push(n);
          }
        }
      }
      await runVoice({ onlyIds: ids.length ? ids : undefined });
      break;
    }
    case 'video': {
      // Flags: --id <n> (repeatable or comma-list), --force, --platform tiktok|youtube
      const args = process.argv.slice(3);
      const ids: number[] = [];
      let force = false;
      let platforms: Array<'tiktok' | 'youtube'> | undefined;
      let backgroundOverride: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--force') {
          force = true;
        } else if (a === '--id' && args[i + 1]) {
          for (const part of args[++i].split(',')) {
            const n = parseInt(part.trim(), 10);
            if (Number.isFinite(n)) ids.push(n);
          }
        } else if (a === '--platform' && args[i + 1]) {
          const p = args[++i].trim();
          if (p === 'tiktok' || p === 'youtube') platforms = [p];
        } else if (a === '--background' && args[i + 1]) {
          backgroundOverride = args[++i];
        }
      }
      await runVideos({
        onlyIds: ids.length ? ids : undefined,
        force,
        platforms,
        backgroundOverride,
      });
      break;
    }
    case 'publish':
      await runPublish(parsePublishOpts(process.argv.slice(3)));
      break;
    case 'carousel': {
      const args = process.argv.slice(3);
      const ids: number[] = [];
      let force = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--force') {
          force = true;
        } else if (a === '--id' && args[i + 1]) {
          for (const part of args[++i].split(',')) {
            const n = parseInt(part.trim(), 10);
            if (Number.isFinite(n)) ids.push(n);
          }
        }
      }
      await runCarousel({ onlyIds: ids.length ? ids : undefined, force });
      break;
    }
    case 'images': {
      const args = process.argv.slice(3);
      const ids: number[] = [];
      let force = false;
      let all = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--force') force = true;
        else if (a === '--all') all = true;
        else if (a === '--id' && args[i + 1]) {
          for (const part of args[++i].split(',')) {
            const n = parseInt(part.trim(), 10);
            if (Number.isFinite(n)) ids.push(n);
          }
        }
      }
      await runImages({ onlyIds: ids.length ? ids : undefined, force, all });
      break;
    }
    case 'auth:youtube':
      await authenticateYouTube();
      break;
    case 'auth:tiktok':
      await authenticateTikTok();
      break;
    case 'queue':
      printQueue();
      break;
    default:
      log.warn('Usage: npm run <pipeline [count]|research|scripts|voice|video|carousel|images|publish|auto-publish|queue>');
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
