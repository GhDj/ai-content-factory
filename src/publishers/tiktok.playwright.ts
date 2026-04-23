import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { chromium } from 'playwright-extra';
// @ts-expect-error — no bundled types, but import works at runtime
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { log } from '../utils/logger';
import type { ScriptWithTopic } from '../db/repository';

import { ACTIVE_ACCOUNT } from '../config/accounts';

chromium.use(StealthPlugin());

const SESSION_PATH = path.join(process.cwd(), ACTIVE_ACCOUNT.sessionFile);
const SCREENSHOT_DIR = path.join(process.cwd(), 'output', 'screenshots');

const LOGIN_URL = 'https://www.tiktok.com/login';
const UPLOAD_URLS = [
  'https://www.tiktok.com/creator-center/upload',
  'https://www.tiktok.com/upload',
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"]',
  'input[accept*="video"]',
  '[class*="upload"] input',
  '[class*="Upload"] input',
  'input[name="upload"]',
];

const CAPTION_SELECTORS = [
  '[data-text="true"]',
  '.public-DraftEditor-content',
  '[contenteditable="true"]',
  'div[class*="caption"] [contenteditable]',
  'div[class*="editor"]',
];

const POST_BUTTON_SELECTORS = [
  'button[data-e2e="btn_post"]',
  'button[data-e2e="post_video_button"]',
  'button:has-text("Post")',
  'button:has-text("Publish")',
  '[class*="post-btn"]',
  '[class*="publish"] button',
];

const MAX_LOGIN_WAIT = 10 * 60 * 1000;

function isHeadless(): boolean {
  const v = process.env.PLAYWRIGHT_HEADLESS;
  return v === 'true' || v === '1';
}

function getChromeExecutablePath(): string {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  return '/usr/bin/google-chrome';
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--start-maximized',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(page: Page, minMs = 2000, maxMs = 4000): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function wiggleMouse(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(
      randomInt(100, 900),
      randomInt(100, 500),
      { steps: randomInt(10, 25) }
    );
    await page.waitForTimeout(randomInt(200, 600));
  }
}

async function tryClickPhoneEmailOption(page: Page): Promise<void> {
  const candidates = [
    page.getByText(/Use phone\s*\/\s*email\s*\/\s*username/i),
    page.getByText(/Phone number\s*\/\s*Email\s*\/\s*Username/i),
    page.getByText(/Continue with email\/phone/i),
    page.locator('[data-e2e="channel-item"]'),
  ];
  for (const c of candidates) {
    try {
      const first = c.first();
      await first.waitFor({ state: 'visible', timeout: 3000 });
      await first.click();
      return;
    } catch {
      /* try next */
    }
  }
}

export async function hasTiktokSession(): Promise<boolean> {
  return fs.pathExists(SESSION_PATH);
}

