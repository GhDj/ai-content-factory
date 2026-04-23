import axios from 'axios';
import * as cheerio from 'cheerio';
import { withRetry } from '../utils/retry';

export interface ScrapedItem {
  title: string;
  url: string;
  source: 'producthunt' | 'hackernews' | 'reddit';
  score: number;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function scrapeRss(): Promise<ScrapedItem[]> {
  const { data } = await axios.get('https://www.producthunt.com/feed', {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const $ = cheerio.load(data as string, { xmlMode: true });
  const items: ScrapedItem[] = [];

  $('entry').each((_, el) => {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().attr('href') ?? '';
    const contentRaw = $(el).find('content').first().text();
    const content = decodeEntities(contentRaw);
    const taglineMatch = content.match(/<p>\s*([^<]+?)\s*<\/p>/);
    const tagline = taglineMatch ? taglineMatch[1].trim() : '';
    if (!title) return;
    items.push({
      title: tagline ? `${title}: ${tagline}` : title,
      url: link,
      source: 'producthunt',
      score: 0,
    });
  });

  return items.slice(0, 15);
}

async function scrapeGraphql(): Promise<ScrapedItem[]> {
  const res = await axios.post(
    'https://api.producthunt.com/v2/api/graphql',
    {
      query:
        '{ posts(order: VOTES, first: 10) { edges { node { name tagline votesCount website } } } }',
    },
    {
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      timeout: 15000,
    }
  );
  const edges = res.data?.data?.posts?.edges ?? [];
  return edges.map((e: any) => ({
    title: `${e.node.name}: ${e.node.tagline}`,
    url: e.node.website ?? '',
    source: 'producthunt' as const,
    score: e.node.votesCount ?? 0,
  }));
}

export async function scrapeProductHunt(): Promise<ScrapedItem[]> {
  try {
    const rss = await withRetry(scrapeRss, 2, 1500);
    if (rss.length >= 3) return rss;
  } catch {
    // fall through to GraphQL (needs OAuth — usually skipped)
  }
  try {
    return await withRetry(scrapeGraphql, 2, 1500);
  } catch {
    return [];
  }
}
