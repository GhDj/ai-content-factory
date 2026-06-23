import { db } from './schema';

export interface TopicInput {
  title: string;
  source: string;
  url?: string;
  viral_angle?: string;
  hook_idea?: string;
  target_emotion?: string;
  pillar?: string;
  score?: number;
}

export interface Topic extends TopicInput {
  id: number;
  target_emotion: string;
  pillar: string;
  used: number;
  created_at: string;
}

export interface ScriptInput {
  topic_id: number;
  platform: 'tiktok' | 'youtube' | string;
  hook: string;
  script_text: string;
  voice_script: string;
  caption: string;
  hashtags: string;
  thumbnail_text: string;
  duration_seconds: number;
  series_id?: string | null;
  episode_number?: number | null;
}

export type ViralVerdict = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Script extends ScriptInput {
  id: number;
  approved: number;
  created_at: string;
  youtube_url?: string | null;
  tiktok_publish_id?: string | null;
  published_at?: string | null;
  viral_score?: number | null;
  viral_verdict?: ViralVerdict | null;
  viral_reason?: string | null;
  series_id?: string | null;
  episode_number?: number | null;
}

export interface ScriptWithTopic extends Script {
  topic_title: string;
}

export function saveTopic(t: TopicInput): number {
  const stmt = db.prepare(`
    INSERT INTO topics (title, source, url, viral_angle, hook_idea, target_emotion, pillar, score)
    VALUES (@title, @source, @url, @viral_angle, @hook_idea, @target_emotion, @pillar, @score)
  `);
  const result = stmt.run({
    title: t.title,
    source: t.source,
    url: t.url ?? '',
    viral_angle: t.viral_angle ?? '',
    hook_idea: t.hook_idea ?? '',
    target_emotion: t.target_emotion ?? 'curiosity',
    pillar: t.pillar ?? 'manipulation',
    score: t.score ?? 0,
  });
  return Number(result.lastInsertRowid);
}

/**
 * Returns the distinct pillars used in topics created within the last `days`
 * days, oldest day first. Used by the research agent to enforce rotation.
 */
export function getRecentPillars(days = 3): string[] {
  return (db
    .prepare(
      `SELECT pillar FROM topics
       WHERE created_at >= datetime('now', ?)
       GROUP BY pillar
       ORDER BY MAX(created_at) DESC`
    )
    .all(`-${days} days`) as Array<{ pillar: string }>)
    .map((r) => r.pillar)
    .filter(Boolean);
}

/**
 * Pillars used in topics created strictly today (UTC date match). Used to
 * decide whether we've already pulled from the same pillar twice today.
 */
export function getTodaysPillars(): string[] {
  return (db
    .prepare(
      `SELECT pillar FROM topics
       WHERE date(created_at) = date('now')
       GROUP BY pillar`
    )
    .all() as Array<{ pillar: string }>)
    .map((r) => r.pillar)
    .filter(Boolean);
}

export function getUnusedTopics(): Topic[] {
  return db
    .prepare(`SELECT * FROM topics WHERE used = 0 ORDER BY id ASC`)
    .all() as Topic[];
}

export function getTopicsByTitles(): Pick<Topic, 'title'>[] {
  return db.prepare(`SELECT title FROM topics`).all() as Pick<Topic, 'title'>[];
}

export function markTopicUsed(id: number): void {
  db.prepare(`UPDATE topics SET used = 1 WHERE id = ?`).run(id);
}