export async function loginToTiktok(): Promise<void> {
  const execPath = getChromeExecutablePath();
  if (!(await fs.pathExists(execPath))) {
    throw new Error(
      `Google Chrome not found at ${execPath}. Install Chrome, or edit getChromeExecutablePath().`
    );
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: execPath,
      args: LAUNCH_ARGS,
    });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    log.info('🌐 Opening TikTok login in your real Chrome (up to 10 min to finish).');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    await humanPause(page, 2000, 4000);
    await wiggleMouse(page);
    await tryClickPhoneEmailOption(page).catch(() => { /* optional */ });
    await humanPause(page, 800, 1500);

    const deadline = Date.now() + MAX_LOGIN_WAIT;
    while (Date.now() < deadline) {
      if (!page.url().includes('/login')) break;
      await page.waitForTimeout(2000);
    }

    if (page.url().includes('/login')) {
      throw new Error('Login not detected within 10 minutes — aborting.');
    }

    await fs.ensureDir(path.dirname(SESSION_PATH));
    await context.storageState({ path: SESSION_PATH });
    log.success(`TikTok session saved to ${SESSION_PATH}. Won't need to log in again.`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

export interface TikTokPublishResult {
  publishId: string;
  url: string;
  screenshot: string;
}

async function debugShot(page: Page, step: string): Promise<void> {
  await fs.ensureDir(SCREENSHOT_DIR);
  const p = path.join(SCREENSHOT_DIR, `tiktok_debug_${step}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  log.info(`      📸 ${p}`);
}

async function findAnySelector(
  page: Page,
  selectors: string[],
  state: 'attached' | 'visible' = 'visible',
  timeoutEach = 5000
): Promise<{ selector: string; inPage: true } | null> {
  for (const selector of selectors) {
    try {
      const handle = await page.waitForSelector(selector, { timeout: timeoutEach, state });
      if (handle) {
        log.info(`      ✓ matched selector: ${selector}`);
        return { selector, inPage: true };
      }
    } catch {
      /* try next */
    }
  }
  // also try inside frames (TikTok sometimes uses iframes)
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      try {
        const handle = await frame.waitForSelector(selector, { timeout: 1500, state });
        if (handle) {
          log.info(`      ✓ matched selector (iframe): ${selector}`);
          return { selector, inPage: true }; // still resolvable via locator on main page? no — caller handles fallback
        }
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function gotoUpload(page: Page): Promise<string> {
  for (const url of UPLOAD_URLS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const landed = page.url();
      if (landed.includes('/login')) {
        throw new Error('SESSION_EXPIRED');
      }
      // If TikTok redirected us away (e.g. 404), fall through to next URL
      const body = await page.locator('body').innerText().catch(() => '');
      if (/can.?t find this page|404/i.test(body)) {
        log.warn(`      ${url} returned 404-ish page, trying next...`);
        continue;
      }
      log.info(`      landed on: ${landed}`);
      return landed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SESSION_EXPIRED')) throw err;
      log.warn(`      failed goto ${url}: ${msg}`);
    }
  }
  throw new Error('Could not open any TikTok upload URL');
}

async function setVideoFile(page: Page, videoPath: string): Promise<string> {
  // Wait for the upload UI to materialize
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  for (const selector of FILE_INPUT_SELECTORS) {
    try {
      const handle = await page.waitForSelector(selector, {
        timeout: 5000,
        state: 'attached', // file inputs are usually hidden
      });
      if (handle) {
        log.info(`      ✓ file input matched: ${selector}`);
        await handle.setInputFiles(videoPath);
        return selector;
      }
    } catch {
      /* try next */
    }
  }

  await debugShot(page, '1b_no_file_input');
  throw new Error('Could not find file input on upload page');
}

async function fillCaption(page: Page, text: string): Promise<string | null> {
  const match = await findAnySelector(page, CAPTION_SELECTORS, 'visible', 5000);
  if (!match) {
    log.warn('      no caption field matched — skipping caption');
    return null;
  }
  const locator = page.locator(match.selector).first();
  await locator.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text.slice(0, 2200), { delay: 8 });
  return match.selector;
}

async function clickPost(page: Page): Promise<string> {
  for (const selector of POST_BUTTON_SELECTORS) {
    try {
      const btn = await page.waitForSelector(selector, { timeout: 3000, state: 'visible' });
      if (btn) {
        log.info(`      ✓ post button matched: ${selector}`);
        await btn.click();
        return selector;
      }
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not find Post button');
}

/**
 * After clicking the main Post button, TikTok Studio may open a
 * "Continue to post?" modal asking to post before the content check finishes.
 * Click "Post now" in that modal to actually commit. No-op if no modal.
 */
async function handleConfirmModal(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole('button', { name: /^Post now$/i }),
    page.locator('button:has-text("Post now")'),
  ];
  for (const c of candidates) {
    try {
      const first = c.first();
      await first.waitFor({ state: 'visible', timeout: 6000 });
      log.info('      ⚠ confirmation modal detected — clicking "Post now"');
      await first.click();
      return true;
    } catch {
      /* no modal for this locator */
    }
  }
  log.info('      no confirmation modal (or already dismissed)');
  return false;
}

/**
 * Success criteria after Post-now click:
 *  - URL no longer contains /upload (any redirect away from the upload page is success)
 *  - OR a specific success toast appears (e.g. "Video published", "has been posted")
 * Previous loose regex (`/posted/i`, `/uploaded/i`) matched sidebar words
 * like "Posts"/"Upload" → false positives. Previous tight regex missed
 * TikTok Studio's actual toast text "Video published" → false negative.
 */
async function waitForSuccess(page: Page): Promise<string> {
  const successTextPatterns = [
    /video published/i,
    /your video has been posted/i,
    /your video is being posted/i,
    /your video has been uploaded/i,
    /video is being reviewed/i,
    /content under review/i,
  ];
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = page.url();
    // Any redirect off /upload (and not to /login) is treated as success
    if (
      url.includes('tiktok.com') &&
      !url.includes('/upload') &&
      !url.includes('/login')
    ) {
      return url;
    }
    const body = await page.locator('body').innerText().catch(() => '');
    if (successTextPatterns.some((p) => p.test(body))) return url;
    await page.waitForTimeout(2000);
  }
  throw new Error('TikTok did not confirm success within 3 minutes');
}

async function attemptUpload(
  context: BrowserContext,
  videoPath: string,
  captionText: string,
  screenshotPath: string
): Promise<TikTokPublishResult> {
  const page = await context.newPage();
  try {
    await gotoUpload(page);
    await humanPause(page, 1500, 3000);

    // DEBUG 1 — page loaded
    await debugShot(page, '1_loaded');

    await setVideoFile(page, videoPath);

    // DEBUG 2 — file set (TikTok begins processing the video)
    await page.waitForTimeout(3000);
    await debugShot(page, '2_file_set');

    await fillCaption(page, captionText);
    await humanPause(page, 800, 1500);

    // DEBUG 3 — caption filled
    await debugShot(page, '3_caption');

    await clickPost(page);

    // DEBUG 4 — right after clicking page-level Post (modal may be open)
    await page.waitForTimeout(2000);
    await debugShot(page, '4_posted');

    // TikTok Studio asks "Continue to post?" while content-check runs — confirm
    await handleConfirmModal(page);

    // DEBUG 5 — after confirmation (or no-op if no modal)
    await page.waitForTimeout(3000);
    await debugShot(page, '5_confirmed');

    const finalUrl = await waitForSuccess(page);

    await fs.ensureDir(path.dirname(screenshotPath));
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const videoIdMatch = finalUrl.match(/\/video\/(\d+)/);
    const publishId = videoIdMatch ? videoIdMatch[1] : `pw_${Date.now()}`;
    return { publishId, url: finalUrl, screenshot: screenshotPath };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function publishToTiktokViaPlaywright(
  videoPath: string,
  script: ScriptWithTopic
): Promise<TikTokPublishResult> {
  if (!(await hasTiktokSession())) {
    throw new Error('No TikTok session. Run: npm run auth:tiktok');
  }

  const caption = [script.caption, script.hashtags].filter(Boolean).join(' ').slice(0, 2200);
  const screenshotPath = path.join(SCREENSHOT_DIR, `tiktok_${script.id}.png`);
  const execPath = getChromeExecutablePath();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: isHeadless(),
      executablePath: execPath,
      args: LAUNCH_ARGS,
    });
    const context = await browser.newContext({
      storageState: SESSION_PATH,
      viewport: null,
    });
    log.info(`  📤 TikTok (Playwright + Stealth): opening upload page...`);

    try {
      return await attemptUpload(context, videoPath, caption, screenshotPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SESSION_EXPIRED')) {
        await fs.remove(SESSION_PATH).catch(() => {});
        throw new Error('TikTok session expired — deleted. Run: npm run auth:tiktok');
      }

      const errorShot = path.join(SCREENSHOT_DIR, `tiktok_${script.id}_error.png`);
      await fs.ensureDir(path.dirname(errorShot));
      try {
        // Find the most-recently-active page (TikTok may have opened new tabs)
        const pages = context.pages();
        const activePage = pages.find((p) => !p.isClosed() && p.url().includes('tiktok.com')) ?? pages[pages.length - 1];
        if (activePage) {
          await activePage.screenshot({ path: errorShot, fullPage: true });
          log.warn(`  Saved error screenshot: ${errorShot}`);
        }
      } catch {
        /* noop */
      }

      log.warn(`  First attempt failed: ${msg}. Retrying in 30s...`);
      await new Promise((r) => setTimeout(r, 30_000));
      return await attemptUpload(context, videoPath, caption, screenshotPath);
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}
