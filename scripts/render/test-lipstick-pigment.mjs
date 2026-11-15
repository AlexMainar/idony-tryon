import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/render/tonePresets/lips.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {renderLipGrace}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const catalog=JSON.parse(fs.readFileSync('data/products.json'));
globalThis.Path2D=class {moveTo(){}lineTo(){}closePath(){}addPath(){}};
const colors=[];
for(const [key,tone]of Object.entries(catalog).filter(([key])=>key.startsWith('lip_grace_'))){
 const points=Array.from({length:478},()=>({x:.5,y:.5}));
 for(const [name,ry]of [['lips_outer',.035],['lips_inner',.008]]){
  const ids=tone.regions[name];ids.forEach((id,i)=>points[id]={x:.5-.12*Math.cos(i/ids.length*Math.PI*2),y:.6-ry*Math.sin(i/ids.length*Math.PI*2)});
 }
 const calls=[],stack=[],ctx={globalAlpha:1,globalCompositeOperation:'source-over',filter:'none',fillStyle:'',
 save(){stack.push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,filter:this.filter,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},
 fill(){calls.push({alpha:this.globalAlpha,blend:this.globalCompositeOperation,color:this.fillStyle});},clip(){},fillRect(){},
 createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};}};
 renderLipGrace(ctx,points,tone,960,720,(color,opacity)=>({color,opacity}),true);
 const pigment=calls[0],coverage=pigment.alpha*pigment.color.opacity;
 const oldCoverage=key.endsWith('mystique_girl')?.7*.58*.78:key.endsWith('twilight_zone')?.7*.72*.9:.7*.68*.88;
 assert(coverage>oldCoverage*1.25,`${key}: pigment must be visibly denser than the weak previous finish`);
 assert.equal(pigment.blend,'multiply','preserve camera texture and shading');
 assert.equal(pigment.color.color,tone.color,'selected shade reaches the pigment unchanged');
 assert(coverage<.7,'retain translucent texture instead of an opaque colour sticker');
 assert.equal(stack.length,0);assert.equal(ctx.globalAlpha,1);assert.equal(ctx.globalCompositeOperation,'source-over');
 colors.push(pigment.color.color);
 console.log(`${key}: effective pigment ${(oldCoverage*100).toFixed(1)}% → ${(coverage*100).toFixed(1)}%`);
}
assert.equal(new Set(colors).size,4,'four independently routed lipstick shades');
delete globalThis.Path2D;
