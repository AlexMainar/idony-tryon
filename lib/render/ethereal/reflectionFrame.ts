import { cross, dot, unit, type FaceBasis, type Vec3 } from "./surface";

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const frameAngle=(a:FaceBasis,b:FaceBasis)=>
  Math.acos(clamp((dot(a.x,b.x)+dot(a.y,b.y)+dot(a.z,b.z)-1)/2,-1,1));
function blend(a:FaceBasis,b:FaceBasis,t:number):FaceBasis {
  const mix=(u:Vec3,v:Vec3)=>u.map((n,i)=>n+(v[i]-n)*t) as unknown as Vec3;
  const x=unit(mix(a.x,b.x)),up=mix(a.y,b.y);
  const y=unit(up.map((n,i)=>n-x[i]*dot(up,x)) as unknown as Vec3);
  return {x,y,z:unit(cross(x,y))};
}

/** Reject sub-degree detector depth wobble in REFLECTION NORMALS only.
 * The current-frame positions never pass through this filter. Correction is
 * bounded to .35 degrees; clear head turns release immediately.
 */
export function createReflectionFrame(){
  let previous:FaceBasis|null=null,lastTime=0;
  return {
    reset(){previous=null;lastTime=0;},
    update(raw:FaceBasis,time:number){
      const dt=(time-lastTime)/1000;lastTime=time;
      if(!previous||dt<=0||dt>.15){previous=raw;return raw;}
      const difference=frameAngle(previous,raw),degrees=difference*180/Math.PI;
      const t=clamp((degrees-.35)/.65,0,1),release=t*t*(3-2*t);
      const base=1-Math.exp(-dt/.075);
      const alpha=Math.max(base+(1-base)*release,1-(.35*Math.PI/180)/Math.max(difference,1e-9));
      previous=blend(previous,raw,alpha);return previous;
    },
  };
}
