import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('lib/face/detectLandmarks.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const encode=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const original={log:console.log,warn:console.warn,error:console.error};
console.log=console.warn=console.error=()=>{};
try {
 for(const gpuFails of [false,true]){
  const calls=[],instance={};
  globalThis.landmarkerMock={resolve:async()=>({}),create:async options=>{calls.push(options);await Promise.resolve();if(gpuFails&&options.baseOptions.delegate==='GPU')throw Error('GPU unsupported');return instance;}};
  const mock=encode('export const FilesetResolver={forVisionTasks:()=>globalThis.landmarkerMock.resolve()};export const FaceLandmarker={createFromOptions:(_,options)=>globalThis.landmarkerMock.create(options)};');
  const {initFaceLandmarker}=await import(encode(source.replace(/from "@mediapipe\/tasks-vision"/,`from ${JSON.stringify(mock)}`)+'\n// scenario '+gpuFails));
  for(const [mode,profile,numFaces] of [['IMAGE','face',1],['VIDEO','face',1],['VIDEO','lips',2]]){
   const start=calls.length;
   const [preload,camera]=await Promise.all([initFaceLandmarker(mode,profile),initFaceLandmarker(mode,profile)]);
   assert.equal(preload,camera);assert.equal(camera,instance);
   assert.equal(calls.length-start,gpuFails?2:1,'preload/camera must share a single initialization');
   assert.equal(calls[start].baseOptions.delegate,'GPU');
   if(gpuFails)assert.equal(calls[start+1].baseOptions.delegate,'CPU');
   for(const options of calls.slice(start)){assert.equal(options.runningMode,mode);assert.equal(options.minTrackingConfidence,.95);assert.equal(options.numFaces,numFaces);}
   await initFaceLandmarker(mode,profile);assert.equal(calls.length-start,gpuFails?2:1,'reuse successful model on camera reopen');
  }
 }
} finally {Object.assign(console,original);delete globalThis.landmarkerMock;}
console.log('PASS: shared IMAGE/VIDEO initialization, GPU/CPU compatibility, raw lip tracking without native smoothing, identity isolation and camera reopen.');
