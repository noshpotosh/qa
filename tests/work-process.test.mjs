import { test } from "node:test";
import assert from "node:assert/strict";
import { runProcess, processEnvironment } from "../scripts/work-process.mjs";
import { profileText } from "../scripts/work-sandbox.mjs";
import { fixture } from "./fixtures/work-repo.mjs";
import { createRun } from "../scripts/work-store.mjs";
import path from "node:path";

test("process wrapper excludes provider/publication tokens and never invokes a shell", async () => {
  assert(!Object.keys(processEnvironment()).some((k) => /TOKEN|KEY/.test(k)));
  const literal = "$(touch /tmp/qa-must-not-execute)";
  const result = await runProcess([process.execPath, "-e", "process.stdout.write(process.argv[1])", literal], { timeoutMs: 10000 });
  assert.equal(result.status, "passed");
  assert.equal(result.output, literal);
});
test("process wrapper enforces a deadline and distinguishes actual command failure", async () => {
  const timeout = await runProcess([process.execPath, "-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 });
  assert.equal(timeout.reason, "timeout");
  const failed = await runProcess([process.execPath, "-e", "process.exit(7)"], { timeoutMs: 10000 });
  assert.equal(failed.code, 7);
  assert.equal(failed.status, "failed");
});
test("generated permission profiles isolate the controller and credential stores", (t) => {
  const f = fixture(t), { state, directory } = createRun(f.root, f.snapshot, f.config);
  const text = profileText({ workspace: state.worktree, directory, common: path.dirname(path.dirname(directory)) });
  assert(text.includes(JSON.stringify(directory) + ' = "deny"'));
  assert(text.includes('"apps" = false'));
  assert(text.includes('"multi_agent" = false'));
  assert(text.includes('"enabled" = false'));
  assert(!text.includes("danger-full-access"));
});
