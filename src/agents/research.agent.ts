import { ask } from '../utils/ai';
import { log } from '../utils/logger';
import { scrapeProductHunt, type ScrapedItem } from '../scrapers/producthunt';
import { scrapeHackerNews } from '../scrapers/hackernews';
import { scrapeReddit } from '../scrapers/reddit';
import { saveTopic, getTopicsByTitles, getRecentPillars } from '../db/repository';
import { ACTIVE_ACCOUNT } from '../config/accounts';
import { darkPsychSeeds, ALL_PILLARS, type Pillar, type SeedTopic } from '../config/darkpsych-seeds';
import { DARK_PSYCH_RESEARCH_PROMPT } from '../config/prompts';

export interface RankedTopic {
  title: string;
  source: string;
  url: string;
  viral_angle: string;
  hook_idea: string;
  target_emotion: string;
  pillar: string;
}

/**
 * Daily priority pillars per the rotation spec. Day-of-cycle = (epoch day) % 4.
 *   Day 1: manipulation + body_language
 *   Day 2: cognitive_bias + power
 *   Day 3: cult + social_engineering
 *   Day 4: self_mastery + manipulation
 */
const DAILY_PILLAR_ROTATION: Pillar[][] = [
  ['manipulation', 'body_language'],
  ['cognitive_bias', 'power'],
  ['cult', 'social_engineering'],
  ['self_mastery', 'manipulation'],
];

function todaysPriorityPillars(): Pillar[] {
  const dayOfCycle = Math.floor(Date.now() / 86400000) % DAILY_PILLAR_ROTATION.length;
  return DAILY_PILLAR_ROTATION[dayOfCycle];
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text.trim();
}

