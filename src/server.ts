import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { ResolvedConfig } from "./config.ts";

export interface RunningServer {
  /** True when wrapguard started it, false when it reused one already running. */
  started: boolean;
  stop(): Promise<void>;
}

const KEEP_OUTPUT_LINES = 30;

/** Answers any HTTP request below 500: a 404 still means the server is up. */
export async function isUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Starts the configured server and waits until its address answers. Reuses a
 * server that's already answering unless `reuseExisting` is false.
 */
export async function startServer(
  server: NonNullable<ResolvedConfig["server"]>,
  root: string,
  log: (message: string) => void,
): Promise<RunningServer> {
  if (server.reuseExisting && (await isUp(server.url))) {
    log(`Using the server already running at ${server.url}`);
    return { started: false, stop: async () => {} };
  }

  log(`Starting your site: ${server.command}`);
  const child = spawn(server.command, {
    shell: true,
    cwd: resolve(root, server.cwd),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group on macOS and Linux, so stopping it also stops what it started.
    detached: process.platform !== "win32",
  });

  const output: string[] = [];
  const keep = (chunk: Buffer) => {
    output.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean));
    output.splice(0, Math.max(0, output.length - KEEP_OUTPUT_LINES));
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exitCode: number | null = null;
  const exited = new Promise<void>((done) => {
    child.once("exit", (code, signal) => {
      exitCode = code ?? (signal ? 128 : 1);
      done();
    });
  });

  // If wrapguard itself is stopped or crashes, don't leave the server running.
  const killOnExit = () => kill(child, true);
  process.once("exit", killOnExit);

  const stop = async () => {
    process.off("exit", killOnExit);
    if (exitCode !== null) return;
    kill(child, false);
    const timer = setTimeout(() => kill(child, true), 5_000);
    await exited;
    clearTimeout(timer);
  };

  const recent = () => (output.length ? `\nLast output from \`${server.command}\`:\n  ${output.join("\n  ")}` : "");
  const deadline = Date.now() + server.timeout;
  while (!(await isUp(server.url))) {
    if (exitCode !== null) {
      process.off("exit", killOnExit);
      throw new Error(`\`${server.command}\` exited with code ${exitCode} before ${server.url} answered.${recent()}`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`${server.url} didn't answer within ${Math.round(server.timeout / 1000)}s of starting \`${server.command}\`.${recent()}`);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  log(`Your site is up at ${server.url}`);
  return { started: true, stop };
}

function kill(child: ChildProcess, force: boolean) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch {
    // Already gone.
  }
}
