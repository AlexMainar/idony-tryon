// Build a local-only browser check. The supplied camera fixture stays on disk.
// Usage: node scripts/render/build-complexion-gpu-check.mjs fixture.json [output.html]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
const [fixturePath,outputPath=path.join(os.tmpdir(),'idony-complexion-check.html')]=process.argv.slice(2);
if(!fixturePath)throw Error('Pass a saved Ethereal fixture JSON. Output is a local HTML file.');
const root=process.cwd(),fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
if(!fixture.basePng||!fixture.landmarks||!fixture.width||!fixture.height)throw Error('Invalid camera fixture');
const modules=new Map();
function compile(file){
 if(modules.has(file))return modules.get(file);
 let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
 code=code.replace(/from\s+["']([^"']+)["']/g,(_,name)=>{
  if(!name.startsWith('.')&&!name.startsWith('@/'))throw Error('Unexpected dependency: '+name);
  const target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);
  return 'from '+JSON.stringify(compile(target+'.ts'));
 });
 const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');modules.set(file,url);return url;
}
const imports=[
 ['createMobileComplexionRenderer','lib/render/mobile/complexionRenderer.ts'],
 ['renderBronzer','lib/render/tonePresets/bronzer.ts'],
 ['renderBlush','lib/render/tonePresets/blush.ts'],
].map(([name,file])=>`import {${name}} from ${JSON.stringify(compile(path.join(root,file)))};`).join('\n');
const catalog=JSON.parse(fs.readFileSync('data/products.json','utf8'));
const script=imports+`
const fixture=${JSON.stringify(fixture)},catalog=${JSON.stringify(catalog)};
const image=new Image();image.src=fixture.basePng;await image.decode();
const canvas=document.createElement('canvas');canvas.width=fixture.width;canvas.height=fixture.height;
const ctx=canvas.getContext('2d',{willReadFrequently:true});
const rgba=(hex,alpha)=>{const n=parseInt(hex.slice(1),16);return 'rgba('+[n>>16,(n>>8)&255,n&255,alpha].join(',')+')';};
let drawCalls=0;const original=WebGLRenderingContext.prototype.drawArrays;
WebGLRenderingContext.prototype.drawArrays=function(...args){drawCalls++;return original.apply(this,args);};
const gpu=createMobileComplexionRenderer(),report=[];
const paint=(fn,tone,useGpu,points=fixture.landmarks)=>{
 ctx.drawImage(image,0,0);const start=performance.now();
 const draw=()=>fn(ctx,points,tone,canvas.width,canvas.height,rgba);
 if(useGpu)gpu.draw(ctx,draw);else draw();
 return {ms:performance.now()-start,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
};
let passed=true;
try {
 for(const key of ['dream_paint_bronzer','dream_paint_blush_ibiza','dream_paint_blush_chelsea','flush_bloom_stick']){
  const render=key==='dream_paint_bronzer'?renderBronzer:renderBlush;
  paint(render,catalog[key],false);paint(render,catalog[key],true);
  let cpuMs=0,gpuMs=0,maxByteDifference=0,differentOverOne=0;
  for(let repeat=0;repeat<3;repeat++){
   const cpu=paint(render,catalog[key],false),actual=paint(render,catalog[key],true);
   cpuMs+=cpu.ms;gpuMs+=actual.ms;
   for(let i=0;i<cpu.pixels.length;i++){
    const difference=Math.abs(cpu.pixels[i]-actual.pixels[i]);
    maxByteDifference=Math.max(maxByteDifference,difference);if(difference>1)differentOverOne++;
   }
  }
  passed&&=maxByteDifference<=1;
  report.push({product:key,cpuMs:cpuMs/3,gpuMs:gpuMs/3,maxByteDifference,differentOverOne});
 }
 ctx.drawImage(image,0,0);const before=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 gpu.draw(ctx,()=>{});const after=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 const noProductUnchanged=before.every((v,i)=>v===after[i]);passed&&=noProductUnchanged&&drawCalls>0;
 report.push({noProductUnchanged,actualGpuDrawCalls:drawCalls});
}finally{gpu.dispose();WebGLRenderingContext.prototype.drawArrays=original;}
document.title=(passed?'PASS':'FAIL')+' mobile pigment check';
document.body.innerHTML=report.map(item=>'<pre>'+JSON.stringify(item,null,2)+'</pre>').join('');
`;
fs.writeFileSync(outputPath,'<!doctype html><meta charset="utf-8"><title>Running mobile pigment check</title><pre>Running…</pre><script type="module">'+script.replaceAll('</script','<\\/script')+'</script>');
console.log(outputPath);
