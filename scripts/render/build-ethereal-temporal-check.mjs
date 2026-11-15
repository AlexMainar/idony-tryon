// Controlled temporal probes: fixed camera/lighting, synthetic detector or sensor noise.
// These are regression tests, not a substitute for a live-phone recording.
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const root=process.cwd(),cache=new Map();
function compile(file){
 if(cache.has(file))return cache.get(file);
 let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
 code=code.replace(/from\s+["']([^"']+)["']/g,(_,v)=>'from '+JSON.stringify(compile((v.startsWith('@/')?path.join(root,v.slice(2)):path.resolve(path.dirname(file),v))+'.ts')));
 const uri='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,uri);return uri;
}
if(!process.argv[2]||!process.argv[4]||!process.argv[5])throw Error('Usage: build-ethereal-temporal-check.mjs fixture output baseline.ts candidate.ts');
const f=JSON.parse(fs.readFileSync(process.argv[2]));
const code=`import{createEtherealRenderer as before}from ${JSON.stringify(compile(process.argv[4]))};import{createEtherealRenderer as after}from ${JSON.stringify(compile(process.argv[5]))};
const f=${JSON.stringify(f)},pre=document.querySelector('pre');
const canvas=()=>{const c=document.createElement('canvas');c.width=f.width;c.height=f.height;return c};
const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height);
const std=a=>{const mean=a.reduce((a,b)=>a+b,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)};
try{
 const image=new Image();image.src=f.basePng;await image.decode();const src=canvas(),out=canvas();const ctx=src.getContext('2d');ctx.drawImage(image,0,0);const original=read(src),reports={};
 for(const mode of ['depth','sensor','scale']){
  const results=[];
  for(const create of [before,after]){
   const renderer=create('film'),energies=[],centers=[],changes=[];let previous=null,elapsed=0;
   for(let n=0;n<36;n++){
    const noisy=new ImageData(new Uint8ClampedArray(original.data),f.width,f.height);
    if(mode==='sensor')for(let i=0;i<noisy.data.length;i+=4){const noise=((Math.imul(i+17,n*113+7919)>>>7)%5)-2;for(let k=0;k<3;k++)noisy.data[i+k]+=noise;}
    ctx.putImageData(noisy,0,0);
    const sign=n%2?1:-1;
    const points=f.landmarks.map(p=>({...p,z:p.z+(mode==='depth'?(p.x-.5)*sign*.004:0),x:mode==='scale'?.5+(p.x-.5)*(1+sign*.003):p.x,y:mode==='scale'?.5+(p.y-.5)*(1+sign*.003):p.y}));
    const t=performance.now();renderer.draw(out.getContext('2d'),{source:src,landmarks:points,product:f.productData,exposureGain:1,lightingOverride:f.renderState.lighting,enabled:true,frozen:false,timestampMs:1000+n*1000/30});const pixels=read(out).data;elapsed+=performance.now()-t;
    const delta=new Float32Array(f.width*f.height);let energy=0,x=0,y=0,diff=0;
    for(let j=0;j<delta.length;j++){
     const i=j*4;delta[j]=(.2126*(pixels[i]-noisy.data[i])+.7152*(pixels[i+1]-noisy.data[i+1])+.0722*(pixels[i+2]-noisy.data[i+2]));
     const e=Math.max(0,delta[j]);energy+=e;x+=(j%f.width)*e;y+=Math.floor(j/f.width)*e;
     if(previous)diff+=Math.abs(delta[j]-previous[j]);
    }
    if(n>8){energies.push(energy);centers.push([x/energy,y/energy]);if(previous)changes.push(diff/energy);}
    previous=delta;
   }
   const mean=energies.reduce((a,b)=>a+b,0)/energies.length;
   results.push({energyCv:std(energies)/mean,centroidRms:Math.hypot(std(centers.map(p=>p[0])),std(centers.map(p=>p[1]))),relativeFrameChange:changes.reduce((a,b)=>a+b,0)/changes.length,meanDrawReadbackMs:elapsed/36});renderer.dispose();
  }
  reports[mode]={before:results[0],after:results[1]};pre.textContent=JSON.stringify(reports,null,2);
 }
 pre.textContent='COMPLETE: fixed-camera temporal probes\\n'+JSON.stringify(reports,null,2);document.title='Ethereal temporal probes complete';
}catch(error){pre.textContent='FAIL: '+error.message;document.title='FAIL Ethereal temporal probes';}`;
fs.writeFileSync(process.argv[3],'<!doctype html><meta charset="utf-8"><style>body{background:#222;color:white;font:16px monospace}pre{white-space:pre-wrap}</style><pre>Running fixed-camera temporal probes…</pre><script type="module">'+code+'</script>');
console.log('Offline temporal probes ready.');
