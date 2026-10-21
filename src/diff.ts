import type { Snapshot, SnapshotElement } from "./snapshot.ts";

export interface WidthChange {
  width: number;
  before: number;
  after: number;
}

export interface ElementChange {
  page: string;
  key: string;
  text: string;
  changes: WidthChange[];
}

export interface ElementNote {
  page: string;
  key: string;
  text: string;
  /** Widths it was added or removed at. Empty when it's the whole element. */
  widths: number[];
}

export interface TextChange {
  page: string;
  key: string;
  before: string;
  after: string;
}

export interface DiffResult {
  /** Text that now takes a different number of lines. These fail `wrapguard check`. */
  changed: ElementChange[];
  added: ElementNote[];
  removed: ElementNote[];
  /** Copy that changed without changing its line count. */
  textOnly: TextChange[];
  /** Pages or widths in the config that the snapshot has no baseline for. */
  missingPages: string[];
  missingWidths: number[];
  elementCount: number;
}

export function diffSnapshots(baseline: Snapshot, current: Snapshot): DiffResult {
  const result: DiffResult = {
    changed: [],
    added: [],
    removed: [],
    textOnly: [],
    missingPages: [],
    missingWidths: current.widths.filter((width) => !baseline.widths.includes(width)),
    elementCount: 0,
  };
  const widths = current.widths.filter((width) => baseline.widths.includes(width));

  for (const [page, elements] of Object.entries(current.pages)) {
    result.elementCount += elements.length;
    const before = baseline.pages[page];
    if (!before) {
      result.missingPages.push(page);
      continue;
    }
    const beforeByKey = new Map(before.map((element) => [element.key, element]));
    const seen = new Set<string>();

    for (const element of elements) {
      const old = beforeByKey.get(element.key);
      seen.add(element.key);
      if (!old) {
        result.added.push(note(page, element, []));
        continue;
      }
      const changes: WidthChange[] = [];
      const addedAt: number[] = [];
      const removedAt: number[] = [];
      for (const width of widths) {
        const was = old.lines[width];
        const now = element.lines[width];
        if (was !== undefined && now !== undefined && was !== now) changes.push({ width, before: was, after: now });
        else if (was === undefined && now !== undefined) addedAt.push(width);
        else if (was !== undefined && now === undefined) removedAt.push(width);
      }
      if (changes.length) result.changed.push({ page, key: element.key, text: element.text, changes });
      else if (old.text !== element.text) {
        result.textOnly.push({ page, key: element.key, before: old.text, after: element.text });
      }
      if (addedAt.length) result.added.push(note(page, element, addedAt));
      if (removedAt.length) result.removed.push(note(page, element, removedAt));
    }

    for (const element of before) {
      if (!seen.has(element.key)) result.removed.push(note(page, element, []));
    }
  }
  return result;
}

export function hasFailures(diff: DiffResult, strict: boolean): boolean {
  if (diff.changed.length) return true;
  return (
    strict &&
    (diff.added.length > 0 || diff.removed.length > 0 || diff.missingPages.length > 0 || diff.missingWidths.length > 0)
  );
}

function note(page: string, element: SnapshotElement, widths: number[]): ElementNote {
  return { page, key: element.key, text: element.text, widths };
}