function filterByNiche(items: ScrapedItem[]): ScrapedItem[] {
  const kws = ACTIVE_ACCOUNT.topics.keywords.map((k) => k.toLowerCase());
  return items.filter((i) => {
    const t = i.title.toLowerCase();
    return kws.some((k) => t.includes(k));
  });
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function seedToRanked(s: SeedTopic): RankedTopic {
  return {
    title: s.title,
    source: 'seed',
    url: '',
    viral_angle: s.hook,
    hook_idea: s.hook,
    target_emotion: s.target_emotion,
    pillar: s.pillar,
  };
}

/**
 * Select `count` seeds enforcing two rules:
 *   1. The two daily-priority pillars come first (one each, when available).
 *   2. No two selected topics share the same pillar.
 *   3. Never reuse a title already in DB.
 *   4. Never pick a pillar that's already been used in topics from the last
 *      2 days (avoid same pillar more than 2 days in a row).
 *
 * Falls back gracefully: if priority pillars are exhausted, fill from the
 * remaining allowed pillars; if those are exhausted too, fall back to any
 * unused seed.
 */
function seedsToRanked(count: number = 5): RankedTopic[] {
  const usedTitles = new Set(getTopicsByTitles().map((t) => t.title));
  const recentPillars = new Set(getRecentPillars(2));
  const priority = todaysPriorityPillars();

  const unused = darkPsychSeeds.filter((s) => !usedTitles.has(s.title));
  const allowedPillars: Pillar[] = ALL_PILLARS.filter((p) => !recentPillars.has(p));
  // If too aggressive, relax: ensure at least the priority pillars are allowed.
  for (const p of priority) if (!allowedPillars.includes(p)) allowedPillars.push(p);

  const selected: RankedTopic[] = [];
  const usedPillarsInRun = new Set<string>();

  // Helper: pick one fresh seed from a specific pillar.
  const pickFromPillar = (pillar: Pillar): SeedTopic | undefined => {
    const candidates = shuffle(unused.filter((s) => s.pillar === pillar && !usedPillarsInRun.has(s.pillar)));
    return candidates[0];
  };

  // Pass 1: today's priority pillars (in order).
  for (const p of priority) {
    if (selected.length >= count) break;
    const pick = pickFromPillar(p);
    if (pick) {
      selected.push(seedToRanked(pick));
      usedPillarsInRun.add(pick.pillar);
    }
  }

  // Pass 2: fill from other allowed pillars not used in this run.
  if (selected.length < count) {
    const remainingPillars = shuffle(allowedPillars.filter((p) => !usedPillarsInRun.has(p)));
    for (const p of remainingPillars) {
      if (selected.length >= count) break;
      const pick = pickFromPillar(p);
      if (pick) {
        selected.push(seedToRanked(pick));
        usedPillarsInRun.add(pick.pillar);
      }
    }
  }

  // Pass 3: last resort — any unused seed from any pillar not yet used in this run.
  if (selected.length < count) {
    const fallbackPool = shuffle(unused.filter((s) => !usedPillarsInRun.has(s.pillar)));
    for (const s of fallbackPool) {
      if (selected.length >= count) break;
      selected.push(seedToRanked(s));
      usedPillarsInRun.add(s.pillar);
    }
  }

  // Absolute last resort: reuse any seed (drop the no-duplicate-pillar guard).
  if (selected.length < count) {
    const filler = shuffle(darkPsychSeeds);
    for (const s of filler) {
      if (selected.length >= count) break;
      if (selected.some((r) => r.title === s.title)) continue;
      selected.push(seedToRanked(s));
    }
  }

  return selected.slice(0, count);
}

export async function runResearch(count: number = 5): Promise<RankedTopic[]> {
  log.info('🔍 Scraping trending sources...');

  const [phRes, hnRes, rdRes] = await Promise.allSettled([
    scrapeProductHunt(),
    scrapeHackerNews(),
    scrapeReddit(),
  ]);

  const ph = phRes.status === 'fulfilled' ? phRes.value : [];
  const hn = hnRes.status === 'fulfilled' ? hnRes.value : [];
  const rd = rdRes.status === 'fulfilled' ? rdRes.value : [];
  const all: ScrapedItem[] = [...ph, ...hn, ...rd];
  const relevant = filterByNiche(all);

  log.info('🔍 Research complete:');
  log.info(`  📌 Product Hunt: ${ph.length} items`);
  log.info(`  📌 Hacker News: ${hn.length} items`);
  log.info(`  📌 Reddit: ${rd.length} items (subs: ${ACTIVE_ACCOUNT.topics.subreddits.length})`);
  log.info(`  🎯 Niche-relevant after keyword filter: ${relevant.length}`);

  let topics: RankedTopic[] = [];

  if (relevant.length < 3) {
    log.warn(`  Scrapers returned < 3 relevant items — falling back to seed bank.`);
    topics = seedsToRanked(count);
    log.info(`  🌱 Using ${topics.length} seed topic(s) from ${ACTIVE_ACCOUNT.niche} seed bank`);
  } else {
    const prompt = DARK_PSYCH_RESEARCH_PROMPT.replace('{TOPICS_JSON}', JSON.stringify(relevant, null, 2));
    const raw = await ask(prompt, { json: true });
    const jsonText = extractJson(raw);
    try {
      const parsed = JSON.parse(jsonText) as { topics: RankedTopic[] };
      const allowed = new Set<string>(ALL_PILLARS);
      topics = (parsed.topics ?? []).map((t) => ({
        ...t,
        pillar: allowed.has(t.pillar) ? t.pillar : 'manipulation',
      }));
    } catch (err) {
      log.error('Failed to parse AI JSON response — falling back to seeds');
      log.error(raw.slice(0, 500));
      topics = seedsToRanked(count);
    }
    if (topics.length < 3) {
      log.warn('  AI ranked < 3 topics — padding from seed bank');
      topics = [...topics, ...seedsToRanked()].slice(0, Math.max(count, 3));
    }
  }

  // Final pass: enforce "no two topics from the same pillar in one run".
  // Keep the first topic per pillar (preserves AI/seed ordering), then if we
  // dropped below the target count, refill from seeds whose pillars haven't
  // been used yet in this run.
  const seenPillars = new Set<string>();
  const deduped: RankedTopic[] = [];
  for (const t of topics) {
    const p = t.pillar ?? 'manipulation';
    if (seenPillars.has(p)) continue;
    seenPillars.add(p);
    deduped.push(t);
  }
  if (deduped.length < count) {
    const usedTitles = new Set([
      ...getTopicsByTitles().map((t) => t.title),
      ...deduped.map((t) => t.title),
    ]);
    const fresh = shuffle(
      darkPsychSeeds.filter(
        (s) => !seenPillars.has(s.pillar) && !usedTitles.has(s.title)
      )
    );
    for (const s of fresh) {
      if (deduped.length >= count) break;
      deduped.push({
        title: s.title,
        source: 'seed',
        url: '',
        viral_angle: s.hook,
        hook_idea: s.hook,
        target_emotion: s.target_emotion,
        pillar: s.pillar,
      });
      seenPillars.add(s.pillar);
    }
  }
  topics = deduped.slice(0, count);

  log.info(`  🤖 Selected top ${topics.length} (pillars: ${todaysPriorityPillars().join(', ')} priority today):`);
  topics.forEach((t, i) => {
    log.info(`    ${i + 1}. [${t.pillar ?? '?'}] ${t.title} (source: ${t.source}, emotion: ${t.target_emotion})`);
  });

  for (const t of topics) {
    saveTopic({
      title: t.title,
      source: t.source,
      url: t.url,
      viral_angle: t.viral_angle,
      hook_idea: t.hook_idea,
      target_emotion: t.target_emotion,
      pillar: t.pillar,
      score: 0,
    });
  }

  log.success(`Saved ${topics.length} topics to DB`);
  return topics;
}
