// src/app/lib/segments/news.ts
import { XMLParser } from 'fast-xml-parser';

const NHK_RSS = 'https://www3.nhk.or.jp/rss/news/cat0.xml';

export interface NewsHeadline {
  title: string;
  description: string;
  pubDate?: string;
}

export async function fetchTopHeadlines(
  limit = 4,
  signal?: AbortSignal
): Promise<NewsHeadline[]> {
  const res = await fetch(NHK_RSS, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal,
  });
  if (!res.ok) throw new Error(`NHK RSS ${res.status}`);
  const xml = await res.text();
  const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
  const items = parsed?.rss?.channel?.item;
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit).map((it: { title?: string; description?: string; pubDate?: string }) => ({
    title: String(it.title ?? '').trim(),
    description: String(it.description ?? '').trim(),
    pubDate: it.pubDate ? String(it.pubDate) : undefined,
  }));
}
