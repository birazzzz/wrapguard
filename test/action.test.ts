import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DiffResult } from "../src/diff.ts";
import { upsertComment } from "../src/github.ts";
import { COMMENT_MARKER, formatMarkdown } from "../src/report.ts";

const run = promisify(execFile);
const actionEntry = fileURLToPath(new URL("../src/action.ts", import.meta.url));
const selfTest = fileURLToPath(new URL("./action/", import.meta.url));

function emptyDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    hasBaseline: true,
    changed: [],
    overLimit: [],
    added: [],
    removed: [],
    textOnly: [],
    moved: [],
    missingPages: [],
    missingWidths: [],
    elementCount: 3,
    ...overrides,
  };
}

describe("markdown report", () => {
  test("lists wrap changes in a table and escapes page text", () => {
    const markdown = formatMarkdown(
      emptyDiff({
        changed: [
          {
            page: "/pricing",
            key: "main > h1",
            text: "Plans | *Pro* <b>",
            changes: [
              { width: 768, before: 1, after: 2 },
              { width: 390, before: 2, after: 3 },
            ],
          },
        ],
      }),
      { pages: 1, widths: 2 },
    );
    assert.ok(markdown.startsWith(COMMENT_MARKER));
    assert.match(markdown, /### ✗ 1 piece of text now wraps differently/);
    assert.match(markdown, /\| `\/pricing` \| `main > h1` \| Plans \\\| \\\*Pro\\\* &lt;b&gt; \| 768px 1 → \*\*2\*\*<br>390px 2 → \*\*3\*\* \|/);
  });

  test("says so when nothing changed, and when strict mode fails on new text", () => {
    assert.match(formatMarkdown(emptyDiff(), { pages: 1, widths: 2 }), /### ✓ No wrapping changes/);
    const added = emptyDiff({ added: [{ page: "/", key: "main > p", text: "New", widths: [] }] });
    assert.match(formatMarkdown(added, { pages: 1, widths: 2 }), /### ✓ No wrapping changes[\s\S]*<details><summary>Also 1 new/);
    assert.match(formatMarkdown(added, { pages: 1, widths: 2, strict: true }), /### ✗ No wrapping changes, but text or pages were added or removed/);
  });

  test("lists line limit violations next to wrap changes", () => {
    const markdown = formatMarkdown(
      emptyDiff({
        changed: [{ page: "/", key: "main > p", text: "Lead", changes: [{ width: 390, before: 2, after: 3 }] }],
        overLimit: [
          { page: "/", key: "header > button", text: "Start free trial", selector: "button", maxLines: 1, widths: [{ width: 390, lines: 2 }] },
        ],
      }),
      { pages: 1, widths: 2, rules: 1 },
    );
    assert.match(markdown, /### ✗ 1 piece of text now wraps differently · 1 piece of text goes over its line limit/);
    assert.match(markdown, /\*\*Wrapping changes\*\*/);
    assert.match(markdown, /\| `button` max 1 \| `\/` \| `header > button` \| Start free trial \| 390px \*\*2\*\* \|/);
  });

  test("says when only line limits were checked", () => {
    const markdown = formatMarkdown(emptyDiff({ hasBaseline: false }), { pages: 1, widths: 2, rules: 2 });
    assert.match(markdown, /### ✓ All text is within its line limits\n\nChecked 1 page at 2 widths, 3 text elements\. No snapshot yet/);
  });

  test("keeps long results to 50 rows", () => {
    const changed = Array.from({ length: 60 }, (_, index) => ({
      page: "/",
      key: `p[${index}]`,
      text: "Text",
      changes: [{ width: 390, before: 1, after: 2 }],
    }));
    const markdown = formatMarkdown(emptyDiff({ changed }), { pages: 1, widths: 1 });
    assert.equal(markdown.split("\n").filter((line) => line.startsWith("| `/`")).length, 50);
    assert.match(markdown, /…and 10 more/);
  });
});

/** In-memory stand-in for the GitHub issue comments API. */
function fakeGitHub(initial: { id: number; body: string }[] = []) {
  const comments = [...initial];
  const calls: string[] = [];
  let nextId = 100;
  const handle = (method: string, url: string, body?: string): { status: number; json: unknown } => {
    calls.push(`${method} ${url}`);
    const path = new URL(url, "http://x").pathname;
    if (method === "GET" && path === "/repos/o/r/issues/7/comments") return { status: 200, json: comments };
    if (method === "POST" && path === "/repos/o/r/issues/7/comments") {
      const comment = { id: nextId++, body: JSON.parse(body!).body };
      comments.push(comment);
      return { status: 201, json: comment };
    }
    const patch = path.match(/^\/repos\/o\/r\/issues\/comments\/(\d+)$/);
    if (method === "PATCH" && patch) {
      const comment = comments.find((item) => item.id === Number(patch[1]));
      if (!comment) return { status: 404, json: {} };
      comment.body = JSON.parse(body!).body;
      return { status: 200, json: comment };
    }
    return { status: 404, json: {} };
  };
  const fetch = (async (url: string, init: RequestInit) => {
    const { status, json } = handle(init.method ?? "GET", url.replace("https://api.test", ""), init.body as string);
    return new Response(JSON.stringify(json), { status });
  }) as typeof globalThis.fetch;
  return { comments, calls, handle, fetch };
}

describe("pull request comment", () => {
  const target = (fetch: typeof globalThis.fetch) => ({ apiUrl: "https://api.test", repository: "o/r", token: "t", issueNumber: 7, fetch });

  test("posts nothing on a clean run when there is no comment yet", async () => {
    const github = fakeGitHub();
    assert.equal(await upsertComment(target(github.fetch), `${COMMENT_MARKER}\nok`, false), "skipped");
    assert.deepEqual(github.comments, []);
  });

  test("creates the comment on failure, then updates the same one", async () => {
    const github = fakeGitHub([{ id: 1, body: "Someone else's comment" }]);
    assert.equal(await upsertComment(target(github.fetch), `${COMMENT_MARKER}\nfailed`, true), "created");
    assert.equal(await upsertComment(target(github.fetch), `${COMMENT_MARKER}\nfixed`, false), "updated");
    assert.equal(await upsertComment(target(github.fetch), `${COMMENT_MARKER}\nfixed`, false), "unchanged");
    assert.deepEqual(
      github.comments.map((comment) => comment.body),
      ["Someone else's comment", `${COMMENT_MARKER}\nfixed`],
    );
  });

  test("reports the HTTP status when GitHub refuses", async () => {
    const fetch = (async () => new Response("{}", { status: 403 })) as typeof globalThis.fetch;
    await assert.rejects(upsertComment(target(fetch), "x", true), (error: { status: number }) => error.status === 403);
  });
});

describe("action entry point", () => {
  let dir: string;
  let pages: Server;
  let api: Server;
  const github = fakeGitHub();

  const listen = async (server: Server) => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return (server.address() as AddressInfo).port;
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "wrapguard-action-"));
    await copyFile(join(selfTest, "index.html"), join(dir, "index.html"));
    await copyFile(join(selfTest, "wrapguard.snap.json"), join(dir, "wrapguard.snap.json"));
    pages = createServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(await readFile(join(dir, "index.html")));
    });
    api = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { status, json } = github.handle(req.method!, req.url!, body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      });
    });
    const pagePort = await listen(pages);
    const apiPort = await listen(api);
    await writeFile(
      join(dir, "wrapguard.config.json"),
      JSON.stringify({ baseUrl: `http://127.0.0.1:${pagePort}`, pages: ["/"], widths: [800, 400] }),
    );
    await writeFile(join(dir, "event.json"), JSON.stringify({ pull_request: { number: 7 } }));
    process.env.WRAPGUARD_TEST_API = `http://127.0.0.1:${apiPort}`;
  });

  after(async () => {
    pages.close();
    api.close();
    await rm(dir, { recursive: true, force: true });
  });

  const runAction = async () => {
    const output = join(dir, "output.txt");
    const summary = join(dir, "summary.md");
    await writeFile(output, "");
    await writeFile(summary, "");
    const env = {
      ...process.env,
      INPUT_WORKING_DIRECTORY: ".",
      INPUT_COMMENT: "true",
      INPUT_FAIL_ON_CHANGE: "true",
      INPUT_STRICT: "false",
      INPUT_GITHUB_TOKEN: "test-token",
      GITHUB_API_URL: process.env.WRAPGUARD_TEST_API,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_PATH: join(dir, "event.json"),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      NO_COLOR: "1",
    };
    const result = await run(process.execPath, [actionEntry], { cwd: dir, env }).then(
      ({ stdout }) => ({ code: 0, stdout }),
      (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }),
    );
    return { ...result, output: await readFile(output, "utf8"), summary: await readFile(summary, "utf8") };
  };

  test("fails and comments when a title wraps, then updates the comment once it's fixed", async () => {
    const page = join(dir, "index.html");
    const original = await readFile(page, "utf8");
    await writeFile(page, original.replace("Short title", "A much longer title"));
    const failed = await runAction();
    assert.equal(failed.code, 1, failed.stdout);
    assert.match(failed.output, /changed=1\n/);
    assert.match(failed.output, /failed=true\n/);
    assert.match(failed.summary, /`title`.*400px 2 → \*\*3\*\*/);
    assert.match(failed.stdout, /::error::1 piece\(s\) of text wrap differently/);
    assert.equal(github.comments.length, 1);
    assert.match(github.comments[0]!.body, /### ✗ 1 piece of text now wraps differently/);

    await writeFile(page, original);
    const fixed = await runAction();
    assert.equal(fixed.code, 0, fixed.stdout);
    assert.match(fixed.output, /changed=0\n/);
    assert.equal(github.comments.length, 1);
    assert.match(github.comments[0]!.body, /### ✓ No wrapping changes/);
  });
});
