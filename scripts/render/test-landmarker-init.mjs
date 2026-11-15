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
  const [preload,camera]=await Promise.all([initFaceLandmarker('IMAGE'),initFaceLandmarker('IMAGE')]);
  assert.equal(preload,camera);assert.equal(camera,instance);
  assert.equal(calls.length,gpuFails?2:1,'preload/camera must share a single initialization');
  assert.equal(calls[0].baseOptions.delegate,'GPU');
  if(gpuFails)assert.equal(calls[1].baseOptions.delegate,'CPU');
  for(const options of calls){assert.equal(options.runningMode,'IMAGE');assert.equal(options.minTrackingConfidence,.95);assert.equal(options.numFaces,1);}
  await initFaceLandmarker('IMAGE');assert.equal(calls.length,gpuFails?2:1,'reuse successful model');
 }
} finally {Object.assign(console,original);delete globalThis.landmarkerMock;}
console.log('PASS: shared cold initialization, GPU inference with CPU compatibility fallback, approved detection mode and thresholds preserved.');
