import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import { db } from '../db/schema';
import {
  getStats,
  getAllScripts,
  getScriptsByIds,
  getPendingScripts,
  getUnusedTopics,
  approveScript,
  type ScriptWithTopic,
  type Stats,
} from '../db/repository';
import { spawn, type ChildProcess } from 'child_process';

const app = express();
const PORT = 3333;

app.use(cors());
app.use(express.json());

const publicDir = path.join(process.cwd(), 'src', 'admin', 'public');

// ---------- API: Stats ----------
app.get('/api/stats', (_req, res) => {
  res.json(getStats());
});

// ---------- API: Scripts ----------
app.get('/api/scripts', (req, res) => {
  const filter = req.query.filter as string | undefined;
  let scripts: ScriptWithTopic[];

  if (filter === 'pending') {
    scripts = getPendingScripts();
  } else {
    scripts = getAllScripts();
  }
  res.json(scripts);
});

app.get('/api/scripts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const scripts = getScriptsByIds([id]);
  if (scripts.length === 0) return res.status(404).json({ error: 'Not found' });
  // Attach audio info
  const audio = db
    .prepare('SELECT file_path FROM audio_files WHERE script_id = ?')
    .get(id) as { file_path: string } | undefined;
  const videoDir = path.join(process.cwd(), 'output', 'videos');
  const tiktokVideo = path.join(videoDir, `script_${id}_tiktok.mp4`);
  const youtubeVideo = path.join(videoDir, `script_${id}_youtube.mp4`);
  res.json({
    ...scripts[0],
    audio_path: audio?.file_path ?? null,
    has_tiktok_video: fs.existsSync(tiktokVideo),
    has_youtube_video: fs.existsSync(youtubeVideo),
  });
});

app.put('/api/scripts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { hook, script_text, voice_script, caption, hashtags, thumbnail_text } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (hook !== undefined) { fields.push('hook = ?'); values.push(hook); }
  if (script_text !== undefined) { fields.push('script_text = ?'); values.push(script_text); }
  if (voice_script !== undefined) { fields.push('voice_script = ?'); values.push(voice_script); }
  if (caption !== undefined) { fields.push('caption = ?'); values.push(caption); }
  if (hashtags !== undefined) { fields.push('hashtags = ?'); values.push(hashtags); }
  if (thumbnail_text !== undefined) { fields.push('thumbnail_text = ?'); values.push(thumbnail_text); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  values.push(id);
  db.prepare(`UPDATE scripts SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = getScriptsByIds([id]);
  res.json(updated[0]);
});

app.post('/api/scripts/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  approveScript(id);
  res.json({ ok: true });
});

app.post('/api/scripts/:id/unapprove', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('UPDATE scripts SET approved = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- API: Topics ----------
app.get('/api/topics', (_req, res) => {
  const topics = db
    .prepare('SELECT * FROM topics ORDER BY id DESC')
    .all();
  res.json(topics);
});

app.get('/api/topics/unused', (_req, res) => {
  res.json(getUnusedTopics());
});

// ---------- API: Run commands ----------
interface RunningJob {
  proc: ChildProcess;
  logs: string[];
  done: boolean;
  exitCode: number | null;
  startedAt: number;
}

const jobs = new Map<string, RunningJob>();
let jobCounter = 0;

const COMMAND_MAP: Record<string, string[]> = {
  pipeline: ['pipeline'],
  research: ['research'],
  scripts: ['scripts'],
  voice: ['voice'],
  video: ['video'],
  carousel: ['carousel'],
  images: ['images'],
  publish: ['publish'],
  'auto-publish': ['auto-publish'],
  queue: ['queue'],
  backgrounds: [],
};

app.post('/api/run/:command', (req, res) => {
  const command = req.params.command;
  const extraArgs: string[] = req.body.args ?? [];

  let spawnCmd: string;
  let spawnArgs: string[];

  if (command === 'backgrounds') {
    spawnCmd = 'npx';
    spawnArgs = ['tsx', 'src/scripts/generate-backgrounds.ts', ...extraArgs];
  } else if (COMMAND_MAP[command]) {
    spawnCmd = 'npx';
    spawnArgs = ['tsx', 'src/index.ts', ...COMMAND_MAP[command], ...extraArgs];
  } else {
    return res.status(400).json({ error: `Unknown command: ${command}` });
  }

  const jobId = `job_${++jobCounter}`;
  const proc = spawn(spawnCmd, spawnArgs, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const job: RunningJob = { proc, logs: [], done: false, exitCode: null, startedAt: Date.now() };

  proc.stdout?.on('data', (data: Buffer) => {
    job.logs.push(data.toString());
  });
  proc.stderr?.on('data', (data: Buffer) => {
    job.logs.push(data.toString());
  });
  proc.on('close', (code) => {
    job.done = true;
    job.exitCode = code;
  });

  jobs.set(jobId, job);
  res.json({ jobId });
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    done: job.done,
    exitCode: job.exitCode,
    logs: job.logs.join(''),
    startedAt: job.startedAt,
  });
});

app.post('/api/jobs/:jobId/stop', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.proc.kill('SIGTERM');
  res.json({ ok: true });
});

// ---------- API: Backgrounds ----------
const BG_DIR = path.join(process.cwd(), 'assets', 'backgrounds');
const CACHE_INDEX = path.join(BG_DIR, 'cache-index.json');

app.get('/api/backgrounds', (_req, res) => {
  const files = fs.readdirSync(BG_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.mp4', '.webm'].includes(ext);
  });

  // Extract pillar key from filename pattern: bg_<key>_...
  const items = files.map((f) => {
    const match = f.match(/^bg_([^_]+)_/);
    return {
      filename: f,
      pillar: match ? match[1] : 'other',
      ext: path.extname(f).toLowerCase(),
      isVideo: ['.mp4', '.webm'].includes(path.extname(f).toLowerCase()),
    };
  });

  // Group by pillar
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.pillar]) grouped[item.pillar] = [];
    grouped[item.pillar].push(item);
  }

  res.json({ items, grouped, total: items.length });
});

app.delete('/api/backgrounds/:filename', (req, res) => {
  const filename = req.params.filename;
  // Prevent path traversal
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(BG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Delete the file
  fs.removeSync(filePath);

  // Remove from cache-index.json
  if (fs.existsSync(CACHE_INDEX)) {
    try {
      const cache = fs.readJsonSync(CACHE_INDEX) as Record<string, string[]>;
      for (const key of Object.keys(cache)) {
        cache[key] = cache[key].filter((p) => !p.endsWith('/' + filename) && p !== filename);
        if (cache[key].length === 0) delete cache[key];
      }
      fs.writeJsonSync(CACHE_INDEX, cache, { spaces: 2 });
    } catch { /* cache file may be malformed */ }
  }

  res.json({ ok: true, deleted: filename });
});

// ---------- Serve background files as thumbnails/previews ----------
app.use('/bg-files', express.static(BG_DIR));

// ---------- API: Serve output files ----------
app.use('/files', express.static(path.join(process.cwd(), 'output')));

// Serve static frontend files AFTER all API routes
app.use(express.static(publicDir));

// SPA fallback for client-side routing
app.use((req, res, _next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Admin UI running at http://localhost:${PORT}`);
});
