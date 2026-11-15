// One deposition field in canonical skin coordinates. A compact central
// deposit fades into a much thinner brush spread along the cheekbone.
const smooth=(a:number,b:number,value:number)=>{
  const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);
};
export function filmDensity(x:number,y:number){
  x=Math.abs(x);
  const dx=x-5.65,dy=y-.50,axisLength=Math.hypot(1,.45);
  const along=(dx+dy*.45)/axisLength,across=(dy-dx*.45)/axisLength;
  // Blend more gently down the cheek; the upper edge approaches the eye less.
  const coreWidth=across>0?.28:.36,spreadWidth=across>0?.50:.90;
  const core=Math.exp(-.5*((along/.80)**2+(across/coreWidth)**2));
  const spread=Math.exp(-.5*((along/1.65)**2+(across/spreadWidth)**2));
  // A middle brush spread bridges the dense core and the thin outer tail.
  // This leaves visible skin-scale reflection in the transition instead of
  // dropping straight from the core into a barely visible broad wash.
  const middleWidth=across>0?.46:.63;
  const middle=Math.exp(-.5*((along/1.10)**2+(across/middleWidth)**2));
  // Extend low/medium deposition along the cheekbone without broadening the
  // dense core. The gate vanishes in the loaded center and grows smoothly in
  // the brush spread; its slope stays below the core's descending slope.
  const extensionWidth=across>0?.60:1.05;
  const extension=Math.exp(-.5*((along/1.85)**2+(across/extensionWidth)**2));
  const deposit=.82*core+.18*spread+.20*middle*(1-core)**2
    +.16*extension*(1-smooth(.15,.60,core));
  const orbitalLimit=.45+.70*Math.max(0,Math.min(2.4,x-4.1));
  const orbital=1-smooth(orbitalLimit-.15,orbitalLimit+.15,y);
  // Retain a longer lateral tail, still ending before the surface boundary.
  const lateral=(1-smooth(6.15,7.25,x))**.75,inner=smooth(3.6,4.1,x);
  const lower=smooth(-1.5,-.65,y);
  const density=deposit*orbital*lateral*inner*lower;
  // End only sub-percent tails before the reduced mesh's support boundary.
  return density*smooth(.002,.008,density);
}
