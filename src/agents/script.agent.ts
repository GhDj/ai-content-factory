import fs from 'fs-extra';
import path from 'path';
import { ask } from '../utils/ai';
import { log } from '../utils/logger';
import {
  getUnusedTopics,
  markTopicUsed,
  saveScript,
  setScriptScore,
  getNextEpisodeNumber,
  getSeriesEpisodeCount,
  type Topic,
  type ViralVerdict,
} from '../db/repository';
import { DARK_PSYCH_SCRIPT_PROMPT, HOOK_FORMULAS, PILLAR_TONES } from '../config/prompts';
import { ACTIVE_ACCOUNT, type SeriesConfig } from '../config/accounts';

const SCRIPT_DIR = path.join(process.cwd(), 'output', 'scripts');

interface GeneratedScript {
  hook: string;
  script_text: string;
  voice_script: string;
  caption: string;
  hashtags: string[];
  thumbnail_text: string;
  duration_seconds: number;
}

const PLATFORMS = ['tiktok', 'youtube'] as const;

interface SeriesContext {
  series: SeriesConfig;
  episodeNumber: number;
}

function buildSeriesPromptAddition(ctx: SeriesContext): string {
  return `\n\nSERIES CONTEXT:
This is Episode ${ctx.episodeNumber} of the '${ctx.series.name}' series.
The episode prefix is "${ctx.series.episodePrefix} #${ctx.episodeNumber}".
Reference that this is part of a series in the CTA.
Make viewers feel they need to follow to not miss the next episode.
End with a teaser: 'Next: [related concept]'
The CTA must say: 'Follow for Episode ${ctx.episodeNumber + 1} — dropping tomorrow'`;
}

function buildPrompt(platform: string, topic: Topic, seriesCtx?: SeriesContext): string {
  const emotion = (topic.target_emotion ?? 'curiosity').toLowerCase();
  const hookFormula = HOOK_FORMULAS[emotion] ?? HOOK_FORMULAS.curiosity;
  const pillar = (topic.pillar ?? 'manipulation').toLowerCase();
  const pillarTone = PILLAR_TONES[pillar] ?? PILLAR_TONES.manipulation;
  let prompt = DARK_PSYCH_SCRIPT_PROMPT
    .replace('{HOOK_FORMULA}', hookFormula.template)
    .replace('{PILLAR_TONE}', pillarTone)
    .replace('{PLATFORM}', platform)
    .replace('{TITLE}', topic.title)
    .replace('{VIRAL_ANGLE}', topic.viral_angle ?? '')
    .replace('{HOOK_IDEA}', topic.hook_idea ?? '')
    .replace('{TARGET_EMOTION}', emotion);

  if (seriesCtx) {
    prompt += buildSeriesPromptAddition(seriesCtx);
  }
  return prompt;
}

/**
 * Pick the best matching series for this topic's pillar, preferring series
 * that haven't hit their target yet. Returns undefined if no match or if
 * the topic should be standalone (alternation logic).
 */
function pickSeriesForTopic(topic: Topic, topicIndex: number): SeriesContext | undefined {
  // Alternate: even-index topics = standalone, odd-index = series
  if (topicIndex % 2 === 0) return undefined;

  const pillar = (topic.pillar ?? 'manipulation').toLowerCase();
  const candidates = ACTIVE_ACCOUNT.series.filter((s) => s.pillar === pillar);
  if (candidates.length === 0) return undefined;

  // Pick the series with fewest episodes (most room to grow)
  let best: SeriesConfig | undefined;
  let bestCount = Infinity;
  for (const s of candidates) {
    const count = getSeriesEpisodeCount(s.id);
    if (count < s.targetEpisodes && count < bestCount) {
      best = s;
      bestCount = count;
    }
  }
  if (!best) return undefined;

  const episodeNumber = getNextEpisodeNumber(best.id);
  return { series: best, episodeNumber };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text.trim();
}

interface ViralScore {
  score: number;
  verdict: ViralVerdict;
  reason: string;
}

async function scoreViralPotential(scriptText: string): Promise<ViralScore | null> {
  const prompt = `Rate this dark psychology video script from 1-10 for viral potential on TikTok. Consider:
- Hook strength (is it impossible to scroll past?)
- Relatability (have most people experienced this?)
- Share factor (would someone send this to a friend?)
- Emotional impact (shock, curiosity, or recognition?)

Script: ${scriptText}

Return ONLY JSON:
{
  "score": 8,
  "verdict": "HIGH",
  "reason": "one sentence why"
}
Where verdict is exactly "HIGH", "MEDIUM", or "LOW".
Use "HIGH" for 8-10, "MEDIUM" for 5-7, "LOW" for 1-4.`;

  try {
    const raw = await ask(prompt, { json: true });
    const jsonText = extractJson(raw);
    const parsed = JSON.parse(jsonText) as Partial<ViralScore>;
    if (typeof parsed.score !== 'number' || !parsed.verdict || !parsed.reason) return null;
    const verdict = parsed.verdict.toUpperCase() as ViralVerdict;
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(verdict)) return null;
    return {
      score: Math.max(1, Math.min(10, Math.round(parsed.score))),
      verdict,
      reason: String(parsed.reason).slice(0, 300),
    };
  } catch {
    return null;
  }
}

