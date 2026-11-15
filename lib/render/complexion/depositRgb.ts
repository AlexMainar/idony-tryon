type RgbColor = { r: number; g: number; b: number };
type Point = { x: number; y: number };

export type RgbDepositPass = { color: string; layers: DepositFieldLayer[] };
const framePasses = new WeakMap<CanvasRenderingContext2D, RgbDepositPass[]>();
/** Capture the approved preset's geometry and pass order for the mobile GPU
 * renderer. This does not capture camera pixels or retain frame history. */
export function collectRgbDeposits<T>(ctx: CanvasRenderingContext2D, draw: () => T) {
  const passes: RgbDepositPass[]=[];
  framePasses.set(ctx,passes);
  try { return {result:draw(),passes}; }
  finally { framePasses.delete(ctx); }
}

export type DepositFieldLayer = {
  centerX: number;
  centerY: number;
  radiusX: number;
  negativeRadiusX?: number;
  positiveRadiusX?: number;
  radiusY: number;
  lowerRadiusY?: number;
  rotation?: number;
  strength: number;
  radiusScale?: number;
  path?: Path2D | null;
  clipToPath?: boolean;
  clipPolygon?: { x: number; y: number }[];
  clipFeatherPx?: number;
  fillRule?: CanvasFillRule;
  responseFloor?: number;
  responseInfluence?: number;
  fieldLine?: Point[];
  falloff?: "gaussian" | "linear" | "smooth" | "constant";
  falloffPower?: number;
};

export type LuminizerGlowOptions = {
  glowStrength?: number;
  tintStrength?: number;
  highlightResponse?: number;
  maxLumaLift?: number;
  coreLayer?: DepositFieldLayer;
  coreMaxLumaLift?: number;
  corePearlColor?: string;
  corePearlStrength?: number;
  skinIntegration?: number;
};

const clampRange = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clamp01 = (value: number) => clampRange(value, 0, 1);

