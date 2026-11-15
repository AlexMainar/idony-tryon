// Generates an offline WebGL check using a supplied local camera fixture.
// Does not create a route in the application or upload images.
import fs from 'node:fs';import path from 'node:path';import {createRequire}from'node:module';
const root=process.cwd(),require=createRequire(root+'/package.json'),ts=require('typescript');const cache=new Map();
if(!process.argv[2])throw new Error('Usage: node scripts/render/build-ethereal-gpu-check.mjs fixture.json [output.html] [material] [renderer.ts]');
const output=process.argv[3]||'/tmp/ethereal-gpu-check.html';
const rendererPath=process.argv[5]||root+'/lib/render/ethereal/renderer.ts';
function compile(file){if(cache.has(file))return cache.get(file);let s=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;s=s.replace(/from\s+["']([^"']+)["']/g,(_,v)=>'from '+JSON.stringify(compile((v.startsWith('@/')?path.join(root,v.slice(2)):path.resolve(path.dirname(file),v))+'.ts')));const u='data:text/javascript;base64,'+Buffer.from(s).toString('base64');cache.set(file,u);return u;}
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
const material=process.argv[4] || fixture.renderState?.material || 'surface';
const tone=JSON.parse(fs.readFileSync(root+'/data/products.json')).ethereal_luminizer;
const imports=`import {createEtherealRenderer as createRenderer} from ${JSON.stringify(compile(rendererPath))};import {canonicalCheeks} from ${JSON.stringify(compile(root+'/lib/render/ethereal/canonical.ts'))};import {filmCheeks} from ${JSON.stringify(compile(root+'/lib/render/ethereal/filmCanonical.ts'))};import {posePositions} from ${JSON.stringify(compile(root+'/lib/render/ethereal/headPose.ts'))};const createEtherealRenderer=()=>createRenderer(${JSON.stringify(material)});`;
const script=imports+`
const fixture=${JSON.stringify(fixture)},tone=${JSON.stringify(tone)};
const status=document.querySelector('pre');const reports=[];
function assert(ok,message){if(!ok)throw Error(message);reports.push(message)}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function diff(a,b){let sum=0,max=0,pixels=0;for(let i=0;i<a.length;i+=4){let d=0;for(let k=0;k<3;k++){const v=Math.abs(a[i+k]-b[i+k]);sum+=v;d+=v;max=Math.max(max,v)}if(d>0)pixels++}return {sum,max,pixels};}
function read(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data}
try{
const source=canvas(640,360),ctx=source.getContext('2d');ctx.fillStyle='#9a7152';ctx.fillRect(0,0,640,360);ctx.fillStyle='#1c57bd';ctx.fillRect(0,0,40,30);ctx.fillStyle='#da733f';ctx.fillRect(600,330,40,30);
const out=canvas(640,360),o=out.getContext('2d'),renderer=createEtherealRenderer();
const options={source,landmarks:null,product:tone,exposureGain:1,enabled:false,frozen:false,timestampMs:1000};
renderer.draw(o,options);const identity=diff(read(source),read(out));assert(identity.max<=1,'GPU camera identity and UV orientation');
const pos=new Map(canonicalCheeks.ids.map((id,i)=>[id,canonicalCheeks.positions[i]]));for(const [id,p]of Object.entries(canonicalCheeks.anchors))pos.set(+id,p);for(const [id,p]of Object.entries(canonicalCheeks.lightSamples))pos.set(+id,p.position);
if(${JSON.stringify(material)}==='film')filmCheeks.ids.forEach((id,i)=>pos.set(id,filmCheeks.positions[i]));
if(${JSON.stringify(material)}==='film')for(const [id,p]of posePositions)pos.set(id,p);
function face(yaw){const pts=Array.from({length:478},()=>({x:NaN,y:NaN,z:NaN}));for(const [id,p]of pos){const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);pts[id]={x:.5+x*.035,y:.5-p[1]*.035*640/360,z:-z*.035}}return pts;}
const pts=face(0);renderer.draw(o,{...options,landmarks:pts,enabled:false,exposureGain:1.3,timestampMs:1200});const base=new Uint8ClampedArray(read(out));renderer.draw(o,{...options,landmarks:pts,enabled:true,exposureGain:1.3,frozen:true,timestampMs:1300});const added=diff(base,read(out));assert(added.pixels>20&&added.max>0,'Surface reflection produces visible local change');assert(added.pixels<640*360*.15,'Reflection stays local to cheek coverage');assert(read(out)[0]===base[0],'Same exposure outside makeup with product on/off');
const first=new Uint8ClampedArray(read(out));renderer.draw(o,{...options,landmarks:pts,enabled:true,exposureGain:1.3,frozen:true,timestampMs:9999});assert(diff(first,read(out)).max===0,'Frozen GPU result is deterministic');
renderer.draw(o,{...options,landmarks:pts,product:{...tone,opacity:0},enabled:true,exposureGain:1.3,frozen:true,timestampMs:9999});assert(diff(base,read(out)).max<=1,'Zero product amount recovers camera exactly');
let depositionCheck;
if(${JSON.stringify(material)}==='film'){
  const saved=ctx.getImageData(0,0,640,360),pattern=ctx.createImageData(640,360);
  for(let y=0;y<360;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4,v=x%2?150:100;pattern.data[i]=pattern.data[i+1]=pattern.data[i+2]=v;pattern.data[i+3]=255;}
  ctx.putImageData(pattern,0,0);
  const testOptions={...options,landmarks:pts,exposureGain:1,frozen:true};
  renderer.draw(o,{...testOptions,enabled:false});const bare=new Uint8ClampedArray(read(out));
  renderer.draw(o,{...testOptions,enabled:true});const full=new Uint8ClampedArray(read(out));
  const energy=a=>{let s=0;for(let i=0;i<a.length;i+=4)for(let k=0;k<3;k++)s+=Math.max(0,a[i+k]-bare[i+k]);return s;};
  renderer.draw(o,{...testOptions,enabled:true,product:{...tone,opacity:.46*.25}});const quarterEnergy=energy(read(out))/energy(full);
  assert(quarterEnergy<.45,'Thin deposition stays substantially weaker than full deposition');
  const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
  const contrasts=[];
  for(const id of [116,117,345,346])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx+=2){
    const x=Math.floor(pts[id].x*640)+dx,y=Math.floor(pts[id].y*360)+dy,i=(y*640+x)*4;
    const contrast=a=>{const l=linear(a[i]),r=linear(a[i+4]);return Math.abs(l-r)/(l+r);};
    contrasts.push(contrast(full)/contrast(bare));
  }
  contrasts.sort((a,b)=>a-b);const textureContrastRatio=contrasts[contrasts.length>>1];
  assert(textureContrastRatio>.9,'Coating preserves substrate microcontrast rather than filling it with uniform white (ratio '+textureContrastRatio.toFixed(4)+')');
  depositionCheck={quarterEnergy,textureContrastRatio};ctx.putImageData(saved,0,0);
}
const peaks=[];for(const angle of [-.5,0,.5]){renderer.draw(o,{...options,landmarks:face(angle),enabled:true,frozen:true});peaks.push(diff(read(source),read(out)).sum)}assert(new Set(peaks).size===3,'Reflection responds to head yaw');
renderer.dispose();renderer.dispose();let rejected=false;try{renderer.draw(o,options)}catch{rejected=true}assert(rejected,'Disposed renderer rejects use');
const image=new Image();image.src=fixture.basePng;await image.decode();const src=canvas(fixture.width,fixture.height);src.getContext('2d').drawImage(image,0,0);const real=createEtherealRenderer();
for(const enabled of [false,true]){const c=canvas(fixture.width,fixture.height);const label=document.createElement('p');label.textContent=enabled?'CON superficie Ethereal':'SIN producto';document.querySelector('section').append(label,c);real.draw(c.getContext('2d'),{source:src,landmarks:fixture.landmarks,product:fixture.productData??tone,exposureGain:fixture.renderState?.exposureGain??1,lightingOverride:fixture.renderState?.lighting,surfaceOverride:fixture.renderState?.surface,enabled,frozen:enabled,timestampMs:performance.now()});}
real.dispose();reports.push('Fixture camera + surface rendered without camera permission');status.textContent='PASS\\n'+reports.join('\\n')+'\\n'+JSON.stringify({identity,added,yawEnergy:peaks,depositionCheck});document.title='PASS Ethereal GPU';
}catch(error){status.textContent='FAIL: '+error.message;document.title='FAIL Ethereal GPU';}
`;
fs.writeFileSync(output,'<!doctype html><meta charset="utf-8"><title>Ethereal GPU</title><style>body{background:#222;color:white;font:16px monospace}pre{white-space:pre-wrap}canvas{width:600px;max-width:90vw}section{display:flex;flex-wrap:wrap;gap:10px}p{width:100%;margin:0}</style><pre>Running WebGL checks…</pre><section></section><script type="module">'+script+'</script>');
console.log('Temporary GPU fixture check ready');
