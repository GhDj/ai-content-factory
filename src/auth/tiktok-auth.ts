import { loginToTiktok } from '../publishers/tiktok.playwright';
import { log } from '../utils/logger';

export async function authenticateTikTok(): Promise<void> {
  await loginToTiktok();
}

if (require.main === module) {
  authenticateTikTok().catch((err) => {
    log.error(String(err));
    process.exit(1);
  });
}
