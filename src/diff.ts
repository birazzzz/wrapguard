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

/** The same text under a new key, such as a section that moved down when one was added above it. */
export interface MovedElement {
  page: string;
  from: string;
  to: string;
  text: string;
}

export interface LimitViolation {
  page: string;
  key: string;
  text: string;
  /** The rule it breaks. */
  selector: string;
  maxLines: number;
  /** Every width where the text takes more than `maxLines`. */
  widths: { width: number; lines: number }[];
}

export interface DiffResult {
  /** False when there is no snapshot yet, so only line limits were checked. */
  hasBaseline: boolean;
  /** Text that now takes a different number of lines. These fail `wrapguard check`. */
  changed: ElementChange[];
  /** Text over a line limit from `rules`. These fail `wrapguard check` too. */
  overLimit: LimitViolation[];
  added: ElementNote[];
  removed: ElementNote[];
  /** Copy that changed without changing its line count. */
  textOnly: TextChange[];
  /** Text that is the same but sits somewhere else on the page now. Never a failure on its own. */
  moved: MovedElement[];
  /** Pages or widths in the config that the snapshot has no baseline for. */
  missingPages: string[];
  missingWidths: number[];
  elementCount: number;
}

/**
 * Compares a scan with the saved snapshot. Without a snapshot (`baseline` undefined),
 * the result only carries the line limit violations.
 */
export function diffSnapshots(
  baseline: Snapshot | undefined,
  current: Snapshot,
  overLimit: LimitViolation[] = [],
): DiffResult {
  const result: DiffResult = {
    hasBaseline: baseline !== undefined,
    changed: [],
    overLimit,
    added: [],
    removed: [],
    textOnly: [],
    moved: [],
    missingPages: [],
    missingWidths: baseline ? current.widths.filter((width) => !baseline.widths.includes(width)) : [],
    elementCount: 0,
  };
  const widths = baseline ? current.widths.filter((width) => baseline.widths.includes(width)) : [];

  for (const [page, elements] of Object.entries(current.pages)) {
    result.elementCount += elements.length;
    if (!baseline) continue;
    const before = baseline.pages[page];
    if (!before) {
      result.missingPages.push(page);
      continue;
    }
    const { pairs, added, removed } = pairElements(before, elements);
    result.added.push(...added.map((element) => note(page, element, [])));
    result.removed.push(...removed.map((element) => note(page, element, [])));

    for (const { old, now: element } of pairs) {
      if (old.key !== element.key && old.text === element.text) {
        result.moved.push({ page, from: old.key, to: element.key, text: element.text });
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
  }
  return result;
}

interface Pair {
  old: SnapshotElement;
  now: SnapshotElement;
}

// Keys without " > " name the element itself (`data-wrapguard` or its own id) and survive
// layout changes. Structural keys shift when a section is added or removed above them.
const isNamed = (key: string) => !key.includes(" > ");

// Above this many old × new elements on one page, skip the in-order match (it needs a
// table that size) and rely on the text and key matches alone.
const MAX_ALIGNMENT_CELLS = 16_000_000;

/**
 * Decides which saved element each scanned element is compared with:
 * 1. named elements by name;
 * 2. the rest in page order by text, as a longest common subsequence, so a section added
 *    or removed above shifts nothing and repeated text ("Learn more") pairs in order;
 * 3. the same text out of order (it moved past other content), nearest position first;
 * 4. the same key with new text (a copy edit).
 * Whatever is left was added or removed.
 */
export function pairElements(
  before: SnapshotElement[],
  after: SnapshotElement[],
): { pairs: Pair[]; added: SnapshotElement[]; removed: SnapshotElement[] } {
  const matched: { old: number; now: number }[] = [];
  const oldLeft = new Set(before.keys());
  const nowLeft = new Set(after.keys());
  const oldByKey = new Map(before.map((element, index) => [element.key, index]));
  const take = (old: number, now: number) => {
    matched.push({ old, now });
    oldLeft.delete(old);
    nowLeft.delete(now);
  };

  for (const now of [...nowLeft]) {
    const old = oldByKey.get(after[now]!.key);
    if (old !== undefined && oldLeft.has(old) && isNamed(after[now]!.key)) take(old, now);
  }

  const olds = [...oldLeft];
  const nows = [...nowLeft];
  if ((olds.length + 1) * (nows.length + 1) <= MAX_ALIGNMENT_CELLS) {
    for (const [old, now] of alignByText(olds, nows, before, after)) take(old, now);
  }

  const oldByText = new Map<string, number[]>();
  for (const old of oldLeft) {
    const text = before[old]!.text;
    oldByText.set(text, [...(oldByText.get(text) ?? []), old]);
  }
  const position = (index: number, length: number) => index / Math.max(1, length - 1);
  for (const now of [...nowLeft]) {
    const candidates = (oldByText.get(after[now]!.text) ?? []).filter((old) => oldLeft.has(old));
    if (!candidates.length) continue;
    const here = position(now, after.length);
    const nearest = candidates.reduce((best, old) =>
      Math.abs(position(old, before.length) - here) < Math.abs(position(best, before.length) - here) ? old : best,
    );
    take(nearest, now);
  }

  for (const now of [...nowLeft]) {
    const old = oldByKey.get(after[now]!.key);
    if (old !== undefined && oldLeft.has(old)) take(old, now);
  }

  matched.sort((a, b) => a.now - b.now);
  return {
    pairs: matched.map(({ old, now }) => ({ old: before[old]!, now: after[now]! })),
    added: [...nowLeft].sort((a, b) => a - b).map((now) => after[now]!),
    removed: [...oldLeft].sort((a, b) => a - b).map((old) => before[old]!),
  };
}

/** Longest common subsequence of the two lists' texts, as [old, now] index pairs in page order. */
function alignByText(
  olds: number[],
  nows: number[],
  before: SnapshotElement[],
  after: SnapshotElement[],
): [number, number][] {
  const columns = nows.length + 1;
  const table = new Uint16Array((olds.length + 1) * columns);
  for (let i = olds.length - 1; i >= 0; i--) {
    for (let j = nows.length - 1; j >= 0; j--) {
      table[i * columns + j] =
        before[olds[i]!]!.text === after[nows[j]!]!.text
          ? table[(i + 1) * columns + j + 1]! + 1
          : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < olds.length && j < nows.length) {
    if (before[olds[i]!]!.text === after[nows[j]!]!.text) {
      pairs.push([olds[i]!, nows[j]!]);
      i++;
      j++;
    } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

export function hasFailures(diff: DiffResult, strict: boolean): boolean {
  if (diff.changed.length || diff.overLimit.length) return true;
  return (
    strict &&
    (diff.added.length > 0 || diff.removed.length > 0 || diff.missingPages.length > 0 || diff.missingWidths.length > 0)
  );
}

function note(page: string, element: SnapshotElement, widths: number[]): ElementNote {
  return { page, key: element.key, text: element.text, widths };
}
