import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import 'dotenv/config';
import { log } from './logger';
import { getRandomBackground } from './backgrounds';

const AI_BG_DIR = path.join(process.cwd(), 'assets', 'backgrounds');
const CACHE_INDEX_PATH = path.join(AI_BG_DIR, 'cache-index.json');

// Per-key target pool size. getBackground picks at random from the pool,
// and grows the pool toward this number when quota allows.
const TARGET_POOL_SIZE = 4;

// Probability of picking a Pexels stock video instead of an image, even
// when the image pool is full. 0 = always image, 1 = always video.
const VIDEO_PICK_RATIO = 0.4;

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

// Each key has a list of prompt variants — picked at random when generating
// new pool entries so even same-key images differ in composition / lighting.
const PROMPT_VARIANTS: Record<TopicKey, string[]> = {
  narcissist: [
    `broken mirror reflection in pitch dark room, single cold spotlight, shattered glass on floor, ${CINEMATIC_STYLE}`,
    `cracked golden mask on dark velvet, dramatic side light, deep shadows, ${CINEMATIC_STYLE}`,
    `empty ornate throne in dark hall, dust particles in single beam of light, ${CINEMATIC_STYLE}`,
    `marble statue face cracking apart in dark gallery, harsh top light, ${CINEMATIC_STYLE}`,
  ],
  gaslighting: [
    `long dark foggy corridor, single flickering candle at end, deep shadows on walls, ${CINEMATIC_STYLE}`,
    `dim hallway with flickering overhead bulb, mist on the floor, peeling walls, ${CINEMATIC_STYLE}`,
    `closed door at end of dark passage, cold blue light leaking under it, fog, ${CINEMATIC_STYLE}`,
    `vintage clock face distorted in dark mist, faint candlelight, ${CINEMATIC_STYLE}`,
  ],
  manipulation: [
    `chess pieces casting long shadows on dark marble, dramatic side lighting, smoke wisps, ${CINEMATIC_STYLE}`,
    `puppet strings descending into deep shadow, single rim light from above, ${CINEMATIC_STYLE}`,
    `dark hand reaching through smoke toward dim red light, ${CINEMATIC_STYLE}`,
    `tangled black threads on dark surface, single hard light, dust motes, ${CINEMATIC_STYLE}`,
  ],
  trauma: [
    `dark stormy ocean at night, lightning on horizon, crashing black waves, ${CINEMATIC_STYLE}`,
    `shattered window with rain outside, cold blue night light, broken glass on floor, ${CINEMATIC_STYLE}`,
    `abandoned dark room with overturned chair, single dim lamp, dust, ${CINEMATIC_STYLE}`,
    `dark forest after storm, broken branches, low fog, faint moonlight, ${CINEMATIC_STYLE}`,
  ],
  lovebombing: [
    `wilting red roses in dark room, single fading spotlight, petals on black floor, ${CINEMATIC_STYLE}`,
    `blown-out candles with smoke trails on dark table, scattered rose petals, ${CINEMATIC_STYLE}`,
    `melted red heart-shaped candle on dark wood, dim warm light, ${CINEMATIC_STYLE}`,
    `torn love letter on dark surface, single warm spotlight, ash, ${CINEMATIC_STYLE}`,
  ],
  silent: [
    `empty dark room with single chair, window with rain, cold blue moonlight, ${CINEMATIC_STYLE}`,
    `unanswered phone on dark nightstand, single dim lamp, deep shadows, ${CINEMATIC_STYLE}`,
    `two empty chairs facing each other in dark room, cold side light, ${CINEMATIC_STYLE}`,
    `dark long dinner table with one untouched setting, single hanging bulb, ${CINEMATIC_STYLE}`,
  ],
  darktriad: [
    `three shadows on dark wall, dramatic rim lighting, deep blacks, ${CINEMATIC_STYLE}`,
    `three black playing cards fanned on dark velvet, single hard light, ${CINEMATIC_STYLE}`,
    `triangular shadow formation in foggy dark room, cold light from above, ${CINEMATIC_STYLE}`,
    `three dark silhouettes overlapping behind frosted glass, dim backlight, ${CINEMATIC_STYLE}`,
  ],
  lying: [
    `dark mirror with distorted reflection, dim light, smoke in background, ${CINEMATIC_STYLE}`,
    `cracked porcelain mask split in two on dark surface, single side light, ${CINEMATIC_STYLE}`,
    `two shadows from one figure on dark wall, dramatic lighting, ${CINEMATIC_STYLE}`,
    `dark fingers crossed behind back, dim warm rim light, deep shadow, ${CINEMATIC_STYLE}`,
  ],
  cult: [
    `dark empty cathedral interior, single beam of light from above, long shadows, ${CINEMATIC_STYLE}`,
    `circle of unlit black candles on dark stone floor, single overhead light, ${CINEMATIC_STYLE}`,
    `hooded silhouettes in dim foggy hall, single distant light source, ${CINEMATIC_STYLE}`,
    `ancient dark altar with smoke rising, faint red glow, deep shadows, ${CINEMATIC_STYLE}`,
  ],
  covert: [
    `shadowy figure blurred behind frosted glass, dim warm spotlight, dark tones, ${CINEMATIC_STYLE}`,
    `silhouette behind sheer dark curtain, faint backlight, smoke, ${CINEMATIC_STYLE}`,
    `partially open door revealing dark room, dim light spilling out, ${CINEMATIC_STYLE}`,
    `mask half-hidden in shadow on dark surface, single sharp side light, ${CINEMATIC_STYLE}`,
  ],
  boundary: [
    `dark wall with cracked line of light, deep shadows, minimalist, ${CINEMATIC_STYLE}`,
    `closed iron gate in dark fog, faint cold light beyond, ${CINEMATIC_STYLE}`,
    `chalk line on dark concrete floor, single hard overhead light, ${CINEMATIC_STYLE}`,
    `tall dark fence silhouette against deep blue night sky, ${CINEMATIC_STYLE}`,
  ],
  anxiety: [
    `dark room full of moving shadows, restless fog, flickering bulb, ${CINEMATIC_STYLE}`,
    `racing clock hands blurred on dark wall, dim red light, ${CINEMATIC_STYLE}`,
    `dark stairwell spiraling downward, faint flickering light, ${CINEMATIC_STYLE}`,
    `vibrating dark water surface with single dim reflection, deep shadows, ${CINEMATIC_STYLE}`,
  ],
  default: [
    `dark abstract smoke and shadow, deep blacks and dark purples, mysterious atmospheric fog, ${CINEMATIC_STYLE}`,
    `dark ink swirling in black water, dramatic rim light, ${CINEMATIC_STYLE}`,
    `dark velvet folds with single hard side light, dust particles, ${CINEMATIC_STYLE}`,
    `deep black void with faint distant cold light, drifting fog, ${CINEMATIC_STYLE}`,
  ],
};

