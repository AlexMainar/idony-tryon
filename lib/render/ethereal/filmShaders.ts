import { etherealFilm, filmF0, filmFocusShader } from "./filmMaterial";
import { packEnergy } from "./filmPost";

export const etherealFilmVertexShader = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aSurfaceUv;
uniform float uAspect;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vSurfaceUv;
varying vec3 vSurfacePosition;
void main(){
  vUv=vec2(aPosition.x,1.0-aPosition.y);
  vNormal=aNormal;
  vSurfaceUv=aSurfaceUv;
  vSurfacePosition=vec3(aPosition.x,-aPosition.y*uAspect,-aPosition.z);
  gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,clamp(aPosition.z,-0.95,0.95),1.0);
}`;
export const etherealFilmFragmentShader = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
uniform sampler2D uCamera;
uniform sampler2D uCoverage;
uniform vec2 uTexel;
uniform vec3 uLightDirection;
uniform float uRadiance;
uniform float uProduct;
uniform float uAmount;
uniform float uFaceScale;
uniform vec3 uFaceRight;
uniform vec3 uFaceUp;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vSurfaceUv;
varying vec3 vSurfacePosition;
const float PI=3.14159265359;
${packEnergy}
${filmFocusShader}
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
float luminance(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
float cameraLuma(vec2 uv){return luminance(toLinear(texture2D(uCamera,uv).rgb));}
float neighborhood(vec2 uv,vec2 stepSize){
  float value=cameraLuma(uv)*4.0;
  value+=2.0*(cameraLuma(uv+vec2(stepSize.x,0.0))+cameraLuma(uv-vec2(stepSize.x,0.0))
    +cameraLuma(uv+vec2(0.0,stepSize.y))+cameraLuma(uv-vec2(0.0,stepSize.y)));
  value+=cameraLuma(uv+stepSize)+cameraLuma(uv-stepSize)
    +cameraLuma(uv+vec2(stepSize.x,-stepSize.y))+cameraLuma(uv+vec2(-stepSize.x,stepSize.y));
  return value/16.0;
}
vec3 detailNormal(vec3 normal,float height,float influence){
  #ifdef GL_OES_standard_derivatives
    vec3 dx=dFdx(vSurfacePosition),dy=dFdy(vSurfacePosition);
    vec3 r1=cross(dy,normal),r2=cross(normal,dx);
    float det=dot(dx,r1);
    vec3 gradient=sign(det)*(dFdx(height)*r1+dFdy(height)*r2)/max(abs(det),0.0000001);
    gradient*=influence;
    gradient*=min(1.0,0.012/max(length(gradient),0.00001));
    return normalize(normal-gradient);
  #else
    return normal;
  #endif
}
float ggx(vec3 N,vec3 V,vec3 L,float roughness,float f0){
  float nv=max(dot(N,V),0.0),nl=max(dot(N,L),0.0);
  if(nv<=0.0||nl<=0.0)return 0.0;
  vec3 H=normalize(V+L);
  float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
  float alpha=roughness*roughness,a2=alpha*alpha,d=nh*nh*(a2-1.0)+1.0;
  float D=a2/(PI*d*d);
  float gv=2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));
  float gl=2.0*nl/(nl+sqrt(a2+(1.0-a2)*nl*nl));
  float F=f0+(1.0-f0)*pow(1.0-vh,5.0);
  return D*gv*gl*F/max(4.0*nv,0.0001);
}
// Anisotropic Trowbridge-Reitz distribution and Smith masking, expressed in
// the cheek's tangent frame. See pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory.
float pearlReflection(vec3 N,vec3 T,vec3 B,vec3 V,vec3 L,float along,float across){
  float nv=max(dot(N,V),0.0),nl=max(dot(N,L),0.0);
  if(nv<=0.0||nl<=0.0)return 0.0;
  vec3 H=normalize(V+L);
  float ax=along*along,ay=across*across;
  float hx=dot(H,T)/ax,hy=dot(H,B)/ay,nh=max(dot(N,H),0.0);
  float d=hx*hx+hy*hy+nh*nh;
  float D=1.0/max(PI*ax*ay*d*d,0.00001);
  float vx=dot(V,T)*ax,vy=dot(V,B)*ay,lx=dot(L,T)*ax,ly=dot(L,B)*ay;
  float lv=(sqrt(1.0+(vx*vx+vy*vy)/max(nv*nv,0.00001))-1.0)*0.5;
  float ll=(sqrt(1.0+(lx*lx+ly*ly)/max(nl*nl,0.00001))-1.0)*0.5;
  float G=1.0/(1.0+lv+ll);
  float F=${etherealFilm.pearlReflectance}+${1 - etherealFilm.pearlReflectance}*pow(1.0-clamp(dot(V,H),0.0,1.0),5.0);
  return D*G*F/max(4.0*nv,0.0001);
}
// Soft angular sheen (Charlie distribution / Neubelt visibility). This is an
// appearance approximation for the pearl halo, not a measured cosmetic BRDF.
// https://google.github.io/filament/Filament.md.html#materialsystem/clothmodel
float pearlSheen(vec3 N,vec3 V,vec3 L){
  float nv=max(dot(N,V),0.0),nl=max(dot(N,L),0.0);
  if(nv<=0.0||nl<=0.0)return 0.0;
  float nh=max(dot(N,normalize(V+L)),0.0);
  float invAlpha=1.0/${etherealFilm.pearlSheenRoughness};
  float D=(2.0+invAlpha)*pow(max(1.0-nh*nh,0.0),invAlpha*0.5)/(2.0*PI);
  return ${etherealFilm.pearlSheenReflectance}*D*nl/max(4.0*(nl+nv-nl*nv),0.0001);
}
void main(){
  // Uniform branches are safe before derivatives. The depth prepass skips
  // coating calculations; the camera is composited later at full resolution.
  if(uProduct<0.5||uAmount<=0.0){gl_FragColor=vec4(0.0);return;}
  float deposition=texture2D(uCoverage,vSurfaceUv).r;
  float coverage=deposition*uProduct*uAmount;
  float focus=filmFocus(deposition);
  float local=neighborhood(vUv,uTexel*4.0);
  float filtered=neighborhood(vUv,uTexel*1.5);
  // Same bounded, spatially filtered surface cue as the lip coating. It is an
  // approximation of microrelief; it does not turn camera noise into glitter.
  float contrast=clamp(log((filtered+0.015)/(local+0.015)),-0.30,0.16);
  float interior=smoothstep(0.02,0.25,coverage);
  float height=contrast*uFaceScale*0.004;
  vec3 N=detailNormal(normalize(vNormal),height,interior);
  vec3 coatN=detailNormal(normalize(vNormal),height*0.55,interior);
  // Evaluate derivatives across complete pixel quads before rejecting the
  // coverage edge; divergent early returns make those derivatives undefined.
  if(coverage<0.00001){gl_FragColor=vec4(0.0);return;}
  vec3 V=vec3(0.0,0.0,1.0);
  vec3 axis=uFaceRight*(vSurfaceUv.x<0.5?-1.0:1.0)+uFaceUp*0.45;
  vec3 tangent=axis-N*dot(axis,N);
  if(dot(tangent,tangent)<0.0001)tangent=cross(abs(N.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0),N);
  vec3 T=normalize(tangent),B=normalize(cross(N,T));
  float crease=clamp(-contrast*2.0,0.0,0.5);
  // Thinly spread product is rougher; the central deposit has a stronger,
  // more defined pearl response. Quantity changes the finish, not only alpha.
  float finish=sqrt(coverage);
  float along=mix(${etherealFilm.thinRoughnessAlong},${etherealFilm.pearlRoughnessAlong},finish)+crease*0.06;
  float across=mix(${etherealFilm.thinRoughnessAcross},${etherealFilm.pearlRoughnessAcross},finish)+crease*0.06;
  float coatRoughness=mix(${etherealFilm.thinCoatRoughness},${etherealFilm.coatRoughness},finish)+crease*0.12;
  float pearl=0.0,body=0.0,coat=0.0,total=0.0;
  // A Gaussian angular source, following the sampling used for Lip Bloom.
  // Its spread is integrated, not painted as a band on the camera image.
  for(int i=0;i<13;i++){
    float radius=sqrt(float(i)/12.0),angle=float(i)*2.39996322973;
    float weight=exp(-2.0*radius*radius);
    vec3 L=normalize(uLightDirection+vec3(cos(angle)*radius*0.65,sin(angle)*radius*0.65,0.0));
    pearl+=pearlReflection(N,T,B,V,L,along,across)*weight;
    // The halo grows on the lateral curvature rather than whitening the
    // front-facing infraorbital plane like the previous broad GGX lobe.
    body+=pearlSheen(normalize(vNormal),V,L)*weight;
    coat+=ggx(coatN,V,L,coatRoughness,${filmF0})*weight;
    total+=weight;
  }
  pearl/=total;body/=total;coat/=total;
  // Neutral translucent film: the camera is the substrate, with no white or
  // champagne diffuse paint. The weak transmission term avoids treating the
  // coating as an independently opaque object laid over the face.
  float nv=clamp(dot(coatN,V),0.0,1.0);
  // Keep the stronger finish in the compact deposit. Raising this response
  // does not brighten the whole brush spread or add a separate white veil.
  float response=mix(${etherealFilm.spreadReflectionScale},${etherealFilm.coreReflectionScale},focus);
  float reflected=(pearl*1.4+coat*0.12+body*0.35)*uRadiance*${etherealFilm.reflectionGain.toFixed(1)}*response;
  // Keep a luminous center in the optical buffer. Spatial diffusion happens
  // before the camera composite, rather than suppressing the center by luma.
  float budget=${etherealFilm.reflectionBudget};
  float unitReflection=budget*(1.0-exp(-reflected/budget));
  gl_FragColor=vec4(packEnergy(coverage*unitReflection),nv,deposition);
}`;