const clampByte = (value: number) => clampRange(Math.round(value), 0, 255);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const parseHexColor = (hex: string): RgbColor => {
  const clean = hex.replace("#", "");
  const normalized =
    clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const getDirectionalBasis = (rotation = 0) => {
  const axisDir = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const liftDir = { x: -axisDir.y, y: axisDir.x };
  return { axisDir, liftDir };
};

const getLayerExtents = (layer: DepositFieldLayer) => {
  const radiusX = Math.max(
    1,
    layer.radiusX,
    layer.negativeRadiusX ?? 0,
    layer.positiveRadiusX ?? 0
  );
  const radiusY = Math.max(1, layer.radiusY);
  const lowerRadiusY = Math.max(radiusY, layer.lowerRadiusY ?? radiusY);
  const maxRadiusY = Math.max(radiusY, lowerRadiusY);
  const radiusScale = layer.radiusScale ?? 2;
  const { axisDir, liftDir } = getDirectionalBasis(layer.rotation);

  return {
    minX:
      layer.centerX -
      (Math.abs(axisDir.x) * radiusX + Math.abs(liftDir.x) * maxRadiusY) * radiusScale,
    minY:
      layer.centerY -
      (Math.abs(axisDir.y) * radiusX + Math.abs(liftDir.y) * maxRadiusY) * radiusScale,
    maxX:
      layer.centerX +
      (Math.abs(axisDir.x) * radiusX + Math.abs(liftDir.x) * maxRadiusY) * radiusScale,
    maxY:
      layer.centerY +
      (Math.abs(axisDir.y) * radiusX + Math.abs(liftDir.y) * maxRadiusY) * radiusScale,
  };
};

const getLayersBounds = (ctx: CanvasRenderingContext2D, layers: DepositFieldLayer[]) => {
  if (!layers.length) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  layers.forEach((layer) => {
    const bounds = getLayerExtents(layer);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  });

  const boxMinX = Math.max(0, Math.floor(minX));
  const boxMinY = Math.max(0, Math.floor(minY));
  const boxMaxX = Math.min(ctx.canvas.width, Math.ceil(maxX));
  const boxMaxY = Math.min(ctx.canvas.height, Math.ceil(maxY));
  const boxWidth = Math.max(0, boxMaxX - boxMinX);
  const boxHeight = Math.max(0, boxMaxY - boxMinY);

  if (!boxWidth || !boxHeight) return null;
  return { boxMinX, boxMinY, boxWidth, boxHeight };
};

const getLayerFieldWeight = (
  layer: DepositFieldLayer,
  canvasX: number,
  canvasY: number
) => {
  if (layer.falloff === "constant") {
    return 1;
  }

  if (layer.fieldLine && layer.fieldLine.length >= 2) {
    const radiusY = Math.max(1, layer.radiusY);
    const closest = getClosestPointOnPolyline(layer.fieldLine, canvasX, canvasY);
    const startFade = smoothstep(0.02, 0.16, closest.progress);
    const endFade = smoothstep(0.02, 0.16, 1 - closest.progress);
    return (
      Math.exp(-(closest.distance * closest.distance) / (radiusY * radiusY)) *
      startFade *
      endFade
    );
  }

  const baseRadiusX = Math.max(1, layer.radiusX);
  const baseRadiusY = Math.max(1, layer.radiusY);
  const lowerRadiusY = Math.max(baseRadiusY, layer.lowerRadiusY ?? baseRadiusY);
  const radiusY = canvasY >= layer.centerY ? lowerRadiusY : baseRadiusY;
  const { axisDir, liftDir } = getDirectionalBasis(layer.rotation);
  const dx = canvasX - layer.centerX;
  const dy = canvasY - layer.centerY;
  const axisDistance = dx * axisDir.x + dy * axisDir.y;
  const liftDistance = dx * liftDir.x + dy * liftDir.y;
  const radiusX = Math.max(
    1,
    axisDistance < 0
      ? layer.negativeRadiusX ?? baseRadiusX
      : layer.positiveRadiusX ?? baseRadiusX
  );

  const normalizedDistance = Math.sqrt(
    (axisDistance * axisDistance) / (radiusX * radiusX) +
      (liftDistance * liftDistance) / (radiusY * radiusY)
  );

  const radiusScale = Math.max(1, layer.radiusScale ?? 2);
  let fieldWeight: number;

  if (layer.falloff === "linear") {
    fieldWeight = clamp01(1 - normalizedDistance / radiusScale);
  } else if (layer.falloff === "smooth") {
    fieldWeight = 1 - smoothstep(0, radiusScale, normalizedDistance);
  } else {
    fieldWeight = Math.exp(-(normalizedDistance * normalizedDistance));
  }

  return Math.pow(fieldWeight, Math.max(0.1, layer.falloffPower ?? 1));
};

/** Sample the same Gaussian at pixel centres without repeating trigonometry,
 * square roots, exponentials and powers for every camera pixel. Start at the
 * row's peak and step outwards so distant/underflowing tails cannot erase the
 * centre. Storage is bounded to a scanline per layer, not a frame history. */
const createFieldRow = (layer: DepositFieldLayer, width: number) => {
  const values = new Float64Array(width);
  const gaussian = !layer.fieldLine?.length &&
    (!layer.falloff || layer.falloff === "gaussian");
  const { axisDir, liftDir } = getDirectionalBasis(layer.rotation);
  const power = Math.max(0.1, layer.falloffPower ?? 1);
  const baseX = Math.max(1, layer.radiusX);
  const negativeX = Math.max(1, layer.negativeRadiusX ?? baseX);
  const positiveX = Math.max(1, layer.positiveRadiusX ?? baseX);
  const positive = negativeX === positiveX ? values : new Float64Array(width);

  const fillGaussian = (out: Float64Array, radiusX: number, radiusY: number,
    axis: number, lift: number) => {
    const ix = power / (radiusX * radiusX), iy = power / (radiusY * radiusY);
    const a = axisDir.x * axisDir.x * ix + liftDir.x * liftDir.x * iy;
    const b = 2 * (axis * axisDir.x * ix + lift * liftDir.x * iy);
    const centre = Math.max(0, Math.min(width - 1, Math.round(-b / (2 * a))));
    const cx = axis + centre * axisDir.x, cy = lift + centre * liftDir.x;
    const peak = Math.exp(-(cx * cx * ix + cy * cy * iy));
    out[centre] = peak;
    const decay = Math.exp(-2 * a);
    let value = peak, step = Math.exp(-(2 * a * centre + a + b));
    for (let x = centre + 1; x < width; x++) {
      value *= step; out[x] = value; step *= decay;
    }
    value = peak; step = Math.exp(2 * a * centre - a + b);
    for (let x = centre - 1; x >= 0; x--) {
      value *= step; out[x] = value; step *= decay;
    }
  };

  return { values, update(startX: number, canvasY: number) {
    if (!gaussian) {
      for (let x = 0; x < width; x++) values[x] = getLayerFieldWeight(layer, startX + x, canvasY);
      return;
    }
    const dx = startX - layer.centerX, dy = canvasY - layer.centerY;
    const axis = dx * axisDir.x + dy * axisDir.y;
    const lift = dx * liftDir.x + dy * liftDir.y;
    const baseY = Math.max(1, layer.radiusY);
    const radiusY = canvasY >= layer.centerY ? Math.max(baseY, layer.lowerRadiusY ?? baseY) : baseY;
    fillGaussian(values, negativeX, radiusY, axis, lift);
    if (positive !== values) {
      fillGaussian(positive, positiveX, radiusY, axis, lift);
      for (let x = 0; x < width; x++) if (axis + x * axisDir.x >= 0) values[x] = positive[x];
    }
  } };
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const distancePointToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 1e-5) return Math.hypot(px - ax, py - ay);

  const t = clamp01((apx * abx + apy * aby) / abLenSq);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(px - closestX, py - closestY);
};

