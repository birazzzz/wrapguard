import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffSnapshots } from "../src/diff.ts";
import type { Snapshot, SnapshotElement } from "../src/snapshot.ts";

const el = (key: string, text: string, lines: number): SnapshotElement => ({ key, text, lines: { 800: lines } });
const snapshot = (elements: SnapshotElement[]): Snapshot => ({ version: 1, widths: [800], pages: { "/": elements } });
const diff = (before: SnapshotElement[], after: SnapshotElement[]) => diffSnapshots(snapshot(before), snapshot(after));

describe("matching elements across snapshots", () => {
  const pricing = [el("main > section > h2", "Pricing", 1), el("main > section > p", "Plans for everyone", 2)];

  test("a section added above others only adds its own text", () => {
    const result = diff(pricing, [
      el("main > section > h2", "Open source", 1),
      el("main > section > p", "A new tool", 2),
      el("main > section[2] > h2", "Pricing", 1),
      el("main > section[2] > p", "Plans for everyone", 2),
    ]);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.textOnly, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(
      result.added.map((note) => note.text),
      ["Open source", "A new tool"],
    );
    assert.deepEqual(
      result.moved.map(({ from, to }) => `${from} → ${to}`),
      ["main > section > h2 → main > section[2] > h2", "main > section > p → main > section[2] > p"],
    );
  });

  test("moved text that also wraps differently is still a change", () => {
    const result = diff(pricing, [
      el("main > section > h2", "Open source", 1),
      el("main > section[2] > h2", "Pricing", 1),
      el("main > section[2] > p", "Plans for everyone", 3),
    ]);
    assert.deepEqual(
      result.changed.map(({ key, changes }) => ({ key, changes })),
      [{ key: "main > section[2] > p", changes: [{ width: 800, before: 2, after: 3 }] }],
    );
  });

  test("repeated text pairs in page order after an insertion", () => {
    const list = (offset: number) => [1, 2, 3].map((lines, index) => el(`ul > li[${index + 1 + offset}]`, "Learn more", lines));
    const result = diff(list(0), [el("ul > li", "New item", 1), ...list(1)]);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(
      result.added.map((note) => note.text),
      ["New item"],
    );
  });

  test("a section removed from the middle only removes its own text", () => {
    const result = diff(
      [el("main > h1", "Title", 1), el("main > section > p", "Gone soon", 2), el("main > section[2] > p", "Stays", 1)],
      [el("main > h1", "Title", 1), el("main > section > p", "Stays", 1)],
    );
    assert.deepEqual(result.changed, []);
    assert.deepEqual(
      result.removed.map((note) => note.text),
      ["Gone soon"],
    );
  });

  test("a copy edit in place is compared with the text it replaced", () => {
    const result = diff(pricing, [el("main > section > h2", "Pricing", 1), el("main > section > p", "Plans for every team and budget", 3)]);
    assert.deepEqual(
      result.changed.map(({ key, changes }) => ({ key, changes })),
      [{ key: "main > section > p", changes: [{ width: 800, before: 2, after: 3 }] }],
    );
    assert.deepEqual(result.moved, []);
  });

  test("named elements keep their name even when another element had their new text", () => {
    const result = diff([el("title", "Alpha", 1), el("main > p", "Beta", 1)], [el("title", "Beta", 2), el("main > p", "Gamma", 1)]);
    assert.deepEqual(
      result.changed.map(({ key }) => key),
      ["title"],
    );
    assert.deepEqual(
      result.textOnly.map(({ key, before, after }) => `${key}: ${before} → ${after}`),
      ["main > p: Beta → Gamma"],
    );
    assert.deepEqual(result.moved, []);
  });

  test("text that jumps past other content is matched as moved", () => {
    const result = diff(
      [el("main > h2", "Move me", 1), el("main > p", "One", 1), el("main > p[2]", "Two", 1)],
      [el("main > p", "One", 1), el("main > p[2]", "Two", 1), el("main > h2", "Move me", 1)],
    );
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
  });
});
