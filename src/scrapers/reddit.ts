import axios from 'axios';
import { withRetry } from '../utils/retry';
import type { ScrapedItem } from './producthunt';
import { ACTIVE_ACCOUNT } from '../config/accounts';

const UA = 'Mozilla/5.0 content-factory-bot/1.0';

async function fetchSub(sub: string, limit: number): Promise<ScrapedItem[]> {
  const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const children = data?.data?.children ?? [];
  return children.map((c: any) => ({
    title: c.data.title as string,
    url: `https://www.reddit.com${c.data.permalink}`,
    source: 'reddit' as const,
    score: (c.data.ups as number) ?? 0,
  }));
}

export async function scrapeReddit(): Promise<ScrapedItem[]> {
  const subs = ACTIVE_ACCOUNT.topics.subreddits.map((sub) => ({
    sub,
    limit: 10,
  }));
  const results = await Promise.allSettled(
    subs.map(({ sub, limit }) => withRetry(() => fetchSub(sub, limit), 2, 1500))
  );
  const items: ScrapedItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
  }
  return items;
}
