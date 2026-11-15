import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root=process.cwd(),cache=new Map();
const basePath=process.argv[2]||root+'/lib/render/ethereal';
function compile(file){
  if(cache.has(file))return cache.get(file);
  let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
  code=code.replace(/from\s+["']([^"']+)["']/g,(_,v)=>'from '+JSON.stringify(compile((v.startsWith('@/')?path.join(root,v.slice(2)):path.resolve(path.dirname(file),v))+'.ts')));
  const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url;
}
const {posePositions,getSkinPose}=await import(compile(basePath+'/headPose.ts'));
const {filmCheeks}=await import(compile(basePath+'/filmCanonical.ts'));
const {createEtherealTracking}=await import(compile(basePath+'/tracking.ts'));
const {rotateCanonicalNormal,dot}=await import(compile(basePath+'/surface.ts'));
const {createReflectionFrame,frameAngle}=await import(compile(basePath+'/reflectionFrame.ts'));
const w=640,h=480;
function face({yaw=0,roll=0,scale=1,dx=0,dy=0}={}){
  const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  for(const[id,p]of posePositions){
    const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
    const xx=x*Math.cos(roll)-p[1]*Math.sin(roll),yy=x*Math.sin(roll)+p[1]*Math.cos(roll);
    points[id]={x:.5+xx*.035*scale+dx/w,y:.5-yy*.035*w/h*scale+dy/h,z:-z*.035*scale};
  }
  return points;
}
const copy=p=>p.map(v=>({...v})),rms=v=>Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length);
let imageX=0,imageY=0,reads=0;
const texture=(x,y)=>128+22*Math.sin(x*.57+y*.31)+19*Math.sin(x*.27-y*.69)+9*Math.cos(x*1.17+y*.91);
const source={getContext(){return {getImageData(x,y,width,height){
  reads++;const data=new Uint8ClampedArray(width*height*4);
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){const k=(j*width+i)*4,v=texture(x+i-imageX,y+j-imageY);data[k]=data[k+1]=data[k+2]=v;data[k+3]=255;}
  return {data};
}}}};
const noPixels={getContext(){return null;}};
const base=face(),tracker=createEtherealTracking(),rawErrors=[],filteredErrors=[];
tracker.update(source,base,w,h,0,false);
for(let f=1;f<=90;f++){
  const jitter=(f%2?1:-1)*.7,raw=base.map(p=>({...p,x:p.x+jitter/w,y:p.y-jitter*.4/h}));
  const serialized=JSON.stringify(raw),out=tracker.update(source,raw,w,h,f*1000/30,false);
  assert.equal(JSON.stringify(raw),serialized,'detector output must stay immutable');
  if(f>10){rawErrors.push(jitter);filteredErrors.push((out.landmarks[117].x-base[117].x)*w);}
}
console.log('Pixel-anchored stationary jitter RMS:',rms(rawErrors).toFixed(3),'→',rms(filteredErrors).toFixed(3),'px');
assert(rms(filteredErrors)<rms(rawErrors)*.55,'skin texture must reject coherent detector wobble');
const local=createEtherealTracking(),localRaw=[],localOut=[];
local.update(noPixels,base,w,h,0,false);
for(let f=1;f<=90;f++){
  const raw=copy(base);
  for(const i of [50,117,118,123,280,346,347,352])raw[i].x+=(f%2?1:-1)*.6/w;
  const out=local.update(noPixels,raw,w,h,f*1000/30,false);
  if(f>10){localRaw.push((raw[117].x-base[117].x)*w);localOut.push((out.landmarks[117].x-base[117].x)*w);}
}
assert(rms(localOut)<rms(localRaw)*.65,'damp residual shape noise in head coordinates');
console.log('Local shape jitter RMS:',rms(localRaw).toFixed(3),'→',rms(localOut).toFixed(3),'px');
// True camera translation and corresponding pixels follow immediately.
const moving=createEtherealTracking();imageX=imageY=0;moving.update(source,base,w,h,0,false);
for(let f=1;f<=12;f++){
  imageX=f*3;imageY=-f*2;
  const raw=face({dx:imageX,dy:imageY}),out=moving.update(source,raw,w,h,f*1000/30,false);
  for(const i of [117,118,346,347])assert(Math.hypot((out.landmarks[i].x-raw[i].x)*w,(out.landmarks[i].y-raw[i].y)*h)<.08,'no lag on true pixel motion');
}
// Full 3D head pose compensation: no screen-space smoothing of rigid motion.
const rigid=createEtherealTracking();rigid.update(noPixels,base,w,h,0,false);
for(let f=1;f<=15;f++){
  const yaw=f*.03,roll=f*-.012,raw=face({yaw,roll,scale:1+f*.008,dx:f*2,dy:-f});
  const out=rigid.update(noPixels,raw,w,h,f*1000/30,false);
  for(const id of filmCheeks.ids)assert(Math.hypot((out.landmarks[id].x-raw[id].x)*w,(out.landmarks[id].y-raw[id].y)*h)<1e-6,'current yaw/roll/scale/translation must not trail');
  const n=filmCheeks.normals[19],x=n[0]*Math.cos(yaw)+n[2]*Math.sin(yaw),z=-n[0]*Math.sin(yaw)+n[2]*Math.cos(yaw);
  const expected=[x*Math.cos(roll)-n[1]*Math.sin(roll),x*Math.sin(roll)+n[1]*Math.cos(roll),z];
  assert(dot(rotateCanonicalNormal(n,out.frame),expected)>.99999,'multi-anchor normal frame follows true pose');
}
const jaw=copy(base);jaw[152].y+=.05;jaw[152].z+=.01;
assert.deepEqual(getSkinPose(base,w,h).frame,getSkinPose(jaw,w,h).frame,'jaw opening cannot tip cheek lighting');
const expression=createEtherealTracking();expression.update(noPixels,base,w,h,0,false);
const smile=copy(base);smile[50].y-=5/h;
assert(Math.abs(expression.update(noPixels,smile,w,h,33,false).landmarks[50].y-smile[50].y)<1e-10,'large real cheek deformation follows immediately');
const raw=face({dx:8}),frozen=tracker.update(source,raw,w,h,4000,false),count=reads;
for(let i=0;i<3;i++)assert.deepEqual(tracker.update(source,copy(raw),w,h,5000+i*33,true),frozen,'frozen state must stay exact');
assert.equal(reads,count,'frozen comparisons must not resample skin pixels');
assert.equal(tracker.update(source,null,w,h,6000,false),null);
assert.deepEqual(tracker.update(noPixels,raw,w,h,6033,false).landmarks,raw,'face reacquisition discards the previous anchor');
// A smooth brightness ramp is ambiguous, despite having nonzero variance.
const ramp={getContext(){return {getImageData(x,y,width,height){
  const data=new Uint8ClampedArray(width*height*4);
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){const k=(j*width+i)*4,v=(x+i)*.5;data[k]=data[k+1]=data[k+2]=v;data[k+3]=255;}
  return {data};
}}}};
const ambiguous=createEtherealTracking();ambiguous.update(ramp,base,w,h,0,false);
for(let i=1;i<=10;i++){
  const raw=face({dx:(i%2?.7:-.7)}),out=ambiguous.update(ramp,raw,w,h,i*1000/30,false);
  assert(Math.abs(out.landmarks[117].x-raw[117].x)*w<1e-6,'ambiguous patches must not accumulate an optical correction');
}
console.log('Current pixel motion, 3D rigid motion, jaw independence, expression release, freeze and face reacquisition passed.');

