/** Edge coverage only. Product pigment, physical specular and clearcoat remain
 * in the same MeshPhysicalMaterial. No overall opacity or color correction.
 */
export function addLipEdgeCoverage(material: import("three").MeshPhysicalMaterial) {
  const enabled = { value: 1 };
  material.transparent = true;
  material.depthWrite = false;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.lipIntegration = enabled;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      attribute vec3 lipEdgeDistance;
      varying vec3 vLipEdgeDistance;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vLipEdgeDistance = lipEdgeDistance;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float lipIntegration;
      varying vec3 vLipEdgeDistance;
    `).replace('#include <opaque_fragment>', `
      #include <opaque_fragment>
      // Transition only INSIDE the silhouette. Scale to band thickness so a
      // thin upper lip retains its pigment; keep the cavity edge tighter.
      float lipBandWidth = vLipEdgeDistance.x + vLipEdgeDistance.y;
      float lipInnerFeather = clamp(lipBandWidth * 0.10, 0.65, 1.25);
      float lipOuterFeather = clamp(lipBandWidth * 0.16, 0.9, 2.25);
      float lipCoverage = smoothstep(0.0, lipInnerFeather, vLipEdgeDistance.x)
        * smoothstep(0.0, lipOuterFeather, vLipEdgeDistance.y)
        * smoothstep(0.0, 1.3, vLipEdgeDistance.z);
      gl_FragColor.a *= mix(1.0, lipCoverage, lipIntegration);
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}-lip-edge-coverage-v2`;
  return { setEnabled(value: boolean) { enabled.value = value ? 1 : 0; } };
}
