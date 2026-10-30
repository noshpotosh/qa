import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../lib/git.mjs";
import { record } from "./fixtures/repair-api.mjs";
import { validateWorkspace } from "../scripts/repair-workspace.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-container-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init"]);
  git(root, ["config", "user.name", "QA Test"]);
  git(root, ["config", "user.email", "qa@example.invalid"]);
  fs.writeFileSync(path.join(root, "app.mjs"), "throw Error('broken');\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Broken fixture"]);
  const r = record();
  r.currentHead = r.target.baseSha = git(root, ["rev-parse", "HEAD"]).trim();
  r.target.kind = "issue";
  r.config.repair.validationCommands = ["node app.mjs"];
  r.config.repair.validationImage = process.env.QA_DOCKER_IMAGE;
  return { root, r };
}
test("real container validates candidate without host credentials or Docker socket", { skip: !process.env.QA_DOCKER_IMAGE }, (t) => {
  const { root, r } = fixture(t);
  const content = `import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.equal(process.env.GITHUB_TOKEN, undefined);
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.GITHUB_OUTPUT, undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapEff:\\s+0+\\s/);
console.log('isolated candidate passed');
`;
  const result = validateWorkspace(r, { changes: [{ path: "app.mjs", content }] }, root);
  assert.equal(result.status, "passed", result.output || result.reason);
  assert.match(result.output, /isolated candidate passed/);
});
test("real container failure is recorded as failed validation", { skip: !process.env.QA_DOCKER_IMAGE }, (t) => {
  const { root, r } = fixture(t);
  const result = validateWorkspace(r, { changes: [{ path: "app.mjs", content: "console.error('regression failed'); process.exit(7);\n" }] }, root);
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.match(result.output, /regression failed/);
});
