import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../../lib/render/lipOil/diagnosticCapture.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {parseLipDiagnostic,captureDiagnosticFrame}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const points=()=>Array.from({length:478},()=>({x:.4,y:.6,z:0}));
const frame={timeMs:0,detectionMs:7,image:'data:image/jpeg;base64,YQ==',raw:points(),stabilized:points()};
const clip={kind:'idony_lip_diagnostic_v1',createdAt:'2026-09-22',width:960,height:720,frames:[frame,{...frame,timeMs:33,raw:null,stabilized:null}]};
assert.deepEqual(parseLipDiagnostic(JSON.stringify(clip)),clip);
for(const invalid of [
 {...clip,frames:[]}, {...clip,width:0}, {...clip,frames:Array(181).fill(frame)},
 {...clip,frames:[frame,frame]}, {...clip,frames:[{...frame,image:'https://example.com/image.jpg'}]},
 {...clip,frames:[{...frame,raw:[{x:0,y:0}]}]}, {...clip,frames:[{...frame,timeMs:-1}]},
]) assert.throws(()=>parseLipDiagnostic(JSON.stringify(invalid)));
// Exercise asynchronous snapshot encoding: camera pixels and landmarks must
// remain paired even when the live buffers change and encoding ends out of order.
const encoders=[];
globalThis.document={createElement:()=>{
 const canvas={width:0,height:0,pixel:0,getContext:()=>({drawImage:source=>{canvas.pixel=source.pixel;}}),toBlob:callback=>{const pixel=canvas.pixel;encoders.push(()=>callback({pixel}));}};return canvas;
}};
globalThis.FileReader=class {readAsDataURL(blob){this.result='data:image/jpeg;base64,'+Buffer.from(String(blob.pixel)).toString('base64');this.onload();}};
const sourceCanvas={width:960,height:720,pixel:1}, raw=points(), stable=points();
const first=captureDiagnosticFrame(sourceCanvas,0,7,raw,stable);
sourceCanvas.pixel=2;raw[0].x=.8;stable[0].x=.7;
const second=captureDiagnosticFrame(sourceCanvas,33,8,raw,stable);
sourceCanvas.pixel=3;raw[0].x=.9;
encoders[1]();encoders[0]();
const frames=await Promise.all([first,second]);
assert.equal(frames[0].raw[0].x,.4);assert.equal(frames[1].raw[0].x,.8);
assert.equal(frames[0].image,'data:image/jpeg;base64,MQ==');assert.equal(frames[1].image,'data:image/jpeg;base64,Mg==');
assert.deepEqual(frames.map(f=>f.timeMs),[0,33]);
console.log('Diagnostic schema, face loss, limits, URL rejection, immutable snapshots and asynchronous frame ordering: passed');
