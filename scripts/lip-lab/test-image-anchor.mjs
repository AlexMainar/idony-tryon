import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../../lib/render/lipOil/imageAnchor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {createImageAnchor}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const width=260,height=190,ids=[57,287,164,18,43,273,106,335,0,17,61,291];
function points(offset=0){const ps=Array.from({length:478},()=>({x:.5,y:.5,z:0}));ids.forEach((id,i)=>{ps[id]={x:(65+(i%4)*40+offset)/width,y:(50+Math.floor(i/4)*40)/height,z:0};});return ps;}
function frame(dx=0,flat=false){const data=new Float32Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=flat?128:128+28*Math.sin((x-dx)*.43+y*.31)+22*Math.cos((x-dx)*.21-y*.53)+19*Math.sin((x-dx)*.73+y*.17);return {data,width,height,x:0,y:0};}
const tracker=createImageAnchor();tracker.update(frame(),points(),width,height,0);
let rawError=0,correctedError=0;
for(let i=1;i<=30;i++){
 const noise=i%2?2:-2;
 const c=tracker.update(frame(i),points(i+noise),width,height,i*1000/30);
 assert(c && c.matches>=5,'textured patches track true image movement');
 rawError+=noise**2;correctedError+=(noise+c.x*width)**2;
 assert(Math.abs(c.y*height)<.35,'no false vertical movement');
}
assert(correctedError<rawError*.4,'image motion reduces coherent detector translation noise');
console.log(`Known image motion: detector noise RMS ${Math.sqrt(rawError/30).toFixed(2)}px → ${Math.sqrt(correctedError/30).toFixed(2)}px`);
const blank=tracker.update(frame(0,true),points(),width,height,1100);
assert(blank && blank.matches===0,'untextured frame rejected without sudden offset reset');
assert.equal(tracker.update(frame(),null,width,height,1133),null,'lost face resets');
assert.equal(tracker.update(frame(),points(),width,height,1166),null,'reacquire without old correction');
assert.equal(tracker.update(frame(),points(),width,height,2000),null,'long gap resets');
console.log('Low texture, face loss, reacquisition and frame gaps: passed');

// A stationary image with coherent detector scale/roll noise must not make
// the painted lip breathe. Correct geometry, without slowing actual motion.
const poseTracker=createImageAnchor(),poseBase=points();
poseTracker.update(frame(),poseBase,width,height,0);
let rawPoseError=0,anchoredPoseError=0;
for(let i=1;i<=45;i++){
 const scale=1+(i%2?.012:-.012),angle=i%2?.012:-.012;
 const raw=poseBase.map(p=>{const x=p.x*width-125,y=p.y*height-90;return {...p,x:(125+scale*(x*Math.cos(angle)-y*Math.sin(angle)))/width,y:(90+scale*(x*Math.sin(angle)+y*Math.cos(angle)))/height};});
 const c=poseTracker.update(frame(),raw,width,height,i*1000/30);
 assert(c&&c.matches>=5);
 const vx=(raw[291].x-raw[61].x)*width,vy=(raw[291].y-raw[61].y)*height;
 const bx=(poseBase[291].x-poseBase[61].x)*width,by=(poseBase[291].y-poseBase[61].y)*height;
 const a=1+(c.scaleDelta??0),b=c.rotationDelta??0;
 rawPoseError+=(vx-bx)**2+(vy-by)**2;
 anchoredPoseError+=(a*vx-b*vy-bx)**2+(b*vx+a*vy-by)**2;
 assert(Math.abs(c.motion.width??1)<.5,'image motion distinguishes detector width noise from a real purse');
}
assert(anchoredPoseError<rawPoseError*.4,'image texture corrects scale and roll noise');
console.log('Image-confirmed pose jitter RMS: '+Math.sqrt(rawPoseError/45).toFixed(3)+'px → '+Math.sqrt(anchoredPoseError/45).toFixed(3)+'px');
