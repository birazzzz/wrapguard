import { hasFailures, type DiffResult, type ElementNote } from "./diff.ts";

export interface ReportOptions {
  pages: number;
  widths: number;
  strict?: boolean;
}

/** Marks wrapguard's pull request comment so later runs update it instead of adding another. */
export const COMMENT_MARKER = "<!-- wrapguard -->";
const MAX_ROWS = 50;

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));
const paint = (code: number) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const color = {
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  dim: paint(2),
  bold: paint(1),
};

export function formatReport(diff: DiffResult, options: ReportOptions & { verbose: boolean }): string {
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
  } else if (hasFailures(diff, options.strict ?? false)) {
    out.push(color.red("✗ No wrapping changes, but text or pages were added or removed (--strict)."));
  } else {
    out.push(color.green("✓ No wrapping changes."));
  }
  return out.join("\n");
}

/** The same result as Markdown, for pull request comments and CI job summaries. */
export function formatMarkdown(diff: DiffResult, options: ReportOptions): string {
  const checked = `Checked ${plural(options.pages, "page")} at ${plural(options.widths, "width")}, ${plural(diff.elementCount, "text element")}.`;
  const out = [COMMENT_MARKER];

  if (diff.changed.length) {
    const changes = diff.changed.length;
    out.push(
      `### ✗ ${plural(changes, "piece")} of text now wrap${changes === 1 ? "s" : ""} differently`,
      "",
      checked,
      "",
      "| Page | Element | Text | Lines |",
      "| --- | --- | --- | --- |",
    );
    for (const change of diff.changed.slice(0, MAX_ROWS)) {
      const lines = change.changes.map(({ width, before, after }) => `${width}px ${before} → **${after}**`).join("<br>");
      out.push(`| ${code(change.page)} | ${code(change.key)} | ${markdownText(change.text)} | ${lines} |`);
    }
    if (changes > MAX_ROWS) out.push("", `…and ${changes - MAX_ROWS} more. The job log lists them all.`);
    out.push("", "If these are intended, run `npx wrapguard update` and commit the snapshot.");
  } else if (hasFailures(diff, options.strict ?? false)) {
    out.push("### ✗ No wrapping changes, but text or pages were added or removed", "", `${checked} Strict mode is on.`);
  } else {
    out.push("### ✓ No wrapping changes", "", checked);
  }

  const missing = [
    ...diff.missingPages.map((page) => code(page)),
    ...diff.missingWidths.map((width) => `${width}px`),
  ];
  if (missing.length) out.push("", `No baseline yet for ${missing.join(", ")}. Run \`npx wrapguard update\` to add it.`);

  const details: string[] = [];
  markdownNotes(details, "New text", diff.added);
  markdownNotes(details, "Gone", diff.removed);
  if (diff.textOnly.length) {
    details.push("", "**Copy changed, same line count**", "");
    for (const change of diff.textOnly.slice(0, MAX_ROWS)) {
      details.push(`- ${code(change.page)} ${code(change.key)}: ${markdownText(change.before)} → ${markdownText(change.after)}`);
    }
  }
  if (details.length) {
    out.push(
      "",
      `<details><summary>Also ${diff.added.length} new, ${diff.removed.length} gone, ${diff.textOnly.length} reworded at the same line count</summary>`,
      ...details,
      "",
      "</details>",
    );
  }

  out.push("", "<sub>Checked by [wrapguard](https://github.com/birazzzz/wrapguard)</sub>", "");
  return out.join("\n");
}

function markdownNotes(out: string[], title: string, notes: ElementNote[]) {
  if (!notes.length) return;
  out.push("", `**${title}**`, "");
  for (const item of notes.slice(0, MAX_ROWS)) {
    const at = item.widths.length ? ` at ${item.widths.map((width) => `${width}px`).join(", ")}` : "";
    out.push(`- ${code(item.page)} ${code(item.key)}: ${markdownText(item.text)}${at}`);
  }
  if (notes.length > MAX_ROWS) out.push(`- …and ${notes.length - MAX_ROWS} more`);
}

function code(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\|/g, "\\|")}\``;
}

// Page text is copy, not Markdown: escape anything that would format it or break the table.
function markdownText(text: string): string {
  const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
  return short.replace(/[\\`*_[\]<>|]/g, (char) => (char === "<" ? "&lt;" : char === ">" ? "&gt;" : `\\${char}`));
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
