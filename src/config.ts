import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface LineRule {
  /** Elements the rule applies to, e.g. `h1` or `nav a`. Each one's full text is measured. */
  selector: string;
  /** Most lines the text may take. */
  maxLines: number;
  /** Widths the rule applies at. All widths when left out. */
  widths?: number[];
}

export interface SitemapOptions {
  /** Sitemap or sitemap index, resolved against `baseUrl`, e.g. `/sitemap.xml`. */
  url: string;
  /** Only pages whose path matches one of these, e.g. `/blog/**`. `*` stays within one path segment. */
  include?: string[];
  /** Leave out pages whose path matches one of these. */
  exclude?: string[];
  /** Most pages taken from the sitemap, after include and exclude. */
  limit?: number;
}

export interface ServerOptions {
  /** Starts your site, e.g. `npm run dev`. Runs in a shell. */
  command: string;
  /** Address to wait for. Defaults to `baseUrl`. */
  url?: string;
  /** Milliseconds to wait for the site to answer. */
  timeout?: number;
  /** Use a server that's already answering at `url` instead of starting one. */
  reuseExisting?: boolean;
  /** Folder to run the command in, relative to the config file. */
  cwd?: string;
}

export interface WrapguardConfig {
  /** Where your site runs, e.g. `http://localhost:3000`. Page paths are resolved against it. */
  baseUrl: string;
  /** Paths (or full URLs) to check. Optional when `sitemap` is set. */
  pages?: string[];
  /** Read more pages from a sitemap. A string is the sitemap's address. */
  sitemap?: string | SitemapOptions;
  /** Start your site before scanning and stop it afterwards. */
  server?: ServerOptions;
  /** Viewport widths in CSS pixels. */
  widths?: number[];
  /** Elements whose text is measured. */
  selector?: string;
  /** Elements never measured, on top of anything marked `data-wrapguard-ignore`. */
  ignore?: string[];
  /** Snapshot file, relative to the config file. */
  snapshot?: string;
  /** Pages loaded at the same time. */
  concurrency?: number;
  /** Extra wait after fonts load, in milliseconds, for pages that render text late. */
  settle?: number;
  /** Line limits checked on every run, with or without a snapshot. */
  rules?: LineRule[];
}

export type ResolvedConfig = Required<Omit<WrapguardConfig, "sitemap" | "server">> & {
  root: string;
  sitemap?: SitemapOptions;
  server?: Required<Omit<ServerOptions, "url">> & { url: string };
};

export const DEFAULT_SELECTOR = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "a", "button", "label",
  "th", "td", "dt", "dd", "figcaption", "blockquote", "summary", "legend",
  "[data-wrapguard]",
].join(", ");

export const DEFAULTS = {
  widths: [1440, 1024, 768, 390],
  selector: DEFAULT_SELECTOR,
  ignore: [] as string[],
  snapshot: "wrapguard.snap.json",
  concurrency: 4,
  settle: 0,
  rules: [] as LineRule[],
  serverTimeout: 60_000,
};

export const CONFIG_FILES = ["wrapguard.config.js", "wrapguard.config.mjs", "wrapguard.config.json"];

/** Typed helper for `wrapguard.config.js`. */
export function defineConfig(config: WrapguardConfig): WrapguardConfig {
  return config;
}

export class ConfigError extends Error {}