const getPolylineLength = (points: Point[]) =>
  points.reduce(
    (length, point, index) =>
      index === 0
        ? 0
        : length + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y),
    0
  );

const getClosestPointOnPolyline = (points: Point[], x: number, y: number) => {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let traversed = 0;
  const totalLength = Math.max(1, getPolylineLength(points));

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength <= 1e-5) continue;

    const t = clamp01(
      ((x - start.x) * dx + (y - start.y) * dy) / (segmentLength * segmentLength)
    );
    const closestX = start.x + dx * t;
    const closestY = start.y + dy * t;
    const distance = Math.hypot(x - closestX, y - closestY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = (traversed + segmentLength * t) / totalLength;
    }

    traversed += segmentLength;
  }

  return { distance: bestDistance, progress: clamp01(bestProgress) };
};

const distanceToPolygonEdge = (
  x: number,
  y: number,
  polygon: { x: number; y: number }[]
) => {
  if (polygon.length < 2) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    best = Math.min(
      best,
      distancePointToSegment(x, y, start.x, start.y, end.x, end.y)
    );
  }
  return best;
};

// Snapshot local luminance before any makeup pixels are written. The summed
// area table lets the live renderer sample each neighborhood in constant time.
const buildLumaIntegral = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowLuma = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rowLuma +=
        (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) / 255;
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowLuma;
    }
  }

  return integral;
};

