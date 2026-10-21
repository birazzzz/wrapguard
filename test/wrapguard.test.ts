import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveConfig, type LineRule } from "../src/config.ts";
import { diffSnapshots } from "../src/diff.ts";
import { scan } from "../src/scan.ts";
import { readSnapshot, serializeSnapshot, type Snapshot } from "../src/snapshot.ts";

const fixture = fileURLToPath(new URL("./fixtures/page.html", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = promisify(execFile);

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "wrapguard-"));
  await copyFile(fixture, join(dir, "page.html"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(widths = [800, 400], rules?: LineRule[]) {
  return resolveConfig({ baseUrl: pathToFileURL(`${dir}/`).href, pages: ["page.html"], widths, rules }, dir);
}

function lines(snapshot: Snapshot, key: string) {
  const element = snapshot.pages["page.html"]!.find((item) => item.key === key);
  assert.ok(element, `no element "${key}" in ${snapshot.pages["page.html"]!.map((item) => item.key).join(", ")}`);
  return element.lines;
}

describe("scan", () => {
  let snapshot: Snapshot;
  before(async () => {
    snapshot = (await scan(config())).snapshot;
  });

  test("counts lines per width", () => {
    assert.deepEqual(lines(snapshot, "main > h1"), { 800: 1, 400: 2 });
    assert.deepEqual(lines(snapshot, "#lead"), { 800: 2, 400: 3 });
  });

  test("keeps mixed font sizes on one line", () => {
    assert.deepEqual(lines(snapshot, "mixed"), { 800: 1, 400: 2 });
  });

  test("counts a badge beside a wrapped title as part of its lines", () => {
    assert.deepEqual(lines(snapshot, "main > a"), { 800: 2, 400: 2 });
  });

  test("adds up blocks stacked on top of each other", () => {
    assert.deepEqual(lines(snapshot, "main > a[2]"), { 800: 2, 400: 2 });
  });

  test("measures text inside a card link once, by its own heading and paragraph", () => {
    assert.deepEqual(lines(snapshot, "main > h3"), { 800: 1, 400: 1 });
    const card = snapshot.pages["page.html"]!.find((item) => item.key === "main > a[3]");
    assert.equal(card?.text, "$7");
  });

  test("counts an inline link as part of its paragraph", () => {
    // "Read the terms of use first" is 27 characters: 2 lines at 20ch, 3 at 10ch.
    assert.deepEqual(lines(snapshot, "inline-link"), { 800: 2, 400: 3 });
    const keys = snapshot.pages["page.html"]!.map((item) => item.key);
    assert.ok(!keys.some((key) => key.startsWith("inline-link >")));
  });

  test("ignores icons and screen-reader-only text", () => {
    assert.deepEqual(lines(snapshot, "menu-button"), { 800: 1, 400: 1 });
  });

  test("skips hidden and ignored text", () => {
    const texts = snapshot.pages["page.html"]!.map((item) => item.text);
    assert.ok(!texts.some((text) => text.startsWith("Hidden")));
    assert.ok(!texts.some((text) => text.startsWith("Ignored")));
  });

  test("measures a link inside a list item once", () => {
    const keys = snapshot.pages["page.html"]!.map((item) => item.key);
    assert.ok(keys.includes("header > nav > ul > li"));
    assert.ok(keys.includes("header > nav > ul > li[2]"));
    assert.ok(!keys.some((key) => key.startsWith("header") && key.endsWith("> a")));
  });

  test("numbers repeated sections and leaves out widths where text is hidden", () => {
    assert.deepEqual(lines(snapshot, "main > section[2] > h2"), { 800: 1, 400: 1 });
    assert.deepEqual(lines(snapshot, "main > section[2] > p"), { 800: 1 });
  });

  test("snapshot file round-trips", async () => {
    const path = join(dir, "roundtrip.json");
    await writeFile(path, serializeSnapshot(snapshot));
    const read = await readSnapshot(path);
    assert.deepEqual(diffSnapshots(snapshot, read).changed, []);
    assert.deepEqual(read.pages, JSON.parse(JSON.stringify(snapshot.pages)));
  });
});

describe("diff", () => {
  test("reports a heading that wraps onto more lines", async () => {
    const baseline = (await scan(config())).snapshot;
    const page = join(dir, "page.html");
    const original = await readFile(page, "utf8");
    await writeFile(page, original.replace("Short title", "A much longer title"));
    try {
      // "A much longer title" still fits 20ch, but needs three lines at 10ch.
      const diff = diffSnapshots(baseline, (await scan(config())).snapshot);
      assert.deepEqual(
        diff.changed.map(({ key, changes }) => ({ key, changes })),
        [{ key: "main > h1", changes: [{ width: 400, before: 2, after: 3 }] }],
      );
      assert.deepEqual(diff.textOnly, []);
    } finally {
      await writeFile(page, original);
    }
  });
});

describe("line limits", () => {
  test("reports text over its limit at the widths where it goes over", async () => {
    const { overLimit } = await scan(config([800, 400], [{ selector: "h1", maxLines: 1 }]));
    assert.deepEqual(overLimit, [
      { page: "page.html", key: "main > h1", text: "Short title", selector: "h1", maxLines: 1, widths: [{ width: 400, lines: 2 }] },
    ]);
  });

  test("measures the full text of a link inside a paragraph", async () => {
    // "Read the terms of use first" breaks inside "terms of use" at both 20ch and 10ch.
    const { overLimit } = await scan(config([800, 400], [{ selector: "[data-wrapguard=inline-link] a", maxLines: 1 }]));
    assert.deepEqual(
      overLimit.map(({ key, text, widths }) => ({ key, text, widths })),
      [{ key: "inline-link > a", text: "terms of use", widths: [{ width: 800, lines: 2 }, { width: 400, lines: 2 }] }],
    );
  });

  test("only checks a rule at its own widths, and passes text within the limit", async () => {
    const { overLimit } = await scan(
      config([800, 400], [
        { selector: "h1", maxLines: 1, widths: [800] },
        { selector: "header li", maxLines: 1 },
      ]),
    );
    assert.deepEqual(overLimit, []);
  });

  test("rejects rules that can't work", async () => {
    assert.throws(() => config([800, 400], [{ selector: "h1", maxLines: 0 }]), /rules\[0\] needs `maxLines`/);
    assert.throws(() => config([800, 400], [{ selector: " ", maxLines: 2 }]), /rules\[0\] needs a `selector`/);
    assert.throws(() => config([800, 400], [{ selector: "h1", maxLines: 2, widths: [1024] }]), /rules\[0\]\.widths/);
    await assert.rejects(scan(config([800], [{ selector: "h1[", maxLines: 2 }])), /rules\[0\] has a selector the browser can't read/);
  });
});

describe("cli", () => {
  test("check runs the line limits on their own when there's no snapshot yet", async () => {
    const write = (name: string, rules: LineRule[]) =>
      writeFile(
        join(dir, name),
        JSON.stringify({ baseUrl: pathToFileURL(`${dir}/`).href, pages: ["page.html"], widths: [800, 400], snapshot: "none.snap.json", rules }),
      );
    await write("strict-rules.json", [{ selector: "h1", maxLines: 1 }]);
    await write("loose-rules.json", [{ selector: "h1", maxLines: 2 }]);
    const node = (args: string[]) => run(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });

    await assert.rejects(node(["check", "-c", "strict-rules.json"]), (error: { code: number; stdout: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /No snapshot yet, so only line limits were checked/);
      assert.match(error.stdout, /h1  max 1 line\n    page\.html  main > h1  "Short title"\n      400px 2 lines/);
      assert.match(error.stdout, /✗ 1 piece of text goes over its line limit/);
      return true;
    });
    const passed = await node(["check", "-c", "loose-rules.json"]);
    assert.match(passed.stdout, /✓ All text is within its line limits/);

    // update saves anyway, and lists what check will fail on, one item per line.
    const updated = await node(["update", "-c", "strict-rules.json"]);
    assert.match(updated.stdout, /\nLine limits\n  h1  max 1 line\n    page\.html  main > h1  "Short title"\n      400px 2 lines\n/);
    assert.match(updated.stdout, /⚠ 1 piece\(s\) of text go over their line limit/);
  });

  test("update then check passes, and fails after a wrap change", async () => {
    await writeFile(
      join(dir, "wrapguard.config.json"),
      JSON.stringify({ baseUrl: pathToFileURL(`${dir}/`).href, pages: ["page.html"], widths: [800, 400] }),
    );
    const node = (args: string[]) => run(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });

    await node(["update"]);
    const passed = await node(["check"]);
    assert.match(passed.stdout, /No wrapping changes/);

    const page = join(dir, "page.html");
    const original = await readFile(page, "utf8");
    await writeFile(page, original.replace("Short title", "A title long enough to wrap"));
    try {
      await assert.rejects(node(["check"]), (error: { code: number; stdout: string }) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /main > h1/);
        assert.match(error.stdout, /800px 1 → 2/);
        return true;
      });
    } finally {
      await writeFile(page, original);
    }
  });
});
