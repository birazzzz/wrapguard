import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface WrapguardConfig {
  /** Where your site runs, e.g. `http://localhost:3000`. Page paths are resolved against it. */
  baseUrl: string;
  /** Paths (or full URLs) to check. */
  pages: string[];
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
}

export type ResolvedConfig = Required<WrapguardConfig> & { root: string };

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

export function resolveConfig(raw: unknown, root: string): ResolvedConfig {
  if (!raw || typeof raw !== "object") throw new ConfigError("Config must be an object.");
  const config = raw as WrapguardConfig;
  if (typeof config.baseUrl !== "string" || !config.baseUrl) {
    throw new ConfigError("Config needs `baseUrl`, e.g. \"http://localhost:3000\".");
  }
  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    throw new ConfigError("Config needs `pages`, e.g. [\"/\", \"/pricing\"].");
  }
  const widths = config.widths ?? DEFAULTS.widths;
  if (!widths.length || widths.some((width) => !Number.isInteger(width) || width < 200)) {
    throw new ConfigError("`widths` must be whole numbers of at least 200.");
  }
  return {
    root,
    baseUrl: config.baseUrl,
    pages: config.pages,
    widths: [...new Set(widths)].sort((a, b) => b - a),
    selector: config.selector ?? DEFAULTS.selector,
    ignore: config.ignore ?? DEFAULTS.ignore,
    snapshot: config.snapshot ?? DEFAULTS.snapshot,
    concurrency: Math.max(1, config.concurrency ?? DEFAULTS.concurrency),
    settle: config.settle ?? DEFAULTS.settle,
  };
}
