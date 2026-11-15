import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/face/selectFaceLandmarks.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {selectFaceLandmarks}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const face=(cx,scale)=>{
 const points=Array.from({length:478},()=>({x:cx,y:.5,z:0}));
 for(const [i,x,y]of [[234,-1,0],[454,1,0],[10,0,-1],[152,0,1],[1,0,0],[33,-.5,-.4],[263,.5,-.4],[61,-.3,.4],[291,.3,.4]])points[i]={x:cx+x*scale,y:.5+y*scale,z:0};
 return points;
};
const primary=face(.5,.2),visitor=face(.85,.1),largerVisitor=face(.8,.3);
assert.equal(selectFaceLandmarks([]),null);
assert.equal(selectFaceLandmarks([primary]),primary);
assert.equal(selectFaceLandmarks([visitor,primary]),primary,'start with the main person');
assert.equal(selectFaceLandmarks([largerVisitor,primary],primary),primary,'face order and size changes must not move makeup to a bystander');
assert.equal(selectFaceLandmarks([primary,largerVisitor],primary),primary);
console.log('PASS: raw lip detector still renders one person and preserves identity across face order changes.');
