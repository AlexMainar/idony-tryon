// Offline audit of the actual camera geometry against a recorded diagnostic.
// Usage: node scripts/lip-lab/audit-recorded-surface.mjs /path/to/capture.json
// Images and landmarks remain local; output contains aggregate metrics only.
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
async function load(path) {
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const { buildCanonicalLipGeometry } = await load('../../lib/render/lipOil/canonicalGeometry.ts');
const { bindLipGeometry } = await load('../../lib/render/lipOil/deformGeometry.ts');
const { parseLipDiagnostic } = await load('../../lib/render/lipOil/diagnosticCapture.ts');
if (!process.argv[2]) throw new Error('Supply a diagnostic JSON path.');
const clip = parseLipDiagnostic(fs.readFileSync(process.argv[2], 'utf8'));
function stats(values) {
  if (!values.length) return null;
  const v = [...values].sort((a,b)=>a-b);
  return { median:v[Math.floor((v.length-1)*.5)], p95:v[Math.floor((v.length-1)*.95)], max:v.at(-1) };
}
const report = { frames:clip.frames.length, surfaces:[] };
for (const source of ['raw','stabilized']) for (const kind of ['upper','lower']) {
  const geometry=buildCanonicalLipGeometry(THREE,{kind,widthSegments:72,heightSegments:16,
    frontDepth:kind==='upper'?.25:.27,backDepth:kind==='upper'?.12:.14});
  const binding=bindLipGeometry(geometry,kind), indices=geometry.index.array;
  const normals=[], steps=[], foldedAreas=[];
  let previous=null, invalid=0, maxFolded=0;
  for (const frame of clip.frames) {
    if (!frame[source] || !binding.update(frame[source],clip.width,clip.height,true)) {
      previous=null; invalid++; continue;
    }
    const p=geometry.attributes.position.array,n=geometry.attributes.normal.array;
    if (!Array.from(p).every(Number.isFinite)) throw new Error('Non-finite surface');
    let folded=0;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      if(a>=binding.frontCount||b>=binding.frontCount||c>=binding.frontCount)continue;
      const area=((p[b*3]-p[a*3])*(p[c*3+1]-p[a*3+1])-(p[b*3+1]-p[a*3+1])*(p[c*3]-p[a*3]))/2;
      if(area<0){folded++;foldedAreas.push(-area);}
    }
    maxFolded=Math.max(maxFolded,folded);
    // Center of the canonical front surface, followed across saved frames.
    const offset=(36*17+8)*3;
    const current={position:new THREE.Vector3().fromArray(p,offset),normal:new THREE.Vector3().fromArray(n,offset)};
    if(previous){
      normals.push(THREE.MathUtils.radToDeg(previous.normal.angleTo(current.normal)));
      steps.push(previous.position.distanceTo(current.position));
    }
    previous=current;
  }
  report.surfaces.push({source,kind,invalid,maxFoldedFrontTriangles:maxFolded,
    foldedTriangleAreaPx2:stats(foldedAreas),centerNormalStepDegrees:stats(normals),centerPositionStepPx:stats(steps)});
  geometry.dispose();
}
console.log(JSON.stringify(report,null,2));
