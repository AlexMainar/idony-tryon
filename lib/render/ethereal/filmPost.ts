import { etherealFilm, filmF0, filmFocusShader } from "./filmMaterial";

export const LIGHT_RANGE=.25;
export const packEnergy=`
vec2 packEnergy(float value){
  float code=floor(clamp(value/${LIGHT_RANGE},0.0,1.0)*65535.0+0.5);
  float hi=floor(code/256.0);return vec2(hi,code-hi*256.0)/255.0;
}`;
const unpack=`float energy(vec2 rg){return dot(rg,vec2(65280.0,255.0))*${LIGHT_RANGE}/65535.0;}`;
const vertex=`attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=vec2(aPosition.x,1.0-aPosition.y);gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,0.0,1.0);}`;
const weights=Array.from({length:9},(_,i)=>Math.exp(-.5*((i-4)*.75)**2));
const total=weights.reduce((a,b)=>a+b,0);
export const diffusionKernel=weights.map(v=>v/total);
const blur=`precision highp float;uniform sampler2D uInput;uniform vec2 uStep;varying vec2 vUv;${packEnergy}${unpack}
void main(){float value=0.0;
${diffusionKernel.map((w,i)=>`value+=energy(texture2D(uInput,vUv+uStep*${(i-4).toFixed(1)}).rg)*${w};`).join('\n')}
gl_FragColor=vec4(packEnergy(value),0.0,1.0);}`;
const composite=`precision highp float;
uniform sampler2D uCamera;uniform sampler2D uLight;uniform sampler2D uSoft;
uniform vec2 uTexel;uniform float uExposure;uniform float uProduct;uniform float uAmount;
varying vec2 vUv;${unpack}${filmFocusShader}
vec3 linear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 display(vec3 c){c=max(c,vec3(0.0));return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 cameraColour(vec2 uv){return linear(texture2D(uCamera,uv).rgb);}
vec3 localColour(vec2 d){
  vec3 local=cameraColour(vUv)*4.0;
  local+=2.0*(cameraColour(vUv+vec2(d.x,0.0))+cameraColour(vUv-vec2(d.x,0.0))+cameraColour(vUv+vec2(0.0,d.y))+cameraColour(vUv-vec2(0.0,d.y)));
  local+=cameraColour(vUv+d)+cameraColour(vUv-d)+cameraColour(vUv+vec2(d.x,-d.y))+cameraColour(vUv+vec2(-d.x,d.y));return local/16.0;
}
vec3 expose(vec3 c){return c*(1.0+(uExposure-1.0)*(1.0-clamp(max(c.r,max(c.g,c.b)),0.0,1.0)));}
void main(){
  vec3 original=texture2D(uCamera,vUv).rgb;
  if(uProduct<.5||uAmount<=0.0){gl_FragColor=vec4(expose(original),1.0);return;}
  vec4 light=texture2D(uLight,vUv);
  if(light.a<=0.0){gl_FragColor=vec4(expose(original),1.0);return;}
  float focused=energy(light.rg),soft=energy(texture2D(uSoft,vUv).rg);
  float deposition=light.a;
  float permit=smoothstep(0.0,.025,deposition);
  float focus=filmFocus(deposition);
  vec3 base=linear(original);
  // Two odd sampling radii suppress pixel-scale aliasing in the substrate
  // estimate. The sharp camera itself is never filtered in the composite.
  vec3 localSkin=.5*(localColour(uTexel)+localColour(uTexel*3.0));
  float local=luma(localSkin);
  float relief=clamp((luma(base)+.001)/(local+.001),.45,1.65);
  float nv=clamp(light.b,0.0,1.0);
  float fresnel=${filmF0}+${1-filmF0}*pow(1.0-nv,5.0);
  float transmission=1.0-deposition*uAmount*min(fresnel,${etherealFilm.maxTransmissionFresnel})*${etherealFilm.transmissionInfluence};
  // Keep a neutral/rosy pearl highlight while carrying the underlying skin
  // colour through the broader reflection. Normalising luminance keeps this
  // colour correction independent of the previously calibrated light energy.
  vec3 pearl=mix(vec3(1.025,.99,1.01),vec3(1.035,.985,1.035),smoothstep(.15,.8,1.0-nv));pearl/=luma(pearl);
  vec3 skinColour=clamp(localSkin/max(local,.015),vec3(.35),vec3(2.5));skinColour/=luma(skinColour);
  float retain=mix(${etherealFilm.edgeSkinColourRetention},${etherealFilm.coreSkinColourRetention},focus)*smoothstep(.004,.025,local);
  vec3 tint=mix(pearl,skinColour,retain);tint/=luma(tint);
  // Preserve the luminous center; only the transition and faint spread use
  // predominantly diffused light. One continuous blend avoids a visible ring.
  float diffusion=mix(${etherealFilm.edgeDiffusionMix},${etherealFilm.coreDiffusionMix},focus);
  float reflected=mix(focused,soft,diffusion)*permit*relief;
  float guard=1.0-smoothstep(.65,1.0,max(base.r,max(base.g,base.b)));
  gl_FragColor=vec4(clamp(expose(display(base*transmission+tint*reflected*guard)),0.0,1.0),1.0);
}`;

