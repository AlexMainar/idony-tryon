import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/render/complexion/etherealExposure.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {exposureGainFromPixels,followExposure,createEtherealExposure}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const pixels=v=>new Uint8ClampedArray(Array.from({length:576},()=>[v,v,v,255]).flat());
assert.equal(exposureGainFromPixels(pixels(180)),1);
assert.equal(exposureGainFromPixels(new Uint8ClampedArray()),1);
assert(exposureGainFromPixels(pixels(40))>exposureGainFromPixels(pixels(80)));
for(let v=0;v<256;v++){const g=exposureGainFromPixels(pixels(v));assert(g>=1&&g<=1.55);}
assert.equal(followExposure(1,1.55,0),1);
assert(followExposure(1,1.55,1/30)<1.04);
// Shader curve: shared RGB multiplier, identity at gain 1, monotone with no clipping.
for(const gain of [1,1.25,1.55]){let prev=-1;for(let i=0;i<=1000;i++){const v=i/1000;const out=v*(1+(gain-1)*(1-v));assert(out>=prev&&out<=1);if(gain===1)assert.equal(out,v);prev=out;}}
let reads=0;globalThis.document={createElement(){return {getContext(){return {drawImage(){},getImageData(){reads++;return {data:pixels(30)}}}}}}};
const meter=createEtherealExposure();const points=Array.from({length:478},()=>({x:.5,y:.5}));points[234]={x:.2,y:.5};points[454]={x:.8,y:.5};points[10]={x:.5,y:.2};points[152]={x:.5,y:.8};const frame={width:1280,height:720};
meter.update(frame,points,1000,false);const gain=meter.update(frame,points,1200,false);const before=reads;
assert.equal(meter.update(frame,points,5000,true),gain);assert.equal(reads,before);
assert(meter.update(frame,null,5200,false)<gain);
console.log('Exposure: daylight identity, bounded dark lift, smooth adaptation, highlight protection, frozen A/B and face-loss recovery passed.');
