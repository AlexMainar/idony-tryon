// Offline GPU verification of the light buffers; no application route or camera.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),cache=new Map();
function compile(file){
  if(cache.has(file))return cache.get(file);
  let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
  code=code.replace(/from\s+["']([^"']+)["']/g,(_,v)=>'from '+JSON.stringify(compile(path.resolve(path.dirname(file),v)+'.ts')));
  const uri='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,uri);return uri;
}
const source=process.argv[3]||root+'/lib/render/ethereal/filmPost.ts';
const output=process.argv[2]||'/tmp/ethereal-diffusion-check.html';
const code=`import{createFilmPost,LIGHT_RANGE,diffusionKernel}from ${JSON.stringify(compile(source))};
const reports=[];function assert(ok,message){if(!ok)throw Error(message);reports.push(message)}
try{
assert(Math.abs(diffusionKernel.reduce((a,b)=>a+b)-1)<1e-12,'Diffusion kernel preserves total reflected energy');
const c=document.createElement('canvas');c.width=256;c.height=192;
const gl=c.getContext('webgl',{alpha:false,premultipliedAlpha:false});if(!gl)throw Error('WebGL unavailable');
const post=createFilmPost(gl),camera=gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D,camera);for(const flag of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,flag,gl.LINEAR);
for(const flag of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,flag,gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
const luma=(p,i)=>.2126*linear(p[i])+.7152*linear(p[i+1])+.0722*linear(p[i+2]);
function read(){const p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}
function clearEnergy(value,density=1){const code=Math.round(value/LIGHT_RANGE*65535),hi=Math.floor(code/256);gl.clearColor(hi/255,(code-hi*256)/255,1,density);gl.clear(gl.COLOR_BUFFER_BIT);}
function render(uniform,impulse=false,cutout=false,density=1,amount=1){
 post.resize(c.width,c.height);post.begin();clearEnergy(uniform,density);
 if(impulse){gl.enable(gl.SCISSOR_TEST);gl.scissor(c.width/2-4,c.height/2-4,8,8);clearEnergy(.04,density);gl.disable(gl.SCISSOR_TEST);}
 if(cutout){gl.enable(gl.SCISSOR_TEST);gl.scissor(c.width/2-2,c.height/2-2,4,4);clearEnergy(0,0);gl.disable(gl.SCISSOR_TEST);}
 post.compose(camera,c.width,c.height,.4,1,true,amount);return read();
}
for(const energy of [.0038,.00392,.00394,.01,.04,.08]){
 const p=render(energy);let low=1,high=0;
 for(let i=0;i<p.length;i+=4){const e=luma(p,i);low=Math.min(low,e);high=Math.max(high,e);}
 assert(high-low<1e-8&&Math.abs(low-energy)<.001,'Packed/filterable light stays uniform across byte boundaries at '+energy);
}
function profile(p){
 let sum=0,tail=0;
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
  const value=luma(p,(y*c.width+x)*4);sum+=value;
  if(Math.abs(x-c.width/2)>9||Math.abs(y-c.height/2)>9)tail+=value;
 }
 return {massRatio:sum/(.04*8*8),haloFraction:tail/sum,center:luma(p,((c.height/2)*c.width+c.width/2)*4)};
}
const core=profile(render(0,true)),edge=profile(render(0,true,false,.1));
assert([core,edge].every(p=>p.massRatio>.9&&p.massRatio<1.1),'Each fixed-concentration blend redistributes its input light without adding a second layer');
// The core redistributes 8% of its light. A small impulse must retain its
// focused contribution; the extra blurred peak depends on the impulse size.
assert(edge.haloFraction>.08&&core.haloFraction<.05&&core.center>.04*.92&&edge.center<.04*.90,'Core retains its 92% focused contribution while thin product spreads light into the halo '+JSON.stringify({core,edge}));
const partial=render(0,true,false,.1,.25),full=render(0,true,false,.1);
assert(partial.every((v,i)=>v===full[i]),'Focus and blend depend on spatial deposition independently of global product amount');
const cutout=render(0,true,true),at=((c.height/2)*c.width+c.width/2)*4;
assert(luma(cutout,at)===0,'Diffused light respects the original surface exclusion');
const before=render(.01);c.width=320;c.height=180;render(.01);c.width=256;c.height=192;const after=render(.01);
assert(before.every((v,i)=>v===after[i]),'Light buffers resize without changing radiometry or orientation');
const colourReports=[];
for(const rgb of [[154,113,82],[90,56,43],[200,160,140]]){
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,camera);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([...rgb,255]));
 const base=rgb.map(linear),y=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
 const transmission=1-(((1.46-1)/(1.46+1))**2)*.35;
 const out=render(.04),value=[0,1,2].map(i=>linear(out[i]));
 const energy=y(value)-y(base)*transmission;
 const chromaError=v=>Math.hypot(...v.map((n,i)=>n/y(v)-base[i]/y(base)));
 const neutral=base.map(v=>v*transmission+.04),retentionError=chromaError(value)/chromaError(neutral);
 assert(Math.abs(energy-.04)<.002,'Colour correction preserves reflected luminance on skin '+rgb);
 assert(retentionError<.65,'Reflected colour retains substantially more skin chromaticity than a neutral-white addition '+rgb);
 colourReports.push({rgb,reflectedLuminance:energy,relativeChromaError:retentionError});
}
post.dispose();gl.deleteTexture(camera);gl.getExtension('WEBGL_lose_context')?.loseContext();
document.querySelector('pre').textContent='PASS\\n'+reports.join('\\n')+'\\n'+JSON.stringify({core,edge,colourReports});document.title='PASS Ethereal diffusion';
}catch(error){document.querySelector('pre').textContent='FAIL: '+error.message;document.title='FAIL Ethereal diffusion';}`;
fs.writeFileSync(output,'<!doctype html><meta charset="utf-8"><style>body{background:#222;color:white;font:18px monospace}pre{white-space:pre-wrap}</style><pre>Running diffusion checks…</pre><script type="module">'+code+'</script>');
console.log('Offline diffusion check ready: '+output);
