import fs from 'fs-extra';
import path from 'path';
import { ask } from '../utils/ai';
import { log } from '../utils/logger';
import {
  getUnusedTopics,
  markTopicUsed,
  saveScript,
  setScriptScore,
  type Topic,
  type ViralVerdict,
} from '../db/repository';
import { DARK_PSYCH_SCRIPT_PROMPT, HOOK_FORMULAS } from '../config/prompts';

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

function buildPrompt(platform: string, topic: Topic): string {
  const emotion = (topic.target_emotion ?? 'curiosity').toLowerCase();
  const hookFormula = HOOK_FORMULAS[emotion] ?? HOOK_FORMULAS.curiosity;
  return DARK_PSYCH_SCRIPT_PROMPT
    .replace('{HOOK_FORMULA}', hookFormula.template)
    .replace('{PLATFORM}', platform)
    .replace('{TITLE}', topic.title)
    .replace('{VIRAL_ANGLE}', topic.viral_angle ?? '')
    .replace('{HOOK_IDEA}', topic.hook_idea ?? '')
    .replace('{TARGET_EMOTION}', emotion);
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

async function generateOne(topic: Topic, platform: string): Promise<GeneratedScript> {
  const raw = await ask(buildPrompt(platform, topic), { json: true });
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

  for (const topic of topics) {
    try {
      for (const platform of PLATFORMS) {
        const emotion = (topic.target_emotion ?? 'curiosity').toLowerCase();
        const hookFormula = HOOK_FORMULAS[emotion] ?? HOOK_FORMULAS.curiosity;

        const g = await generateOne(topic, platform);
        const hashtagsStr = Array.isArray(g.hashtags)
          ? g.hashtags.join(' ')
          : String(g.hashtags);

        const scriptId = saveScript({
          topic_id: topic.id,
          platform,
          hook: g.hook,
          script_text: g.script_text,
          voice_script: g.voice_script,
          caption: g.caption,
          hashtags: hashtagsStr,
          thumbnail_text: g.thumbnail_text,
          duration_seconds: g.duration_seconds ?? 60,
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
        log.info(
          `  → script ${scriptId} [${platform}] emotion=${emotion} hook_style=${hookFormula.name}${scoreTag}`
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
