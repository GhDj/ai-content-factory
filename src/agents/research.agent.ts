import { ask } from '../utils/ai';
import { log } from '../utils/logger';
import { scrapeProductHunt, type ScrapedItem } from '../scrapers/producthunt';
import { scrapeHackerNews } from '../scrapers/hackernews';
import { scrapeReddit } from '../scrapers/reddit';
import { saveTopic, getTopicsByTitles } from '../db/repository';
import { ACTIVE_ACCOUNT } from '../config/accounts';
import { darkPsychSeeds } from '../config/darkpsych-seeds';
import { DARK_PSYCH_RESEARCH_PROMPT } from '../config/prompts';

export interface RankedTopic {
  title: string;
  source: string;
  url: string;
  viral_angle: string;
  hook_idea: string;
  target_emotion: string;
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

function seedsToRanked(count: number = 5): RankedTopic[] {
  const usedTitles = new Set(getTopicsByTitles().map((t) => t.title));
  const unused = darkPsychSeeds.filter((s) => !usedTitles.has(s.title));
  const pool = unused.length >= count ? unused : darkPsychSeeds;
  return shuffle(pool).slice(0, count).map((s) => ({
    title: s.title,
    source: 'seed',
    url: '',
    viral_angle: s.hook,
    hook_idea: s.hook,
    target_emotion: s.target_emotion,
  }));
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
      topics = parsed.topics ?? [];
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

  topics = topics.slice(0, count);

  log.info(`  🤖 Selected top ${topics.length}:`);
  topics.forEach((t, i) => {
    log.info(`    ${i + 1}. ${t.title} (source: ${t.source}, emotion: ${t.target_emotion})`);
  });

  for (const t of topics) {
    saveTopic({
      title: t.title,
      source: t.source,
      url: t.url,
      viral_angle: t.viral_angle,
      hook_idea: t.hook_idea,
      target_emotion: t.target_emotion,
      score: 0,
    });
  }

  log.success(`Saved ${topics.length} topics to DB`);
  return topics;
}
