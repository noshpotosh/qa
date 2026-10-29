import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("THPS4 adapter preserves concurrent tracker changes and mirrors accepted IDs idempotently", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-tracker-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  fs.mkdirSync(path.join(root, "Tools"));
  fs.copyFileSync("examples/thps4/consumer/Tools/qa-work-adapter.mjs", path.join(root, "Tools/qa-work-adapter.mjs"));
  let data = { revision: 1, items: [{ id: "presentation", milestoneId: "grinds-slides", checks: { verification: [{ label: "Pose", done: false }] } },
    { id: "other", milestoneId: "later", notes: "initial", checks: {} }] };
  let saves = 0;
  const transport = async (_url, request) => {
    if (!request.method) return Response.json(data);
    saves++;
    if (saves === 1) {
      data.revision++; data.items[1].notes = "concurrent human edit";
      return Response.json({}, { status: 409 });
    }
    assert.equal(Number(request.headers["If-Match"]), data.revision);
    data = { ...JSON.parse(request.body), revision: data.revision + 1 }; return Response.json(data);
  };
  const binding = { id: "pose", card: "presentation", phase: "verification", label: "Pose" };
  write(".qa-tracker.json", { version: 1, url: "http://127.0.0.1:4173/api/tracker", requiredInputs: [], bindings: [binding] });
  write(".qa-work.json", { version: 1, milestones: [{ id: "grinds-slides", criteria: [{ id: "pose", kind: "automated", done: false, evidence: [] }] }] });
  const workspace = path.join(root, ".qa-worktrees/demo");
  write(".qa-worktrees/demo/Tracker/qa-acceptance.json", { version: 1, accepted: [] });
  write("Tracker/qa-acceptance.json", { version: 1, accepted: [] });
  const { handle } = await import(pathToFileURL(path.join(root, "Tools/qa-work-adapter.mjs")));
  const request = { version: 1, operation: "record", milestoneId: "grinds-slides", operationId: "op-1", sourceHead: "abc", workspace,
    task: { criteria: ["pose"] }, receipt: { id: "receipt", review: { report: { status: "passed" }, scope: "within-request", resolvedSources: ["pose"] } } };
  const result = await handle(request, transport);
  assert.deepEqual(result.checkpointFiles, ["Tracker/qa-acceptance.json"]);
  assert.equal(data.items[1].notes, "concurrent human edit");
  assert.equal(data.items[0].checks.verification[0].done, true);
  await handle(request, transport); assert.equal(saves, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, "Tracker/qa-acceptance.json"))).accepted, ["pose"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "Tracker/qa-acceptance.json"))).accepted, []);
  fs.copyFileSync("examples/thps4/consumer/Tracker/qa-acceptance.mjs", path.join(root, "Tracker/qa-acceptance.mjs"));
  fs.copyFileSync(path.join(workspace, "Tracker/qa-acceptance.json"), path.join(root, "Tracker/qa-acceptance.json"));
  const { applyQaAcceptance } = await import(pathToFileURL(path.join(root, "Tracker/qa-acceptance.mjs")));
  const seed = structuredClone(data); seed.items[0].checks.verification[0].done = false;
  assert.equal(applyQaAcceptance(seed).items[0].checks.verification[0].done, true);
  await assert.rejects(handle({ ...request, operationId: "op-2", receipt: { ...request.receipt, review: { ...request.receipt.review, scope: "expanded" } } }, transport), /scoped passing/);
});
