import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAgent,currentSnapshot,publishPR,publishAudit,marker,auditMarker} from '../lib/publish.mjs';
const report={status:'passed',summary:'Reviewed the changed behavior.',coverage:['Tests were inspected, not executed.'],findings:[]};
const snapshot={head:'abc',base:'def',updatedAt:'now'};
const pr={head:{sha:'abc'},base:{sha:'def'},updated_at:'now',state:'open'};
function mock({comments=[],issues=[],current=pr}={}){const calls=[];return {calls,paginate:async(fn)=>fn==='comments'?comments:issues,rest:{pulls:{get:async()=>({data:current})},issues:{listComments:'comments',listForRepo:'issues',updateComment:async x=>calls.push(['update',x]),createComment:async x=>calls.push(['create',x]),update:async x=>calls.push(['issue-update',x]),create:async x=>calls.push(['issue-create',x])}}};}
test('missing and malformed provider output is unavailable, not passed',()=>{for(const s of ['', '```json\n{}\n```','{}'])assert.equal(parseAgent(s).status,'unavailable');assert.equal(parseAgent(JSON.stringify(report)).status,'passed');});
test('stale commits and edited descriptions do not publish',async()=>{
 assert(!currentSnapshot(snapshot,{...pr,updated_at:'later'}));const api=mock({current:{...pr,head:{sha:'new'}}});assert.equal(await publishPR(api,{owner:'a',repo:'b',number:1,snapshot,policy:report,agent:report}),'stale');assert.equal(api.calls.length,0);
});
test('existing bot comment updates while forged human marker is ignored',async()=>{
 for(const [type,action] of [['Bot','update'],['User','create']]){
  const api=mock({comments:[{id:4,user:{type},body:marker+'\nold'}]});await publishPR(api,{owner:'a',repo:'b',number:1,snapshot,policy:report,agent:report});assert.equal(api.calls[0][0],action);
 }
});
test('audit updates one tracking issue and ignores unrelated matching titles',async()=>{
 const api=mock({issues:[{number:2,title:'Weekly quality audit',body:'human issue',user:{type:'User'}},{number:3,body:auditMarker+'\nold',user:{type:'Bot'}}]});await publishAudit(api,{owner:'a',repo:'b',report,head:'abc'});assert.equal(api.calls[0][0],'issue-update');assert.equal(api.calls[0][1].issue_number,3);
});
