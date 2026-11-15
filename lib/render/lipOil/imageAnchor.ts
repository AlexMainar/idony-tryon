import type { LipPoint } from "./deformGeometry";

const FEATURES = [57, 287, 164, 18, 43, 273, 106, 335, 0, 17, 61, 291];
const SEARCH_FEATURES = [...FEATURES, 13, 14];
export type ImageLipCorrection = {
  x: number; y: number; matches?: number;
  scaleDelta?: number; rotationDelta?: number;
  motion?: {width?: number; height?: number; gap?: number};
};
export type GrayFrame = { data: Float32Array; width: number; height: number; x: number; y: number };
const median = (values: number[]) => {
  values.sort((a,b)=>a-b); const i=Math.floor(values.length/2);
  return values.length%2 ? values[i] : (values[i-1]+values[i])/2;
};

/** Track image texture independently of landmark coordinates. Landmarks only
 * center a bounded patch search. No color classification or fixed lip color.
 */
export function createImageAnchor() {
  let previous: GrayFrame | null = null, previousPoints: LipPoint[] | null = null;
  let previousTime=0, correctionX=0, correctionY=0, scaleCorrection=0, rotationCorrection=0, lastWidth=0, lastHeight=0;
  const reset = () => { previous=null; previousPoints=null; correctionX=correctionY=scaleCorrection=rotationCorrection=0; };
  function update(frame: GrayFrame, points: LipPoint[] | null, width: number, height: number, timeMs: number) {
    if (!points || !FEATURES.every(i=>points[i] && Number.isFinite(points[i].x) && Number.isFinite(points[i].y))) {reset();return null;}
    const dt=(timeMs-previousTime)/1000;
    const before=previous, beforePoints=previousPoints;
    previous=frame;previousPoints=points.map(p=>({...p}));previousTime=timeMs;
    const resized=width!==lastWidth||height!==lastHeight;lastWidth=width;lastHeight=height;
    if (!before || !beforePoints || dt<=0 || dt>.15 || resized) {correctionX=correctionY=scaleCorrection=rotationCorrection=0;return null;}
    const offsets: number[][]=[];
    const measured=new Map<number, {x:number;y:number}>();
    const radius=7, search=8, size=radius*2+1, count=size*size;
    const patch=new Float32Array(count);
    for (const id of SEARCH_FEATURES) {
      if(!points[id]||!beforePoints[id]||![points[id].x,points[id].y,beforePoints[id].x,beforePoints[id].y].every(Number.isFinite))continue;
      const px=Math.round(beforePoints[id].x*width)-before.x, py=Math.round(beforePoints[id].y*height)-before.y;
      const cx=Math.round(points[id].x*width)-frame.x, cy=Math.round(points[id].y*height)-frame.y;
      if(px<radius||py<radius||px+radius>=before.width||py+radius>=before.height||cx<radius+search||cy<radius+search||cx+radius+search>=frame.width||cy+radius+search>=frame.height) continue;
      let sum=0,index=0;
      for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){const v=before.data[(py+y)*before.width+px+x];patch[index++]=v;sum+=v;}
      const mean=sum/count;let variance=0;
      for(let i=0;i<count;i++){patch[i]-=mean;variance+=patch[i]*patch[i];}
      if(variance<625)continue;
      const stride=search*2+1;
      const scores=new Float32Array(stride*stride);scores.fill(-2);
      const scoreAt=(dx:number,dy:number)=>{
        const index=(dy+search)*stride+dx+search;
        if(scores[index]>-2)return scores[index];
        let s=0,s2=0,dot=0,k=0;
        for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
          const v=frame.data[(cy+dy+y)*frame.width+cx+dx+x];s+=v;s2+=v*v;dot+=v*patch[k++];
        }
        return scores[index]=dot/Math.sqrt(Math.max(1e-8,(s2-s*s/count)*variance));
      };
      // Locate candidate peaks with a sparse patch, then score their complete
      // neighbourhood at full resolution. The final confidence/subpixel fit
      // still uses every pixel of the original patch.
      const coarsePatch:number[]=[];let coarseSum=0;
      for(let y=-radius;y<=radius;y+=2)for(let x=-radius;x<=radius;x+=2){
        const v=before.data[(py+y)*before.width+px+x];coarsePatch.push(v);coarseSum+=v;
      }
      const coarseCount=coarsePatch.length,coarseMean=coarseSum/coarseCount;
      let coarseVariance=0;
      for(let i=0;i<coarseCount;i++){coarsePatch[i]-=coarseMean;coarseVariance+=coarsePatch[i]**2;}
      const candidates:{x:number;y:number;score:number}[]=[];
      for(let dy=-search;dy<=search;dy++)for(let dx=-search;dx<=search;dx++){
        let s=0,s2=0,dot=0,k=0;
        for(let y=-radius;y<=radius;y+=2)for(let x=-radius;x<=radius;x+=2){
          const v=frame.data[(cy+dy+y)*frame.width+cx+dx+x];s+=v;s2+=v*v;dot+=v*coarsePatch[k++];
        }
        const score=dot/Math.sqrt(Math.max(1e-8,(s2-s*s/coarseCount)*coarseVariance));
        if(candidates.length<3||score>candidates[candidates.length-1].score){
          candidates.push({x:dx,y:dy,score});candidates.sort((a,b)=>b.score-a.score);if(candidates.length>3)candidates.pop();
        }
      }
      let best=-1,bestX=0,bestY=0;
      for(const candidate of candidates)for(let dy=Math.max(-search,candidate.y-1);dy<=Math.min(search,candidate.y+1);dy++)for(let dx=Math.max(-search,candidate.x-1);dx<=Math.min(search,candidate.x+1);dx++){
        const score=scoreAt(dx,dy);if(score>best){best=score;bestX=dx;bestY=dy;}
      }
      if(best<.92||Math.abs(bestX)===search||Math.abs(bestY)===search)continue;
      const k=(bestY+search)*stride+bestX+search;
      scoreAt(bestX-1,bestY);scoreAt(bestX+1,bestY);scoreAt(bestX,bestY-1);scoreAt(bestX,bestY+1);
      const peak=(a:number,b:number,c:number)=>Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
      // Account for rounding patch centers so a subpixel shift is not rounded
      // into a one-pixel jump.
      const dx=bestX+peak(scores[k-1],scores[k],scores[k+1])
        +(cx+frame.x-points[id].x*width)-(px+before.x-beforePoints[id].x*width);
      const dy=bestY+peak(scores[k-17],scores[k],scores[k+17])
        +(cy+frame.y-points[id].y*height)-(py+before.y-beforePoints[id].y*height);
      measured.set(id,{x:dx,y:dy});
      if(FEATURES.includes(id))offsets.push([dx,dy,id]);
    }
    // Expression is lip deformation relative to the head, not a head zoom.
    const skin=FEATURES.filter(id=>![0,17,61,291].includes(id)&&measured.has(id));
    let imageScale=1;
    if(skin.length>=4){
      const oldCenter=skin.reduce((sum,id)=>({x:sum.x+beforePoints[id].x*width,y:sum.y+beforePoints[id].y*height}),{x:0,y:0});
      const nextCenter=skin.reduce((sum,id)=>({x:sum.x+points[id].x*width+measured.get(id)!.x,y:sum.y+points[id].y*height+measured.get(id)!.y}),{x:0,y:0});
      oldCenter.x/=skin.length;oldCenter.y/=skin.length;nextCenter.x/=skin.length;nextCenter.y/=skin.length;
      let spread=0,dot=0,cross=0;
      for(const id of skin){
        const x=beforePoints[id].x*width-oldCenter.x,y=beforePoints[id].y*height-oldCenter.y;
        const u=points[id].x*width+measured.get(id)!.x-nextCenter.x,v=points[id].y*height+measured.get(id)!.y-nextCenter.y;
        spread+=x*x+y*y;dot+=x*u+y*v;cross+=x*v-y*u;
      }
      if(spread>1)imageScale=Math.hypot(dot,cross)/spread;
    }
    const spanChange=(a:number,b:number)=>{
      const first=measured.get(a),second=measured.get(b);
      if(!first||!second)return undefined;
      const oldSpan=Math.hypot((beforePoints[a].x-beforePoints[b].x)*width,(beforePoints[a].y-beforePoints[b].y)*height);
      const newSpan=Math.hypot((points[a].x-points[b].x)*width+first.x-second.x,(points[a].y-points[b].y)*height+first.y-second.y);
      return newSpan-oldSpan*imageScale;
    };
    const motion={width:spanChange(61,291),height:spanChange(0,17),gap:spanChange(13,14)};
    const release = () => {
      const decay=Math.exp(-dt/.045);correctionX*=decay;correctionY*=decay;
      scaleCorrection*=decay;rotationCorrection*=decay;
      return {x:correctionX/width,y:correctionY/height,matches:0,scaleDelta:scaleCorrection,rotationDelta:rotationCorrection,motion};
    };
    if(offsets.length<5)return release();
    const dx=median(offsets.map(p=>p[0])),dy=median(offsets.map(p=>p[1]));
    const inliers=offsets.filter(p=>Math.hypot(p[0]-dx,p[1]-dy)<2);
    if(inliers.length<5)return release();
    // Re-anchor continuously to detection to avoid accumulated optical drift.
    // Only translation is corrected; expressions and shape stay with landmarks.
    const retention=Math.exp(-dt/.085);
    correctionX=(correctionX+median(inliers.map(p=>p[0])))*retention;
    correctionY=(correctionY+median(inliers.map(p=>p[1])))*retention;
    // Correct only pose error measured in camera texture. This does not
    // low-pass real head movement or alter the existing translation anchor.
    const center=inliers.reduce((sum,p)=>({x:sum.x+points[p[2]].x*width,y:sum.y+points[p[2]].y*height}),{x:0,y:0});
    center.x/=inliers.length;center.y/=inliers.length;
    const meanOffset={x:inliers.reduce((sum,p)=>sum+p[0],0)/inliers.length,y:inliers.reduce((sum,p)=>sum+p[1],0)/inliers.length};
    let spread=0,scaleError=0,rotationError=0;
    for(const [dx,dy,id]of inliers){
      const x=points[id].x*width-center.x,y=points[id].y*height-center.y;
      spread+=x*x+y*y;
      scaleError+=x*(dx-meanOffset.x)+y*(dy-meanOffset.y);
      rotationError+=x*(dy-meanOffset.y)-y*(dx-meanOffset.x);
    }
    const bound=(value:number)=>Math.max(-.04,Math.min(.04,value));
    scaleCorrection=bound((scaleCorrection+(spread>1?scaleError/spread:0))*retention);
    rotationCorrection=bound((rotationCorrection+(spread>1?rotationError/spread:0))*retention);
    const mouthWidth=Math.hypot((points[291].x-points[61].x)*width,(points[291].y-points[61].y)*height);
    const limit=Math.min(8,mouthWidth*.07),length=Math.hypot(correctionX,correctionY);
    if(length>limit){correctionX*=limit/length;correctionY*=limit/length;}
    return {x:correctionX/width,y:correctionY/height,matches:inliers.length,scaleDelta:scaleCorrection,rotationDelta:rotationCorrection,motion};
  }
  return {update,reset};
}

/** Read only a small region around the mouth, not the whole video image. */
export function readMouthGray(ctx: CanvasRenderingContext2D, points: LipPoint[], width: number, height: number): GrayFrame {
  const xs=FEATURES.map(i=>points[i].x*width),ys=FEATURES.map(i=>points[i].y*height);
  const x=Math.min(width-1,Math.max(0,Math.floor(Math.min(...xs))-24)),y=Math.min(height-1,Math.max(0,Math.floor(Math.min(...ys))-24));
  const w=Math.max(1,Math.min(width,Math.ceil(Math.max(...xs))+25)-x),h=Math.max(1,Math.min(height,Math.ceil(Math.max(...ys))+25)-y);
  const rgba=ctx.getImageData(x,y,w,h).data,data=new Float32Array(w*h);
  for(let i=0;i<data.length;i++)data[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
  return {data,width:w,height:h,x,y};
}
