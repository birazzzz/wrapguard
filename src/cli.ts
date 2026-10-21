#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, ConfigError, DEFAULTS, loadConfig } from "./config.ts";
import { diffSnapshots, hasFailures } from "./diff.ts";
import { color, formatMarkdown, formatReport } from "./report.ts";
import { scan } from "./scan.ts";
import { readSnapshot, writeSnapshot } from "./snapshot.ts";

const HELP = `wrapguard: catch text that starts wrapping onto more lines.

Usage
  wrapguard init              Create wrapguard.config.json
  wrapguard update            Scan your pages and save the line counts
  wrapguard check             Scan again and fail if any text wraps differently

Options
  -c, --config <file>         Config file (default: wrapguard.config.{js,mjs,json})
      --strict                check: also fail on new or missing text and pages
      --verbose               check: list new, missing and reworded text too
      --json                  check: print the result as JSON
      --markdown              check: print the result as Markdown, e.g. for a CI comment
  -h, --help
  -v, --version

Built by FynePDF · https://fynepdf.com`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      strict: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      markdown: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return 0;
  }
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  const cwd = process.cwd();
  switch (command) {
    case "init":
      return init(cwd);
    case "update": {
      const config = await loadConfig(cwd, values.config);
      const snapshot = await scan(config, progress());
      const path = resolve(config.root, config.snapshot);
      await writeSnapshot(path, snapshot);
      const count = Object.values(snapshot.pages).reduce((sum, elements) => sum + elements.length, 0);
      console.log(color.green(`✓ Saved ${count} text elements from ${config.pages.length} page(s) to ${config.snapshot}`));
      return 0;
    }
    case "check": {
      const config = await loadConfig(cwd, values.config);
      const path = resolve(config.root, config.snapshot);
      if (!existsSync(path)) {
        console.error(`No snapshot at ${config.snapshot} yet. Run \`wrapguard update\` first and commit the file.`);
        return 2;
      }
      const baseline = await readSnapshot(path);
      const plain = values.json || values.markdown;
      const current = await scan(config, plain ? undefined : progress());
      const diff = diffSnapshots(baseline, current);
      const size = { pages: config.pages.length, widths: config.widths.length, strict: values.strict };
      if (values.json) console.log(JSON.stringify(diff, null, 2));
      else if (values.markdown) console.log(formatMarkdown(diff, size));
      else console.log(formatReport(diff, { ...size, verbose: values.verbose }));
      return hasFailures(diff, values.strict) ? 1 : 0;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

async function init(cwd: string): Promise<number> {
  const existing = CONFIG_FILES.find((name) => existsSync(resolve(cwd, name)));
  if (existing) {
    console.error(`${existing} already exists.`);
    return 1;
  }
  const config = { baseUrl: "http://localhost:3000", pages: ["/"], widths: DEFAULTS.widths };
  await writeFile(resolve(cwd, "wrapguard.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(
    [
      color.green("✓ Created wrapguard.config.json"),
      "",
      "Next:",
      "  1. Set baseUrl and the pages you care about",
      "  2. Start your site, then run: wrapguard update",
      "  3. Commit wrapguard.snap.json and run `wrapguard check` in CI",
    ].join("\n"),
  );
  return 0;
}

function progress() {
  if (!process.stderr.isTTY) return undefined;
  return ({ page, width, done, total }: { page: string; width: number; done: number; total: number }) => {
    const line = `Scanning ${done}/${total}  ${page} @ ${width}px`;
    process.stderr.write(`\r${line.padEnd(process.stderr.columns ? process.stderr.columns - 1 : 60)}`);
    if (done === total) process.stderr.write("\r\x1b[K");
  };
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(error instanceof ConfigError ? message : `wrapguard: ${message}`));
    process.exitCode = 2;
  },
);