const renderDepositLayers = (
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[],
  resolvePixel: ((
    source: RgbColor,
    target: RgbColor,
    weight: number,
    canvasX: number,
    canvasY: number,
    localLuma: number
  ) => RgbColor) | null,
  localLumaRadius = 0
) => {
  const bounds = getLayersBounds(ctx, layers);
  if (!bounds) return;
  const { boxMinX, boxMinY, boxWidth, boxHeight } = bounds;

  const target = parseHexColor(targetColor);
  const imageData = ctx.getImageData(boxMinX, boxMinY, boxWidth, boxHeight);
  const { data } = imageData;
  const lumaIntegral = localLumaRadius > 0
    ? buildLumaIntegral(data, boxWidth, boxHeight)
    : null;
  const lumaStride = boxWidth + 1;
  const fields = layers.map(layer => ({
    layer, row: createFieldRow(layer, boxWidth),
    responseFloor: clamp01(layer.responseFloor ?? 0),
    responseInfluence: clamp01(layer.responseInfluence ?? 1),
  }));

  // The mobile blush/bronzer fields all use this RGB deposit. Keep their hot
  // loop numeric: no per-pixel callback, RGB objects or repeated colour clamps.
  if (!resolvePixel && fields.every(field => !field.layer.clipToPath)) {
    const tr=target.r,tg=target.g,tb=target.b;
    if (fields.length === 1) {
      const field=fields[0],row=field.row.values,strength=field.layer.strength;
      const floor=field.responseFloor,influence=field.responseInfluence;
      for (let y=0;y<boxHeight;y++) {
        field.row.update(boxMinX+.5,boxMinY+y+.5);
        let index=y*boxWidth*4;
        for (let x=0;x<boxWidth;x++,index+=4) {
          const r=data[index],g=data[index+1],b=data[index+2];
          const response=Math.sqrt((.299*r+.587*g+.114*b)/255);
          const weight=row[x]*strength*(1+(Math.max(response,floor)-1)*influence);
          if (weight<=1e-5) continue;
          const amount=Math.min(1,weight);
          data[index]=Math.round(r+(tr-r)*amount);
          data[index+1]=Math.round(g+(tg-g)*amount);
          data[index+2]=Math.round(b+(tb-b)*amount);
        }
      }
    } else {
      for (let y=0;y<boxHeight;y++) {
        for (const field of fields) field.row.update(boxMinX+.5,boxMinY+y+.5);
        let index=y*boxWidth*4;
        for (let x=0;x<boxWidth;x++,index+=4) {
          const r=data[index],g=data[index+1],b=data[index+2];
          const response=Math.sqrt((.299*r+.587*g+.114*b)/255);
          let weight=0;
          for (let i=0;i<fields.length;i++) {
            const f=fields[i];
            weight+=f.row.values[x]*f.layer.strength*(1+(Math.max(response,f.responseFloor)-1)*f.responseInfluence);
          }
          if (weight<=1e-5) continue;
          const amount=Math.min(1,weight);
          data[index]=Math.round(r+(tr-r)*amount);
          data[index+1]=Math.round(g+(tg-g)*amount);
          data[index+2]=Math.round(b+(tb-b)*amount);
        }
      }
    }
    ctx.putImageData(imageData,boxMinX,boxMinY);
    return;
  }

  for (let y = 0; y < boxHeight; y += 1) {
    for (const field of fields) field.row.update(boxMinX + 0.5, boxMinY + y + 0.5);
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = boxMinX + x + 0.5;
      const canvasY = boxMinY + y + 0.5;
      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);

      let totalWeight = 0;

      for (const field of fields) {
        const { layer } = field;
        let edgeFeatherWeight = 1;
        if (
          layer.clipToPath &&
          layer.path &&
          !ctx.isPointInPath(
            layer.path,
            canvasX,
            canvasY,
            layer.fillRule ?? "nonzero"
          )
        ) {
          continue;
        }

        if (
          layer.clipToPath &&
          layer.path &&
          layer.clipPolygon &&
          layer.clipPolygon.length >= 3 &&
          (layer.clipFeatherPx ?? 0) > 0
        ) {
          const featherPx = Math.max(1, layer.clipFeatherPx ?? 0);
          const edgeDistance = distanceToPolygonEdge(
            canvasX,
            canvasY,
            layer.clipPolygon
          );
          const normalizedDistance = clamp01(edgeDistance / featherPx);
          edgeFeatherWeight =
            normalizedDistance *
            normalizedDistance *
            (3 - 2 * normalizedDistance);
          if (edgeFeatherWeight <= 1e-4) continue;
        }

        const fieldWeight = field.row.values[x];
        const effectiveResponseRaw = Math.max(response, field.responseFloor);
        const effectiveResponse = lerp(
          1,
          effectiveResponseRaw,
          field.responseInfluence
        );

        totalWeight +=
          fieldWeight *
          layer.strength *
          effectiveResponse *
          edgeFeatherWeight;
      }

      if (totalWeight <= 1e-5) continue;

      const weight = clamp01(totalWeight);
      let localLuma = luma;
      if (lumaIntegral) {
        const x0 = Math.max(0, x - localLumaRadius);
        const y0 = Math.max(0, y - localLumaRadius);
        const x1 = Math.min(boxWidth, x + localLumaRadius + 1);
        const y1 = Math.min(boxHeight, y + localLumaRadius + 1);
        localLuma = (
          lumaIntegral[y1 * lumaStride + x1] -
          lumaIntegral[y0 * lumaStride + x1] -
          lumaIntegral[y1 * lumaStride + x0] +
          lumaIntegral[y0 * lumaStride + x0]
        ) / ((x1 - x0) * (y1 - y0));
      }
      const next = resolvePixel
        ? resolvePixel({ r, g, b }, target, weight, canvasX, canvasY, localLuma)
        : {r:lerp(r,target.r,weight),g:lerp(g,target.g,weight),b:lerp(b,target.b,weight)};
      data[pixelIndex] = clampByte(next.r);
      data[pixelIndex + 1] = clampByte(next.g);
      data[pixelIndex + 2] = clampByte(next.b);
    }
  }

  ctx.putImageData(imageData, boxMinX, boxMinY);
};

export function renderDepositRgbLayers(
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[]
) {
  const queued=framePasses.get(ctx);
  if(queued){queued.push({color:targetColor,layers});return;}
  renderDepositLayers(ctx, targetColor, layers, null);
}