function pickPromptVariant(key: TopicKey): string {
  const variants = PROMPT_VARIANTS[key] ?? PROMPT_VARIANTS.default;
  return variants[Math.floor(Math.random() * variants.length)];
}

type CacheShape = Record<string, string[]>;

async function loadCache(): Promise<CacheShape> {
  try {
    const raw = await fs.readFile(CACHE_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate legacy `key: string` entries to `key: [string]`.
    const out: CacheShape = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
      else if (typeof v === 'string') out[k] = [v];
    }
    return out;
  } catch {
    return {};
  }
}

async function saveCache(cache: CacheShape): Promise<void> {
  await fs.ensureDir(AI_BG_DIR);
  await fs.writeFile(CACHE_INDEX_PATH, JSON.stringify(cache, null, 2));
}

async function prunePool(pool: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of pool) {
    if (await fs.pathExists(p)) out.push(p);
  }
  return out;
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
 * Generate one image via FLUX.1 for the given topic key (or free-form topic
 * that maps to one). Picks a random prompt variant so repeated calls for the
 * same key produce visually distinct images.
 */
export async function generateBackgroundImage(topicOrKey: string, outPath?: string): Promise<string> {
  const key: TopicKey = (TOPIC_KEYS as readonly string[]).includes(topicOrKey.toLowerCase())
    ? (topicOrKey.toLowerCase() as TopicKey)
    : getTopicKey(topicOrKey);
  const prompt = pickPromptVariant(key);
  log.info(`  🤖 FLUX.1 prompt (${key}): ${prompt.slice(0, 120)}...`);

  await fs.ensureDir(AI_BG_DIR);
  const finalPath =
    outPath ?? path.join(AI_BG_DIR, `bg_${key}_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`);
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
 * Pool-based background lookup. Each topic key holds a list of cached PNGs.
 * Picks one at random. Tries to grow the pool toward TARGET_POOL_SIZE by
 * generating fresh variants when quota is available. Falls back to a Pexels
 * video only when the pool is empty AND HuggingFace fails.
 */
export async function getBackground(topic: string): Promise<BackgroundResult> {
  const key = getTopicKey(topic);
  const cache = await loadCache();
  let pool = await prunePool(cache[key] ?? []);

  // Pool already large enough — pick at random and skip the API call.
  // With probability VIDEO_PICK_RATIO, swap in a Pexels stock video so
  // the rotation includes motion clips, not just stills.
  if (pool.length >= TARGET_POOL_SIZE) {
    if (Math.random() < VIDEO_PICK_RATIO) {
      try {
        const videoPath = await getRandomBackground();
        log.info(`  🎬 Video pick (ratio=${VIDEO_PICK_RATIO}) → ${path.basename(videoPath)}`);
        return { path: videoPath, isImage: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`  Video pick failed (${msg.slice(0, 100)}). Falling back to image pool.`);
      }
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    log.info(`  📦 Pool[${key}] size=${pool.length} → ${path.basename(pick)}`);
    cache[key] = pool;
    await saveCache(cache);
    return { path: pick, isImage: true };
  }

  // Pool below target — try to add a fresh variant.
  try {
    const imagePath = await generateBackgroundImage(key);
    pool.push(imagePath);
    cache[key] = pool;
    await saveCache(cache);
    log.success(`  💾 Pool[${key}] grew to size=${pool.length}`);
    return { path: imagePath, isImage: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pool.length > 0) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      log.warn(`  HuggingFace failed (${msg.slice(0, 100)}). Reusing pool[${key}] → ${path.basename(pick)}`);
      return { path: pick, isImage: true };
    }
    log.warn(`  HuggingFace failed and pool[${key}] empty. Falling back to Pexels video.`);
    const videoPath = await getRandomBackground();
    return { path: videoPath, isImage: false };
  }
}

/**
 * Quota-aware prefetch: grows each key's pool toward TARGET_POOL_SIZE.
 * Stops on first 402. Returns counts per outcome.
 */
export async function prefetchAllBackgrounds(delayMs = 3000): Promise<{
  generated: number;
  total: number;
  quotaHitAt: TopicKey | null;
}> {
  const cache = await loadCache();
  let generated = 0;
  let quotaHitAt: TopicKey | null = null;
  const keys = [...TOPIC_KEYS];
  const total = keys.length * TARGET_POOL_SIZE;

  outer: for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let pool = await prunePool(cache[key] ?? []);

    while (pool.length < TARGET_POOL_SIZE) {
      try {
        const imagePath = await generateBackgroundImage(key);
        pool.push(imagePath);
        cache[key] = pool;
        await saveCache(cache);
        generated++;
        log.success(`  [${key} ${pool.length}/${TARGET_POOL_SIZE}] generated ✓`);
        await new Promise((r) => setTimeout(r, delayMs));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('402') || /Payment Required/i.test(msg)) {
          quotaHitAt = key;
          log.warn(`  [${key}] HuggingFace quota hit (402). Stopping.`);
          break outer;
        }
        log.error(`  [${key}] failed: ${msg.slice(0, 160)}`);
        break; // move on to next key on non-quota errors
      }
    }
    cache[key] = pool;
  }

  await saveCache(cache);
  return { generated, total, quotaHitAt };
}
