import 'dotenv/config';
import { prefetchAllBackgrounds, TOPIC_KEYS } from '../utils/ai-background';
import { log } from '../utils/logger';

(async () => {
  log.info(`🎨 Pre-generating AI backgrounds for ${TOPIC_KEYS.length} topic keys`);
  const result = await prefetchAllBackgrounds(3000);

  console.log('');
  console.log('📊 Summary');
  console.log('─────────────────────────────');
  console.log(`Generated this run: ${result.generated}`);
  console.log(`Total topic keys:   ${result.total}`);
  if (result.quotaHitAt) {
    console.log(`Quota hit at:       ${result.quotaHitAt}`);
    console.log('Run again tomorrow (or upgrade HF) to fill in the rest.');
  } else {
    console.log('All keys cached.');
  }
  console.log('─────────────────────────────');
})();
