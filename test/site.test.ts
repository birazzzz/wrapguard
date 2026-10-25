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
import { resolveConfig } from "../src/config.ts";
import { scan } from "../src/scan.ts";
import { isUp, startServer } from "../src/server.ts";
import { resolvePages } from "../src/site.ts";
import { pagesFromSitemap, pattern } from "../src/sitemap.ts";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/page.html", import.meta.url));
const node = `"${process.execPath}"`;

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "wrapguard-site-"));
  await copyFile(fixture, join(dir, "page.html"));
  // A tiny site whose sitemap names the production host, like most real sitemaps.
  await writeFile(
    join(dir, "serve.mjs"),
    `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const sitemap = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  '<url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>';
createServer((req, res) => {
  if (req.url === "/sitemap.xml") return res.writeHead(200, { "content-type": "application/xml" }).end(sitemap);
  res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(new URL("./page.html", import.meta.url)));
}).listen(Number(process.argv[2]), "127.0.0.1", () => console.log("listening"));
`,
  );
  await writeFile(join(dir, "exit.mjs"), `console.log("boom: missing env"); process.exit(3);`);
  await writeFile(join(dir, "idle.mjs"), `console.log("still compiling"); setInterval(() => {}, 1000);`);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

async function eventually(check: () => Promise<boolean>, timeout = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

const server = (command: string, url: string, extra: { timeout?: number; reuseExisting?: boolean } = {}) => ({
  command,
  url,
  timeout: extra.timeout ?? 15_000,
  reuseExisting: extra.reuseExisting ?? true,
  cwd: ".",
});
const quiet = () => {};

describe("path patterns", () => {
  test("* stays in one segment, ** crosses segments, the rest is literal", () => {
    assert.ok(pattern("/blog/**")("/blog/2026/hello"));
    assert.ok(!pattern("/blog/**")("/blogs"));
    assert.ok(pattern("/tools/*")("/tools/compress"));
    assert.ok(!pattern("/tools/*")("/tools/compress/help"));
    assert.ok(pattern("/pricing")("/pricing"));
    assert.ok(!pattern("/a.b")("/axb"));
  });
});

describe("sitemap", () => {
  const sitemaps: Record<string, string> = {
    "http://localhost:3000/sitemap.xml": `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
      </sitemapindex>`,
    "http://localhost:3000/sitemap-pages.xml": `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com</loc></url>
        <url><loc> https://example.com/pricing </loc></url>
        <url><loc>https://example.com/search?q=a&amp;b=1</loc></url>
        <url><loc><![CDATA[https://example.com/tools/compress]]></loc></url>
      </urlset>`,
    "http://localhost:3000/sitemap-blog.xml": `<urlset><url><loc>https://example.com/blog/one</loc></url>
        <url><loc>https://example.com/blog/two</loc></url><url><loc>https://example.com/pricing</loc></url></urlset>`,
  };
  const requested: string[] = [];
  const fetchText = async (url: string) => {
    requested.push(url);
    const xml = sitemaps[url];
    if (!xml) throw new Error(`unexpected ${url}`);
    return xml;
  };

  test("reads a sitemap index and keeps paths, loaded from baseUrl", async () => {
    const pages = await pagesFromSitemap({ url: "/sitemap.xml" }, "http://localhost:3000", fetchText);
    assert.deepEqual(pages, ["/", "/pricing", "/search?q=a&b=1", "/tools/compress", "/blog/one", "/blog/two"]);
    assert.ok(requested.every((url) => url.startsWith("http://localhost:3000/")), requested.join(", "));
  });

  test("applies include, exclude and limit in that order", async () => {
    const pick = (options: object) => pagesFromSitemap({ url: "/sitemap.xml", ...options }, "http://localhost:3000", fetchText);
    assert.deepEqual(await pick({ include: ["/blog/**"] }), ["/blog/one", "/blog/two"]);
    assert.deepEqual(await pick({ exclude: ["/blog/**", "/search*"] }), ["/", "/pricing", "/tools/compress"]);
    assert.deepEqual(await pick({ exclude: ["/blog/**"], limit: 2 }), ["/", "/pricing"]);
  });

  test("says when the address isn't a sitemap", async () => {
    await assert.rejects(
      pagesFromSitemap({ url: "/" }, "http://localhost:3000", async () => "<html></html>"),
      /isn't a sitemap/,
    );
  });

  test("config accepts a sitemap instead of pages, and checks the options", () => {
    const config = resolveConfig({ baseUrl: "http://localhost:3000", sitemap: "/sitemap.xml" }, dir);
    assert.deepEqual(config.sitemap, { url: "/sitemap.xml" });
    assert.deepEqual(config.pages, []);
    assert.throws(() => resolveConfig({ baseUrl: "http://localhost:3000" }, dir), /needs `pages`.*or a `sitemap`/);
    assert.throws(() => resolveConfig({ baseUrl: "x", sitemap: { url: "/s.xml", limit: 0 } }, dir), /sitemap\.limit/);
    assert.throws(() => resolveConfig({ baseUrl: "x", sitemap: { url: "/s.xml", include: "/blog" } }, dir), /sitemap\.include/);
  });
});

describe("dev server", () => {
  test("config fills in the server defaults", () => {
    const config = resolveConfig({ baseUrl: "http://localhost:3000", pages: ["/"], server: { command: "npm run dev" } }, dir);
    assert.deepEqual(config.server, { command: "npm run dev", url: "http://localhost:3000", timeout: 60_000, reuseExisting: true, cwd: "." });
    assert.throws(() => resolveConfig({ baseUrl: "x", pages: ["/"], server: { command: "" } }, dir), /needs a `command`/);
  });

  test("starts the command, waits for it, and stops it again", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const running = await startServer(server(`${node} serve.mjs ${port}`, url), dir, quiet);
    assert.equal(running.started, true);
    assert.equal(await isUp(url), true);
    await running.stop();
    assert.ok(await eventually(async () => !(await isUp(url))), "server still answering after stop()");
  });

  test("uses a server that's already running instead of starting one", async () => {
    const existing = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((done) => existing.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(existing.address() as AddressInfo).port}/`;
    try {
      // The command would fail if it ran.
      const running = await startServer(server(`${node} exit.mjs`, url), dir, quiet);
      assert.equal(running.started, false);
    } finally {
      existing.close();
    }
  });

  test("reports a command that exits before the site answers, with its output", async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;
    await assert.rejects(startServer(server(`${node} exit.mjs`, url), dir, quiet), (error: Error) => {
      assert.match(error.message, /exited with code 3 before/);
      assert.match(error.message, /boom: missing env/);
      return true;
    });
  });

  test("gives up after the timeout and stops the command", async () => {
    const url = `http://127.0.0.1:${await freePort()}/`;
    await assert.rejects(startServer(server(`${node} idle.mjs`, url, { timeout: 1_500 }), dir, quiet), (error: Error) => {
      assert.match(error.message, /didn't answer within 2s/);
      assert.match(error.message, /still compiling/);
      return true;
    });
  });
});

describe("cli with server and sitemap", () => {
  test("update and check start the site, read its sitemap, and stop it", async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    await writeFile(
      join(dir, "wrapguard.config.json"),
      JSON.stringify({ baseUrl, sitemap: "/sitemap.xml", widths: [800], server: { command: `${node} serve.mjs ${port}` } }),
    );
    const wrapguard = (args: string[]) => run(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });

    const updated = await wrapguard(["update"]);
    assert.match(updated.stderr, /Starting your site/);
    assert.match(updated.stderr, /Found 2 page\(s\) in \/sitemap\.xml/);
    const snapshot = JSON.parse(await readFile(join(dir, "wrapguard.snap.json"), "utf8"));
    assert.deepEqual(Object.keys(snapshot.pages), ["/", "/about"]);
    assert.ok(await eventually(async () => !(await isUp(baseUrl))), "server still running after update");

    const checked = await wrapguard(["check"]);
    assert.match(checked.stdout, /Checked 2 pages at 1 width/);
    assert.match(checked.stdout, /✓ No wrapping changes/);
    assert.ok(await eventually(async () => !(await isUp(baseUrl))), "server still running after check");
  });
});

