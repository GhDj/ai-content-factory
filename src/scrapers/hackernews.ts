import axios from 'axios';
import { withRetry } from '../utils/retry';
import type { ScrapedItem } from './producthunt';
import { ACTIVE_ACCOUNT } from '../config/accounts';

export async function scrapeHackerNews(): Promise<ScrapedItem[]> {
  try {
    const { data } = await withRetry(
      () =>
        axios.get(
          'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
          { timeout: 15000 }
        ),
      3,
      1500
    );

    const hits = data?.hits ?? [];
    const keywords = ACTIVE_ACCOUNT.topics.keywords.map((k) => k.toLowerCase());
    const matches: ScrapedItem[] = [];
    for (const h of hits) {
      const title: string = h.title ?? '';
      if (!title) continue;
      const lower = title.toLowerCase();
      if (!keywords.some((k) => lower.includes(k))) continue;
      matches.push({
        title,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: 'hackernews',
        score: h.points ?? 0,
      });
    }
    return matches;
  } catch {
    return [];
  }
}
