import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { git } from "../lib/git.mjs";
import { initialize, repairCaller } from "../lib/init.mjs";
import { inspectRepository, sourceRef, runtimeEntries } from "../lib/install.mjs";
import { packageRelease } from "../scripts/package-release.mjs";
import { diagnose } from "../scripts/doctor.mjs";

function temp(t) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "qa-adoption-"));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
}
function repo(p) {
  git(p, ["init", "-b", "develop"]);
  git(p, ["config", "user.name", "QA Test"]);
  git(p, ["config", "user.email", "qa@example.invalid"]);
}
test("release archive installs without a nested Git checkout and upgrades only managed files", (t) => {
  const source = temp(t), out = temp(t), consumer = temp(t);
  repo(source);
  for (const name of runtimeEntries) fs.cpSync(path.resolve(name), path.join(source, name), { recursive: true });
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "Release fixture"]);
  const release = packageRelease(source, out);
  execFileSync("tar", ["-xzf", release.target, "-C", out]);
  const runtime = path.join(out, "qa");
  assert.equal(sourceRef(runtime), release.sourceSha);
  repo(consumer);
  fs.writeFileSync(path.join(consumer, "index.html"), "hello");
  fs.writeFileSync(path.join(consumer, "AGENTS.md"), "Local instructions\n");
  fs.mkdirSync(path.join(consumer, "sub"));
  const detected = inspectRepository(path.join(consumer, "sub"));
  assert.equal(detected.branch, "develop");
  assert.equal(detected.profile, "static-site");
  const options = { branch: detected.branch, profile: detected.profile, ref: release.sourceSha, runtimeRoot: runtime, milestones: true };
  initialize(consumer, options);
  assert(!fs.existsSync(path.join(consumer, ".qa")));
  initialize(consumer, { ...options, apply: true });
  assert(!fs.existsSync(path.join(consumer, ".qa/.git")));
  assert(fs.existsSync(path.join(consumer, ".qa/templates/milestone-work.json")));
  assert(fs.existsSync(path.join(consumer, ".qa-work.json")));
  assert(fs.readFileSync(path.join(consumer, ".gitignore"), "utf8").includes("/.qa/"));
  assert(fs.readFileSync(path.join(consumer, "AGENTS.md"), "utf8").startsWith("Local instructions"));
  assert(initialize(consumer, options).every((c) => c.action === "preserve"));
  fs.appendFileSync(path.join(consumer, ".qa/bin/qa.mjs"), "\n// local edit\n");
  assert.throws(() => initialize(consumer, { ...options, apply: true }), /Managed runtime edited/);
});
test("setup refuses unrelated runtimes, dangling symlinks and preserves custom templates", (t) => {
  const root = temp(t), ref = "b".repeat(40);
  fs.mkdirSync(path.join(root, ".qa"));
  assert.throws(() => initialize(root, { ref, runtimeRoot: process.cwd() }), /not a managed installation/);
  fs.rmdirSync(path.join(root, ".qa"));
  fs.symlinkSync(path.join(root, "missing"), path.join(root, ".qa"));
  assert.throws(() => initialize(root, { ref, runtimeRoot: process.cwd() }), /symlink/);
  fs.unlinkSync(path.join(root, ".qa"));
  fs.mkdirSync(path.join(root, ".github"));
  fs.writeFileSync(path.join(root, ".github/pull_request_template.md"), "Custom template");
  const preview = initialize(root, { ref });
  assert(preview.find((c) => c.path.endsWith("pull_request_template.md")).conflict);
  initialize(root, { ref, apply: true });
  assert.equal(fs.readFileSync(path.join(root, ".github/pull_request_template.md"), "utf8"), "Custom template");
});
test("only intact managed callers can be upgraded", (t) => {
  const root = temp(t), ref = "a".repeat(40), next = "b".repeat(40);
  initialize(root, { ref, apply: true });
  assert.equal(initialize(root, { ref: next }).find((c) => c.path.endsWith("quality.yml")).action, "update");
  fs.appendFileSync(path.join(root, ".github/workflows/quality.yml"), "# local edit\n");
  assert(initialize(root, { ref: next }).find((c) => c.path.endsWith("quality.yml")).conflict);
});
test("managed repair callers upgrade without opting new consumers into repairs", (t) => {
  const root = temp(t), ref = "a".repeat(40), next = "b".repeat(40);
  initialize(root, { ref, apply: true });
  assert(!fs.existsSync(path.join(root, ".github/workflows/qa-repair.yml")));
  initialize(root, { ref, repairs: true, apply: true });
  initialize(root, { ref: next, apply: true });
  assert.equal(fs.readFileSync(path.join(root, ".github/workflows/qa-repair.yml"), "utf8"), repairCaller(next));
});
test("doctor distinguishes configuration from unavailable live evidence", (t) => {
  const root = temp(t);
  initialize(root, { ref: "a".repeat(40), apply: true });
  let calls = 0;
  const gh = () => { calls++; throw Error("No login"); };
  assert.equal(diagnose(root, { gh }).review.status, "not-checked");
  assert.equal(calls, 0);
  const result = diagnose(root, { remote: true, gh });
  assert.equal(result.configuration.status, "passed");
  assert.equal(result.workflows.status, "passed");
  assert.equal(result.credentials.status, "unavailable");
});
