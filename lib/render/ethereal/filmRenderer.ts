import type { EtherealDrawOptions } from "./renderer";
import { createCheekSurface } from "./surface";
import { createEtherealLighting, type EtherealLight } from "./lighting";
import { createCoveragePixels, COVERAGE_SIZE } from "./coverage";
import { filmDensity } from "./filmCoverage";
import { etherealFilmVertexShader, etherealFilmFragmentShader } from "./filmShaders";
import { createEtherealTracking, type EtherealSurfaceState } from "./tracking";
import { createFilmPost } from "./filmPost";
export const ETHEREAL_FILM_REVISION="ethereal-film-09";
export function createEtherealFilmRenderer(){
  const material="film" as const;
  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl",{alpha:false,depth:true,antialias:true,premultipliedAlpha:false});
  if(!gl)throw new Error("No se pudo iniciar el renderer WebGL de Ethereal.");
  gl.getExtension("OES_standard_derivatives");
  const shaders: WebGLShader[]=[];
  let program: WebGLProgram|null=null,texture: WebGLTexture|null=null;
  let coverageTexture: WebGLTexture|null=null;
  let buffer: WebGLBuffer|null=null,indexBuffer: WebGLBuffer|null=null;
  const cleanup=()=>{if(buffer)gl.deleteBuffer(buffer);if(indexBuffer)gl.deleteBuffer(indexBuffer);
    if(texture)gl.deleteTexture(texture);if(coverageTexture)gl.deleteTexture(coverageTexture);if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);};
  try{
    const compile=(type:number,source:string)=>{
      const shader=gl.createShader(type);if(!shader)throw new Error("No se pudo reservar el shader Ethereal.");
      shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||"Shader Ethereal inválido.");return shader;
    };
    program=gl.createProgram();if(!program)throw new Error("No se pudo crear el programa Ethereal.");
    gl.attachShader(program,compile(gl.VERTEX_SHADER,etherealFilmVertexShader));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,etherealFilmFragmentShader));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||"No se pudo enlazar Ethereal.");
    texture=gl.createTexture();coverageTexture=gl.createTexture();buffer=gl.createBuffer();indexBuffer=gl.createBuffer();
    if(!texture||!coverageTexture||!buffer||!indexBuffer)throw new Error("No se pudieron crear los recursos de Ethereal.");
  }catch(error){cleanup();gl.getExtension("WEBGL_lose_context")?.loseContext();throw error;}
  let post:ReturnType<typeof createFilmPost>;
  try{post=createFilmPost(gl);}catch(error){cleanup();gl.getExtension("WEBGL_lose_context")?.loseContext();throw error;}
  const uniform=(name:string)=>gl.getUniformLocation(program!,name);
  const uniforms=Object.fromEntries(["uAspect","uFaceScale","uFaceRight","uFaceUp","uCamera","uCoverage","uTexel","uLightDirection","uRadiance","uProduct","uAmount"].map(name=>[name,uniform(name)]));
  const attributes=[gl.getAttribLocation(program!,"aPosition"),gl.getAttribLocation(program!,"aNormal"),gl.getAttribLocation(program!,"aSurfaceUv")];
  const surface=createCheekSurface(true),lighting=createEtherealLighting();
  const tracking=createEtherealTracking();
  let surfaceState:EtherealSurfaceState|undefined;

  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,coverageTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,COVERAGE_SIZE,COVERAGE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,createCoveragePixels(filmDensity));
  gl.activeTexture(gl.TEXTURE0);
  gl.useProgram(program);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,surface.indices,gl.STATIC_DRAW);
  let disposed=false;
  function uploadVertices(data:Float32Array){
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    [3,3,2].forEach((size,i)=>{gl.enableVertexAttribArray(attributes[i]);gl.vertexAttribPointer(attributes[i],size,gl.FLOAT,false,32,[0,12,24][i]);});
  }
  return {
    material,
    get surfaceState(){return surfaceState;},
    revision: ETHEREAL_FILM_REVISION,
    draw(ctx:CanvasRenderingContext2D,options:EtherealDrawOptions):EtherealLight{
      if(disposed||gl.isContextLost())throw new Error("El contexto gráfico de Ethereal no está disponible.");
      const {source,landmarks,product,exposureGain,enabled,frozen,timestampMs}=options;
      if(canvas.width!==source.width||canvas.height!==source.height){canvas.width=source.width;canvas.height=source.height;}
      post.resize(source.width,source.height);
      const tracked=options.surfaceOverride??tracking.update(source,landmarks,source.width,source.height,timestampMs,frozen);
      const renderPoints=tracked?.landmarks??null;
      const frame=surface.update(renderPoints,source.width,source.height,tracked?.frame);
      surfaceState=frame&&renderPoints?{landmarks:renderPoints,frame}:undefined;
      const light=options.lightingOverride ?? lighting.update(source,landmarks,frame,timestampMs,frozen);
      post.begin();gl.useProgram(program);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      // Upload before drawing back: safe even when source and target coincide.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      gl.uniform1i(uniforms.uCamera,0);gl.uniform2f(uniforms.uTexel,1/canvas.width,1/canvas.height);
      gl.uniform1f(uniforms.uAspect,source.height/source.width);
      const eyeLeft=landmarks?.[33],eyeRight=landmarks?.[263];
      const faceScale=eyeLeft&&eyeRight
        ? Math.hypot(eyeLeft.x-eyeRight.x,(eyeLeft.y-eyeRight.y)*source.height/source.width) : .25;
      gl.uniform1f(uniforms.uFaceScale,Math.max(.05,faceScale));
      gl.uniform3f(uniforms.uFaceRight,...(frame?.x ?? [1,0,0] as const));
      gl.uniform3f(uniforms.uFaceUp,...(frame?.y ?? [0,1,0] as const));
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,coverageTexture);gl.uniform1i(uniforms.uCoverage,1);gl.activeTexture(gl.TEXTURE0);
      gl.uniform3f(uniforms.uLightDirection,...light.direction);gl.uniform1f(uniforms.uRadiance,light.radiance);
      const amount=Math.max(0,Math.min(1,(product.opacity??.46)/.46));
      gl.uniform1f(uniforms.uAmount,amount);
      gl.uniform1f(uniforms.uProduct,0);

      if(enabled&&frame){
        if(surface.hasOccluder){
          gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
          gl.colorMask(false,false,false,false);
          uploadVertices(surface.occluderVertices);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,surface.occluderIndices,gl.DYNAMIC_DRAW);
          gl.drawElements(gl.TRIANGLES,surface.occluderIndices.length,gl.UNSIGNED_SHORT,0);
          gl.colorMask(true,true,true,true);gl.depthMask(false);
        }
        gl.uniform1f(uniforms.uProduct,1);
        uploadVertices(surface.vertices);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,surface.indices,gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES,surface.indices.length,gl.UNSIGNED_SHORT,0);}
      gl.depthMask(true);gl.disable(gl.DEPTH_TEST);
      post.compose(texture!,canvas.width,canvas.height,Math.max(.05,faceScale),Math.max(1,Math.min(1.55,exposureGain)),enabled&&!!frame,amount);
      ctx.drawImage(canvas,0,0,source.width,source.height);
      return light;
    },
    dispose(){if(disposed)return;disposed=true;tracking.reset();surfaceState=undefined;post.dispose();cleanup();gl.getExtension("WEBGL_lose_context")?.loseContext();canvas.width=canvas.height=1;},
  };
}