/** Full-resolution focused reflection, with half-resolution diffusion buffers.
 * A narrow bright center must not be rasterized on a coarser grid than skin.
 * RG packs linear energy
 * in 16 bits with an affine decode, so LINEAR filtering interpolates energy.
 * B/A retain the original normal/view term and deposition for the composite.
 */
export function createFilmPost(gl:WebGLRenderingContext){
  const shaders:WebGLShader[]=[],programs:WebGLProgram[]=[],textures:WebGLTexture[]=[],fbos:WebGLFramebuffer[]=[];
  let depth:WebGLRenderbuffer|null=null,quad:WebGLBuffer|null=null;
  const dispose=()=>{for(const p of programs)gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);for(const t of textures)gl.deleteTexture(t);for(const f of fbos)gl.deleteFramebuffer(f);if(depth)gl.deleteRenderbuffer(depth);if(quad)gl.deleteBuffer(quad);};
  function program(fragment:string){
    const p=gl.createProgram();if(!p)throw Error('No se pudo crear la difusión Ethereal.');programs.push(p);
    for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type);if(!s)throw Error('No se pudo reservar el shader de difusión.');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Shader de difusión inválido.');gl.attachShader(p,s);}
    gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'Enlace de difusión inválido.');return p;
  }
  let blurProgram:WebGLProgram,compositeProgram:WebGLProgram;
  try{
    blurProgram=program(blur);compositeProgram=program(composite);quad=gl.createBuffer();depth=gl.createRenderbuffer();if(!quad||!depth)throw Error('No se pudieron reservar los buffers de luz.');
    for(let i=0;i<3;i++){
      const t=gl.createTexture(),f=gl.createFramebuffer();if(!t||!f){if(t)gl.deleteTexture(t);if(f)gl.deleteFramebuffer(f);throw Error('No se pudo reservar la textura de luz.');}
      textures.push(t);fbos.push(f);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),gl.STATIC_DRAW);
  }catch(error){dispose();throw error;}
  let width=0,height=0,sourceWidth=0,sourceHeight=0;
  const uniform=(p:WebGLProgram,name:string)=>gl.getUniformLocation(p,name);
  const blurLocations={input:uniform(blurProgram,'uInput'),step:uniform(blurProgram,'uStep')};
  const compositeLocations=Object.fromEntries(['uCamera','uLight','uSoft','uTexel','uExposure','uProduct','uAmount'].map(n=>[n,uniform(compositeProgram,n)]));
  const drawQuad=(p:WebGLProgram)=>{const at=gl.getAttribLocation(p,'aPosition');gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,6);};
  const bindTexture=(slot:number,t:WebGLTexture)=>{gl.activeTexture(gl.TEXTURE0+slot);gl.bindTexture(gl.TEXTURE_2D,t);};
  return {dispose,
    resize(w:number,h:number){
      const nextW=Math.max(1,Math.ceil(w/2)),nextH=Math.max(1,Math.ceil(h/2));if(sourceWidth===w&&sourceHeight===h)return;width=nextW;height=nextH;sourceWidth=w;sourceHeight=h;
      gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      for(let i=0;i<3;i++){gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,i===0?sourceWidth:width,i===0?sourceHeight:height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,textures[i],0);}
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,sourceWidth,sourceHeight);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[0]);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      for(const f of fbos){gl.bindFramebuffer(gl.FRAMEBUFFER,f);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('El buffer de luz Ethereal no está completo.');}gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    },
    begin(){gl.disable(gl.DITHER);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[0]);gl.viewport(0,0,sourceWidth,sourceHeight);gl.colorMask(true,true,true,true);gl.depthMask(true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);},
    compose(camera:WebGLTexture,w:number,h:number,faceScale:number,exposure:number,enabled:boolean,amount=1){
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);
      if(enabled){
        gl.useProgram(blurProgram);gl.viewport(0,0,width,height);gl.uniform1i(blurLocations.input,0);
        const sigma=Math.max(1.5,Math.min(18,faceScale*w*etherealFilm.diffusionRadius));
        for(let axis=0;axis<2;axis++){gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[axis+1]);bindTexture(0,textures[axis]);gl.uniform2f(blurLocations.step,axis===0?sigma*.75/w:0,axis===1?sigma*.75/h:0);drawQuad(blurProgram);}
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.useProgram(compositeProgram);
      bindTexture(0,camera);bindTexture(1,textures[0]);bindTexture(2,textures[2]);
      gl.uniform1i(compositeLocations.uCamera,0);gl.uniform1i(compositeLocations.uLight,1);gl.uniform1i(compositeLocations.uSoft,2);gl.uniform2f(compositeLocations.uTexel,1/w,1/h);gl.uniform1f(compositeLocations.uExposure,exposure);gl.uniform1f(compositeLocations.uProduct,enabled?1:0);gl.uniform1f(compositeLocations.uAmount,amount);drawQuad(compositeProgram);gl.activeTexture(gl.TEXTURE0);
    },
  };
}
