import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const base=process.argv[2]||'lib/render/ethereal';
const code=ts.transpileModule(fs.readFileSync(base+'/filmMaterial.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {filmF0,filmTransmission,filmFocus,etherealFilm}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
assert(filmF0>.03&&filmF0<.04);
for(let v=0;v<=100;v++)for(let amount=0;amount<=100;amount++){
  const t=filmTransmission(v/100,amount/100);
  assert(t>=.9475&&t<=1,'thin coating must keep at least 94.75% of camera substrate');
}
for(const nv of [0,.3,.7,1])assert.equal(filmTransmission(nv,0),1,'zero coating leaves camera unchanged');
assert(filmTransmission(1,1)>filmTransmission(.2,1),'Fresnel response changes smoothly toward grazing');
let previous=filmTransmission(0,1);for(let i=1;i<=100;i++){const next=filmTransmission(i/100,1);assert(next>=previous);assert(next-previous<.004);previous=next;}
console.log('Ethereal film: dielectric F0, bounded substrate transmission, zero-coverage identity and smooth Fresnel response passed.');

async function load(file) {
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {filmDensity}=await load(base+'/filmCoverage.ts');
const {createCoveragePixels,COVERAGE_SIZE}=await load(base+'/coverage.ts');
const {filmCheeks}=await load(base+'/filmCanonical.ts');
function application(coverage) {
  let mass=0,centerX=0,centerY=0,footprint=0,highCore=0,denseArea=0;
  for(let x=2;x<=8;x+=.025)for(let y=-2;y<=4;y+=.025){
    const c=coverage(x,y);
    assert(c>=0&&c<=1);
    assert.equal(c,coverage(-x,y),'same anatomical application on both cheeks');
    mass+=c;centerX+=x*c;centerY+=y*c;if(c>.1)footprint++;if(c>.9)highCore++;if(c>.65)denseArea+=.025**2;
  }
  return {centerX:centerX/mass,centerY:centerY/mass,footprint,highCore,denseArea};
}
const deposit=application(filmDensity);
assert(deposit.centerX>5.3&&deposit.centerY<.7,'application belongs on lateral cheekbone, away from infraorbital plane');
assert(deposit.highCore>0&&deposit.highCore<deposit.footprint*.1,'concentrated center must not become a broad fully loaded plateau');
assert(deposit.denseArea>.5&&deposit.denseArea<.9,'dense finish occupies a compact core, below 61% of the film-06 reference area (1.489)');
assert(deposit.footprint*.025**2>6.2,'medium/low deposition covers at least 18% more cheek area than film-08 (5.2425), with the dense core still bounded');
assert(filmDensity(5.65,.5)>.99,'product core sits on lateral cheekbone');
let lastDensity=1;const axis=Math.hypot(1,.45),bands=new Set();
for(let distance=.025;distance<=2.5;distance+=.025){
  const value=filmDensity(5.65+distance*.45/axis,.5-distance/axis);
  assert(value<=lastDensity+1e-10,'quantity must fall gradually away from deposit');
  assert(lastDensity-value<.065,'no abrupt contour at the blended edge');
  if(value>.05&&value<.95)bands.add(Math.floor(value*4));
  lastDensity=value;
}
assert(bands.size===4,'deposition must traverse thin, medium and concentrated quantities');
for(let x=2.5;x<=5;x+=.05)for(let y=1.25;y<=2.8;y+=.05){
  assert.equal(filmDensity(x,y),0,'keep full infraorbital area clear');
}
for(const [x,y]of [[0,0],[2,1],[3.177186,2.294265],[4.445859,2.663991],[5,-1.5],[7.8,1]])
  assert.equal(filmDensity(x,y),0,'exclude nose, eyelid, lower cheek and face boundary');
// The field must fade before the mesh boundary, including between vertices.
const edges=new Map();
for(const t of filmCheeks.triangles)for(let i=0;i<3;i++){
  const edge=[t[i],t[(i+1)%3]].sort((a,b)=>a-b),key=edge.join(',');
  edges.set(key,(edges.get(key)??0)+1);
}
for(const [key,count]of edges)if(count===1){
  const [a,b]=key.split(',').map(i=>filmCheeks.positions[+i]);
  for(let step=0;step<=10;step++){
    const t=step/10;
    const x=a[0]*(1-t)+b[0]*t,y=a[1]*(1-t)+b[1]*t;
    assert.equal(filmDensity(x,y),0,'deposition must end before support boundary');
  }
}
const pixels=createCoveragePixels(filmDensity);
const sample=(x,y,channel)=>pixels[(Math.floor((y+10)/20*COVERAGE_SIZE)*COVERAGE_SIZE+Math.floor((x+9)/18*COVERAGE_SIZE))*4+channel];
for(let i=0;i<pixels.length;i+=4)assert.equal(pixels[i],pixels[i+1],'one deposition field, without a second independently filled halo');
assert(sample(5.65,.5,0)>sample(5.65,-.65,0),'texture retains the central-to-thin deposition gradient');
const diffusion=density=>etherealFilm.edgeDiffusionMix+(etherealFilm.coreDiffusionMix-etherealFilm.edgeDiffusionMix)*filmFocus(density);
assert(diffusion(1)<.1&&diffusion(.1)>.7&&diffusion(.1)<.85,'center stays focused; outer spread retains skin-scale reflection alongside its diffused component');
let previousDiffusion=diffusion(0);
for(let i=1;i<=100;i++){
  const current=diffusion(i/100);
  assert(current<=previousDiffusion&&previousDiffusion-current<.025,'no abrupt blend boundary or ring between center and spread');
  previousDiffusion=current;
}
console.log('Ethereal film: concentrated deposition, gradual blending, anatomical exclusions, bilateral attachment and unclipped support passed.');
