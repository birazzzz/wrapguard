import type { DiffResult, ElementNote } from "./diff.ts";

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));
const paint = (code: number) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const color = {
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  dim: paint(2),
  bold: paint(1),
};

export function formatReport(diff: DiffResult, options: { pages: number; widths: number; verbose: boolean }): string {
  const out: string[] = [];
  out.push(
    color.dim(
      `Checked ${plural(options.pages, "page")} at ${plural(options.widths, "width")}, ${plural(diff.elementCount, "text element")}.`,
    ),
    "",
  );

  const byPage = groupBy(diff.changed, (change) => change.page);
  for (const [page, changes] of byPage) {
    out.push(color.bold(page));
    for (const change of changes) {
      const widths = change.changes
        .map(({ width, before, after }) => `${width}px ${before} → ${color.red(String(after))}`)
        .join(color.dim("  ·  "));
      out.push(`  ${label(change.key, change.text)}`, `    ${widths} ${color.dim("lines")}`);
    }
    out.push("");
  }

  if (options.verbose) {
    section(out, "New text", diff.added);
    section(out, "Gone", diff.removed);
    if (diff.textOnly.length) {
      out.push(color.bold("Copy changed, same line count"));
      for (const change of diff.textOnly) {
        out.push(`  ${change.page}  ${change.key}`, `    ${color.dim(quote(change.before))} → ${quote(change.after)}`);
      }
      out.push("");
    }
  }

  if (diff.missingPages.length) {
    out.push(color.yellow(`No baseline yet for: ${diff.missingPages.join(", ")}`));
  }
  if (diff.missingWidths.length) {
    out.push(color.yellow(`No baseline yet at: ${diff.missingWidths.map((width) => `${width}px`).join(", ")}`));
  }

  const quiet = diff.added.length + diff.removed.length + diff.textOnly.length;
  if (quiet && !options.verbose) {
    out.push(
      color.dim(
        `Also ${diff.added.length} new, ${diff.removed.length} gone, ${diff.textOnly.length} with new copy at the same line count (--verbose lists them).`,
      ),
    );
  }

  if (diff.changed.length) {
    const changes = diff.changed.length;
    out.push(
      color.red(`✗ ${plural(changes, "piece")} of text now wrap${changes === 1 ? "s" : ""} differently on ${plural(byPage.size, "page")}.`),
      color.dim("  If that's intended, run: wrapguard update"),
    );
  } else {
    out.push(color.green("✓ No wrapping changes."));
  }
  return out.join("\n");
}

function section(out: string[], title: string, notes: ElementNote[]) {
  if (!notes.length) return;
  out.push(color.bold(title));
  for (const item of notes) {
    const at = item.widths.length ? color.dim(` at ${item.widths.map((width) => `${width}px`).join(", ")}`) : "";
    out.push(`  ${item.page}  ${label(item.key, item.text)}${at}`);
  }
  out.push("");
}

function label(key: string, text: string): string {
  return `${key}  ${color.dim(quote(text))}`;
}

function quote(text: string): string {
  return `"${text.length > 60 ? `${text.slice(0, 59)}…` : text}"`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
