/**
 * TikTok "publisher" — no longer does automated upload.
 *
 * The Playwright path is kept in tiktok.playwright.ts for future use but is
 * not wired in. Current flow: save a manual-upload guide and let the user
 * post from the TikTok app. That proved more reliable and avoided bot
 * detection / Content-under-review limbo.
 */
import type { ScriptWithTopic } from '../db/repository';
import { saveTiktokGuide, type TikTokGuideResult } from './tiktok-guide';

export type TikTokPublishResult = TikTokGuideResult;

export async function publishToTiktok(
  videoPath: string,
  script: ScriptWithTopic
): Promise<TikTokPublishResult> {
  return saveTiktokGuide(videoPath, script);
}
