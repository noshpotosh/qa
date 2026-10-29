// Explicit opt-in live pilot. Uses the installed CLI/account; never part of npm test.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { git } from "../lib/git.mjs";
import { resolveWork } from "../lib/work-config.mjs";
import { runMilestone } from "../scripts/work-runner.mjs";
import { loadRun } from "../scripts/work-store.mjs";

if (process.env.QA_LIVE_WORK !== "1") throw Error("Set QA_LIVE_WORK=1 to run this account-backed pilot");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-milestone-live-"));
git(root, ["init", "-b", "main"]);
git(root, ["config", "user.name", "QA pilot"]);
git(root, ["config", "user.email", "qa-pilot@example.invalid"]);
fs.mkdirSync(path.join(root, "src"));
fs.writeFileSync(path.join(root, "src/app.mjs"), "export const answer = 0;\n");
fs.writeFileSync(path.join(root, "test.mjs"), "import assert from 'node:assert/strict'; import {answer} from './src/app.mjs'; assert.equal(answer,42); console.log('answer verified');\n");
fs.writeFileSync(path.join(root, "verify-note.mjs"), "import fs from 'node:fs'; import assert from 'node:assert/strict'; const n=JSON.parse(fs.readFileSync('evidence/note.json','utf8')); assert.equal(n.answer,42); assert.equal(n.method,'direct module observation'); console.log('research note verified');\n");
const task = (id, kind, criterion, check, dependencies = []) => ({ id, kind, title: id === "fix" ? "Return the documented answer 42" : "Record a direct module observation",
  criteria: [criterion], checks: [check], dependencies, capabilities: [], priority: 1 });
const milestone = { id: "pilot", title: "Answer module acceptance", scope: "Return 42 from the answer export and record its direct observation. Preserve the two verifier programs; human feel acceptance is separate.",
  allowedPaths: ["src/**", "evidence/**"], finalChecks: ["answer", "note"],
  criteria: [
    { id: "answer", description: "src/app.mjs exports answer exactly 42", kind: "automated", done: false, evidence: [], checks: ["answer"] },
    { id: "note", description: "evidence/note.json records answer 42 and method direct module observation", kind: "automated", done: false, evidence: [], checks: ["note"] },
    { id: "hands-on", description: "Operator accepts this exact build", kind: "human", done: false, evidence: [], checks: [] },
  ], tasks: [task("fix", "implementation", "answer", "answer"), task("observe", "research", "note", "note", ["fix"])] };
const config = resolveWork({ enabled: true, tasks: 1, minutes: 10,
  checks: { answer: { argv: [process.execPath, "test.mjs"], timeoutSeconds: 30 }, note: { argv: [process.execPath, "verify-note.mjs"], timeoutSeconds: 30 } } });
fs.writeFileSync(path.join(root, ".qa-work.json"), JSON.stringify({ version: 1, milestones: [milestone] }, null, 2));
git(root, ["add", "."]); git(root, ["commit", "-m", "Define live pilot and failing behavior"]);
try { execFileSync(process.execPath, ["test.mjs"], { cwd: root, stdio: "pipe" }); throw Error("Baseline should fail"); }
catch (error) { if (error.status !== 1) throw error; }
console.log(JSON.stringify({ root, phase: "baseline-regression-confirmed" }));
for (const options of [{ approve: true }, { resume: true }, { resume: true }]) {
  const result = await runMilestone(root, config, "pilot", { ...options, onProgress: (event) => console.log(JSON.stringify(event)) });
  console.log(JSON.stringify({ root, result }));
}
const { state } = loadRun(root, "pilot");
if (state.states.fix?.status !== "done" || state.states.observe?.status !== "done" || state.status !== "awaiting-human" || state.checkpoints.length !== 2) throw Error("Live pilot acceptance incomplete");
if (fs.readFileSync(path.join(root, "src/app.mjs"), "utf8") !== "export const answer = 0;\n") throw Error("Original checkout changed");
console.log(JSON.stringify({ status: "passed", root, checkpoints: state.checkpoints, humanHandoff: state.status }));
