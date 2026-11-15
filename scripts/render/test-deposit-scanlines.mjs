import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code=ts.transpileModule(fs.readFileSync('lib/render/complexion/depositRgb.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {renderDepositRgbLayers}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let seed=97;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const width=173,height=117;
const base=new Uint8ClampedArray(width*height*4);
for(let i=0;i<base.length;i+=4){base[i]=30+random()*200;base[i+1]=30+random()*200;base[i+2]=30+random()*200;base[i+3]=255;}
const context=()=>({canvas:{width,height},data:base.slice(),
  isPointInPath(_path,x,y){return ((x-85)/70)**2+((y-56)/45)**2<1;},
  getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let row=0;row<h;row++)data.set(this.data.subarray(((row+y)*width+x)*4,((row+y)*width+x+w)*4),row*w*4);return {data,width:w,height:h};},
  putImageData(image,x,y){for(let row=0;row<image.height;row++)this.data.set(image.data.subarray(row*image.width*4,(row+1)*image.width*4),((row+y)*width+x)*4);},
});
const clamp=x=>Math.max(0,Math.min(1,x));
// Independent scalar definition of the approved optical deposit, used only as
// a numerical oracle. It does not use the scanline implementation.
function reference(ctx,layers){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const cx=x+.5,cy=y+.5,index=(y*width+x)*4;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const l of layers){const c=Math.cos(l.rotation??0),s=Math.sin(l.rotation??0),rx=Math.max(1,l.radiusX,l.negativeRadiusX??0,l.positiveRadiusX??0),ry=Math.max(1,l.radiusY,l.lowerRadiusY??0),extent=l.radiusScale??2;
      minX=Math.min(minX,l.centerX-(Math.abs(c)*rx+Math.abs(s)*ry)*extent);maxX=Math.max(maxX,l.centerX+(Math.abs(c)*rx+Math.abs(s)*ry)*extent);
      minY=Math.min(minY,l.centerY-(Math.abs(s)*rx+Math.abs(c)*ry)*extent);maxY=Math.max(maxY,l.centerY+(Math.abs(s)*rx+Math.abs(c)*ry)*extent);
    }
    if(x<Math.floor(minX)||x>=Math.ceil(maxX)||y<Math.floor(minY)||y>=Math.ceil(maxY))continue;
    const response=Math.sqrt((.299*ctx.data[index]+.587*ctx.data[index+1]+.114*ctx.data[index+2])/255);
    let weight=0;
    for(const l of layers){
      if(l.clipToPath&&l.path&&!ctx.isPointInPath(l.path,cx,cy))continue;
      const c=Math.cos(l.rotation??0),s=Math.sin(l.rotation??0),dx=cx-l.centerX,dy=cy-l.centerY;
      const along=dx*c+dy*s,across=-dx*s+dy*c;
      const rx=Math.max(1,along<0?l.negativeRadiusX??l.radiusX:l.positiveRadiusX??l.radiusX),ry=Math.max(1,l.radiusY,cy>=l.centerY?l.lowerRadiusY??0:0);
      const q=(along/rx)**2+(across/ry)**2;
      const field=Math.exp(-q*Math.max(.1,l.falloffPower??1));
      weight+=field*l.strength*(1+(Math.max(response,clamp(l.responseFloor??0))-1)*clamp(l.responseInfluence??1));
    }
    if(weight<=1e-5)continue;
    weight=clamp(weight);
    for(const [k,target]of [154,87,63].entries())ctx.data[index+k]=Math.max(0,Math.min(255,Math.round(ctx.data[index+k]+(target-ctx.data[index+k])*weight)));
  }
}
let maxDifference=0;
for(let test=0;test<36;test++){
  const layers=Array.from({length:1+test%3},(_,i)=>({
    centerX:random()*width,centerY:random()*height,radiusX:1+random()*45,radiusY:1+random()*30,
    negativeRadiusX:test%2?1+random()*35:undefined,positiveRadiusX:test%3?1+random()*35:undefined,
    lowerRadiusY:1+random()*40,rotation:random()*Math.PI*2,strength:random()*.6,
    falloffPower:.1+random()*3,responseFloor:random(),responseInfluence:random(),
    clipToPath:test%4===0,path:test%4===0?{}:undefined,
  }));
  const actual=context(),expected=context();
  renderDepositRgbLayers(actual,'#9a573f',layers);reference(expected,layers);
  for(let i=0;i<actual.data.length;i++)maxDifference=Math.max(maxDifference,Math.abs(actual.data[i]-expected.data[i]));
}
// A tiny Gaussian far from another layer must retain its peak despite an
// underflowing tail at the start of the shared bounding rectangle.
const distant=[{centerX:5,centerY:5,radiusX:1,radiusY:1,strength:.5},
  {centerX:165,centerY:107,radiusX:1,radiusY:1,strength:.5}];
const actual=context(),expected=context();renderDepositRgbLayers(actual,'#9a573f',distant);reference(expected,distant);
for(let i=0;i<actual.data.length;i++)maxDifference=Math.max(maxDifference,Math.abs(actual.data[i]-expected.data[i]));
assert(maxDifference<=1,`Optical deposit changed by ${maxDifference} byte levels`);
console.log(`PASS: rotated/asymmetric/thin/clipped/multilayer deposits match the scalar reference (max difference ${maxDifference}/255).`);
