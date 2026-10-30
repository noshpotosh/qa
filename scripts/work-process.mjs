import fs from "node:fs";
import { spawn } from "node:child_process";

export const processEnvironment = () => Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "USER", "LANG", "CODEX_HOME"].filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
export async function runProcess(argv, { cwd, input = "", timeoutMs, signal,
  env = processEnvironment(), log, onStart = () => {}, onEnd = () => {} } = {}) {
  if (!Array.isArray(argv) || !argv.length || timeoutMs <= 0) throw Error("Invalid bounded process request");
  if (signal?.aborted) throw Error("Run interrupted");
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", bytes = 0, reason = null, timer, killTimer, fd, outcome;
  const startedAt = Date.now();
  if (log) fd = fs.openSync(log, "wx", 0o600);
  const stop = (why) => {
    if (reason) return;
    reason = why;
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    killTimer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    }, 2000);
    killTimer.unref();
  };
  const abort = () => stop("interrupted");
  signal?.addEventListener("abort", abort, { once: true });
  timer = setTimeout(() => stop("timeout"), timeoutMs);
  const consume = (data) => {
    bytes += data.length;
    if (bytes > 8 * 1024 * 1024) { stop("output-limit"); return; }
    if (fd !== undefined) fs.writeSync(fd, data);
    output = (output + data.toString("utf8")).slice(-65536);
  };
  child.stdout.on("data", consume); child.stderr.on("data", consume);
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  try {
    if (child.pid) onStart(child.pid);
    const result = await new Promise((resolve) => {
      child.on("error", (error) => resolve({ code: null, reason: error.message }));
      child.on("close", (code, signal) => resolve({ code, signal, reason }));
    });
    outcome = { ...result, startedAt, endedAt: Date.now(), status: result.reason || result.signal ? "unavailable" : result.code === 0 ? "passed" : "failed", output, bytes };
    return outcome;
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* No surviving owned children. */ }
    clearTimeout(timer); clearTimeout(killTimer);
    signal?.removeEventListener("abort", abort);
    if (fd !== undefined) fs.closeSync(fd);
    onEnd(outcome || { code: null, signal: null, reason: "process-observation-failed", startedAt, endedAt: Date.now() });
  }
}