export function renderLuminizerGlowLayers(
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[],
  options: LuminizerGlowOptions = {}
) {
  const glowStrength = clampRange(options.glowStrength ?? 0.72, 0, 1);
  const tintStrength = clampRange(options.tintStrength ?? 0.92, 0, 1);
  const highlightResponse = clampRange(options.highlightResponse ?? 0.95, 0, 1);
  const baseMaxLumaLift = clampRange(options.maxLumaLift ?? 0.055, 0, 0.15) * 255;
  const coreMaxLumaLift = clampRange(
    options.coreMaxLumaLift ?? baseMaxLumaLift / 255,
    baseMaxLumaLift / 255,
    0.15
  ) * 255;
  const targetRgb = parseHexColor(targetColor);
  const targetLuma =
    0.299 * targetRgb.r + 0.587 * targetRgb.g + 0.114 * targetRgb.b;
  const pearlRgb = options.corePearlColor
    ? parseHexColor(options.corePearlColor)
    : targetRgb;
  const pearlStrength = options.corePearlColor
    ? clamp01(options.corePearlStrength ?? 0)
    : 0;
  const skinIntegration = clamp01(options.skinIntegration ?? 0);
  const localLumaRadius = skinIntegration > 0 && options.coreLayer
    ? Math.round(clampRange(
        Math.min(options.coreLayer.radiusX, options.coreLayer.radiusY) * 0.22,
        2,
        10
      ))
    : 0;

  renderDepositLayers(ctx, targetColor, layers, (source, target, weight, canvasX, canvasY, localLuma) => {
    const luma = (0.299 * source.r + 0.587 * source.g + 0.114 * source.b) / 255;
    const coreWeight = options.coreLayer && options.coreLayer.strength > 0
      ? clamp01(getLayerFieldWeight(options.coreLayer, canvasX, canvasY))
      : 0;
    // Relative light leaves more skin visible in small shadows, independent
    // of the cheek's overall brightness. Limit the response to the stable peak.
    const relativeLight = (luma - localLuma) / Math.max(0.12, localLuma);
    const skinResponse = lerp(
      1,
      // Reflect mainly from locally lit skin, leaving pores and small shadows
      // visible. Apply this to the veil too, not just the central ellipse.
      lerp(0.12, 1, smoothstep(-0.025, 0.06, relativeLight)),
      skinIntegration
    );
    const lightResponse = smoothstep(0.18, 0.76, luma);
    const highlightGuard = lerp(1, 0.82, smoothstep(0.86, 1, luma));
    const response = lerp(
      1,
      lightResponse * highlightGuard,
      highlightResponse
    );
    const pigmentResponse = lerp(0.42, 1, smoothstep(0.12, 0.68, luma));
    const tintWeight = clamp01(weight * tintStrength * pigmentResponse);
    const glowWeight = clamp01(weight * glowStrength * response * skinResponse);

    // Keep the soft champagne veil; the core can carry a neutral pearl tint.
    const champagneTint = {
      r: lerp(source.r, source.r + (target.r - targetLuma), tintWeight),
      g: lerp(source.g, source.g + (target.g - targetLuma), tintWeight),
      b: lerp(source.b, source.b + (target.b - targetLuma), tintWeight),
    };
    const pearlMix = coreWeight * pearlStrength;
    // Pearl belongs to the reflected light, not to an opaque neutral pigment.
    // Keep the skin's chroma underneath the champagne tint.
    const pigmented = champagneTint;
    const reflectionColor = {
      r: lerp(target.r, pearlRgb.r, pearlMix),
      g: lerp(target.g, pearlRgb.g, pearlMix),
      b: lerp(target.b, pearlRgb.b, pearlMix),
    };
    const screen = {
      r: 255 - ((255 - pigmented.r) * (255 - reflectionColor.r)) / 255,
      g: 255 - ((255 - pigmented.g) * (255 - reflectionColor.g)) / 255,
      b: 255 - ((255 - pigmented.b) * (255 - reflectionColor.b)) / 255,
    };
    const lit = {
      r: lerp(pigmented.r, screen.r, glowWeight),
      g: lerp(pigmented.g, screen.g, glowWeight),
      b: lerp(pigmented.b, screen.b, glowWeight),
    };
    const pigmentedLuma =
      0.299 * pigmented.r + 0.587 * pigmented.g + 0.114 * pigmented.b;
    const litLuma = 0.299 * lit.r + 0.587 * lit.g + 0.114 * lit.b;
    const lumaLift = Math.max(0, litLuma - pigmentedLuma);
    // Follow the existing core field so extra light fades out before the veil.
    const maxLumaLift = lerp(baseMaxLumaLift, coreMaxLumaLift, coreWeight) * skinResponse;
    // Approach the light budget smoothly instead of clipping the center to a
    // uniform plateau. Small variations in the source remain visible even
    // where the old hard cap would have flattened the whole cheek highlight.
    const softLift = maxLumaLift > 0
      ? maxLumaLift * -Math.expm1(-lumaLift / maxLumaLift)
      : 0;
    const liftScale = lumaLift > 0 ? softLift / lumaLift : 1;

    return {
      r: lerp(pigmented.r, lit.r, liftScale),
      g: lerp(pigmented.g, lit.g, liftScale),
      b: lerp(pigmented.b, lit.b, liftScale),
    };
  }, localLumaRadius);
}
