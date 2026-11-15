import type { LipPoint } from "./deformGeometry";

const FEATURES = [57, 287, 164, 18, 43, 273, 106, 335, 0, 17, 61, 291];
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
  let previousTime=0, correctionX=0, correctionY=0, lastWidth=0, lastHeight=0;
  const reset = () => { previous=null; previousPoints=null; correctionX=correctionY=0; };
  function update(frame: GrayFrame, points: LipPoint[] | null, width: number, height: number, timeMs: number) {
    if (!points || !FEATURES.every(i=>points[i] && Number.isFinite(points[i].x) && Number.isFinite(points[i].y))) {reset();return null;}
    const dt=(timeMs-previousTime)/1000;
    const before=previous, beforePoints=previousPoints;
    previous=frame;previousPoints=points.map(p=>({...p}));previousTime=timeMs;
    const resized=width!==lastWidth||height!==lastHeight;lastWidth=width;lastHeight=height;
    if (!before || !beforePoints || dt<=0 || dt>.15 || resized) {correctionX=correctionY=0;return null;}
    const offsets: number[][]=[];
    const radius=7, search=8, size=radius*2+1, count=size*size;
    const patch=new Float32Array(count);
    for (const id of FEATURES) {
      const px=Math.round(beforePoints[id].x*width)-before.x, py=Math.round(beforePoints[id].y*height)-before.y;
      const cx=Math.round(points[id].x*width)-frame.x, cy=Math.round(points[id].y*height)-frame.y;
      if(px<radius||py<radius||px+radius>=before.width||py+radius>=before.height||cx<radius+search||cy<radius+search||cx+radius+search>=frame.width||cy+radius+search>=frame.height) continue;
      let sum=0,index=0;
      for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){const v=before.data[(py+y)*before.width+px+x];patch[index++]=v;sum+=v;}
      const mean=sum/count;let variance=0;
      for(let i=0;i<count;i++){patch[i]-=mean;variance+=patch[i]*patch[i];}
      if(variance<625)continue;
      const scores=new Float32Array((search*2+1)**2);let best=-1,bestX=0,bestY=0;
      for(let dy=-search;dy<=search;dy++)for(let dx=-search;dx<=search;dx++){
        let s=0,s2=0,dot=0,k=0;
        for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
          const v=frame.data[(cy+dy+y)*frame.width+cx+dx+x];s+=v;s2+=v*v;dot+=v*patch[k++];
        }
        const score=dot/Math.sqrt(Math.max(1e-8,(s2-s*s/count)*variance));
        scores[(dy+search)*(search*2+1)+dx+search]=score;
        if(score>best){best=score;bestX=dx;bestY=dy;}
      }
      if(best<.92||Math.abs(bestX)===search||Math.abs(bestY)===search)continue;
      const k=(bestY+search)*(search*2+1)+bestX+search;
      const peak=(a:number,b:number,c:number)=>Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
      // Account for rounding patch centers so a subpixel shift is not rounded
      // into a one-pixel jump.
      const dx=bestX+peak(scores[k-1],scores[k],scores[k+1])
        +(cx+frame.x-points[id].x*width)-(px+before.x-beforePoints[id].x*width);
      const dy=bestY+peak(scores[k-17],scores[k],scores[k+17])
        +(cy+frame.y-points[id].y*height)-(py+before.y-beforePoints[id].y*height);
      offsets.push([dx,dy]);
    }
    const release = () => {
      const decay=Math.exp(-dt/.045);correctionX*=decay;correctionY*=decay;
      return {x:correctionX/width,y:correctionY/height,matches:0};
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
    const mouthWidth=Math.hypot((points[291].x-points[61].x)*width,(points[291].y-points[61].y)*height);
    const limit=Math.min(8,mouthWidth*.07),length=Math.hypot(correctionX,correctionY);
    if(length>limit){correctionX*=limit/length;correctionY*=limit/length;}
    return {x:correctionX/width,y:correctionY/height,matches:inliers.length};
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
