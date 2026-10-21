import { chromium, type Browser } from "playwright";
import type { ResolvedConfig } from "./config.ts";
import { measureInPage, type MeasuredElement } from "./measure.ts";
import type { Snapshot, SnapshotElement } from "./snapshot.ts";

export interface ScanProgress {
  page: string;
  width: number;
  done: number;
  total: number;
}

/** Loads every page at every width and records how many lines each piece of text takes. */
export async function scan(
  config: ResolvedConfig,
  onProgress?: (progress: ScanProgress) => void,
): Promise<Snapshot> {
  const jobs = config.pages.flatMap((page) => config.widths.map((width) => ({ page, width })));
  const measured = new Map<string, MeasuredElement[]>();
  const jobKey = (page: string, width: number) => `${width} ${page}`;

  const browser = await launch();
  try {
    let next = 0;
    let done = 0;
    const worker = async () => {
      const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
      try {
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
      for (const { key, text, lines } of measured.get(jobKey(page, width)) ?? []) {
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
  return { version: 1, widths: config.widths, pages };
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

async function measurePage(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  config: ResolvedConfig,
  page: string,
  width: number,
): Promise<MeasuredElement[]> {
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
    return await tab.evaluate(measureInPage, { selector: config.selector, ignore: config.ignore });
  } finally {
    await tab.close();
  }
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
