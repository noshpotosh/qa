// Explicit paid-model evaluation; never included in npm test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/git.mjs';
import { CodexExecutor } from '../scripts/work-codex.mjs';
import { fileHash } from '../scripts/work-evidence.mjs';
if (process.env.QA_LIVE_REVIEW !== '1' || !process.env.QA_REVIEW_MODEL) throw Error('Set QA_LIVE_REVIEW=1 and QA_REVIEW_MODEL to a pinned model');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(source, 'tests/fixtures/review-v2-cases.json')));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-review-v2-'));
const workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace);
git(workspace, ['init', '-b', 'main']);
const standards = fs.readdirSync(path.join(source, 'skills')).sort().map((id) => fs.readFileSync(path.join(source, 'skills', id, 'SKILL.md'), 'utf8')).join('\n');
const context = { workspace, directory: path.join(directory, 'controller'), common: path.join(workspace, '.git'),
  codex: 'codex', model: process.env.QA_REVIEW_MODEL, resources: [], readRoots: [], protectedPaths: [], standards };
fs.mkdirSync(context.directory);
const executor = new CodexExecutor(context, () => ({ timeoutMs: 180000 }));
const results = { version: 2, model: context.model, sourceHead: git(source, ['rev-parse', 'HEAD']).trim(),
  fixtureHash: fileHash(path.join(source, 'tests/fixtures/review-v2-cases.json')), date: new Date().toISOString(), runs: [] };
console.log(JSON.stringify({ directory, model: context.model }));
for (const sample of cases) for (let repeat = 1; repeat <= 3; repeat++) {
  const milestone = { version: 2, id: 'evaluation', scope: 'Review this self-contained fixture only; no product-wide claims.', criteria: [
    { id: 'criterion', description: sample.criterion, kind: 'automated', done: false, evidence: [], checks: ['fixture'] }] };
  const task = { id: sample.id, purpose: sample.purpose, question: sample.question, criteria: ['criterion'] };
  const name = `${sample.id}.json`; fs.writeFileSync(path.join(workspace, name), JSON.stringify(sample.artifact, null, 2));
  const evidence = { summary: sample.summary, changedPaths: [name], artifacts: [{ path: name, sha256: fileHash(path.join(workspace, name)) }],
    checks: [{ id: 'fixture', status: 'passed', code: 0, output: JSON.stringify(sample.artifact) }], patch: JSON.stringify(sample.artifact),
    previousProgress: sample.id === 'documentation-churn' ? [{ answer: 'Window remains unknown' }] : [] };
  try {
    const review = await executor.review(milestone, task, evidence);
    const passed = review.resolvedSources.includes('criterion') === sample.expected.resolved && review.progress.advanced === sample.expected.advanced &&
      (!sample.expected.clean || review.report.status === 'passed' && !review.report.findings.some((f) => f.severity === 'blocking'));
    results.runs.push({ id: sample.id, repeat, passed, review });
  } catch (error) { results.runs.push({ id: sample.id, repeat, passed: false, unavailable: error.message }); }
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ id: sample.id, repeat, passed: results.runs.at(-1).passed }));
}
results.passed = results.runs.length === 12 && results.runs.every((r) => r.passed);
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ passed: results.passed, results: path.join(directory, 'results.json') }));
if (!results.passed) process.exitCode = 1;
