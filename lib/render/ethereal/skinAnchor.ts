import type { RenderLandmark } from "@/lib/render/landmarks";

export const skinFeatures = [[111,117,118,50,123,101],[340,346,347,280,352,330]] as const;
export type SkinGray={data:Float32Array;width:number;height:number;x:number;y:number};
const median=(v:number[])=>{v.sort((a,b)=>a-b);const i=v.length>>1;return v.length%2?v[i]:(v[i-1]+v[i])/2;};
const sample=(f:SkinGray,x:number,y:number)=>{
  const ix=Math.floor(x),iy=Math.floor(y),a=x-ix,b=y-iy,i=iy*f.width+ix;
  return (f.data[i]*(1-a)+f.data[i+1]*a)*(1-b)+(f.data[i+f.width]*(1-a)+f.data[i+f.width+1]*a)*b;
};
export function readSkinGray(ctx:CanvasRenderingContext2D,points:RenderLandmark[],ids:readonly number[],w:number,h:number):SkinGray{
  const xs=ids.map(i=>points[i].x*w),ys=ids.map(i=>points[i].y*h);
  const x=Math.max(0,Math.min(w-1,Math.floor(Math.min(...xs))-12)),y=Math.max(0,Math.min(h-1,Math.floor(Math.min(...ys))-12));
  const width=Math.max(1,Math.min(w,Math.ceil(Math.max(...xs))+13)-x),height=Math.max(1,Math.min(h,Math.ceil(Math.max(...ys))+13)-y);
  const rgba=ctx.getImageData(x,y,width,height).data,data=new Float32Array(width*height);
  for(let i=0;i<data.length;i++)data[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
  return {data,width,height,x,y};
}
/** Bounded translation from the current skin pixels, independent of detector
 * displacement. Same principle as Lip Bloom's image anchor, with smaller skin
 * patches. Reject ambiguous/flat patches rather than accumulating optical drift.
 */
export function createSkinAnchor(ids:readonly number[]){
  let before:SkinGray|null=null,oldPoints:RenderLandmark[]|null=null,lastTime=0;
  let correction={x:0,y:0},lastW=0,lastH=0;
  const reset=()=>{before=null;oldPoints=null;correction={x:0,y:0};lastTime=0;};
  return {reset,update(frame:SkinGray,points:RenderLandmark[],w:number,h:number,time:number){
    const prev=before,prevPoints=oldPoints,dt=(time-lastTime)/1000;
    before=frame;oldPoints=[];for(const id of ids)oldPoints[id]={...points[id]};lastTime=time;
    const resized=w!==lastW||h!==lastH;lastW=w;lastH=h;
    if(!prev||!prevPoints||dt<=0||dt>.15||resized){correction={x:0,y:0};return correction;}
    const offsets:number[][]=[],radius=5,search=3,count=121,grid=7;
    const patch=new Float32Array(count);
    for(const id of ids){
      const px=prevPoints[id].x*w-prev.x,py=prevPoints[id].y*h-prev.y;
      const cx=points[id].x*w-frame.x,cy=points[id].y*h-frame.y;
      if(px<radius||py<radius||px+radius+1>=prev.width||py+radius+1>=prev.height||cx<radius+search||cy<radius+search||cx+radius+search+1>=frame.width||cy+radius+search+1>=frame.height)continue;
      let sum=0,k=0;
      for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){const v=sample(prev,px+x,py+y);patch[k++]=v;sum+=v;}
      const mean=sum/count;let variance=0;
      for(let i=0;i<count;i++){patch[i]-=mean;variance+=patch[i]*patch[i];}
      // Skin in a phone camera can have only 1–2 gray levels of local contrast.
      // Correlation and peak uniqueness, not high contrast, decide reliability.
      if(variance<count)continue;
      const correlation=(dx:number,dy:number)=>{
        let s=0,s2=0,dot=0,index=0;
        for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
          const v=sample(frame,cx+dx+x,cy+dy+y);s+=v;s2+=v*v;dot+=v*patch[index++];
        }
        return dot/Math.sqrt(Math.max(1e-8,(s2-s*s/count)*variance));
      };
      const scores=new Float32Array(grid*grid);let best=-1,bx=0,by=0;
      for(let dy=-search;dy<=search;dy++)for(let dx=-search;dx<=search;dx++){
        const score=correlation(dx,dy);
        scores[(dy+search)*grid+dx+search]=score;
        if(score>best){best=score;bx=dx;by=dy;}
      }
      if(best<.78||Math.abs(bx)===search||Math.abs(by)===search)continue;
      let alternative=-1;
      for(let dy=-search;dy<=search;dy++)for(let dx=-search;dx<=search;dx++)
        if(Math.abs(dx-bx)>1||Math.abs(dy-by)>1)alternative=Math.max(alternative,scores[(dy+search)*grid+dx+search]);
      if(best-alternative<.005)continue;
      // Test confidence AFTER subpixel alignment. A true half-pixel shift on
      // low-contrast skin can score poorly at every integer offset.
      for(const step of [.5,.25,.125]){
        const x=bx,y=by;
        for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
          const dx=x+i*step,dy=y+j*step,score=correlation(dx,dy);
          if(score>best){best=score;bx=dx;by=dy;}
        }
      }
      if(best<.95)continue;
      offsets.push([bx,by]);
    }
    const release=()=>{const a=Math.exp(-dt/.045);correction={x:correction.x*a,y:correction.y*a};return correction;};
    if(offsets.length<3)return release();
    const x=median(offsets.map(p=>p[0])),y=median(offsets.map(p=>p[1]));
    const inliers=offsets.filter(p=>Math.hypot(p[0]-x,p[1]-y)<.9);
    if(inliers.length<3)return release();
    const retain=Math.exp(-dt/.12);
    correction={x:(correction.x+median(inliers.map(p=>p[0])))*retain,y:(correction.y+median(inliers.map(p=>p[1])))*retain};
    const length=Math.hypot(correction.x,correction.y),limit=1.75;
    if(length>limit){correction.x*=limit/length;correction.y*=limit/length;}
    return correction;
  }};
}
