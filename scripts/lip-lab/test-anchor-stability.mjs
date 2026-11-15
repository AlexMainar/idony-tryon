import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../../lib/render/lipOil/stabilizeLandmarks.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { createLipStabilizer } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const width = 960, height = 720;
const face = [33,133,362,263,168,6,197,195,234,454,98,327,2,164,57,287,43,273];
const upper = [61,185,40,39,37,0,267,269,270,409,291,78,191,80,81,82,13,312,311,310,415,308];
const lower = [61,146,91,181,84,17,314,405,321,375,291,78,95,88,178,87,14,317,402,318,324,308];
const lips = [...new Set([...upper,...lower])];
function fixture() {
  const points = Array.from({length:478}, () => ({x:.5,y:.5,z:0}));
  face.forEach((id,i) => {points[id]={x:.5+.2*Math.cos(i*.7),y:.35+.13*Math.sin(i*.7),z:0};});
  upper.forEach((id,i) => {points[id]={x:.4+.2*(i%11)/10,y:.59-.025*Math.sin(Math.PI*(i%11)/10),z:0};});
  lower.forEach((id,i) => {points[id]={x:.4+.2*(i%11)/10,y:.59+.025*Math.sin(Math.PI*(i%11)/10),z:0};});
  return points;
}
const copy = ps => ps.map(p => ({...p}));
const rms = values => Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length);
const baseline = fixture();
const jitterFilter = createLipStabilizer();
jitterFilter.update(baseline,width,height,0);
const rawErrors=[], filteredErrors=[];
for(let frame=1;frame<=90;frame++) {
  const raw=copy(baseline), jitter=(frame%2 ? 1 : -1)*.65/width;
  for(const i of lips) raw[i].x+=jitter;
  const original=JSON.stringify(raw);
  const filtered=jitterFilter.update(raw,width,height,frame*1000/30);
  assert.equal(JSON.stringify(raw),original,'do not mutate detector results');
  if(frame>10) {rawErrors.push(jitter*width);filteredErrors.push((filtered[0].x-baseline[0].x)*width);}
}
assert(rms(filteredErrors)<rms(rawErrors)*.55,'reduce subpixel contour noise');
console.log(`Contour jitter RMS: ${rms(rawErrors).toFixed(3)}px → ${rms(filteredErrors).toFixed(3)}px`);

// A moving face must not be low-pass filtered in screen space.
for(const [name,map] of [
  ['translation',p=>({...p,x:p.x+.016,y:p.y-.011})],
  ['roll/scale',p=>({...p,x:.5+1.02*((p.x-.5)*Math.cos(.09)-(p.y-.5)*height/width*Math.sin(.09)),y:.5+1.02*((p.x-.5)*width/height*Math.sin(.09)+(p.y-.5)*Math.cos(.09))})],
  ['yaw approximation',p=>({...p,x:.5+(p.x-.5)*.97+.015*(p.y-.5),y:p.y+.006*(p.x-.5)})],
]) {
 const tracker=createLipStabilizer(); let raw=copy(baseline);tracker.update(raw,width,height,0);
 for(let f=1;f<15;f++) {
   raw=raw.map(map);const filtered=tracker.update(raw,width,height,f*1000/30);
   for(const i of lips) assert(Math.hypot((filtered[i].x-raw[i].x)*width,(filtered[i].y-raw[i].y)*height)<(name === 'yaw approximation' ? 2 : 1e-6),`${name}: bounded tracking error`);
 }
 console.log(`${name}: tracking error within tolerance`);
}
const expression=createLipStabilizer();expression.update(baseline,width,height,0);
const open=copy(baseline);open[13].y-=.02;open[14].y+=.02;
assert.deepEqual(expression.update(open,width,height,33)[14],open[14],'opening follows immediately');
assert.deepEqual(expression.update(baseline,width,height,66)[14],baseline[14],'closing follows immediately');
assert.equal(expression.update(null,width,height,99),null);
const moved=baseline.map(p=>({...p,x:p.x+.1}));
assert.deepEqual(expression.update(moved,width,height,132),moved,'reacquire without old anchor');
assert.deepEqual(expression.update(baseline,width,height,1000),baseline,'reset after freeze/time gap');
const invalid=copy(baseline);invalid[0].x=NaN;
assert.equal(expression.update(invalid,width,height,1033),null);
console.log('Opening, closing, face loss, reacquisition, freeze and invalid data: passed');

// Pursing and pressing closed lips must not be mistaken for detector noise.
for(const expressionName of ['purse','press']) {
 const tracker=createLipStabilizer();tracker.update(baseline,width,height,0);
 const changed=copy(baseline);
 if(expressionName==='purse')for(const id of lips)changed[id].x=.5+(changed[id].x-.5)*.94;
 else {changed[0].y+=.012;changed[17].y-=.012;}
 const actual=tracker.update(changed,width,height,33);
 for(const id of lips)assert(Math.hypot((actual[id].x-changed[id].x)*width,(actual[id].y-changed[id].y)*height)<1e-6,expressionName+': expression must follow the current mouth');
}
console.log('Pursing and closed-lip compression follow the current frame.');

// Size noise used to trigger the expression bypass on every frame. Pixel
// evidence of a stationary mouth must keep residual denoising active.
const breathing=createLipStabilizer();breathing.update(baseline,width,height,0);
const rawBreathing=[],filteredBreathing=[];
for(let frame=1;frame<=90;frame++){
 const raw=copy(baseline),scale=1+(frame%2?.02:-.02);
 for(const id of lips)raw[id].x=.5+(raw[id].x-.5)*scale;
 const actual=breathing.update(raw,width,height,frame*1000/30,{x:0,y:0,motion:{width:0,height:0,gap:0}});
 if(frame>10){rawBreathing.push((raw[61].x-baseline[61].x)*width);filteredBreathing.push((actual[61].x-baseline[61].x)*width);}
}
assert(rms(filteredBreathing)<rms(rawBreathing)*.6,'stationary pixels must suppress detector size noise');
console.log('Image-confirmed size jitter RMS: '+rms(rawBreathing).toFixed(3)+'px → '+rms(filteredBreathing).toFixed(3)+'px');
const realPurse=createLipStabilizer();realPurse.update(baseline,width,height,0);
const pursed=copy(baseline);for(const id of lips)pursed[id].x=.5+(pursed[id].x-.5)*.94;
const follow=realPurse.update(pursed,width,height,33,{x:0,y:0,motion:{width:-12,height:0,gap:0}});
for(const id of lips)assert(Math.abs(follow[id].x-pursed[id].x)<1e-10,'image-confirmed expression follows immediately');
