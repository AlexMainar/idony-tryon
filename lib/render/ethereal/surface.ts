import { canonicalCheeks, faceOcclusionTriangles } from "./canonical";
import { filmCheeks } from "./filmCanonical";
import type { RenderLandmark } from "@/lib/render/landmarks";
import { surfaceUv } from "./coverage";

export type Vec3 = readonly [number, number, number];
export type FaceBasis = { x: Vec3; y: Vec3; z: Vec3 };
export const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function unit(a: Vec3): Vec3 {
  const length=Math.hypot(...a);
  return length>1e-8 ? [a[0]/length,a[1]/length,a[2]/length] : [0,0,1];
}
function basis(left: Vec3, right: Vec3, top: Vec3, bottom: Vec3): FaceBasis | null {
  const horizontal=sub(right,left), vertical=sub(top,bottom);
  if(Math.hypot(...horizontal)<1e-5 || Math.hypot(...vertical)<1e-5) return null;
  const x=unit(horizontal), projected=dot(vertical,x);
  const up: Vec3=[vertical[0]-x[0]*projected,vertical[1]-x[1]*projected,vertical[2]-x[2]*projected];
  if(Math.hypot(...up)<1e-5) return null;
  const y=unit(up), z=unit(cross(x,y));
  return {x,y,z};
}
const reference = basis(canonicalCheeks.anchors[33],canonicalCheeks.anchors[263],canonicalCheeks.anchors[10],canonicalCheeks.anchors[152])!;
export function getFaceBasis(points: RenderLandmark[] | null, width: number, height: number): FaceBasis | null {
  if(!points || width<=0 || height<=0) return null;
  const p=[33,263,10,152].map(i=>points[i]);
  if(p.some(v=>!v || ![v.x,v.y,v.z].every(Number.isFinite))) return null;
  // Weak-perspective approximation: depth uses the same scale as image x.
  // Canonical normals supply stable curvature; raw z only determines head pose.
  const world=p.map(v=>[v.x*width,-v.y*height,-v.z!*width] as Vec3);
  return basis(world[0],world[1],world[2],world[3]);
}
export function rotateCanonicalNormal(normal: Vec3, frame: FaceBasis): Vec3 {
  const nx=dot(normal,reference.x),ny=dot(normal,reference.y),nz=dot(normal,reference.z);
  return unit([frame.x[0]*nx+frame.y[0]*ny+frame.z[0]*nz,
    frame.x[1]*nx+frame.y[1]*ny+frame.z[1]*nz,
    frame.x[2]*nx+frame.y[2]*ny+frame.z[2]*nz]);
}
export function createCheekSurface(film = false) {
  const cheeks = film ? filmCheeks : canonicalCheeks;
  const vertices=new Float32Array(cheeks.ids.length*8);
  const indices=new Uint16Array(cheeks.triangles.flatMap(t=>[...t]));
  const occluderVertices=new Float32Array(468*8);
  const occluderIndices=new Uint16Array(faceOcclusionTriangles);
  let hasOccluder=false;
  return {
    vertices,indices,occluderVertices,occluderIndices,
    get hasOccluder(){return hasOccluder;},
    update(points: RenderLandmark[] | null,width: number,height: number,frameOverride?:FaceBasis): FaceBasis | null {
      hasOccluder=false;
      const frame=frameOverride??getFaceBasis(points,width,height);
      if(!frame || !points) return null;
      for(let i=0;i<cheeks.ids.length;i++){
        const p=points[cheeks.ids[i]];
        if(!p || ![p.x,p.y,p.z].every(Number.isFinite)) return null;
        const n=rotateCanonicalNormal(cheeks.normals[i],frame),offset=i*8;
        const rest=cheeks.positions[i];
        vertices.set([p.x,p.y,p.z!,...n,...surfaceUv(rest[0],rest[1])],offset);
      }
      hasOccluder=points.length>=468;
      for(let i=0;i<468&&hasOccluder;i++){
        const p=points[i];
        if(!p||![p.x,p.y,p.z].every(Number.isFinite)){hasOccluder=false;break;}
        occluderVertices.set([p.x,p.y,p.z!,0,0,1,0,0],i*8);
      }
      return frame;
    },
  };
}
