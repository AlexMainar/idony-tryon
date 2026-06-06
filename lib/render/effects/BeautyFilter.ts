/**
 * BeautyFilter - WebGL-based real-time facial beauty pass
 *
 * Applies a light camera enhancement pass before makeup rendering:
 * 1. Edge-preserving bilateral blur (softens skin while keeping facial features sharp)
 * 2. Gentle exposure/contrast/saturation lift (brighter premium selfie look)
 * 3. Very subtle skin chroma softening (reduces redness without muting lip tint)
 */

export interface BeautyFilterParams {
  smoothingStrength: number;   // 0.0-5.0, default: 1.35 - blur aggressiveness
  edgeThreshold: number;       // 0.05-0.3, default: 0.18 - edge preservation gatekeeper
  contrastBoost: number;       // 1.0-1.4, default: 1.22 - brighter camera enhancement strength
  skinChromaSoftening: number; // 0.0-1.0, default: 0.12 - subtle red desaturation
  highlightBloom: number;      // 0.0-1.0, default: 0.16 - soft glossy highlight lift
  exposureLift: number;        // 0.0-0.3, default: 0.06 - premium selfie brightness
  softboxStrength: number;
  shadowLift: number;
  lipProtectStrength: number;
}

const defaultParams: BeautyFilterParams = {
  smoothingStrength: 1.35,
  edgeThreshold: 0.18,
  contrastBoost: 1.22,
  skinChromaSoftening: 0.12,
  highlightBloom: 0.14,
  exposureLift: 0.045,
  softboxStrength: 0.045,
  shadowLift: 0.012,
  lipProtectStrength: 0.85,
};

