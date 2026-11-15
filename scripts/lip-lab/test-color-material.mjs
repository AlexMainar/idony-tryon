import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
async function load(path) {
  const {outputText}=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020},
  });
  return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
}
const {createLipMaterial,addLipLighting}=await load('../../lib/render/lipOil/sceneMaterial.ts');
const {addLipEdgeCoverage}=await load('../../lib/render/lipOil/integrateMaterial.ts');
const {addLipCameraDetail}=await load('../../lib/render/lipOil/cameraDetail.ts');
const {lipOilTones}=await load('../../lib/render/lipOil/tones.ts');
for(const tone of lipOilTones){
  const material=createLipMaterial(THREE,tone.color),texture=new THREE.Texture();
  const edge=addLipEdgeCoverage(material),detail=addLipCameraDetail(material,texture);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader,{});
  // Exercise the full chain: a later extension used to overwrite earlier hooks.
  assert(shader.fragmentShader.includes('vec3 totalDiffuse = reflectedLight.indirectDiffuse;'));
  assert(!shader.fragmentShader.includes('reflectedLight.directDiffuse + reflectedLight.indirectDiffuse'));
  assert(shader.fragmentShader.includes('reflectedLight.directSpecular + reflectedLight.indirectSpecular'));
  assert(shader.fragmentShader.includes('clearcoatSpecularDirect + clearcoatSpecularIndirect'));
  assert(shader.fragmentShader.includes('gl_FragColor.a *= mix(1.0, lipCoverage, lipIntegration)'));
  assert(!shader.fragmentShader.includes('vLipReferenceUV'),'no moving reference patch');
  assert.equal(material.color.getHexString(),tone.color.slice(1),'sRGB product color is routed without overrides');
  assert.equal(material.emissive.getHex(),0);
  assert.equal(material.opacity,1);
  detail.update(960,720,true);assert.deepEqual(shader.uniforms.lipFrameSize.value,{x:960,y:720});
  detail.update(720,960,false);assert.deepEqual(shader.uniforms.lipFrameSize.value,{x:720,y:960});
  assert.equal(shader.uniforms.lipDetailStrength.value,0);
  edge.setEnabled(false);assert.equal(shader.uniforms.lipIntegration.value,0);
  assert.equal(material.clearcoat,1,'texture toggle cannot remove physical coating');
  material.dispose();texture.dispose();
}
const scene=new THREE.Scene();addLipLighting(THREE,scene);
const hemi=scene.children.find(light=>light.isHemisphereLight);
assert(hemi.color.equals(hemi.groundColor),'neutral pigment irradiance at any normal');
assert.equal(hemi.intensity/Math.PI,1,'neutral diffuse response in linear color space');
console.log('Three tones: color routing, shader extension composition, neutral diffuse, physical reflections, texture toggles and resizing passed.');

const emitters = scene.children.filter(light => light.isDirectionalLight);
assert.equal(emitters.length, 26);
assert(Math.abs(emitters.reduce((sum, light) => sum + light.intensity, 0) - 1.375) < 1e-8);
assert(!scene.children.some(light => light.isRectAreaLight));
