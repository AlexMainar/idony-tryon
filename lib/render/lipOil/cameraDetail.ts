/** Current-frame detail modulates pigment and the physical surface response.
 * Luminance is a bounded microrelief cue, not a measured depth map. Broad light
 * changes cancel locally, and source RGB never replaces the product hue.
 */
export function addLipCameraDetail(
  material: import("three").MeshPhysicalMaterial,
  texture: import("three").Texture,
) {
  const frameSize = { value: { x: 1, y: 1 } };
  const strength = { value: 1 };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.lipCameraFrame = { value: texture };
    shader.uniforms.lipFrameSize = frameSize;
    shader.uniforms.lipDetailStrength = strength;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform sampler2D lipCameraFrame;
      uniform vec2 lipFrameSize;
      uniform float lipDetailStrength;
      float lipLuminance(vec2 uv) {
        return dot(texture2D(lipCameraFrame, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
      }
      float lipNeighborhood(vec2 uv, vec2 stepSize) {
        float mean = lipLuminance(uv) * 4.0;
        mean += 2.0 * (lipLuminance(uv + vec2(stepSize.x, 0.0))
          + lipLuminance(uv - vec2(stepSize.x, 0.0))
          + lipLuminance(uv + vec2(0.0, stepSize.y))
          + lipLuminance(uv - vec2(0.0, stepSize.y)));
        mean += lipLuminance(uv + stepSize) + lipLuminance(uv - stepSize)
          + lipLuminance(uv + vec2(stepSize.x, -stepSize.y))
          + lipLuminance(uv + vec2(-stepSize.x, stepSize.y));
        return mean / 16.0;
      }
      // Surface-gradient bump mapping in view space. Limiting the tangent
      // gradient prevents camera noise or a dark mouth edge flipping normals.
      vec3 lipDetailNormal(vec3 surfacePosition, vec3 surfaceNormal, float height, float influence) {
        vec3 dx = dFdx(surfacePosition), dy = dFdy(surfacePosition);
        vec3 r1 = cross(dy, surfaceNormal), r2 = cross(surfaceNormal, dx);
        float determinant = dot(dx, r1);
        vec3 gradient = sign(determinant)
          * (dFdx(height) * r1 + dFdy(height) * r2)
          / max(abs(determinant), 0.00001);
        // Fade the gradient, not the height: differentiating an edge fade
        // would manufacture a ridge and a new specular rim at the silhouette.
        gradient *= influence;
        gradient *= min(1.0, 0.16 / max(length(gradient), 0.00001));
        return normalize(surfaceNormal - gradient);
      }
    `).replace('#include <map_fragment>', `
      #include <map_fragment>
      // Both renderers use pixelRatio=1, with the same unmirrored source frame.
      // Mirroring happens after rendering and therefore affects both equally.
      vec2 lipUV = gl_FragCoord.xy / lipFrameSize;
      vec2 lipStep = vec2(3.0) / lipFrameSize;
      float lipCenter = lipLuminance(lipUV);
      float lipLocal = lipNeighborhood(lipUV, lipStep);
      float lipBroad = lipNeighborhood(lipUV, lipStep * 2.0);
      // Use each pixel's own neighborhood, never a moving central lip sample.
      // Preserve creases instead of clipping almost all texture to +/-8%.
      // Log contrast suppresses exposure dependence and limits highlights.
      float lipFineContrast = log((lipCenter + 0.015) / (lipLocal + 0.015));
      float lipBroadContrast = log((lipCenter + 0.015) / (lipBroad + 0.015));
      float lipContrast = clamp(mix(lipFineContrast, lipBroadContrast, 0.35), -0.36, 0.18);
      float lipDetail = exp(lipContrast);
      diffuseColor.rgb *= mix(1.0, lipDetail, lipDetailStrength);
      // Keep texture-derived normals away from the silhouette/cavity, where
      // camera luminance describes occlusion rather than surface relief.
      float lipDetailInterior = smoothstep(0.4, 2.0, min(vLipEdgeDistance.x, vLipEdgeDistance.y))
        * smoothstep(0.3, 1.6, vLipEdgeDistance.z);
      // Filter the signal BEFORE differentiating it. Raw camera texels and
      // compression blocks must not become sparkling facets in the oil.
      // Pigment above keeps its original detail; this is spatial, not temporal.
      float lipSurfaceMean = lipNeighborhood(lipUV, vec2(1.0) / lipFrameSize);
      float lipSurfaceContrast = log((lipSurfaceMean + 0.015) / (lipLocal + 0.015));
      float lipMicroHeight = clamp(lipSurfaceContrast, -0.36, 0.18) * 0.65 * lipDetailStrength;
      float lipCrease = clamp(-lipSurfaceContrast * 2.0, 0.0, 0.65)
        * lipDetailStrength * lipDetailInterior;
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = lipDetailNormal(-vViewPosition, normal, lipMicroHeight, lipDetailInterior);
    `).replace('#include <clearcoat_normal_fragment_maps>', `
      #include <clearcoat_normal_fragment_maps>
      // Oil smooths the smallest grooves, while retaining their orientation.
      #ifdef USE_CLEARCOAT
        clearcoatNormal = lipDetailNormal(-vViewPosition, clearcoatNormal, lipMicroHeight * 0.65, lipDetailInterior);
      #endif
    `).replace('#include <lights_physical_fragment>', `
      #include <lights_physical_fragment>
      material.roughness = min(1.0, material.roughness + lipCrease * 0.12);
      #ifdef USE_CLEARCOAT
        material.clearcoatRoughness = min(1.0, material.clearcoatRoughness + lipCrease * 0.10);
      #endif
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}-camera-surface-detail-v5`;
  return {
    update(width: number, height: number, enabled: boolean) {
      frameSize.value.x = Math.max(1,width); frameSize.value.y = Math.max(1,height);
      strength.value = enabled ? 1 : 0;
    },
  };
}
