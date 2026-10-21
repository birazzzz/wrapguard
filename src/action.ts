// Entry point of the GitHub Action (action.yml). Inputs arrive as INPUT_* variables.
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { diffSnapshots, hasFailures, type DiffResult } from "./diff.ts";
import { GitHubError, upsertComment } from "./github.ts";
import { formatMarkdown, formatReport } from "./report.ts";
import { scan } from "./scan.ts";
import { withSite } from "./site.ts";
import { readSnapshot } from "./snapshot.ts";

const input = (name: string) => (process.env[`INPUT_${name}`] ?? "").trim();

async function main(): Promise<number> {
  const cwd = resolve(input("WORKING_DIRECTORY") || ".");
  const strict = input("STRICT") === "true";
  const config = await loadConfig(cwd, input("CONFIG") || undefined);
  const snapshotPath = resolve(config.root, config.snapshot);
  const hasSnapshot = existsSync(snapshotPath);
  if (!hasSnapshot && !config.rules.length) {
    console.log(
      `::error::No snapshot at ${relative(process.cwd(), snapshotPath) || config.snapshot}. Run \`npx wrapguard update\` and commit it.`,
    );
    return 2;
  }

  const baseline = hasSnapshot ? await readSnapshot(snapshotPath) : undefined;
  // The server, when configured, only runs for the scan.
  const { current, pages } = await withSite(config, console.log, async (site) => ({
    current: await scan(site),
    pages: site.pages.length,
  }));
  const diff = diffSnapshots(baseline, current.snapshot, current.overLimit);
  const failing = hasFailures(diff, strict);
  const size = { pages, widths: config.widths.length, strict, rules: config.rules.length };
  console.log(formatReport(diff, { ...size, verbose: true }));

  const markdown = formatMarkdown(diff, size);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  await setOutputs(diff, failing);
  if (input("COMMENT") !== "false") await comment(markdown, failing);

  if (diff.changed.length) {
    console.log(
      `::error::${diff.changed.length} piece(s) of text wrap differently. If intended, run \`npx wrapguard update\` and commit the snapshot.`,
    );
  }
  if (diff.overLimit.length) {
    console.log(`::error::${diff.overLimit.length} piece(s) of text go over their line limit.`);
  }
  if (failing && !diff.changed.length && !diff.overLimit.length) {
    console.log("::error::Text or pages were added or removed (strict mode).");
  }
  return failing && input("FAIL_ON_CHANGE") !== "false" ? 1 : 0;
}

async function setOutputs(diff: DiffResult, failing: boolean) {
  if (!process.env.GITHUB_OUTPUT) return;
  const outputs = {
    changed: diff.changed.length,
    "over-limit": diff.overLimit.length,
    added: diff.added.length,
    removed: diff.removed.length,
    failed: failing,
  };
  const lines = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, lines.join(""));
}

async function comment(markdown: string, failing: boolean) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath && existsSync(eventPath) ? JSON.parse(await readFile(eventPath, "utf8")) : {};
  const issueNumber: number | undefined = event.pull_request?.number;
  const token = input("GITHUB_TOKEN");
  if (!issueNumber || !token || !process.env.GITHUB_REPOSITORY) {
    console.log("Not a pull request run, so no comment. The job summary has the result.");
    return;
  }
  try {
    const result = await upsertComment(
      {
        apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
        repository: process.env.GITHUB_REPOSITORY,
        token,
        issueNumber,
      },
      markdown,
      failing,
    );
    console.log(`Pull request comment: ${result}.`);
  } catch (error) {
    // A missing permission shouldn't hide the real result, which is in the log and summary.
    const status = error instanceof GitHubError ? error.status : undefined;
    const hint =
      status === 403 || status === 404
        ? " Give the job `pull-requests: write` permission. Pull requests from forks can't be commented on with the default token."
        : "";
    console.log(`::warning::Couldn't comment on the pull request: ${error instanceof Error ? error.message : error}.${hint}`);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.log(`::error::wrapguard: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
