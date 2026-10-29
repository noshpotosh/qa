import { test } from "node:test";
import assert from "node:assert/strict";
import { runProcess, processEnvironment } from "../scripts/work-process.mjs";
import { profileText } from "../scripts/work-sandbox.mjs";
import { fixture } from "./fixtures/work-repo.mjs";
import { createRun } from "../scripts/work-store.mjs";
import path from "node:path";
import fs from "node:fs";

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
  assert(text.includes('project_doc_max_bytes = 0'));
  assert(text.includes('project_doc_fallback_filenames = []'));
  assert(text.includes('"**/AGENTS.override.md" = "deny"'));
  assert(!text.includes("danger-full-access"));
});
test("toolchain admission protects launchers and admits only the npm package with owned temporary storage", (t) => {
  const f = fixture(t), { state, directory } = createRun(f.root, f.snapshot, f.config);
  const tools = path.join(f.root, "toolchain"), bin = path.join(tools, "bin"), npm = path.join(tools, "lib/node_modules/npm");
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(path.join(npm, "bin"), { recursive: true });
  fs.writeFileSync(path.join(npm, "package.json"), JSON.stringify({ name: "npm" }));
  fs.writeFileSync(path.join(npm, "bin/npm-cli.js"), "// fixture runtime");
  const executable = path.join(bin, "npm"); fs.symlinkSync(path.join(npm, "bin/npm-cli.js"), executable);
  const previous = process.env.PATH; process.env.PATH = bin;
  t.after(() => { process.env.PATH = previous; });
  const text = profileText({ workspace: state.worktree, directory, common: path.dirname(path.dirname(directory)) });
  assert(text.includes(JSON.stringify(path.join(directory, "scratch/bin")) + ' = "read"'));
  const canonicalNpm = fs.realpathSync(npm);
  assert(fs.readFileSync(path.join(directory, "scratch/bin/npm"), "utf8").includes(path.join(canonicalNpm, "bin/npm-cli.js")));
  assert(text.includes(JSON.stringify(canonicalNpm) + ' = "read"'));
  assert(!text.includes(JSON.stringify(tools) + ' = "read"'));
  assert(text.includes('"TMPDIR" = ' + JSON.stringify(path.join(directory, "scratch"))));
});
