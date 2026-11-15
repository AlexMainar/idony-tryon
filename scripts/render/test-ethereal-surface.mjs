import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const cache=new Map();
function compile(file){
  if(cache.has(file))return cache.get(file);
  let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
  code=code.replace(/from\s+["']([^"']+)["']/g,(_,spec)=>'from '+JSON.stringify(compile(path.resolve(path.dirname(file),spec+'.ts'))));
  const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;
}
const root=path.resolve('lib/render/ethereal');
const {canonicalCheeks}=await import(compile(root+'/canonical.ts'));
const {createCheekSurface,rotateCanonicalNormal,dot,unit}=await import(compile(root+'/surface.ts'));
const {fitEtherealLight,createEtherealLighting}=await import(compile(root+'/lighting.ts'));
const positions=new Map(canonicalCheeks.ids.map((id,i)=>[id,canonicalCheeks.positions[i]]));
for(const [id,pos]of Object.entries(canonicalCheeks.anchors))positions.set(+id,pos);
for(const [id,anchor]of Object.entries(canonicalCheeks.lightSamples))positions.set(+id,anchor.position);
const w=1280,h=720;
function face(angle=0,roll=0){
  const result=Array.from({length:478},()=>({x:NaN,y:NaN,z:NaN}));
  for(const [id,p]of positions){
    const x=p[0]*Math.cos(angle)+p[2]*Math.sin(angle),z=-p[0]*Math.sin(angle)+p[2]*Math.cos(angle);
    const xx=x*Math.cos(roll)-p[1]*Math.sin(roll),yy=x*Math.sin(roll)+p[1]*Math.cos(roll);
    result[id]={x:.5+xx*.035,y:.5-yy*.035*w/h,z:-z*.035};
  }
  return result;
}
const surface=createCheekSurface(),front=surface.update(face(),w,h);
assert(front);
for(const yaw of [-.6,0,.6])for(const roll of [-.25,.25]){
  const points=face(yaw,roll),frame=surface.update(points,w,h);assert(frame);
  canonicalCheeks.ids.forEach((id,i)=>{
    assert(Math.abs(surface.vertices[i*8]-points[id].x)<1e-6);
    assert(Math.abs(surface.vertices[i*8+1]-points[id].y)<1e-6);
    const n=rotateCanonicalNormal(canonicalCheeks.normals[i],frame);
    assert(Math.abs(Math.hypot(...n)-1)<1e-6);
    assert.equal(surface.vertices[i*8+6],Math.fround((canonicalCheeks.positions[i][0]+9)/18));
    assert.equal(surface.vertices[i*8+7],Math.fround((canonicalCheeks.positions[i][1]+10)/20));
    const p=canonicalCheeks.normals[i],x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
    const expected=[x*Math.cos(roll)-p[1]*Math.sin(roll),x*Math.sin(roll)+p[1]*Math.cos(roll),z];
    assert(dot(n,unit(expected))>.9999,'canonical curvature follows rigid head rotation');
  });
}
assert.equal(surface.update(null,w,h),null);
const invalid=face();delete invalid[33].z;assert.equal(surface.update(invalid,w,h),null);
const samples=canonicalCheeks.normals.filter(n=>n[2]>.15);
const makeLight=x=>fitEtherealLight(samples.map(normal=>({normal,luma:.3+.22*dot(normal,unit([x,.3,1]))})));
assert(makeLight(-.8).direction[0]<makeLight(.8).direction[0],'light fit follows left/right contrast');
const flat=fitEtherealLight(samples.map(normal=>({normal,luma:.3})));assert(flat.confidence<1e-10);
let reads=0;globalThis.document={createElement(){return {getContext(){return {drawImage(){},getImageData(){reads++;return {data:new Uint8ClampedArray(Array.from({length:80*80},()=>[150,125,110,255]).flat())}}}}}}};
const lighting=createEtherealLighting(),points=face();const frame=surface.update(points,w,h);
const a=lighting.update({width:w,height:h},points,frame,1000,false),count=reads;
assert.deepEqual(lighting.update({width:w,height:h},face(.5),surface.update(face(.5),w,h),4000,true),a);
assert.equal(reads,count,'frozen comparisons do not resample light');
console.log('Ethereal: exact same-frame projection, 3D normals over yaw/roll, stable coverage, missing-depth handling, light direction and frozen lighting passed.');
