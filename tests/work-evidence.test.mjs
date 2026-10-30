import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixtures/work-repo.mjs";
import { git } from "../lib/git.mjs";
import { fileHash, headSnapshot, indexSnapshot, workspaceSnapshot } from "../scripts/work-evidence.mjs";

test("snapshots stream blobs above the old 64 MiB limit and retain content and mode checks", (t) => {
  const f = fixture(t), file = path.join(f.root, "src/large.dat"), block = Buffer.alloc(1024 * 1024, 7);
  const fd = fs.openSync(file, "w");
  try { for (let n = 0; n < 65; n++) fs.writeSync(fd, block); }
  finally { fs.closeSync(fd); }
  git(f.root, ["add", "."]); git(f.root, ["commit", "-m", "Retain large baseline blob"]);
  const before = headSnapshot(f.root);
  assert.equal(before["src/large.dat"].hash, fileHash(file));
  assert.deepEqual(before, workspaceSnapshot(f.root));
  fs.appendFileSync(file, "changed"); fs.chmodSync(file, 0o755); git(f.root, ["add", "."]);
  const indexed = indexSnapshot(f.root);
  assert.deepEqual(indexed, workspaceSnapshot(f.root));
  assert.notEqual(indexed["src/large.dat"].hash, before["src/large.dat"].hash);
  assert.equal(indexed["src/large.dat"].executable, true);
});
