import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import 'dotenv/config';
import { log } from './logger';
import { getRandomBackground } from './backgrounds';

const AI_BG_DIR = path.join(process.cwd(), 'assets', 'backgrounds');
const CACHE_INDEX_PATH = path.join(AI_BG_DIR, 'cache-index.json');

const CINEMATIC_STYLE =
  'cinematic vertical format 9:16, ultra dark moody atmosphere, dramatic shadows, ' +
  'psychological thriller aesthetic, 8k quality, no text, no people';

export const TOPIC_KEYS = [
  'narcissist',
  'gaslighting',
  'manipulation',
  'trauma',
  'lovebombing',
  'silent',
  'darktriad',
  'lying',
  'cult',
  'covert',
  'boundary',
  'anxiety',
  'default',
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

export function getTopicKey(topic: string): TopicKey {
  const t = topic.toLowerCase();
  if (t.includes('narcissist')) return 'narcissist';
  if (t.includes('gaslight')) return 'gaslighting';
  if (t.includes('manipulat')) return 'manipulation';
  if (t.includes('trauma')) return 'trauma';
  if (t.includes('love bomb')) return 'lovebombing';
  if (t.includes('silent')) return 'silent';
  if (t.includes('dark triad')) return 'darktriad';
  if (t.includes('lie') || t.includes('lying')) return 'lying';
  if (t.includes('cult')) return 'cult';
  if (t.includes('covert')) return 'covert';
  if (t.includes('boundary')) return 'boundary';
  if (t.includes('anxiety')) return 'anxiety';
  return 'default';
}

function buildImagePrompt(key: TopicKey): string {
  switch (key) {
    case 'narcissist':
      return `broken mirror reflection in pitch dark room, single cold spotlight, shattered glass on floor, ${CINEMATIC_STYLE}`;
    case 'gaslighting':
      return `long dark foggy corridor, single flickering candle at end, deep shadows on walls, ${CINEMATIC_STYLE}`;
    case 'manipulation':
      return `chess pieces casting long shadows on dark marble, dramatic side lighting, smoke wisps, ${CINEMATIC_STYLE}`;
    case 'trauma':
      return `dark stormy ocean at night, lightning on horizon, crashing black waves, ${CINEMATIC_STYLE}`;
    case 'lovebombing':
      return `wilting red roses in dark room, single fading spotlight, petals on black floor, ${CINEMATIC_STYLE}`;
    case 'silent':
      return `empty dark room with single chair, window with rain, cold blue moonlight, ${CINEMATIC_STYLE}`;
    case 'darktriad':
      return `three shadows on dark wall, dramatic rim lighting, deep blacks, ${CINEMATIC_STYLE}`;
    case 'lying':
      return `dark mirror with distorted reflection, dim light, smoke in background, ${CINEMATIC_STYLE}`;
    case 'cult':
      return `dark empty cathedral interior, single beam of light from above, long shadows, ${CINEMATIC_STYLE}`;
    case 'covert':
      return `shadowy figure blurred behind frosted glass, dim warm spotlight, dark tones, ${CINEMATIC_STYLE}`;
    case 'boundary':
      return `dark wall with cracked line of light, deep shadows, minimalist, ${CINEMATIC_STYLE}`;
    case 'anxiety':
      return `dark room full of moving shadows, restless fog, flickering bulb, ${CINEMATIC_STYLE}`;
    default:
      return `dark abstract smoke and shadow, deep blacks and dark purples, mysterious atmospheric fog, ${CINEMATIC_STYLE}`;
  }
}

async function loadCache(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(CACHE_INDEX_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(cache: Record<string, string>): Promise<void> {
  await fs.ensureDir(AI_BG_DIR);
  await fs.writeFile(CACHE_INDEX_PATH, JSON.stringify(cache, null, 2));
}

async function hfRequest(prompt: string, outPath: string): Promise<void> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error('HUGGINGFACE_API_KEY missing or placeholder in .env');
  }

  const genResponse = await axios.post(
    'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell',
    {
      prompt,
      image_size: { width: 1080, height: 1920 },
      num_inference_steps: 4,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }
  );

  const imageUrl: string | undefined = genResponse.data?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`Router returned no image URL: ${JSON.stringify(genResponse.data).slice(0, 200)}`);
  }

  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, Buffer.from(imgResponse.data));
}