describe("cookies and headers", () => {
  let site: Server;
  let elsewhere: Server;
  let baseUrl: string;
  // The x-variant header of every request that reached another host.
  const elsewhereSaw: (string | undefined)[] = [];

  const listen = async (server: Server) => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  before(async () => {
    elsewhere = createServer((req, res) => {
      elsewhereSaw.push(req.headers["x-variant"] as string | undefined);
      res.writeHead(200, { "content-type": "text/css" }).end("");
    });
    const elsewhereUrl = await listen(elsewhere);
    // Its page shows what it was sent, and its sitemap needs the header.
    site = createServer((req, res) => {
      const variant = req.headers["x-variant"];
      if (req.url === "/sitemap.xml") {
        if (!variant) return res.writeHead(401).end();
        return res.writeHead(200, { "content-type": "application/xml" }).end("<urlset><url><loc>https://example.com/pricing</loc></url></urlset>");
      }
      res.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><link rel="stylesheet" href="${elsewhereUrl}/style.css">` +
          `<h1>variant ${variant ?? "none"}</h1><p>cookie ${req.headers.cookie ?? "none"}</p>`,
      );
    });
    baseUrl = await listen(site);
  });

  after(() => {
    for (const server of [site, elsewhere]) {
      server.closeAllConnections();
      server.close();
    }
  });

  test("sends them to your site, and the headers nowhere else", async () => {
    const config = resolveConfig(
      { baseUrl, pages: ["/"], widths: [800], cookies: { "hero-test": "b" }, headers: { "X-Variant": "b" } },
      dir,
    );
    const { snapshot } = await scan(config);
    assert.deepEqual(snapshot.pages["/"]!.map((element) => element.text), ["variant b", "cookie hero-test=b"]);
    assert.ok(elsewhereSaw.length > 0, "the page's stylesheet was never requested");
    assert.ok(elsewhereSaw.every((variant) => variant === undefined), "another host got the header");
  });

  test("reads the sitemap with them too", async () => {
    const config = resolveConfig({ baseUrl, sitemap: "/sitemap.xml", headers: { "x-variant": "b" } }, dir);
    assert.deepEqual(await resolvePages(config, quiet), ["/pricing"]);
    await assert.rejects(resolvePages(resolveConfig({ baseUrl, sitemap: "/sitemap.xml" }, dir), quiet), /\(401\)/);
  });

  test("config checks them", () => {
    const config = resolveConfig({ baseUrl, pages: ["/"] }, dir);
    assert.deepEqual([config.cookies, config.headers], [{}, {}]);
    assert.throws(
      () => resolveConfig({ baseUrl, pages: ["/"], cookies: { session: undefined } }, dir),
      /`cookies\.session` must be text, not undefined/,
    );
    assert.throws(() => resolveConfig({ baseUrl, pages: ["/"], headers: ["x-variant: b"] }, dir), /`headers` must map names/);
    assert.throws(
      () => resolveConfig({ baseUrl: "file:///site/", pages: ["/"], cookies: { "hero-test": "b" } }, dir),
      /http:\/\/ or https:\/\//,
    );
  });
});