async function generateOne(topic: Topic, platform: string, seriesCtx?: SeriesContext): Promise<GeneratedScript> {
  const raw = await ask(buildPrompt(platform, topic, seriesCtx), { json: true });
  const json = extractJson(raw);
  return JSON.parse(json) as GeneratedScript;
}

async function writeScriptFile(
  scriptId: number,
  topic: Topic,
  platform: string,
  g: GeneratedScript
): Promise<void> {
  await fs.ensureDir(SCRIPT_DIR);
  const file = path.join(SCRIPT_DIR, `${scriptId}_${platform}.txt`);
  const hashtags = Array.isArray(g.hashtags) ? g.hashtags.join(' ') : String(g.hashtags);
  const content =
`==================================================
TOPIC: ${topic.title}
PLATFORM: ${platform}
EMOTION: ${topic.target_emotion ?? 'curiosity'}
DATE: ${new Date().toISOString().slice(0, 10)}
==================================================
HOOK: ${g.hook}
THUMBNAIL: ${g.thumbnail_text}
CAPTION: ${g.caption}
HASHTAGS: ${hashtags}
--------------------------------------------------
FULL SCRIPT (with directions):
${g.script_text}
--------------------------------------------------
VOICE SCRIPT (clean for TTS):
${g.voice_script}
==================================================
`;
  await fs.writeFile(file, content, 'utf8');
}

export async function runScripts(): Promise<number[]> {
  const topics = getUnusedTopics();
  if (topics.length === 0) {
    log.warn('No unused topics. Run research first.');
    return [];
  }

  log.info(`📝 Generating scripts for ${topics.length} topic(s)...`);

  const producedIds: number[] = [];

  for (let ti = 0; ti < topics.length; ti++) {
    const topic = topics[ti];
    try {
      // Decide if this topic gets series treatment (alternating pattern)
      const seriesCtx = pickSeriesForTopic(topic, ti);

      for (const platform of PLATFORMS) {
        const emotion = (topic.target_emotion ?? 'curiosity').toLowerCase();
        const hookFormula = HOOK_FORMULAS[emotion] ?? HOOK_FORMULAS.curiosity;

        const g = await generateOne(topic, platform, seriesCtx);
        let hashtagsStr = Array.isArray(g.hashtags)
          ? g.hashtags.join(' ')
          : String(g.hashtags);

        // Inject series hashtags
        if (seriesCtx) {
          const seriesTag = `#${seriesCtx.series.name.replace(/\s+/g, '')}`;
          const epTag = `#Episode${seriesCtx.episodeNumber}`;
          if (!hashtagsStr.includes(seriesTag)) hashtagsStr += ` ${seriesTag} ${epTag}`;
        }

        let thumbnailText = g.thumbnail_text;
        if (seriesCtx) {
          thumbnailText = `${seriesCtx.series.episodePrefix.toUpperCase()} #${seriesCtx.episodeNumber}`;
        }

        const scriptId = saveScript({
          topic_id: topic.id,
          platform,
          hook: g.hook,
          script_text: g.script_text,
          voice_script: g.voice_script,
          caption: g.caption,
          hashtags: hashtagsStr,
          thumbnail_text: thumbnailText,
          duration_seconds: g.duration_seconds ?? 60,
          series_id: seriesCtx?.series.id ?? null,
          episode_number: seriesCtx?.episodeNumber ?? null,
        });

        await writeScriptFile(scriptId, topic, platform, g);

        // Score viral potential (best-effort; skipped silently on failure)
        const score = await scoreViralPotential(g.script_text);
        if (score) {
          setScriptScore(scriptId, score.score, score.verdict, score.reason);
        }

        const scoreTag = score
          ? ` viral=${score.score}/10 ${score.verdict}`
          : '';
        const seriesTag = seriesCtx
          ? ` [${seriesCtx.series.episodePrefix} #${seriesCtx.episodeNumber}]`
          : '';
        log.info(
          `  → script ${scriptId} [${platform}] emotion=${emotion} hook_style=${hookFormula.name}${seriesTag}${scoreTag}`
        );
        producedIds.push(scriptId);
      }
      markTopicUsed(topic.id);
      log.success(`Scripts generated for: ${topic.title}`);
    } catch (err) {
      log.error(`Failed for "${topic.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return producedIds;
}
