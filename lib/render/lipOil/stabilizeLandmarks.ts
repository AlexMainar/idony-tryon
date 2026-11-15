import type { LipPoint } from "./deformGeometry";
import type { ImageLipCorrection } from "./imageAnchor";

// Fit motion close to the mouth. Extrapolating a free affine transform from
// eyes/temples to the lips amplified small upper-face errors during head turns.
const FACE = [98, 327, 2, 164, 57, 287, 43, 273];
const UPPER = [61,185,40,39,37,0,267,269,270,409,291,78,191,80,81,82,13,312,311,310,415,308];
const LOWER = [61,146,91,181,84,17,314,405,321,375,291,78,95,88,178,87,14,317,402,318,324,308];
const LIPS = [...new Set([...UPPER, ...LOWER])];
const valid = (p: LipPoint | undefined) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0);
const clone = (points: LipPoint[]) => points.map(p => ({ ...p }));
const mix = (a: number, b: number, t: number) => a + (b-a)*t;

/** Predict the previous lip in the CURRENT head pose before damping residual
 * shape noise. Filtering screen coordinates directly makes the lip trail the
 * head. No future-frame prediction, accumulated pose, or rest-shape attraction.
 */
export function createLipStabilizer() {
  let previousRaw: LipPoint[] | null = null;
  let previousFiltered: LipPoint[] | null = null;
  let previousTime = 0, previousWidth = 0, previousHeight = 0;
  function reset() { previousRaw = null; previousFiltered = null; previousTime = 0; }
  function update(points: LipPoint[] | null, width: number, height: number, timeMs: number, imageCorrection?: ImageLipCorrection | null): LipPoint[] | null {
    if (!points || ![...FACE, ...LIPS].every(i => valid(points[i]))) { reset(); return null; }
    const raw = points;
    const finish = (result: LipPoint[]) => {
      previousRaw = clone(raw); previousFiltered = result;
      previousTime = timeMs; previousWidth = width; previousHeight = height;
      return result;
    };
    const dt = (timeMs-previousTime)/1000;
    if (!previousRaw || !previousFiltered || dt <= 0 || dt > .15 || width !== previousWidth || height !== previousHeight) return finish(clone(raw));
    const before = previousRaw;
    // A local similarity has only translation, rotation and uniform scale;
    // it cannot shear/stretch the lip when upper-face perspective changes.
    const center = (ps: LipPoint[]) => {
      const sum = FACE.reduce((s,i) => ({x:s.x+ps[i].x*width,y:s.y+ps[i].y*height,z:s.z+(ps[i].z??0)}), {x:0,y:0,z:0});
      return {x:sum.x/FACE.length,y:sum.y/FACE.length,z:sum.z/FACE.length};
    };
    const oldCenter = center(before), newCenter = center(raw);
    let spread=0, dot=0, cross=0;
    for (const i of FACE) {
      const x=before[i].x*width-oldCenter.x, y=before[i].y*height-oldCenter.y;
      const u=raw[i].x*width-newCenter.x, v=raw[i].y*height-newCenter.y;
      spread+=x*x+y*y; dot+=x*u+y*v; cross+=x*v-y*u;
    }
    if (spread < 1e-6) return finish(clone(raw));
    const a=dot/spread, b=-cross/spread, c=cross/spread, d=dot/spread;
    const transform = (p: LipPoint): LipPoint => {
      const x=p.x*width-oldCenter.x, y=p.y*height-oldCenter.y;
      return {x:(a*x+b*y+newCenter.x)/width,y:(c*x+d*y+newCenter.y)/height,z:(p.z??0)+newCenter.z-oldCenter.z};
    };
    const mouthWidth = Math.hypot((raw[291].x-raw[61].x)*width,(raw[291].y-raw[61].y)*height);
    const poseError = Math.sqrt(FACE.reduce((sum,i) => {
      const p=transform(before[i]);
      return sum+((p.x-raw[i].x)*width)**2+((p.y-raw[i].y)*height)**2;
    },0)/FACE.length);
    const areaScale=a*d-b*c;
    if (mouthWidth < 2 || areaScale < .65 || areaScale > 1.5 || poseError > mouthWidth*.08) return finish(clone(raw));
    const predicted = clone(raw);
    for (const i of LIPS) predicted[i]=transform(previousFiltered[i]);
    // Mouth opening/closing is expression, not noise. Follow it immediately so
    // filtering does not leave the cavity closed over teeth or delay lip closure.
    const distance = (ps: LipPoint[], a: number, b: number) => Math.hypot((ps[a].x-ps[b].x)*width,(ps[a].y-ps[b].y)*height);
    const expressionThreshold=mouthWidth*.012;
    const motion=imageCorrection?.motion;
    const expressionChange = ([[13,14,"gap"],[61,291,"width"],[0,17,"height"]] as const).some(([a,b,kind]) => {
      if(Math.abs(distance(raw,a,b)-distance(predicted,a,b))<=expressionThreshold)return false;
      // A detector size fluctuation is not a smile/purse. When image patches
      // match, require independent pixel movement before bypassing denoising.
      const measured=motion?.[kind];
      return measured===undefined||Math.abs(measured)>expressionThreshold*.5;
    });
    const gain = (indices: number[]) => {
      const residuals=indices.map(i => Math.hypot((raw[i].x-predicted[i].x)*width,(raw[i].y-predicted[i].y)*height)).sort((a,b)=>a-b);
      // One noisy corner must not disable stabilization of the entire lip.
      const residual=residuals[Math.floor((residuals.length-1)*.75)];
      const motion=Math.max(0,Math.min(1,(residual/mouthWidth-.008)/.035));
      // Extra damping only near rest. Current head pose and the immediate
      // expression bypass remain unchanged, so movement is not globally delayed.
      return expressionChange ? 1 : mix(1-Math.exp(-dt/.085),1,motion*motion*(3-2*motion));
    };
    const upperGain=gain(UPPER), lowerGain=gain(LOWER);
    const upperSet = new Set(UPPER), lowerSet = new Set(LOWER);
    const result=clone(raw);
    for (const i of LIPS) {
      const alpha=upperSet.has(i) && lowerSet.has(i) ? Math.max(upperGain,lowerGain) : upperSet.has(i) ? upperGain : lowerGain;
      const p=predicted[i], r=raw[i];
      result[i]={x:mix(p.x,r.x,alpha),y:mix(p.y,r.y,alpha),z:mix(p.z??0,r.z??0,alpha)};
    }
    if (imageCorrection) {
      // Keep filtered lip shape, but use the pixel-driven translation rather
      // than layering two independent center filters on top of each other.
      const centerOffset=LIPS.reduce((s,i)=>({x:s.x+result[i].x-raw[i].x,y:s.y+result[i].y-raw[i].y}),{x:0,y:0});
      const dx=imageCorrection.x-centerOffset.x/LIPS.length,dy=imageCorrection.y-centerOffset.y/LIPS.length;
      for(const i of LIPS){result[i].x+=dx;result[i].y+=dy;}
    }
    return finish(result);
  }
  return { update, reset };
}
