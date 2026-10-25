import { chromium, type Browser, type BrowserContext } from "playwright";
import type { ResolvedConfig } from "./config.ts";
import type { LimitViolation } from "./diff.ts";
import { measureInPage, type PageMeasurement } from "./measure.ts";
import type { Snapshot, SnapshotElement } from "./snapshot.ts";

export interface ScanResult {
  snapshot: Snapshot;
  /** Text over a line limit from the config's `rules`. */
  overLimit: LimitViolation[];
}

export interface ScanProgress {
  page: string;
  width: number;
  done: number;
  total: number;
}

/**
 * Loads every page at every width, records how many lines each piece of text takes,
 * and checks the line limits.
 */
export async function scan(
  config: ResolvedConfig,
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const jobs = config.pages.flatMap((page) => config.widths.map((width) => ({ page, width })));
  const measured = new Map<string, PageMeasurement>();
  const jobKey = (page: string, width: number) => `${width} ${page}`;

  const browser = await launch();
  try {
    let next = 0;
    let done = 0;
    const worker = async () => {
      const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
      try {
        await sendToSite(context, config);
        while (next < jobs.length) {
          const job = jobs[next++]!;
          measured.set(jobKey(job.page, job.width), await measurePage(context, config, job.page, job.width));
          onProgress?.({ ...job, done: ++done, total: jobs.length });
        }
      } finally {
        await context.close();
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.concurrency, jobs.length) }, worker));
  } finally {
    await browser.close();
  }

  const pages: Snapshot["pages"] = {};
  for (const page of config.pages) {
    // Keep document order of the widest layout, then add anything that only shows up narrower.
    const elements = new Map<string, SnapshotElement>();
    for (const width of config.widths) {
      for (const { key, text, lines } of measured.get(jobKey(page, width))?.elements ?? []) {
        let element = elements.get(key);
        if (!element) {
          element = { key, text: excerpt(text), lines: {} };
          elements.set(key, element);
        }
        element.lines[width] = lines;
      }
    }
    pages[page] = [...elements.values()];
  }

  // One entry per rule, page and element, listing every width where it goes over.
  const overLimit = new Map<string, LimitViolation & { rule: number }>();
  for (const page of config.pages) {
    for (const width of config.widths) {
      for (const hit of measured.get(jobKey(page, width))?.overLimit ?? []) {
        const id = `${hit.rule}\n${page}\n${hit.key}`;
        let violation = overLimit.get(id);
        if (!violation) {
          const rule = config.rules[hit.rule]!;
          violation = {
            rule: hit.rule,
            page,
            key: hit.key,
            text: excerpt(hit.text),
            selector: rule.selector,
            maxLines: rule.maxLines,
            widths: [],
          };
          overLimit.set(id, violation);
        }
        violation.widths.push({ width, lines: hit.lines });
      }
    }
  }

  // Rule by rule, page by page, in the order the elements appear on the page.
  const pageOrder = new Map(config.pages.map((page, index) => [page, index]));
  const position = (violation: LimitViolation) => {
    const index = pages[violation.page]?.findIndex((element) => element.key === violation.key) ?? -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sorted = [...overLimit.values()].sort(
    (a, b) => a.rule - b.rule || pageOrder.get(a.page)! - pageOrder.get(b.page)! || position(a) - position(b),
  );

  return {
    snapshot: { version: 1, widths: config.widths, pages },
    overLimit: sorted.map(({ rule: _rule, ...violation }) => violation),
  };
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      throw new Error("Chromium isn't installed for Playwright. Run: npx playwright install chromium");
    }
    throw error;
  }
}

/** Sets the config's cookies and headers for the site at `baseUrl`, and nowhere else. */
async function sendToSite(context: BrowserContext, config: ResolvedConfig): Promise<void> {
  const { origin } = new URL(config.baseUrl);
  const cookies = Object.entries(config.cookies).map(([name, value]) => ({ name, value, url: `${origin}/` }));
  if (cookies.length) await context.addCookies(cookies);

  const headers = Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [name.toLowerCase(), value]));
  if (!Object.keys(headers).length) return;
  // A route instead of `extraHTTPHeaders`, which would send them to fonts, analytics and
  // every other host too. Headers can hold a token.
  await context.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
}

async function measurePage(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  config: ResolvedConfig,
  page: string,
  width: number,
): Promise<PageMeasurement> {
  const tab = await context.newPage();
  try {
    await tab.setViewportSize({ width, height: 900 });
    const url = new URL(page, config.baseUrl).href;
    const response = await tab.goto(url, { waitUntil: "load", timeout: 30_000 });
    if (response && response.status() >= 400) {
      throw new Error(`${url} answered ${response.status()}`);
    }
    await tab.evaluate(() => document.fonts.ready.then(() => undefined));
    if (config.settle > 0) await tab.waitForTimeout(config.settle);
    const rules = config.rules
      .map((rule, index) => ({ index, selector: rule.selector, maxLines: rule.maxLines, widths: rule.widths }))
      .filter((rule) => !rule.widths || rule.widths.includes(width))
      .map(({ index, selector, maxLines }) => ({ index, selector, maxLines }));
    return await tab.evaluate(measureInPage, { selector: config.selector, ignore: config.ignore, rules });
  } finally {
    await tab.close();
  }
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