/**
 * Generate an image via FLUX.1 for the given topic key (or free-form topic
 * that maps to one). Writes to assets/backgrounds/bg_<timestamp>.png by default.
 */
export async function generateBackgroundImage(topicOrKey: string, outPath?: string): Promise<string> {
  // Accept either a raw topic string or a known TopicKey — map to a key either way
  const key: TopicKey = (TOPIC_KEYS as readonly string[]).includes(topicOrKey.toLowerCase())
    ? (topicOrKey.toLowerCase() as TopicKey)
    : getTopicKey(topicOrKey);
  const prompt = buildImagePrompt(key);
  log.info(`  🤖 FLUX.1 prompt (${key}): ${prompt.slice(0, 120)}...`);

  await fs.ensureDir(AI_BG_DIR);
  const finalPath = outPath ?? path.join(AI_BG_DIR, `bg_${key}_${Date.now()}.png`);
  await hfRequest(prompt, finalPath);

  const size = (await fs.stat(finalPath)).size;
  log.success(`  🖼  AI background saved: ${finalPath} (${(size / 1024).toFixed(0)} KB)`);
  return finalPath;
}

export interface BackgroundResult {
  path: string;
  isImage: boolean;
}

/**
 * Cache-first background lookup. Checks assets/backgrounds/cache-index.json
 * for the topic key. On miss, tries HuggingFace; caches success. On HF
 * failure, falls back to a random Pexels video.
 */
export async function getBackground(topic: string): Promise<BackgroundResult> {
  const key = getTopicKey(topic);
  const cache = await loadCache();

  if (cache[key] && (await fs.pathExists(cache[key]))) {
    log.info(`  📦 Using cached background for key: ${key}`);
    return { path: cache[key], isImage: true };
  }

  try {
    const imagePath = await generateBackgroundImage(key);
    cache[key] = imagePath;
    await saveCache(cache);
    log.success(`  💾 Background cached for key: ${key}`);
    return { path: imagePath, isImage: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`  HuggingFace failed: ${msg.slice(0, 160)}. Using Pexels video fallback.`);
    const videoPath = await getRandomBackground();
    return { path: videoPath, isImage: false };
  }
}

// Export a quota-aware prefetch helper used by the generate-backgrounds CLI.
// Returns { generated, total, quotaHitAt }.
export async function prefetchAllBackgrounds(delayMs = 3000): Promise<{
  generated: number;
  total: number;
  quotaHitAt: TopicKey | null;
}> {
  const cache = await loadCache();
  let generated = 0;
  let quotaHitAt: TopicKey | null = null;
  const keys = [...TOPIC_KEYS];
  const total = keys.length;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (cache[key] && (await fs.pathExists(cache[key]))) {
      log.info(`  [${i + 1}/${total}] ${key} — already cached, skipping`);
      continue;
    }
    try {
      const imagePath = await generateBackgroundImage(key);
      cache[key] = imagePath;
      await saveCache(cache);
      generated++;
      log.success(`  [${i + 1}/${total}] ${key} — generated ✓`);
      if (i < keys.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('402') || /Payment Required/i.test(msg)) {
        quotaHitAt = key;
        log.warn(`  [${i + 1}/${total}] ${key} — HuggingFace quota hit (402). Stopping.`);
        break;
      }
      log.error(`  [${i + 1}/${total}] ${key} — failed: ${msg.slice(0, 160)}`);
    }
  }

  await saveCache(cache);
  return { generated, total, quotaHitAt };
}
