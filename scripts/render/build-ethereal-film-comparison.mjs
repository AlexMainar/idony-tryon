// Offline comparison of the current surface and translucent film on the same saved frame.
// Only uses the supplied local fixture; no app route or external upload.
import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';
const root=process.cwd(),req=createRequire(root+'/package.json'),ts=req('typescript');const cache=new Map();
if (!process.argv[2]) throw new Error('Usage: node scripts/render/build-ethereal-film-comparison.mjs fixture.json [output.html] [baseline-renderer.ts] [candidate-renderer.ts]');
const output = process.argv[3] || '/tmp/ethereal-film-comparison.html';
function compile(file){if(cache.has(file))return cache.get(file);let source=fs.readFileSync(file,'utf8');let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;code=code.replace(/from\s+["']([^"']+)["']/g,(_,v)=>'from '+JSON.stringify(compile((v.startsWith('@/')?path.join(root,v.slice(2)):path.resolve(path.dirname(file),v))+'.ts')));const u='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,u);return u;}
const before=compile(process.argv[4] || root+'/lib/render/ethereal/renderer.ts');
const after=compile(process.argv[5] || root+'/lib/render/ethereal/renderer.ts');
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
const code=`import {createEtherealRenderer as createBefore} from ${JSON.stringify(before)};import{createEtherealRenderer as createFilm}from ${JSON.stringify(after)};const before=()=>createBefore(${JSON.stringify(process.argv[4] ? 'film' : 'surface')});const after=()=>createFilm("film");const f=${JSON.stringify(fixture)};
const canvas=()=>{const c=document.createElement('canvas');c.width=f.width;c.height=f.height;return c};const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;const section=document.querySelector('section'),status=document.querySelector('pre');
const points=f.landmarks.slice(0,468),minX=Math.max(0,Math.min(...points.map(p=>p.x))*f.width-15),minY=Math.max(0,Math.min(...points.map(p=>p.y))*f.height-20),maxX=Math.min(f.width,Math.max(...points.map(p=>p.x))*f.width+15),maxY=Math.min(f.height,Math.max(...points.map(p=>p.y))*f.height+20);
function show(name,c){const a=document.createElement('article'),label=document.createElement('p'),crop=document.createElement('canvas');crop.width=maxX-minX;crop.height=maxY-minY;crop.getContext('2d').drawImage(c,minX,minY,crop.width,crop.height,0,0,crop.width,crop.height);label.textContent=name;a.append(label,crop);section.append(a)}
function stats(a,b){let changed=0,positive=0,negative=0,peak=0;for(let i=0;i<a.length;i+=4){let d=0;for(let k=0;k<3;k++){const v=b[i+k]-a[i+k];positive+=Math.max(0,v);negative+=Math.max(0,-v);d+=Math.abs(v);peak=Math.max(peak,Math.abs(v))}if(d)changed++}return{changed,meanPositive:positive/Math.max(1,changed*3),meanNegative:negative/Math.max(1,changed*3),peak};}
try{const image=new Image();image.src=f.basePng;await image.decode();const src=canvas();src.getContext('2d').drawImage(image,0,0);const opts={source:src,landmarks:f.landmarks,product:f.productData,exposureGain:f.renderState.exposureGain,lightingOverride:f.renderState.lighting,surfaceOverride:f.renderState.surface,enabled:true,frozen:true,timestampMs:1000};const old=before(),next=after();const base=canvas(),a=canvas(),b=canvas();old.draw(base.getContext('2d'),{...opts,enabled:false});old.draw(a.getContext('2d'),opts);next.draw(b.getContext('2d'),opts);show('Sin producto',base);show('Actual',a);show('Película translúcida',b);const reports={actual:stats(read(base),read(a)),film:stats(read(base),read(b))};
const identity=canvas();next.draw(identity.getContext('2d'),{...opts,enabled:false});if(stats(read(base),read(identity)).changed)throw Error('Different base in film renderer');
next.draw(identity.getContext('2d'),opts);if(stats(read(b),read(identity)).changed)throw Error('Film not deterministic');
const durations=[],errors=[[],[]];const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
if('surfaceState' in next){
  let last;
  for(let i=1;i<=30;i++){
    const jitter=(i%2?1:-1)*.7;
    const landmarks=f.landmarks.map(p=>({...p,x:p.x+jitter/f.width,y:p.y-jitter*.4/f.height}));
    last={...opts,surfaceOverride:undefined,landmarks,frozen:false,timestampMs:1000+i*1000/30};
    const t=performance.now();next.draw(identity.getContext('2d'),last);read(identity);durations.push(performance.now()-t);
    if(i>8&&next.surfaceState)[117,346].forEach((id,k)=>errors[k].push((next.surfaceState.landmarks[id].x-f.landmarks[id].x)*f.width));
  }
  reports.stationaryImageJitterRms={raw:.7,cheeks:errors.map(rms)};
  reports.meanLiveFrameIncludingReadbackMs=durations.slice(5).reduce((a,b)=>a+b,0)/25;
  const saved=JSON.parse(JSON.stringify(next.surfaceState)),replay=after(),replayed=canvas();
  replay.draw(replayed.getContext('2d'),{...last,surfaceOverride:saved,frozen:true});
  if(stats(read(identity),read(replayed)).changed)throw Error('Saved surface state does not reproduce displayed frame');
  replay.dispose();reports.surfaceSnapshotReplay='exact';
}
old.dispose();next.dispose();status.textContent='PASS: misma base y fotograma, película determinista.\\n'+JSON.stringify(reports);document.title='Ethereal film: PASS';}catch(e){status.textContent='FAIL: '+e.message;document.title='Ethereal film: FAIL';}`;
fs.writeFileSync(output,'<!doctype html><meta charset="utf-8"><style>body{background:#222;color:white;font:16px Arial}section{display:flex;gap:12px}article{width:30vw}canvas{width:100%}pre{white-space:pre-wrap}</style><h1>Ethereal: película translúcida</h1><pre>Rendering…</pre><section></section><script type="module">'+code+'</script>');console.log('Film comparison ready: '+output);
