import fs from 'fs-extra';
import { google } from 'googleapis';
import { loadYouTubeClient } from '../auth/youtube-auth';
import { log } from '../utils/logger';
import type { ScriptWithTopic } from '../db/repository';

export interface YouTubePublishResult {
  videoId: string;
  url: string;
}

const BASE_TAGS = [
  'dark psychology',
  'manipulation',
  'narcissist',
  'psychology facts',
  'mindset',
  'protect yourself',
  'mental health',
  'toxic relationship',
];

function hashtagsToTags(hashtags: string): string[] {
  return hashtags
    .split(/\s+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length > 0);
}

function buildTitle(script: ScriptWithTopic): string {
  const base = script.thumbnail_text.trim();
  const suffix = '#MindShieldDaily #shorts';
  if (base.toLowerCase().includes('#shorts')) return base;
  return `${base} ${suffix}`;
}

function buildDescription(script: ScriptWithTopic): string {
  return [
    script.caption,
    '',
    script.hashtags,
    '',
    '━━━━━━━━━━━━━━━━━',
    '🧠 MindShieldDaily — Learn to protect your mind.',
    'New dark psychology drop every day.',
    'Subscribe to never miss one.',
    '━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

function buildTags(script: ScriptWithTopic): string[] {
  const fromHashtags = hashtagsToTags(script.hashtags);
  const merged = [...BASE_TAGS, ...fromHashtags];
  // Dedupe preserving order, cap at 30 (YouTube limit) and 500 chars total
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const t of merged) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    if (total + t.length + 1 > 500) break;
    seen.add(key);
    out.push(t);
    total += t.length + 1;
    if (out.length >= 30) break;
  }
  return out;
}

export async function publishToYoutube(
  videoPath: string,
  script: ScriptWithTopic
): Promise<YouTubePublishResult> {
  const auth = await loadYouTubeClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const size = (await fs.stat(videoPath)).size;
  log.info(`  📤 YouTube: uploading ${(size / 1024 / 1024).toFixed(2)} MB...`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: buildTitle(script),
        description: buildDescription(script),
        tags: buildTags(script),
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(videoPath) },
  });

  const videoId = res.data.id;
  if (!videoId) throw new Error('YouTube API returned no video id');
  const url = `https://youtube.com/shorts/${videoId}`;
  log.success(`🎬 Published to YouTube: ${url}`);
  return { videoId, url };
}
