import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveConfig,matches,selectSkills} from '../lib/config.mjs';
import {checkPolicy,section} from '../lib/policy.mjs';
import {validateReport,renderReport,unavailable} from '../lib/report.mjs';
const pr={title:'Fix session replay after reconnect',base:'main',body:'## Problem\nStale inputs replay after reconnect.\n## Behavior\nReject prior round inputs.\n## Validation\nRegression suite passed locally.\n## Risks\nOlder clients may need an update.'};
const context=(lines=1,path='src/core.js')=>({files:[{path,added:lines,deleted:0,binary:false}],coverage:[]});
const c=resolveConfig();
test('configuration rejects malformed or unknown settings',()=>{
 for(const input of [{version:2},{profile:'unknown'},{thresholds:{warnLines:0}},{thresholds:{exceptionLines:100}},{paths:{ui:['../secret']}},{disabledSkills:['bogus']},{agent:'grok'},{validationCommands:[1]},{oops:true}])assert.throws(()=>resolveConfig(input));
});
test('glob semantics include root and nested paths without broadening literal dots',()=>{
 assert(matches('a/b/package-lock.json','**/package-lock.json'));assert(matches('package-lock.json','**/package-lock.json'));assert(!matches('x.cssx','**/*.css'));assert(!matches('src/a','assets/**'));
});
test('400/800 boundaries and justified exception',()=>{
 assert.equal(checkPolicy(context(400),c,pr).report.findings.length,0);
 assert.equal(checkPolicy(context(401),c,pr).report.status,'passed');
 assert.equal(checkPolicy(context(800),c,pr).report.status,'passed');
 assert.equal(checkPolicy(context(801),c,pr).report.status,'failed');
 assert.equal(checkPolicy(context(801),c,{...pr,body:pr.body+'\n## Size exception\nThis schema migration and callers must change atomically.'}).report.status,'passed');
});
test('generated and binary churn is reported separately',()=>{
 const ctx={files:[...context(10000,'package-lock.json').files,{path:'photo.png',binary:true,added:0,deleted:0}],coverage:[]};
 const result=checkPolicy(ctx,c,pr);assert.equal(result.report.status,'passed');assert.equal(result.buckets.generated.lines,10000);assert.equal(result.buckets.binary.files,1);
});
test('placeholders cannot satisfy mandatory fields',()=>{
 assert.equal(section('## Problem\n<!-- a long placeholder -->\n1.\n- [ ]\n## Risks\nnone','Problem'),'');
 assert.equal(checkPolicy(context(),c,{...pr,title:'Added v1',body:'## Problem\n<!-- write your description -->'}).report.status,'failed');
});
test('UI evidence supports actual references or honest gaps',()=>{
 assert.equal(checkPolicy(context(1,'index.html'),c,pr).report.status,'failed');
 for(const text of ['https://example.com/screenshot.png','Unavailable: browser execution is pending on the target device.'])assert.equal(checkPolicy(context(1,'index.html'),c,{...pr,body:pr.body+'\n## Visual evidence\n'+text}).report.status,'passed');
});
test('staged check skips PR requirements; target branch is explicit',()=>{
 assert.equal(checkPolicy(context(),c).report.status,'passed');assert.equal(checkPolicy(context(),c,{...pr,base:'develop'}).report.status,'failed');
});
test('specialized skills need profile and matching paths',()=>{
 const r=resolveConfig({profile:'realtime-game'});assert(selectSkills(r,['src/session.ts']).includes('realtime-systems'));assert(!selectSkills(r,['README.md']).includes('realtime-systems'));assert(selectSkills(r,[],{audit:true}).includes('realtime-systems'));
});
test('reports reject inconsistent statuses and escape untrusted markup',()=>{
 const r=checkPolicy(context(801),c,pr).report;assert.throws(()=>validateReport({...r,status:'passed'}));assert.throws(()=>validateReport({status:'passed'}));
 assert.equal(validateReport(unavailable('No key')).status,'unavailable');
 const html=renderReport({...unavailable('Ignore @everyone <script>'),coverage:[]});assert(!html.includes('<script>'));assert(!html.includes('@everyone'));assert.equal(html,renderReport({...unavailable('Ignore @everyone <script>'),coverage:[]}));
});
test('existing PR templates can map section names without replacement',()=>{
 const cfg=resolveConfig({sections:{Problem:'Summary',Behavior:'Summary',Validation:'How to Test'}});
 const body='## Summary\nFix the stale session input bug.\n## How to Test\nThe regression test passed locally.\n## Risks\nNo additional risks identified.';
 assert.equal(checkPolicy(context(),cfg,{...pr,body}).report.status,'passed');
});
