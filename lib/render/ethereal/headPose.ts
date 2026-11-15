import { canonicalCheeks } from "./canonical";
import { filmCheeks } from "./filmCanonical";
import { cross, dot, sub, unit, type FaceBasis, type Vec3 } from "./surface";
import type { RenderLandmark } from "@/lib/render/landmarks";

// Wide, bilateral anchors average detector noise. Exclude jaw/mouth motion
// from the lighting frame. Every observed pose is used immediately.
const PAIRS = [[33,263],[25,255],[143,372],[226,446]] as const;
const UPPER = [108,337,69,299], LOWER = [24,254,110,339];
export const posePositions = new Map<number,Vec3>(filmCheeks.ids.map((id,i)=>[id,filmCheeks.positions[i]]));
for(const [id,p] of Object.entries(canonicalCheeks.anchors))posePositions.set(+id,p);
for(const [id,p] of Object.entries(canonicalCheeks.lightSamples))posePositions.set(+id,p.position);
export const poseIds = [...new Set([...PAIRS.flat(),...UPPER,...LOWER])];
const mean = (ids: readonly number[], get: (id:number)=>Vec3):Vec3 =>
  [0,1,2].map(k=>ids.reduce((s,id)=>s+get(id)[k],0)/ids.length) as unknown as Vec3;
function axes(x:Vec3,up:Vec3):FaceBasis|null{
  if(Math.hypot(...x)<1e-6)return null;
  x=unit(x);const y=sub(up,x.map(v=>v*dot(up,x)) as unknown as Vec3);
  if(Math.hypot(...y)<1e-6)return null;
  return {x,y:unit(y),z:unit(cross(x,y))};
}
function averagedAxes(get:(id:number)=>Vec3):FaceBasis|null{
  const x=[0,0,0];
  for(const [a,b]of PAIRS){
    const length=Math.hypot(...sub(posePositions.get(b)!,posePositions.get(a)!));
    const d=sub(get(b),get(a));for(let k=0;k<3;k++)x[k]+=d[k]/length;
  }
  return axes(x as unknown as Vec3,sub(mean(UPPER,get),mean(LOWER,get)));
}
const rest=averagedAxes(id=>posePositions.get(id)!)!;
const original=axes(sub(posePositions.get(263)!,posePositions.get(33)!),
  sub(posePositions.get(10)!,posePositions.get(152)!))!;
export type SkinPose={frame:FaceBasis;origin:Vec3;scale:number};
export const toWorld=(p:RenderLandmark,w:number,h:number):Vec3=>[p.x*w,-p.y*h,-p.z!*w];
export function getSkinPose(points:RenderLandmark[]|null,w:number,h:number):SkinPose|null{
  if(!points||w<=0||h<=0||poseIds.some(id=>!points[id]||![points[id].x,points[id].y,points[id].z].every(Number.isFinite)))return null;
  const get=(id:number)=>toWorld(points[id],w,h),observed=averagedAxes(get);
  if(!observed)return null;
  const rotate=(v:Vec3):Vec3=>[0,1,2].map(k=>observed.x[k]*dot(v,rest.x)+observed.y[k]*dot(v,rest.y)+observed.z[k]*dot(v,rest.z)) as unknown as Vec3;
  const scale=PAIRS.reduce((s,[a,b])=>s+Math.hypot(...sub(get(b),get(a)))/Math.hypot(...sub(posePositions.get(b)!,posePositions.get(a)!)),0)/PAIRS.length;
  if(!Number.isFinite(scale)||scale<.1)return null;
  return {frame:{x:rotate(original.x),y:rotate(original.y),z:rotate(original.z)},origin:mean(poseIds,get),scale};
}
export function skinLocal(p:RenderLandmark,pose:SkinPose,w:number,h:number):Vec3{
  const d=sub(toWorld(p,w,h),pose.origin);
  return [dot(d,pose.frame.x)/pose.scale,dot(d,pose.frame.y)/pose.scale,dot(d,pose.frame.z)/pose.scale];
}
export function skinWorld(p:Vec3,pose:SkinPose,w:number,h:number):RenderLandmark{
  const v=[0,1,2].map(k=>pose.origin[k]+pose.scale*(pose.frame.x[k]*p[0]+pose.frame.y[k]*p[1]+pose.frame.z[k]*p[2]));
  return {x:v[0]/w,y:-v[1]/h,z:-v[2]/w};
}
