import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const modules=new Map();
function compile(file){
 if(modules.has(file))return modules.get(file);
 let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
 code=code.replace(/from\s+["']([^"']+)["']/g,(_,name)=>'from '+JSON.stringify(compile(path.resolve(path.dirname(file),name+'.ts'))));
 const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');modules.set(file,url);return url;
}
const {createMobileLipTracker}=await import(compile(path.resolve('lib/render/mobile/lipTracker.ts')));
const {LIP_ANCHORS}=await import(compile(path.resolve('lib/render/lipOil/deformGeometry.ts')));
const w=360,h=240;
const baseline=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
for(const [id,x,y]of [[98,140,116],[327,220,116],[2,180,110],[164,180,120],[57,116,138],[287,244,138],[43,128,120],[273,232,120],[106,100,110],[335,260,110],[18,180,174]])baseline[id]={x:x/w,y:y/h,z:0};
for(const [kind,sign]of [['upper',-1],['lower',1]])for(const [edge,ry]of [['outer',15],['inner',5]]){
 LIP_ANCHORS[kind][edge].forEach((id,i)=>baseline[id]={x:(110+i*14)/w,y:(140+sign*ry*Math.sin(Math.PI*i/10))/h,z:0});
}
const lips=[...new Set(Object.values(LIP_ANCHORS).flatMap(p=>[...p.outer,...p.inner]))];
const pose=(points,dx=0,dy=0,scale=1,angle=0)=>points.map(p=>{
 const x=p.x*w-180,y=p.y*h-130;
 return {...p,x:(180+dx+scale*(x*Math.cos(angle)-y*Math.sin(angle)))/w,y:(130+dy+scale*(x*Math.sin(angle)+y*Math.cos(angle)))/h};
});
let imagePose={dx:0,dy:0,scale:1,angle:0};
const ctx={getImageData(left,top,width,height){
 const data=new Uint8ClampedArray(width*height*4),p=imagePose,c=Math.cos(p.angle),s=Math.sin(p.angle);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=left+x-180-p.dx,dy=top+y-130-p.dy;
  const sx=180+(dx*c+dy*s)/p.scale,sy=130+(-dx*s+dy*c)/p.scale;
  const value=128+28*Math.sin(sx*.43+sy*.31)+22*Math.cos(sx*.21-sy*.53)+19*Math.sin(sx*.73+sy*.17),i=(y*width+x)*4;
  data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 return {data};
}};
const error=(a,b)=>Math.sqrt(lips.reduce((sum,i)=>sum+((a[i].x-b[i].x)*w)**2+((a[i].y-b[i].y)*h)**2,0)/lips.length);
const moving=createMobileLipTracker();moving.update(ctx,baseline,w,h,0);
let maxLag=0;
for(let frame=1;frame<=40;frame++){
 imagePose={dx:frame*.8,dy:frame*.4,scale:1+frame*.001,angle:frame*.001};
 const actual=pose(baseline,...Object.values(imagePose));
 maxLag=Math.max(maxLag,error(moving.update(ctx,actual,w,h,frame*1000/30),actual));
}
assert(maxLag<.4,'real camera movement must not trail a smoothed pose: '+maxLag);
console.log('Real image translation/roll/scale: maximum tracking error '+maxLag.toFixed(3)+'px');
imagePose={dx:0,dy:0,scale:1,angle:0};
const noisy=createMobileLipTracker();noisy.update(ctx,baseline,w,h,0);
let rawSquared=0,filteredSquared=0;
for(let frame=1;frame<=60;frame++){
 const sign=frame%2?1:-1,raw=pose(baseline,sign*1.2,sign*.8,1+sign*.012,sign*.012);
 const filtered=noisy.update(ctx,raw,w,h,frame*1000/30);
 if(frame>10){rawSquared+=error(raw,baseline)**2;filteredSquared+=error(filtered,baseline)**2;}
}
assert(filteredSquared<rawSquared*.3,'image-guided pose must remove detector noise without smoothing true motion');
console.log('Composite pose jitter RMS: '+Math.sqrt(rawSquared/50).toFixed(3)+'px → '+Math.sqrt(filteredSquared/50).toFixed(3)+'px');
noisy.reset();assert.deepEqual(noisy.update(ctx,baseline,w,h,3000),baseline,'reopen must not reuse old image correction');
assert.equal(noisy.update(ctx,null,w,h,3033),null);
