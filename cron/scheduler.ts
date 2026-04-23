import 'dotenv/config';
import cron from 'node-cron';
import { runResearch } from '../src/agents/research.agent';
import { runScripts } from '../src/agents/script.agent';
import { runAutoVoice } from '../src/agents/voice.agent';
import { runVideos } from '../src/agents/video.agent';
import { runAutoPublish } from '../src/publishers';
import { getStats } from '../src/db/repository';
import { log } from '../src/utils/logger';

// Daily schedule for @MindShieldDaily — 2 videos/day
const PIPELINE_CRON = '0 6 * * *';   // 06:00 generate
const PUBLISH_1_CRON = '0 7 * * *';  // 07:00 publish video 1
const PUBLISH_2_CRON = '55 19 * * *'; // 19:55 publish video 2
const VIDEOS_PER_DAY = 2;

const TZ = process.env.TZ || undefined;

async function runDailyPipeline(): Promise<void> {
  log.info(`🚀 [06:00] Scheduled pipeline starting — target ${VIDEOS_PER_DAY} videos`);
  try {
    await runResearch(VIDEOS_PER_DAY);
    await runScripts();
    const voicedIds = await runAutoVoice({ count: VIDEOS_PER_DAY, platform: 'tiktok' });
    await runVideos({ onlyIds: voicedIds });
    const s = getStats();
    log.success(
      `📊 Pipeline done. Topics: ${s.topics_total} | Scripts: ${s.scripts_total} | Audio: ${s.audio_files} | Pending approval: ${s.scripts_pending}`
    );
  } catch (err) {
    log.error(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runScheduledPublish(label: string): Promise<void> {
  log.info(`🤖 [${label}] Scheduled publish firing`);
  try {
    await runAutoPublish();
  } catch (err) {
    log.error(`Scheduled publish failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

cron.schedule(PIPELINE_CRON, () => runDailyPipeline(), { timezone: TZ });
cron.schedule(PUBLISH_1_CRON, () => runScheduledPublish('07:00'), { timezone: TZ });
cron.schedule(PUBLISH_2_CRON, () => runScheduledPublish('19:55'), { timezone: TZ });

log.info(`⏰ MindShieldDaily scheduler active (timezone: ${TZ ?? 'system default'})`);
log.info(`  • ${PIPELINE_CRON}   pipeline — ${VIDEOS_PER_DAY} videos/day`);
log.info(`  • ${PUBLISH_1_CRON}   auto-publish video 1`);
log.info(`  • ${PUBLISH_2_CRON}   auto-publish video 2`);
log.info('Press Ctrl+C to stop.');

// Dev shortcut: immediate run
if (process.argv.includes('--now')) {
  log.info('--now flag detected, running pipeline immediately...');
  runDailyPipeline();
}
if (process.argv.includes('--publish-now')) {
  log.info('--publish-now flag detected, running auto-publish immediately...');
  runScheduledPublish('manual');
}
