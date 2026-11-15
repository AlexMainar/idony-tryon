import type { RenderLandmark } from "@/lib/render/landmarks";
import { filmCheeks } from "./filmCanonical";
import { getSkinPose, skinLocal, skinWorld } from "./headPose";
import { createSkinAnchor, readSkinGray, skinFeatures } from "./skinAnchor";
import { createReflectionFrame } from "./reflectionFrame";
import type { Vec3, FaceBasis } from "./surface";

export type EtherealSurfaceState={landmarks:RenderLandmark[];frame:FaceBasis};
const clone=(p:RenderLandmark[])=>p.map(v=>({...v}));
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const sides=filmCheeks.ids.map((_,i)=>filmCheeks.positions[i][0]<0?0:1);
export function createEtherealTracking(){
  const anchors=skinFeatures.map(ids=>createSkinAnchor(ids));
  const reflectionFrame=createReflectionFrame();
  let previous:Vec3[]|null=null,lastRaw:RenderLandmark[]|null=null,lastResult:EtherealSurfaceState|null=null;
  let lastTime=0,lastW=0,lastH=0;
  const reset=()=>{previous=null;lastRaw=null;lastResult=null;lastTime=0;anchors.forEach(a=>a.reset());reflectionFrame.reset();};
  return {reset,update(source:HTMLCanvasElement,points:RenderLandmark[]|null,w:number,h:number,time:number,frozen:boolean):EtherealSurfaceState|null{
    const pose=getSkinPose(points,w,h);
    if(!points||!pose||filmCheeks.ids.some(i=>!points[i]||![points[i].x,points[i].y,points[i].z].every(Number.isFinite))){reset();return null;}
    if(frozen&&lastRaw&&lastResult&&w===lastW&&h===lastH&&points.length===lastRaw.length&&points.every((p,i)=>p.x===lastRaw![i].x&&p.y===lastRaw![i].y&&p.z===lastRaw![i].z))return lastResult;
    const dt=(time-lastTime)/1000,resized=w!==lastW||h!==lastH;
    const acquire=!previous||dt<=0||dt>.15||resized||frozen;
    if(acquire){anchors.forEach(a=>a.reset());reflectionFrame.reset();}
    const locals=filmCheeks.ids.map(i=>skinLocal(points[i],pose,w,h));
    const result=clone(points),next:Vec3[]=[];
    // Filter only local shape residuals; pose is already the current frame.
    // Rigid head translation, rotation and scale never pass through a low-pass.
    for(let i=0;i<filmCheeks.ids.length;i++){
      const raw=locals[i],old=previous?.[i]??raw;
      if(acquire){next.push(raw);continue;}
      const residual=Math.hypot(...raw.map((v,k)=>(v-old[k])*pose.scale));
      const release=smooth(.65,2.2,residual),base=1-Math.exp(-Math.max(0,dt)/.075);
      const alpha=acquire?1:base+(1-base)*release;
      let local=raw.map((v,k)=>old[k]+(v-old[k])*alpha) as unknown as Vec3;
      let p=skinWorld(local,pose,w,h),r=points[filmCheeks.ids[i]];
      const correction=Math.hypot((p.x-r.x)*w,(p.y-r.y)*h,(p.z!-r.z!)*w);
      if(correction>1.0){const a=1.0/correction;local=raw.map((v,k)=>v+(local[k]-v)*a) as unknown as Vec3;p=skinWorld(local,pose,w,h);}
      next.push(local);result[filmCheeks.ids[i]]=p;
    }
    const ctx=!frozen?source.getContext("2d",{willReadFrequently:true}):null;
    if(ctx){
      const corrections=skinFeatures.map((ids,i)=>anchors[i].update(readSkinGray(ctx,points,ids,w,h),points,w,h,time));
      // The optical correction owns cheek translation. Do not add a second
      // center filter on top of it (the same constraint used for Lip Bloom).
      for(let side=0;side<2;side++){
        const indices=filmCheeks.ids.map((id,i)=>({id,i})).filter(v=>sides[v.i]===side);
        const mean=indices.reduce((s,{id})=>({x:s.x+(result[id].x-points[id].x)*w,y:s.y+(result[id].y-points[id].y)*h}),{x:0,y:0});
        const dx=corrections[side].x-mean.x/indices.length,dy=corrections[side].y-mean.y/indices.length;
        for(const {id}of indices){result[id].x+=dx/w;result[id].y+=dy/h;}
      }
    }
    previous=next;lastRaw=clone(points);lastTime=time;lastW=w;lastH=h;
    lastResult={landmarks:result,frame:reflectionFrame.update(pose.frame,time)};return lastResult;
  }};
}
