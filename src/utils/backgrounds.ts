import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import 'dotenv/config';
import { log } from './logger';
import { withRetry } from './retry';

const BG_DIR = path.join(process.cwd(), 'assets', 'backgrounds');

const QUERIES = [
  'dark abstract smoke black',
  'dark rain window night moody',
  'dark forest fog mystery',
  'black particles dark background',
  'dark ocean waves night',
  'dark city rain neon night',
  'candle flame dark room',
  'ink water swirl black',
  'abandoned dark room dust',
  'dark sky storm clouds timelapse',
  'dark hallway shadows',
  'black silk fabric flowing',
  'dark fireplace embers',
  'foggy night street lamp',
  'rain on glass black background',
  'dark mirror reflection',
  'shadow figure silhouette dark',
  'dark stairs descending',
];

// How many clips to fetch per query (Pexels free tier is generous).
const PER_QUERY = 3;
// Stop early once we already have at least this many cached clips.
const TARGET_TOTAL = 30;

interface PexelsVideoFile {
  link: string;
  quality: string;
  width: number;
  height: number;
  file_type: string;
}

interface PexelsVideo {
  id: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4s = files.filter((f) => f.file_type === 'video/mp4');
  if (mp4s.length === 0) return null;

  const hd = mp4s.find((f) => f.quality === 'hd');
  if (hd) return hd;

  return [...mp4s].sort((a, b) => b.height - a.height)[0];
}

async function searchMany(
  query: string,
  apiKey: string,
  perQuery: number
): Promise<PexelsVideoFile[]> {
  const res = await withRetry(
    () =>
      axios.get<PexelsSearchResponse>('https://api.pexels.com/videos/search', {
        params: { query, per_page: perQuery, orientation: 'portrait' },
        headers: { Authorization: apiKey },
        timeout: 20000,
      }),
    2,
    1500
  );
  const videos = res.data.videos ?? [];
  const files: PexelsVideoFile[] = [];
  for (const v of videos) {
    const f = pickBestFile(v.video_files);
    if (f) files.push(f);
  }
  return files;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function downloadTo(url: string, outPath: string): Promise<void> {
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    res.data.pipe(ws);
    ws.on('finish', () => resolve());
    ws.on('error', reject);
    res.data.on('error', reject);
  });
}

export async function ensureBackgrounds(): Promise<string[]> {
  await fs.ensureDir(BG_DIR);
  const existing = (await fs.readdir(BG_DIR)).filter((f) => f.endsWith('.mp4'));

  if (existing.length >= TARGET_TOTAL) {
    return existing.map((f) => path.join(BG_DIR, f));
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error(
      'PEXELS_API_KEY missing or placeholder in .env. Get a free key at https://www.pexels.com/api/'
    );
  }

  log.info(`📥 Downloading Pexels backgrounds (have ${existing.length}, target ${TARGET_TOTAL})...`);
  const downloaded: string[] = existing.map((f) => path.join(BG_DIR, f));

  for (let i = 0; i < QUERIES.length; i++) {
    if (downloaded.length >= TARGET_TOTAL) break;
    const query = QUERIES[i];
    const slug = slugify(query);
    try {
      const files = await searchMany(query, apiKey, PER_QUERY);
      if (files.length === 0) {
        log.warn(`  no results for "${query}" — skipping`);
        continue;
      }
      for (let j = 0; j < files.length; j++) {
        if (downloaded.length >= TARGET_TOTAL) break;
        const file = files[j];
        const outPath = path.join(BG_DIR, `${slug}-${j + 1}.mp4`);
        if (await fs.pathExists(outPath)) {
          if (!downloaded.includes(outPath)) downloaded.push(outPath);
          continue;
        }
        log.info(
          `  [${i + 1}/${QUERIES.length} #${j + 1}] "${query}" → ${file.width}×${file.height} ${file.quality}`
        );
        await downloadTo(file.link, outPath);
        const size = (await fs.stat(outPath)).size;
        log.info(`      saved ${path.basename(outPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
        downloaded.push(outPath);
      }
    } catch (err) {
      log.error(`  failed "${query}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (downloaded.length === 0) {
    throw new Error('Downloaded 0 backgrounds — check Pexels key and network');
  }

  log.success(`Background pool size: ${downloaded.length}`);
  return downloaded;
}

export async function getRandomBackground(): Promise<string> {
  const bgs = await ensureBackgrounds();
  return bgs[Math.floor(Math.random() * bgs.length)];
}
