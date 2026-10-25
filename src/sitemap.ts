import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SitemapOptions } from "./config.ts";

const MAX_SITEMAPS = 50;

/**
 * Pages listed in a sitemap, as paths. Sitemaps name the production site even when
 * served by a dev server, so only each address's path (and query) is kept and the
 * pages are loaded from `baseUrl`.
 */
export async function pagesFromSitemap(
  sitemap: SitemapOptions,
  baseUrl: string,
  fetchText: (url: string) => Promise<string> = readText,
): Promise<string[]> {
  const pages: string[] = [];
  const queue = [new URL(sitemap.url, baseUrl).href];
  const seen = new Set<string>();

  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (seen.size > MAX_SITEMAPS) throw new Error(`Stopped after ${MAX_SITEMAPS} sitemaps. Point \`sitemap\` at a smaller one.`);

    const xml = await fetchText(url);
    const locations = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) => decodeXml(match[1]!));
    if (/<sitemapindex[\s>]/.test(xml)) {
      queue.push(...locations.map((location) => new URL(pathOf(location, baseUrl), baseUrl).href));
    } else if (/<urlset[\s>]/.test(xml)) {
      pages.push(...locations.map((location) => pathOf(location, baseUrl)));
    } else {
      throw new Error(`${url} isn't a sitemap: no <urlset> or <sitemapindex>.`);
    }
  }

  const include = (sitemap.include ?? []).map(pattern);
  const exclude = (sitemap.exclude ?? []).map(pattern);
  const picked = [...new Set(pages)].filter(
    (page) => (!include.length || include.some((test) => test(page))) && !exclude.some((test) => test(page)),
  );
  return sitemap.limit ? picked.slice(0, sitemap.limit) : picked;
}

/** `*` matches within one path segment, `**` matches across segments. */
export function pattern(glob: string): (path: string) => boolean {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  const regex = new RegExp(`^${source}$`);
  return (path) => regex.test(path);
}

function pathOf(location: string, baseUrl: string): string {
  const url = new URL(location.trim(), baseUrl);
  return `${url.pathname}${url.search}`;
}

function decodeXml(text: string): string {
  return text
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (name[0] !== "#") return named[name.toLowerCase()] ?? entity;
      return String.fromCodePoint(name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    })
    .trim();
}

export async function readText(url: string, headers: Record<string, string> = {}): Promise<string> {
  if (url.startsWith("file:")) return readFile(fileURLToPath(url), "utf8");
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Couldn't read the sitemap at ${url} (${response.status}).`);
  return response.text();
}
