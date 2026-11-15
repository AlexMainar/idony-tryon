import { buildCanonicalLipGeometry } from "./canonicalGeometry";
import { bindLipGeometry, type LipPoint } from "./deformGeometry";
import { addLipEdgeCoverage } from "./integrateMaterial";
import { createLipMaterial, addLipLighting } from "./sceneMaterial";

import { addLipCameraDetail } from "./cameraDetail";

export function createLipOilRenderer(THREE: typeof import("three")) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const base = document.createElement("canvas");
  const baseCtx = base.getContext("2d")!;
  const texture = new THREE.CanvasTexture(base);texture.colorSpace=THREE.SRGBColorSpace;
  scene.background=texture;
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,.1,10000);camera.position.z=2000;
  const material=createLipMaterial(THREE,"#a53a39");
  const edge=addLipEdgeCoverage(material);
  const detail=addLipCameraDetail(material,texture);addLipLighting(THREE,scene);
  const lips=(["upper","lower"] as const).map(kind=>{
    const geometry=buildCanonicalLipGeometry(THREE,{kind,widthSegments:72,heightSegments:16,
      frontDepth:kind==="upper"?.25:.27,backDepth:kind==="upper"?.12:.14});
    const binding=bindLipGeometry(geometry,kind),mesh=new THREE.Mesh(geometry,material);
    mesh.frustumCulled=false;scene.add(mesh);return {geometry,binding,mesh};
  });
  return {
    draw(ctx: CanvasRenderingContext2D, image: CanvasImageSource, points: LipPoint[] | null,
      width: number, height: number, color: string) {
      if(base.width!==width||base.height!==height){
        base.width=width;base.height=height;renderer.setSize(width,height,false);
        camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();
      }
      baseCtx.drawImage(image,0,0,width,height);texture.needsUpdate=true;
      material.color.set(color);edge.setEnabled(true);detail.update(width,height,true);
      for(const lip of lips){
        lip.mesh.visible=!!points&&lip.binding.update(points,width,height,true);
      }
      renderer.render(scene,camera);
      // Copy synchronously while the WebGL drawing buffer is valid. The renderer
      // canvas remains detached, so global canvas layout rules cannot affect it.
      ctx.drawImage(renderer.domElement,0,0,width,height);
    },
    dispose(){
      for(const lip of lips)lip.geometry.dispose();
      material.dispose();texture.dispose();renderer.dispose();renderer.forceContextLoss();
    },
  };
}
