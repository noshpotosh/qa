import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, diffContext, parseNumstat } from "../lib/git.mjs";
import { initialize } from "../lib/init.mjs";
function temp(t) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "qa-test-"));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
}
test("actual staged diff excludes unstaged changes and handles rename", (t) => {
  const p = temp(t);
  git(p, ["init"]);
  git(p, ["config", "user.name", "QA Test"]);
  git(p, ["config", "user.email", "qa@example.invalid"]);
  fs.writeFileSync(path.join(p, "a.txt"), "first\n");
  git(p, ["add", "a.txt"]);
  git(p, ["commit", "-m", "Initial test"]);
  fs.renameSync(path.join(p, "a.txt"), path.join(p, "b.txt"));
  git(p, ["add", "a.txt", "b.txt"]);
  fs.appendFileSync(path.join(p, "b.txt"), "unstaged\n");
  const c = diffContext(p, { staged: true });
  assert.equal(c.files[0].previousPath, "a.txt");
  assert.equal(c.files[0].path, "b.txt");
  assert(!c.patch.includes("unstaged"));
  assert.throws(() => diffContext(p, {}));
  assert.throws(() => diffContext(p, { base: "--help" }));
});
test("numstat handles binary, tabs/newlines and deletion", () => {
  const rows = parseNumstat(
    "-\t-\timage.png\0" + "0\t3\tgone.txt\0" + "1\t0\tweird\tname\n.txt\0",
  );
  assert(rows[0].binary);
  assert.equal(rows[1].deleted, 3);
  assert.equal(rows[2].path, "weird\tname\n.txt");
});
test("init dry-run, apply and repeat preserve user-owned files", (t) => {
  const p = temp(t),
    ref = "a".repeat(40);
  fs.writeFileSync(path.join(p, "AGENTS.md"), "Existing policy\n");
  initialize(p, { ref });
  assert(!fs.existsSync(path.join(p, ".qa.json")));
  initialize(p, { ref, apply: true });
  const first = fs.readFileSync(path.join(p, "AGENTS.md"), "utf8");
  assert(first.startsWith("Existing policy"));
  fs.writeFileSync(path.join(p, ".qa.json"), "custom content");
  initialize(p, { ref, apply: true });
  assert.equal(
    fs.readFileSync(path.join(p, ".qa.json"), "utf8"),
    "custom content",
  );
  assert.equal(fs.readFileSync(path.join(p, "AGENTS.md"), "utf8"), first);
});
test("init refuses symlink traversal and mutable references", (t) => {
  const p = temp(t);
  fs.symlinkSync(os.tmpdir(), path.join(p, ".github"));
  assert.throws(() => initialize(p, { ref: "a".repeat(40), apply: true }));
  assert.throws(() => initialize(p, { ref: "main" }));
  assert(!fs.existsSync(path.join(p, ".qa.json")));
});
test('existing managed guidance gains continuation once without replacing custom instructions', (t) => {
  const p = temp(t), ref = 'a'.repeat(40);
  const original = 'Local instructions\n<!-- qa:standards -->\nCustomized standards text\n';
  fs.writeFileSync(path.join(p, 'AGENTS.md'), original);
  initialize(p, { ref, apply: true });
  const updated = fs.readFileSync(path.join(p, 'AGENTS.md'), 'utf8');
  assert(updated.startsWith(original));
  assert(updated.includes('.qa/instructions/continuation.md'));
  initialize(p, { ref, apply: true });
  assert.equal(fs.readFileSync(path.join(p, 'AGENTS.md'), 'utf8'), updated);
});
