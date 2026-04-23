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
];

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

async function searchOne(query: string, apiKey: string): Promise<PexelsVideoFile | null> {
  const res = await withRetry(
    () =>
      axios.get<PexelsSearchResponse>('https://api.pexels.com/videos/search', {
        params: { query, per_page: 1, orientation: 'portrait' },
        headers: { Authorization: apiKey },
        timeout: 20000,
      }),
    2,
    1500
  );
  const video = res.data.videos?.[0];
  if (!video) return null;
  return pickBestFile(video.video_files);
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

  if (existing.length >= 5) {
    return existing.map((f) => path.join(BG_DIR, f));
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error(
      'PEXELS_API_KEY missing or placeholder in .env. Get a free key at https://www.pexels.com/api/'
    );
  }

  log.info('📥 Downloading Pexels backgrounds...');
  const downloaded: string[] = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    const outPath = path.join(BG_DIR, `${i + 1}.mp4`);
    if (await fs.pathExists(outPath)) {
      downloaded.push(outPath);
      continue;
    }
    try {
      const file = await searchOne(query, apiKey);
      if (!file) {
        log.warn(`  no result for "${query}" — skipping`);
        continue;
      }
      log.info(`  [${i + 1}/${QUERIES.length}] "${query}" → ${file.width}×${file.height} ${file.quality}`);
      await downloadTo(file.link, outPath);
      const size = (await fs.stat(outPath)).size;
      log.info(`      saved ${path.basename(outPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      downloaded.push(outPath);
    } catch (err) {
      log.error(`  failed "${query}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (downloaded.length === 0) {
    throw new Error('Downloaded 0 backgrounds — check Pexels key and network');
  }

  log.success(`Downloaded ${downloaded.length} background(s)`);
  return downloaded;
}

export async function getRandomBackground(): Promise<string> {
  const bgs = await ensureBackgrounds();
  return bgs[Math.floor(Math.random() * bgs.length)];
}
