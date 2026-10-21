import { readFile, writeFile } from "node:fs/promises";

export interface SnapshotElement {
  key: string;
  text: string;
  /** Lines per viewport width. A width is missing when the element isn't shown there. */
  lines: Record<number, number>;
}

export interface Snapshot {
  version: 1;
  widths: number[];
  pages: Record<string, SnapshotElement[]>;
}

export async function readSnapshot(path: string): Promise<Snapshot> {
  const snapshot = JSON.parse(await readFile(path, "utf8")) as Snapshot;
  if (snapshot.version !== 1 || !snapshot.pages) {
    throw new Error(`${path} isn't a wrapguard snapshot this version can read.`);
  }
  return snapshot;
}

export async function writeSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await writeFile(path, serializeSnapshot(snapshot), "utf8");
}

/**
 * One element per line, so a pull request diff reads like a list of what moved.
 */
export function serializeSnapshot(snapshot: Snapshot): string {
  const out = ["{", '  "version": 1,', `  "widths": ${JSON.stringify(snapshot.widths)},`, '  "pages": {'];
  const pages = Object.entries(snapshot.pages);
  pages.forEach(([page, elements], pageIndex) => {
    out.push(`    ${JSON.stringify(page)}: [`);
    elements.forEach((element, index) => {
      const lines = snapshot.widths
        .filter((width) => element.lines[width] !== undefined)
        .map((width) => `"${width}": ${element.lines[width]}`)
        .join(", ");
      const comma = index < elements.length - 1 ? "," : "";
      out.push(
        `      { "key": ${JSON.stringify(element.key)}, "text": ${JSON.stringify(element.text)}, "lines": { ${lines} } }${comma}`,
      );
    });
    out.push(`    ]${pageIndex < pages.length - 1 ? "," : ""}`);
  });
  out.push("  }", "}", "");
  return out.join("\n");
}