// Vertex shader - basic screen quad
const vertexShader = `
  attribute vec2 position;
  attribute vec2 texCoord;

  varying vec2 vTexCoord;

  void main() {
    vTexCoord = texCoord;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// Fragment shader - beauty filter with bilateral blur + contrast + chroma softening
const fragmentShader = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec2 uTexelSize;
  uniform float uSmoothingStrength;
  uniform float uEdgeThreshold;
  uniform float uContrastBoost;
  uniform float uSkinChromaSoftening;
  uniform float uHighlightBloom;
  uniform float uExposureLift;
  uniform float uSoftboxStrength;
  uniform float uShadowLift;
  uniform float uLipProtectStrength;
  varying vec2 vTexCoord;

  // Convert RGB to luminance (perceptually accurate, skin texture weighted)
  float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  // Luminance-based color distance (perceptually accurate for skin)
  float colorDistance(vec3 a, vec3 b) {
    return abs(getLuminance(a) - getLuminance(b));
  }

  // Convert RGB to HSL for chroma operations
  vec3 rgbToHsl(vec3 rgb) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float l = (maxC + minC) / 2.0;

    if (maxC == minC) {
      return vec3(0.0, 0.0, l);
    }

    float d = maxC - minC;
    float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);

    float h = 0.0;
    if (maxC == rgb.r) {
      h = mod((rgb.g - rgb.b) / d + (rgb.g < rgb.b ? 6.0 : 0.0), 6.0) / 6.0;
    } else if (maxC == rgb.g) {
      h = ((rgb.b - rgb.r) / d + 2.0) / 6.0;
    } else {
      h = ((rgb.r - rgb.g) / d + 4.0) / 6.0;
    }

    return vec3(h, s, l);
  }

  // Convert HSL back to RGB
  vec3 hslToRgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;

    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;

    vec3 rgb;
    if (h < 1.0 / 6.0) {
      rgb = vec3(c, x, 0.0);
    } else if (h < 2.0 / 6.0) {
      rgb = vec3(x, c, 0.0);
    } else if (h < 3.0 / 6.0) {
      rgb = vec3(0.0, c, x);
    } else if (h < 4.0 / 6.0) {
      rgb = vec3(0.0, x, c);
    } else if (h < 5.0 / 6.0) {
      rgb = vec3(x, 0.0, c);
    } else {
      rgb = vec3(c, 0.0, x);
    }

    return rgb + m;
  }

  void main() {
    vec4 centerSample = texture2D(uTexture, vTexCoord);
    vec3 centerColor = centerSample.rgb;
    float alpha = centerSample.a;
    float centerLum = getLuminance(centerColor);

    // ===== PILLAR 1: SMOOTH SHADOW MASK (Continuous Fade) =====
    // Use smoothstep instead of hard bool for natural transition
    // Shadows (lashes, brows): ~0% blur (stay sharp)
    // Transitions (cheeks, nose shadows): gradual blur
    // Bright skin: full bilateral blur
    float shadowMaskFade = smoothstep(0.15, 0.35, centerLum);

    vec3 blurred = vec3(0.0);
    float totalWeight = 0.0;

    float sampleStride = max(1.0, uSmoothingStrength);
    float densityMultiplier = 1.0;

    // ===== BILATERAL FILTER (Weighted by Shadow Mask) =====
    // In shadows: ~0% effect (stay nítidas)
    // In highlights: 100% effect (smooth skin)
    for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
      for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
        vec2 offset = vec2(dx, dy) * uTexelSize * sampleStride * densityMultiplier;
        vec3 sampleColor = texture2D(uTexture, vTexCoord + offset).rgb;

        float spatialDist = sqrt(dx * dx + dy * dy);
        float spatialWeight = exp(-(spatialDist * spatialDist) / (2.0 * 2.0));

        float colorDist = colorDistance(centerColor, sampleColor);
        float compressedColorDist = smoothstep(0.0, uEdgeThreshold * 3.5, colorDist);
        float colorWeight = exp(-(compressedColorDist * compressedColorDist) / (2.0 * 0.5 * 0.5));

        // Apply shadowMaskFade to blur weight: shadows stay sharp, lights smooth
        float weight = spatialWeight * colorWeight * shadowMaskFade;

        blurred += sampleColor * weight;
        totalWeight += weight;
      }
    }

    vec3 bilateralResult = totalWeight > 0.0 ? blurred / totalWeight : centerColor;

    // Blend original + blurred — never fully replace, always mix
    float blendAlpha = clamp(uSmoothingStrength * 0.30, 0.0, 0.65) * shadowMaskFade;
    vec3 smoothed = mix(centerColor, bilateralResult, blendAlpha);

    float beautyStrength = clamp(uContrastBoost - 1.0, 0.0, 0.4) / 0.4;

    // Gentle premium-camera tonemapping.
    // Lift mids slightly while protecting deep shadows and lip pigment density.
    vec3 graded = smoothed;
    graded = pow(max(graded, vec3(0.0)), vec3(0.90));
    graded = (graded - 0.5) * 1.08 + 0.5;
    graded *= (1.0 + uExposureLift);

    vec3 gradedHsl = rgbToHsl(clamp(graded, 0.0, 1.0));
    gradedHsl.y = clamp(gradedHsl.y * 1.06, 0.0, 1.0);
    graded = hslToRgb(gradedHsl);
        
    // ===== PREMIUM HIGHLIGHT BLOOM =====
    // Instead of global blur/plastic skin, softly lift only brighter regions.
    // This creates the glossy iPhone/Violette-style hydrated perception.
    float highlightMask = smoothstep(0.58, 0.92, getLuminance(graded));

    vec3 bloomColor = graded;
    bloomColor = pow(max(bloomColor, vec3(0.0)), vec3(0.82));
    bloomColor *= 1.08;

    graded = mix(
      graded,
      bloomColor,
      highlightMask * uHighlightBloom
    );

    // ===== DIRECTIONAL BEAUTY LIGHT =====
    vec3 lightHsl = rgbToHsl(clamp(graded, 0.0, 1.0));

    float skinHue =
      smoothstep(0.005, 0.045, lightHsl.x) *
      (1.0 - smoothstep(0.145, 0.22, lightHsl.x));

    float skinLight =
      smoothstep(0.18, 0.46, lightHsl.z) *
      (1.0 - smoothstep(0.88, 1.0, lightHsl.z));

    float skinSat =
      smoothstep(0.04, 0.24, lightHsl.y) *
      (1.0 - smoothstep(0.82, 1.0, lightHsl.y));

    float beautySkinMask = clamp(skinHue * skinLight * skinSat, 0.0, 1.0);

    float redHue =
      smoothstep(0.94, 0.99, lightHsl.x) +
      (1.0 - smoothstep(0.015, 0.055, lightHsl.x));

    float lipProtect =
      clamp(redHue * smoothstep(0.28, 0.72, lightHsl.y), 0.0, 1.0);

    float protectedSkinMask =
      beautySkinMask * (1.0 - lipProtect * uLipProtectStrength);

    vec2 softboxPos = vec2(0.36, 0.30);
    float softboxDist = distance(vTexCoord, softboxPos);
    float softbox = smoothstep(0.82, 0.06, softboxDist);

    float midtoneMask =
      smoothstep(0.22, 0.55, getLuminance(graded)) *
      (1.0 - smoothstep(0.82, 1.0, getLuminance(graded)));

    float shadowMask =
      1.0 - smoothstep(0.14, 0.42, getLuminance(graded));

    vec3 warmLight = vec3(1.0, 0.88, 0.74);

    graded += warmLight * softbox * midtoneMask * protectedSkinMask * uSoftboxStrength;
    graded += warmLight * softbox * shadowMask * protectedSkinMask * uShadowLift;

    smoothed = mix(smoothed, clamp(graded, 0.0, 1.0), beautyStrength);

    vec3 hsl = rgbToHsl(smoothed);
    float skinHueMask =
      smoothstep(0.005, 0.045, hsl.x) * (1.0 - smoothstep(0.145, 0.22, hsl.x));
    float skinLightMask = smoothstep(0.20, 0.42, hsl.z) *
      (1.0 - smoothstep(0.86, 1.0, hsl.z));
    float skinSatMask = smoothstep(0.05, 0.20, hsl.y) *
      (1.0 - smoothstep(0.82, 1.0, hsl.y));
    float skinMask = clamp(skinHueMask * skinLightMask * skinSatMask, 0.0, 1.0);
    float chromaSoftening = clamp(uSkinChromaSoftening, 0.0, 1.0) * skinMask;
    hsl.y *= 1.0 - chromaSoftening * 0.08;
    hsl.z = min(hsl.z + chromaSoftening * 0.004, 1.0);
    smoothed = mix(smoothed, hslToRgb(hsl), chromaSoftening * 0.65);

    gl_FragColor = vec4(smoothed, alpha);
  }
`;

