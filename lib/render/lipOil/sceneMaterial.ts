export const LIP_MATERIAL_REVISION = "oil-soft-light-4";

type ThreeModule = typeof import("three");

/** Shared by live camera and recorded-frame replay. */
export function createLipMaterial(THREE: ThreeModule, color: string) {
  const material = new THREE.MeshPhysicalMaterial({
    specularIntensity: .25,
    color, roughness: .48, metalness: 0, clearcoat: 1,
    clearcoatRoughness: .24, ior: 1.45, side: THREE.FrontSide,
  });
  // Calibrated pigment receives uniform neutral irradiance. Direct lights
  // still generate the physical specular and clearcoat, but cannot repaint the
  // base color as the lip normals change during speech.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
      'vec3 totalDiffuse = reflectedLight.indirectDiffuse;',
    );
  };
  material.customProgramCacheKey = () => 'lip-neutral-pigment-v1';
  return material;
}
export function addLipLighting(THREE: ThreeModule, scene: import("three").Scene) {
  // Lambert's 1/pi BRDF cancels this irradiance, preserving the linear base
  // color before the physical clearcoat contribution. Equal sky/ground colors
  // make the pigment independent of the surface normal.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, Math.PI));
  // Integrate a soft angular emitter with Gaussian-weighted samples. Unlike
  // a uniform rectangular emitter, this has no hard rectangular footprint.
  // Each sample still evaluates Three's physical BRDF against the lip normals.
  const addSoftSource = (x: number, y: number, z: number, radius: number, energy: number) => {
    // A disk sampled with a golden-angle spiral avoids a row/column pattern
    // in the reflection. Normalize weights so spread does not change energy.
    const samples = Array.from({ length: 13 }, (_, i) => {
      const r = Math.sqrt(i / 12);
      const angle = i * 2.399963229728653;
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, weight: Math.exp(-2 * r * r) };
    });
    const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
    for (const sample of samples) {
      const light = new THREE.DirectionalLight(0xffffff, energy * sample.weight / total);
      light.position.set(x + sample.x * radius, y + sample.y * radius, z);
      scene.add(light);
    }
  };
  addSoftSource(-450, 600, 1400, 650, 1.10);
  addSoftSource(650, 150, 1200, 750, .275);
}
