export const etherealVertexShader = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aSurfaceUv;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vSurfaceUv;
void main(){
  vUv=vec2(aPosition.x,1.0-aPosition.y);
  vNormal=aNormal;
  vSurfaceUv=aSurfaceUv;
  gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,clamp(aPosition.z,-0.95,0.95),1.0);
}`;
export const etherealFragmentShader = `
precision highp float;
uniform sampler2D uCamera;
uniform sampler2D uCoverage;
uniform vec2 uTexel;
uniform vec3 uLightDirection;
uniform float uRadiance;
uniform float uExposure;
uniform float uProduct;
uniform float uAmount;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vSurfaceUv;
const float PI=3.14159265359;
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 toDisplay(vec3 c){c=max(c,vec3(0.0));return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
float luma(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
float sampleLuma(vec2 uv){return luma(toLinear(texture2D(uCamera,uv).rgb));}
float ggx(vec3 N,vec3 V,vec3 L,float roughness,float f0){
  float nv=max(dot(N,V),0.0),nl=max(dot(N,L),0.0);
  if(nv<=0.0||nl<=0.0)return 0.0;
  vec3 H=normalize(V+L);
  float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
  float alpha=roughness*roughness, a2=alpha*alpha;
  float d=nh*nh*(a2-1.0)+1.0;
  float D=a2/(PI*d*d);
  float gv=2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));
  float gl=2.0*nl/(nl+sqrt(a2+(1.0-a2)*nl*nl));
  float F=f0+(1.0-f0)*pow(1.0-vh,5.0);
  return D*gv*gl*F/max(4.0*nv,0.0001);
}
vec3 exposure(vec3 c){
  float peak=max(c.r,max(c.g,c.b));
  return c*(1.0+(uExposure-1.0)*(1.0-clamp(peak,0.0,1.0)));
}
void main(){
  vec3 original=texture2D(uCamera,vUv).rgb;
  float coverage=texture2D(uCoverage,vSurfaceUv).r*uProduct*uAmount;
  if(coverage<0.00001){gl_FragColor=vec4(exposure(original),1.0);return;}
  vec3 base=toLinear(original);
  float center=luma(base);
  float east=sampleLuma(vUv+vec2(uTexel.x,0.0));
  float west=sampleLuma(vUv-vec2(uTexel.x,0.0));
  float north=sampleLuma(vUv+vec2(0.0,uTexel.y));
  float south=sampleLuma(vUv-vec2(0.0,uTexel.y));
  float local=(east+west+north+south+center*4.0)/8.0;
  // Camera contrast only adds a bounded micro variation. It does not decide
  // the main lobe, and is not treated as measured physical surface height.
  vec2 slope=clamp(vec2(east-west,north-south)/max(local,0.06),vec2(-0.08),vec2(0.08));
  vec3 N=normalize(vNormal+vec3(-slope.x,-slope.y,0.0)*0.22);
  vec3 V=vec3(0.0,0.0,1.0);
  float detail=clamp((center-local)/max(local,0.06),-0.15,0.15);
  float roughness=clamp(0.48-detail*0.2,0.43,0.55);
  float extra=0.0;
  // Five deterministic samples approximate a wide source. No per-frame noise.
  for(int i=0;i<5;i++){
    vec2 offset=vec2(0.0);
    if(i==1)offset=vec2(0.30,0.0);
    if(i==2)offset=vec2(-0.30,0.0);
    if(i==3)offset=vec2(0.0,0.30);
    if(i==4)offset=vec2(0.0,-0.30);
    vec3 L=normalize(uLightDirection+vec3(offset,0.0));
    float coated=0.75*ggx(N,V,L,roughness,0.075)+0.25*ggx(N,V,L,0.66,0.075);
    float bare=ggx(N,V,L,0.70,0.028);
    extra+=max(coated-bare,0.0)/5.0;
  }
  // Approximate added reflection over camera skin; no diffuse white material.
  float reflected=coverage*extra*uRadiance*2.6;
  float budget=0.12;
  float bounded=budget*(1.0-exp(-reflected/budget));
  float guard=1.0-smoothstep(0.65,1.0,max(base.r,max(base.g,base.b)));
  vec3 composed=base+vec3(bounded*guard);
  // Camera and coating pass through the same display exposure, exactly once.
  gl_FragColor=vec4(clamp(exposure(toDisplay(composed)),0.0,1.0),1.0);
}`;
