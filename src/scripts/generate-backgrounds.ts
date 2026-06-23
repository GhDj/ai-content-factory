import 'dotenv/config';
import { prefetchAllBackgrounds, TOPIC_KEYS } from '../utils/ai-background';
import { log } from '../utils/logger';

type Source = 'huggingface' | 'pexels' | 'pexels-video';

interface CliArgs {
  source: Source;
  reset: boolean;
  target?: number;
}

function parseArgs(args: string[]): CliArgs {
  let source: Source = 'huggingface';
  let reset = false;
  let target: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--source' && args[i + 1]) {
      const v = args[++i].trim().toLowerCase();
      if (v === 'pexels' || v === 'pexels-image' || v === 'pexels-img') source = 'pexels';
      else if (v === 'pexels-video' || v === 'pexels-vid' || v === 'video') source = 'pexels-video';
      else if (v === 'huggingface' || v === 'hf') source = 'huggingface';
    } else if (a === '--reset') {
      reset = true;
    } else if (a === '--target' && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (Number.isFinite(n) && n > 0) target = n;
    }
  }
  return { source, reset, target };
}

(async () => {
  const { source, reset, target } = parseArgs(process.argv.slice(2));
  log.info(`🎨 Pre-generating backgrounds (source=${source}, reset=${reset}, target=${target ?? 4}) for ${TOPIC_KEYS.length} topic keys`);
  const delayMs = source === 'huggingface' ? 3000 : 500;
  const result = await prefetchAllBackgrounds(delayMs, source, { reset, target });

  console.log('');
  console.log('📊 Summary');
  console.log('─────────────────────────────');
  console.log(`Source:             ${source}`);
  if (reset) console.log(`Removed on reset:   ${result.removedOnReset}`);
  console.log(`Generated this run: ${result.generated}`);
  console.log(`Total target slots: ${result.total}`);
  if (result.quotaHitAt) {
    console.log(`Quota hit at:       ${result.quotaHitAt}`);
    console.log('Run again later, or try a different --source.');
  } else {
    console.log('All keys filled.');
  }
  console.log('─────────────────────────────');
})();