export function saveScript(s: ScriptInput): number {
  const stmt = db.prepare(`
    INSERT INTO scripts
      (topic_id, platform, hook, script_text, voice_script, caption,
       hashtags, thumbnail_text, duration_seconds, series_id, episode_number)
    VALUES
      (@topic_id, @platform, @hook, @script_text, @voice_script, @caption,
       @hashtags, @thumbnail_text, @duration_seconds, @series_id, @episode_number)
  `);
  const result = stmt.run({
    ...s,
    series_id: s.series_id ?? null,
    episode_number: s.episode_number ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getNextEpisodeNumber(seriesId: string): number {
  const row = db
    .prepare(`SELECT MAX(episode_number) AS max_ep FROM scripts WHERE series_id = ?`)
    .get(seriesId) as { max_ep: number | null } | undefined;
  return (row?.max_ep ?? 0) + 1;
}

export function getSeriesEpisodeCount(seriesId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM scripts WHERE series_id = ? AND platform = 'tiktok'`)
    .get(seriesId) as { c: number };
  return row.c;
}

export function getPendingScripts(): ScriptWithTopic[] {
  return db
    .prepare(`
      SELECT s.*, t.title AS topic_title
      FROM scripts s
      JOIN topics t ON t.id = s.topic_id
      WHERE s.approved = 0
      ORDER BY s.id ASC
    `)
    .all() as ScriptWithTopic[];
}

export function approveScript(id: number): void {
  db.prepare(`UPDATE scripts SET approved = 1 WHERE id = ?`).run(id);
}

export function saveAudioFile(scriptId: number, filePath: string): number {
  const result = db
    .prepare(`INSERT INTO audio_files (script_id, file_path) VALUES (?, ?)`)
    .run(scriptId, filePath);
  return Number(result.lastInsertRowid);
}

export function getAllScripts(): ScriptWithTopic[] {
  return db
    .prepare(`
      SELECT s.*, t.title AS topic_title
      FROM scripts s
      JOIN topics t ON t.id = s.topic_id
      ORDER BY s.id DESC
    `)
    .all() as ScriptWithTopic[];
}

export interface ScriptWithAudio extends ScriptWithTopic {
  audio_path: string;
}

export function getApprovedScriptsWithAudio(): ScriptWithAudio[] {
  return db
    .prepare(`
      SELECT s.*, t.title AS topic_title, af.file_path AS audio_path
      FROM scripts s
      JOIN topics t ON t.id = s.topic_id
      JOIN audio_files af ON af.script_id = s.id
      WHERE s.approved = 1
      ORDER BY s.id ASC
    `)
    .all() as ScriptWithAudio[];
}

export function getAudioPath(scriptId: number): string | null {
  const row = db
    .prepare(`SELECT file_path FROM audio_files WHERE script_id = ?`)
    .get(scriptId) as { file_path: string } | undefined;
  return row?.file_path ?? null;
}

export function getUnpublishedApprovedScripts(): ScriptWithTopic[] {
  return db
    .prepare(`
      SELECT s.*, t.title AS topic_title
      FROM scripts s
      JOIN topics t ON t.id = s.topic_id
      WHERE s.approved = 1
        AND (s.youtube_url IS NULL OR s.tiktok_publish_id IS NULL)
      ORDER BY s.id ASC
    `)
    .all() as ScriptWithTopic[];
}

export function setScriptScore(
  scriptId: number,
  score: number,
  verdict: ViralVerdict,
  reason: string
): void {
  db.prepare(`
    UPDATE scripts
    SET viral_score = ?, viral_verdict = ?, viral_reason = ?
    WHERE id = ?
  `).run(score, verdict, reason, scriptId);
}

export function getScriptsByIds(ids: number[]): ScriptWithTopic[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`
      SELECT s.*, t.title AS topic_title
      FROM scripts s
      JOIN topics t ON t.id = s.topic_id
      WHERE s.id IN (${placeholders})
      ORDER BY s.id ASC
    `)
    .all(...ids) as ScriptWithTopic[];
}

export function markScriptPublished(
  scriptId: number,
  youtubeUrl: string | null,
  tiktokPublishId: string | null
): void {
  // COALESCE preserves any prior success when re-running publish
  db.prepare(`
    UPDATE scripts
    SET youtube_url       = COALESCE(?, youtube_url),
        tiktok_publish_id = COALESCE(?, tiktok_publish_id),
        published_at      = datetime('now')
    WHERE id = ?
  `).run(youtubeUrl, tiktokPublishId, scriptId);
}

export interface Stats {
  topics_total: number;
  topics_unused: number;
  scripts_total: number;
  scripts_pending: number;
  audio_files: number;
}

export function getStats(): Stats {
  const row = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    topics_total:    row(`SELECT COUNT(*) AS c FROM topics`),
    topics_unused:   row(`SELECT COUNT(*) AS c FROM topics WHERE used = 0`),
    scripts_total:   row(`SELECT COUNT(*) AS c FROM scripts`),
    scripts_pending: row(`SELECT COUNT(*) AS c FROM scripts WHERE approved = 0`),
    audio_files:     row(`SELECT COUNT(*) AS c FROM audio_files`),
  };
}
