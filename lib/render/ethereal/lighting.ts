import { canonicalCheeks } from "./canonical";
import { dot, rotateCanonicalNormal, unit, type FaceBasis, type Vec3 } from "./surface";
import type { RenderLandmark } from "@/lib/render/landmarks";

export type EtherealLight = { direction: Vec3; radiance: number; confidence: number };
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const defaultLight: EtherealLight={direction:unit([-.25,.35,1]),radiance:.65,confidence:0};
// Fit a low-order directional component to many skin patches. This is an
// illumination approximation: albedo, occlusion and camera processing remain
// confounders. A ridge prior and confidence gate prevent one dark patch from
// becoming an extreme light direction.
export function fitEtherealLight(samples: {normal: Vec3; luma: number}[]): EtherealLight {
  if(samples.length<8) return defaultLight;
  const mean=samples.reduce((s,p)=>s+p.luma,0)/samples.length;
  const normalMean=[0,1,2].map(i=>samples.reduce((s,p)=>s+p.normal[i],0)/samples.length);
  const matrix=Array.from({length:3},()=>[0,0,0]);const rhs=[0,0,0];
  for(const sample of samples){
    const n=sample.normal.map((v,i)=>v-normalMean[i]),value=clamp(sample.luma/Math.max(.025,mean)-1,-.65,.65);
    for(let i=0;i<3;i++){rhs[i]+=n[i]*value;for(let j=0;j<3;j++)matrix[i][j]+=n[i]*n[j];}
  }
  for(let i=0;i<3;i++)matrix[i][i]+=.45;
  const rows=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let i=0;i<3;i++){
    let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;
    [rows[i],rows[pivot]]=[rows[pivot],rows[i]];
    const d=rows[i][i];if(Math.abs(d)<1e-8)return defaultLight;
    for(let k=i;k<4;k++)rows[i][k]/=d;
    for(let j=0;j<3;j++)if(j!==i){const f=rows[j][i];for(let k=i;k<4;k++)rows[j][k]-=f*rows[i][k];}
  }
  const gradient=rows.map(row=>row[3]);
  const confidence=clamp(Math.hypot(...gradient)*.7,0,.75);
  const estimated=unit([clamp(gradient[0],-.8,.8),clamp(gradient[1],-.6,.8),Math.max(.45,gradient[2])]);
  const direction=unit(estimated.map((v,i)=>defaultLight.direction[i]*(1-confidence)+v*confidence) as unknown as Vec3);
  return {direction,radiance:clamp(Math.sqrt(Math.max(0,mean))*2,.25,1.2),confidence};
}
export function createEtherealLighting(){
  const canvas=document.createElement("canvas");canvas.width=canvas.height=80;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  let light: EtherealLight={...defaultLight},target=light,lastTime=0,lastSample=-Infinity;
  return {
    update(source:HTMLCanvasElement,points:RenderLandmark[]|null,frame:FaceBasis|null,time:number,frozen:boolean):EtherealLight{
      if(frozen) return light;
      const dt=lastTime?clamp((time-lastTime)/1000,0,.2):0;lastTime=time;
      if(!points||!frame){light={...defaultLight};target=light;return light;}
      if(ctx&&time-lastSample>=150){
        lastSample=time;ctx.drawImage(source,0,0,80,80);const data=ctx.getImageData(0,0,80,80).data;
        const samples:{normal:Vec3;luma:number}[]=[];
        for(const [id,anchor] of Object.entries(canonicalCheeks.lightSamples)){
          const p=points[+id];if(!p||p.x<.03||p.x>.97||p.y<.03||p.y>.97)continue;
          const normal=rotateCanonicalNormal(anchor.normal,frame);if(dot(normal,[0,0,1])<.15)continue;
          const x=Math.round(p.x*79),y=Math.round(p.y*79);let luma=0;
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const i=((y+dy)*80+x+dx)*4;
            luma+=.2126*linear(data[i]/255)+.7152*linear(data[i+1]/255)+.0722*linear(data[i+2]/255);
          }
          samples.push({normal,luma:luma/9});
        }
        target=fitEtherealLight(samples);
        if(lastTime===time&&dt===0)light=target;
      }
      const alpha=1-Math.exp(-dt/.55);
      light={direction:unit(light.direction.map((v,i)=>v+(target.direction[i]-v)*alpha) as unknown as Vec3),
        radiance:light.radiance+(target.radiance-light.radiance)*alpha,confidence:target.confidence};
      return light;
    },
  };
}