export async function loadConfig(root: string, explicitPath?: string): Promise<ResolvedConfig> {
  const path = explicitPath
    ? resolve(root, explicitPath)
    : CONFIG_FILES.map((name) => resolve(root, name)).find((candidate) => existsSync(candidate));
  if (!path || !existsSync(path)) {
    throw new ConfigError(
      explicitPath
        ? `Config file not found: ${explicitPath}`
        : "No wrapguard config found. Run `wrapguard init` to create one.",
    );
  }

  let raw: unknown;
  if (path.endsWith(".json")) {
    raw = JSON.parse(await readFile(path, "utf8"));
  } else {
    const module = await import(pathToFileURL(path).href);
    raw = module.default ?? module;
  }
  return resolveConfig(raw, resolve(path, ".."));
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function resolveConfig(raw: unknown, root: string): ResolvedConfig {
  if (!raw || typeof raw !== "object") throw new ConfigError("Config must be an object.");
  const config = raw as WrapguardConfig;
  if (typeof config.baseUrl !== "string" || !config.baseUrl) {
    throw new ConfigError("Config needs `baseUrl`, e.g. \"http://localhost:3000\".");
  }

  const sitemap = resolveSitemap(config.sitemap);
  const pages = config.pages ?? [];
  if (!isStringList(pages)) throw new ConfigError("`pages` must be a list of paths, e.g. [\"/\", \"/pricing\"].");
  if (pages.length === 0 && !sitemap) {
    throw new ConfigError("Config needs `pages`, e.g. [\"/\", \"/pricing\"], or a `sitemap`.");
  }

  const widths = config.widths ?? DEFAULTS.widths;
  if (!widths.length || widths.some((width) => !Number.isInteger(width) || width < 200)) {
    throw new ConfigError("`widths` must be whole numbers of at least 200.");
  }

  const rules = config.rules ?? DEFAULTS.rules;
  if (!Array.isArray(rules)) throw new ConfigError("`rules` must be a list, e.g. [{ \"selector\": \"h1\", \"maxLines\": 2 }].");
  rules.forEach((rule, index) => {
    const where = `rules[${index}]`;
    if (!rule || typeof rule.selector !== "string" || !rule.selector.trim()) {
      throw new ConfigError(`${where} needs a \`selector\`, e.g. "h1".`);
    }
    if (!Number.isInteger(rule.maxLines) || rule.maxLines < 1) {
      throw new ConfigError(`${where} needs \`maxLines\`, a whole number of at least 1.`);
    }
    if (rule.widths !== undefined && (!Array.isArray(rule.widths) || rule.widths.some((width) => !widths.includes(width)))) {
      throw new ConfigError(`${where}.widths must only list widths from \`widths\` (${widths.join(", ")}).`);
    }
  });

  return {
    root,
    baseUrl: config.baseUrl,
    pages,
    sitemap,
    server: resolveServer(config.server, config.baseUrl),
    widths: [...new Set(widths)].sort((a, b) => b - a),
    selector: config.selector ?? DEFAULTS.selector,
    ignore: config.ignore ?? DEFAULTS.ignore,
    snapshot: config.snapshot ?? DEFAULTS.snapshot,
    concurrency: Math.max(1, config.concurrency ?? DEFAULTS.concurrency),
    settle: config.settle ?? DEFAULTS.settle,
    rules,
  };
}

function resolveSitemap(raw: WrapguardConfig["sitemap"]): SitemapOptions | undefined {
  if (raw === undefined) return undefined;
  const sitemap = typeof raw === "string" ? { url: raw } : raw;
  if (!sitemap || typeof sitemap.url !== "string" || !sitemap.url.trim()) {
    throw new ConfigError("`sitemap` needs an address, e.g. \"/sitemap.xml\".");
  }
  for (const key of ["include", "exclude"] as const) {
    if (sitemap[key] !== undefined && !isStringList(sitemap[key])) {
      throw new ConfigError(`\`sitemap.${key}\` must be a list of path patterns, e.g. ["/blog/**"].`);
    }
  }
  if (sitemap.limit !== undefined && (!Number.isInteger(sitemap.limit) || sitemap.limit < 1)) {
    throw new ConfigError("`sitemap.limit` must be a whole number of at least 1.");
  }
  return sitemap;
}

function resolveServer(raw: ServerOptions | undefined, baseUrl: string): ResolvedConfig["server"] {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw.command !== "string" || !raw.command.trim()) {
    throw new ConfigError("`server` needs a `command`, e.g. \"npm run dev\".");
  }
  if (raw.timeout !== undefined && (!Number.isInteger(raw.timeout) || raw.timeout < 1)) {
    throw new ConfigError("`server.timeout` must be a whole number of milliseconds.");
  }
  return {
    command: raw.command,
    url: raw.url ?? baseUrl,
    timeout: raw.timeout ?? DEFAULTS.serverTimeout,
    reuseExisting: raw.reuseExisting ?? true,
    cwd: raw.cwd ?? ".",
  };
}
