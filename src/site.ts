import type { ResolvedConfig } from "./config.ts";
import { startServer } from "./server.ts";
import { pagesFromSitemap } from "./sitemap.ts";

/**
 * Gets the site ready to scan: starts the server when one is configured, then adds the
 * sitemap's pages to `pages`. Always stops the server again, also when `work` fails.
 */
export async function withSite<T>(
  config: ResolvedConfig,
  log: (message: string) => void,
  work: (config: ResolvedConfig) => Promise<T>,
): Promise<T> {
  const server = config.server ? await startServer(config.server, config.root, log) : undefined;
  const stopOnSignal = () => {
    void server?.stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);
  try {
    return await work({ ...config, pages: await resolvePages(config, log) });
  } finally {
    process.off("SIGINT", stopOnSignal);
    process.off("SIGTERM", stopOnSignal);
    await server?.stop();
  }
}

/** `pages` first, then sitemap pages that aren't listed already. */
export async function resolvePages(config: ResolvedConfig, log: (message: string) => void): Promise<string[]> {
  if (!config.sitemap) return config.pages;
  const fromSitemap = await pagesFromSitemap(config.sitemap, config.baseUrl);
  const href = (page: string) => new URL(page, config.baseUrl).href;
  const listed = new Set(config.pages.map(href));
  const added = fromSitemap.filter((page) => !listed.has(href(page)));
  log(`Found ${added.length} page(s) in ${config.sitemap.url}`);
  if (config.pages.length + added.length === 0) throw new Error(`No pages to check: ${config.sitemap.url} lists none that match.`);
  return [...config.pages, ...added];
}