const normalFilter=createReflectionFrame(),rawAngles=[],filteredAngles=[];
for(let n=0;n<90;n++){
  const raw=getSkinPose(face({yaw:(n%2?1:-1)*.004}),w,h).frame;
  const filtered=normalFilter.update(raw,n*1000/30);
  assert(frameAngle(raw,filtered)<.35*Math.PI/180+1e-6,'normal correction stays bounded independently of frame rate');
  for(const axis of ['x','y','z'])assert(Math.abs(dot(filtered[axis],filtered[axis])-1)<1e-10,'filtered frame remains normalized');
  assert(Math.abs(dot(filtered.x,filtered.y))<1e-10,'normal filtering cannot shear the tangent frame');
  if(n>10){rawAngles.push(Math.atan2(raw.z[0],raw.z[2]));filteredAngles.push(Math.atan2(filtered.z[0],filtered.z[2]));}
}
const deviation=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return rms(a.map(v=>v-m));};
assert(deviation(filteredAngles)<deviation(rawAngles)*.4,'small alternating depth-orientation noise is reduced before reflection');
const turn=getSkinPose(face({yaw:.04}),w,h).frame;
assert(frameAngle(normalFilter.update(turn,3100),turn)<1e-6,'clear head rotation releases reflection normals immediately');
normalFilter.reset();assert.deepEqual(normalFilter.update(turn,3200),turn,'normal history resets on face reacquisition');
console.log('Sub-degree reflection noise, bounded angular correction, orthonormality and immediate head-turn release passed.');
