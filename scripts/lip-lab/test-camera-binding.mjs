import assert from 'node:assert/strict';
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
const { bindLipGeometry, LIP_ANCHORS } = await load('../../lib/render/lipOil/deformGeometry.ts');
for (const kind of ['upper', 'lower']) {
  const geometry = buildCanonicalLipGeometry(THREE, {
    kind, widthSegments: 72, heightSegments: 16, frontDepth: .26, backDepth: .13,
  });
  const binding = bindLipGeometry(geometry, kind);
  const indices = Array.from(geometry.index.array);
  const storage = geometry.attributes.position.array;
  for (const gap of [0, .02, .12]) for (const yaw of [-.5, 0, .5]) {
    const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
    for (const edge of ['outer', 'inner']) LIP_ANCHORS[kind][edge].forEach((id, i) => {
      const u = i / 10, arc = Math.sin(Math.PI * u);
      points[id] = {
        x: .5 + .3 * (u - .5) * Math.cos(yaw),
        y: .5 + (kind === 'upper' ? -1 : 1) * ((edge === 'inner' ? gap : gap + .05) * arc),
        z: .3 * (u - .5) * Math.sin(yaw),
      };
    });
    assert(binding.update(points, 960, 720));
    assert(Array.from(storage).every(Number.isFinite));
    assert(geometry.attributes.normal.array[(36 * 17 + 8) * 3 + 2] > .1, 'outward front normals');
    assert.equal(geometry.attributes.position.array, storage, 'same vertex buffer');
    assert.deepEqual(Array.from(geometry.index.array), indices, 'same triangles');
    for (let i = 0; i < binding.frontCount; i++) {
      const y = storage[i * 3 + 1];
      assert(kind === 'upper' ? y >= -1e-4 : y <= 1e-4, 'no triangle spans the mouth');
    }
    const original = new Float32Array(storage);
    assert(binding.update(points, 960, 720, true));
    assert(Array.from(storage).every(Number.isFinite), 'fitted surface stays finite');
    for (let i = 0; i < binding.frontCount; i++) {
      const u = geometry.attributes.uv.array[i * 2];
      const segment = Math.min(9, Math.floor(u * 10));
      const boundary = ['inner','outer'].flatMap(edge => [segment,segment+1].map(j=>points[LIP_ANCHORS[kind][edge][j]]));
      const xs=boundary.map(p=>p.x*960-480),ys=boundary.map(p=>360-p.y*720);
      assert(storage[i*3]>=Math.min(...xs)-1e-4 && storage[i*3]<=Math.max(...xs)+1e-4,'cubic X cannot overshoot observed segment');
      assert(storage[i*3+1]>=Math.min(...ys)-1e-4 && storage[i*3+1]<=Math.max(...ys)+1e-4,'cubic Y cannot overshoot observed segment');
      const row = Math.floor(i / 17) * 17;
      const v = geometry.attributes.uv.array[i * 2 + 1];
      const t = v * v * (3 - 2 * v);
      const chord = storage[row * 3 + 2] * (1-t) + storage[(row+16)*3+2] * t;
      const relief = Math.abs(storage[i * 3 + 2] - chord);
      const oldChord = original[row*3+2]*(1-t)+original[(row+16)*3+2]*t;
      const oldRelief = Math.abs(original[i * 3 + 2] - oldChord);
      assert(relief <= oldRelief * .221 + 1e-4, 'less protrusion at every vertex');
      const edges = geometry.attributes.lipEdgeDistance.array;
      assert(relief <= (edges[i*3]+edges[i*3+1]) * .101 + 1e-4, 'depth follows local thickness');
      if (i % 17 === 0) assert.equal(edges[i*3], 0, 'inner edge distance');
      if (i % 17 === 16) assert.equal(edges[i*3+1], 0, 'outer edge distance');
    }
    assert(geometry.attributes.normal.array[(36 * 17 + 8) * 3 + 2] > .1, 'fitted outward normals');
    // Center outer/inner boundaries exactly match observed landmarks, even at yaw.
    for (const [edge, v] of [['inner', 0], ['outer', 16]]) {
      const index = (36 * 17 + v) * 3;
      const p = points[LIP_ANCHORS[kind][edge][5]];
      assert(Math.abs(storage[index] - (p.x * 960 - 480)) < 1e-4);
      assert(Math.abs(storage[index + 1] - (360 - p.y * 720)) < 1e-4);
      assert(Math.abs(storage[index + 2] + p.z * 960) < 1e-4);
    }
  }
  assert.equal(binding.update([], 960, 720), false, 'reject lost tracking');
  console.log(`${kind}: 9 poses passed (closed/open, yaw, borders, normals, stable topology, fitted relief)`);
  geometry.dispose();
}
// Every detector knot remains an exact positional constraint after smoothing.
// 70 width segments place a mesh row on each of the 11 detector anchors.
for (const kind of ['upper','lower']) {
  const geometry=buildCanonicalLipGeometry(THREE,{kind,widthSegments:70,heightSegments:16,frontDepth:.26,backDepth:.13});
  const binding=bindLipGeometry(geometry,kind);
  const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  for(const edge of ['inner','outer'])LIP_ANCHORS[kind][edge].forEach((id,j)=>{
    points[id]={x:.2+j*.06,y:.5+(kind==='upper'?-1:1)*(.01+(edge==='outer'?.04:.0))*Math.sin(Math.PI*j/10),z:.015*Math.sin(j*.7)};
  });
  assert(binding.update(points,960,720,true));
  for(let j=0;j<=10;j++) for(const [edge,v] of [['inner',0],['outer',16]]) {
    const at=(j*7*17+v)*3,p=points[LIP_ANCHORS[kind][edge][j]],out=geometry.attributes.position.array;
    assert(Math.abs(out[at]-(p.x*960-480))<1e-4,'exact X anchor');
    assert(Math.abs(out[at+1]-(360-p.y*720))<1e-4,'exact Y anchor');
    assert(Math.abs(out[at+2]+p.z*960)<1e-4,'exact Z anchor');
  }
  geometry.dispose();
}
console.log('All 44 contour knots remain anchored after cubic interpolation.');
// Opening translates the two bands apart without thickening them. Added
// relief must decrease, while every boundary keeps following the detector.
for(const kind of ['upper','lower']) {
  const geometry=buildCanonicalLipGeometry(THREE,{kind,widthSegments:72,heightSegments:16,frontDepth:.26,backDepth:.13});
  const binding=bindLipGeometry(geometry,kind);
  let previousPeak=Infinity;
  for(const gap of [0,.03,.10,.25]) {
    const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
    for(const side of ['upper','lower'])for(const edge of ['inner','outer'])LIP_ANCHORS[side][edge].forEach((id,j)=>{
      const u=j/10;
      points[id]={x:.3+.4*u,y:.5+(side==='upper'?-1:1)*(gap+(edge==='outer'?.05:0))*Math.sin(Math.PI*u),z:0};
    });
    assert(binding.update(points,960,720,true));
    const p=geometry.attributes.position.array;
    let peak=0;
    for(let i=0;i<binding.frontCount;i++)peak=Math.max(peak,p[i*3+2]);
    assert(peak<previousPeak,'opening cannot inflate the added relief');previousPeak=peak;
    points[14].y=NaN;
    assert.equal(binding.update(points,960,720,true),false,'reject invalid mouth gap');
  }
  geometry.dispose();
}
console.log('Opening reduces relief without changing the tracked contour.');