export class BeautyFilter {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private positionBuffer: WebGLBuffer;
  private texCoordBuffer: WebGLBuffer;
  private framebuffer: WebGLFramebuffer;
  private texture: WebGLTexture;
  private outputTexture: WebGLTexture;
  private outputFramebuffer: WebGLFramebuffer;

  constructor(sourceCanvas: HTMLCanvasElement) {
    // Create an off-DOM WebGL context for post-processing
    const glCanvas = document.createElement("canvas");
    glCanvas.width = sourceCanvas.width;
    glCanvas.height = sourceCanvas.height;

    const glContext = glCanvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      alpha: true,
      premultipliedAlpha: false, // CRITICAL: Prevent double alpha multiplication that crushes RGB values
    });
    if (!glContext) throw new Error("WebGL not available for BeautyFilter");

    this.gl = glContext;

    // Compile shader program
    this.program = this.createProgram(vertexShader, fragmentShader);

    // Create screen quad
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    );
    this.texCoordBuffer = this.createBuffer(
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0])
    );

    // CRITICAL: Initialize texture 0 (input texture)
    this.texture = this.gl.createTexture();
    if (!this.texture) throw new Error("Failed to create input texture");
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    // Configure texture filtering (must be LINEAR for proper color sampling)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    // Clamp to edge to prevent wrapping artifacts
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // CRITICAL: Initialize texture 1 (output texture)
    this.outputTexture = this.gl.createTexture();
    if (!this.outputTexture) throw new Error("Failed to create output texture");
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.outputTexture);
    // Configure with same filtering as input
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    // CRITICAL FIX: Allocate output texture at FULL SOURCE RESOLUTION from the start.
    // Initializing at 1x1 then resizing every frame causes GPU memory synchronization leaks
    // where drivers fail to re-bind framebuffer layout dynamically, causing output clipping and dark output.
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      sourceCanvas.width,  // Full resolution
      sourceCanvas.height, // Full resolution
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      null
    );

    // CRITICAL: Initialize framebuffers and attach textures
    this.framebuffer = this.gl.createFramebuffer();
    if (!this.framebuffer) throw new Error("Failed to create input framebuffer");

    this.outputFramebuffer = this.gl.createFramebuffer();
    if (!this.outputFramebuffer) throw new Error("Failed to create output framebuffer");

    // Attach output texture to output framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.outputFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.outputTexture,
      0
    );

    // Verify framebuffer is complete
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Output framebuffer is not complete");
    }

    // Unbind to avoid accidental modifications
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  private createProgram(vShader: string, fShader: string): WebGLProgram {
    const vertex = this.compileShader(vShader, this.gl.VERTEX_SHADER);
    const fragment = this.compileShader(fShader, this.gl.FRAGMENT_SHADER);

    const program = this.gl.createProgram();
    if (!program) throw new Error("Failed to create WebGL program");

    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(
        "WebGL program link failed: " +
        this.gl.getProgramInfoLog(program)
      );
    }

    return program;
  }

  private compileShader(source: string, type: number): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Failed to create WebGL shader");

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(
        "WebGL shader compile failed: " + this.gl.getShaderInfoLog(shader)
      );
    }

    return shader;
  }

  private createBuffer(data: Float32Array): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) throw new Error("Failed to create WebGL buffer");

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);

    return buffer;
  }

  /**
   * Apply beauty filter to a canvas and write result back
   * @param canvas - The canvas containing the camera frame
   * @param params - Beauty filter parameters
   */
  processFrame(
    canvas: HTMLCanvasElement,
    params: Partial<BeautyFilterParams> = {}
  ): void {
    const finalParams = { ...defaultParams, ...params };

    // Set up WebGL canvas size to match input
    this.gl.canvas.width = canvas.width;
    this.gl.canvas.height = canvas.height;
    this.gl.viewport(0, 0, canvas.width, canvas.height);

    // Bind input canvas as texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      canvas
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE
    );

    // Render directly to the internal WebGL canvas. getRenderedWebGLCanvas()
    // returns this canvas, so rendering to an offscreen framebuffer here would
    // make callers sample a stale/empty frame.
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    // Use shader program
    this.gl.useProgram(this.program);

    // Set up vertex attributes
    const posLoc = this.gl.getAttribLocation(this.program, "position");
    const texLoc = this.gl.getAttribLocation(this.program, "texCoord");

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(posLoc);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
    this.gl.vertexAttribPointer(texLoc, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(texLoc);

    // Set uniforms
    this.gl.uniform1i(
      this.gl.getUniformLocation(this.program, "uTexture"),
      0
    );

    // CRITICAL: Calculate texel size for the CURRENT canvas dimensions
    // This MUST be recalculated every frame because canvas size can change
    const texelX = 1.0 / canvas.width;
    const texelY = 1.0 / canvas.height;
    this.gl.uniform2f(
      this.gl.getUniformLocation(this.program, "uTexelSize"),
      texelX,
      texelY
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uSmoothingStrength"),
      finalParams.smoothingStrength
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uEdgeThreshold"),
      finalParams.edgeThreshold
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uContrastBoost"),
      finalParams.contrastBoost
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uSkinChromaSoftening"),
      finalParams.skinChromaSoftening
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uHighlightBloom"),
      finalParams.highlightBloom
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uExposureLift"),
      finalParams.exposureLift
    );
    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uSoftboxStrength"),
      finalParams.softboxStrength
    );

    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uShadowLift"),
      finalParams.shadowLift
    );

    this.gl.uniform1f(
      this.gl.getUniformLocation(this.program, "uLipProtectStrength"),
      finalParams.lipProtectStrength
    );


    // Clear the framebuffer before rendering to prevent color lock
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Render
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

    // Do not write pixels back to the original canvas with putImageData.
    // Three.js reads the GPU-rendered canvas directly via getRenderedWebGLCanvas().
  }

  /**
   * Get the internal WebGL canvas containing the processed beauty filter output.
   * This canvas maintains the full dynamic range without destructive putImageData conversions.
   * Pass this canvas directly to Three.js for lip rendering instead of the original input canvas.
   */
  getRenderedWebGLCanvas(): HTMLCanvasElement {
    return this.gl.canvas as HTMLCanvasElement;
  }

  dispose(): void {
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteBuffer(this.texCoordBuffer);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.outputTexture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteFramebuffer(this.outputFramebuffer);
    this.gl.deleteProgram(this.program);
  }
}
