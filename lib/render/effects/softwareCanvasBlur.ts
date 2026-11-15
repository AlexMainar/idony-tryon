export type SoftwareBlurBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

let layerCanvas: HTMLCanvasElement | null = null;
let blurBufferA = new Float32Array(0);
let blurBufferB = new Float32Array(0);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const ensureBlurBuffers = (length: number) => {
  if (blurBufferA.length < length) {
    blurBufferA = new Float32Array(length);
    blurBufferB = new Float32Array(length);
  }
  return [blurBufferA, blurBufferB] as const;
};

const getGaussianBoxSizes = (sigma: number, passes = 3) => {
  const idealWidth = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lowerWidth = Math.floor(idealWidth);
  if (lowerWidth % 2 === 0) lowerWidth -= 1;
  const upperWidth = lowerWidth + 2;
  const lowerPasses = Math.round(
    (12 * sigma * sigma -
      passes * lowerWidth * lowerWidth -
      4 * passes * lowerWidth -
      3 * passes) /
      (-4 * lowerWidth - 4)
  );

  return Array.from({ length: passes }, (_, index) =>
    index < lowerPasses ? lowerWidth : upperWidth
  );
};

const boxBlurHorizontalRgba = (
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number
) => {
  const divisor = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let x = -radius; x <= radius; x += 1) {
      const pixelOffset = (rowOffset + Math.max(0, Math.min(width - 1, x))) * 4;
      sumR += source[pixelOffset];
      sumG += source[pixelOffset + 1];
      sumB += source[pixelOffset + 2];
      sumA += source[pixelOffset + 3];
    }

    for (let x = 0; x < width; x += 1) {
      const outputOffset = (rowOffset + x) * 4;
      target[outputOffset] = sumR / divisor;
      target[outputOffset + 1] = sumG / divisor;
      target[outputOffset + 2] = sumB / divisor;
      target[outputOffset + 3] = sumA / divisor;

      const removeX = Math.max(0, x - radius);
      const addX = Math.min(width - 1, x + radius + 1);
      const removeOffset = (rowOffset + removeX) * 4;
      const addOffset = (rowOffset + addX) * 4;
      sumR += source[addOffset] - source[removeOffset];
      sumG += source[addOffset + 1] - source[removeOffset + 1];
      sumB += source[addOffset + 2] - source[removeOffset + 2];
      sumA += source[addOffset + 3] - source[removeOffset + 3];
    }
  }
};

const boxBlurVerticalRgba = (
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number
) => {
  const divisor = radius * 2 + 1;

  for (let x = 0; x < width; x += 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let y = -radius; y <= radius; y += 1) {
      const pixelOffset = (Math.max(0, Math.min(height - 1, y)) * width + x) * 4;
      sumR += source[pixelOffset];
      sumG += source[pixelOffset + 1];
      sumB += source[pixelOffset + 2];
      sumA += source[pixelOffset + 3];
    }

    for (let y = 0; y < height; y += 1) {
      const outputOffset = (y * width + x) * 4;
      target[outputOffset] = sumR / divisor;
      target[outputOffset + 1] = sumG / divisor;
      target[outputOffset + 2] = sumB / divisor;
      target[outputOffset + 3] = sumA / divisor;

      const removeY = Math.max(0, y - radius);
      const addY = Math.min(height - 1, y + radius + 1);
      const removeOffset = (removeY * width + x) * 4;
      const addOffset = (addY * width + x) * 4;
      sumR += source[addOffset] - source[removeOffset];
      sumG += source[addOffset + 1] - source[removeOffset + 1];
      sumB += source[addOffset + 2] - source[removeOffset + 2];
      sumA += source[addOffset + 3] - source[removeOffset + 3];
    }
  }
};

const applySoftwareGaussianBlur = (imageData: ImageData, sigma: number) => {
  const { width, height, data } = imageData;
  const valueCount = width * height * 4;
  const [bufferA, bufferB] = ensureBlurBuffers(valueCount);

  for (let offset = 0; offset < valueCount; offset += 4) {
    const alpha = data[offset + 3] / 255;
    bufferA[offset] = (data[offset] / 255) * alpha;
    bufferA[offset + 1] = (data[offset + 1] / 255) * alpha;
    bufferA[offset + 2] = (data[offset + 2] / 255) * alpha;
    bufferA[offset + 3] = alpha;
  }

  let source = bufferA;
  let target = bufferB;
  for (const boxSize of getGaussianBoxSizes(Math.max(0.5, sigma))) {
    const radius = Math.max(0, (boxSize - 1) / 2);
    boxBlurHorizontalRgba(source, target, width, height, radius);
    [source, target] = [target, source];
    boxBlurVerticalRgba(source, target, width, height, radius);
    [source, target] = [target, source];
  }

  for (let offset = 0; offset < valueCount; offset += 4) {
    const alpha = clamp01(source[offset + 3]);
    data[offset + 3] = Math.round(alpha * 255);
    if (alpha <= 1e-5) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      continue;
    }
    data[offset] = Math.round(clamp01(source[offset] / alpha) * 255);
    data[offset + 1] = Math.round(clamp01(source[offset + 1] / alpha) * 255);
    data[offset + 2] = Math.round(clamp01(source[offset + 2] / alpha) * 255);
  }
};

export const drawSoftwareBlurredLayer = (
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  bounds: SoftwareBlurBounds,
  blur: number,
  composite: GlobalCompositeOperation,
  globalAlpha: number,
  drawSource: (layerCtx: CanvasRenderingContext2D) => void
) => {
  const padding = Math.max(2, Math.ceil(blur * 3));
  const minX = Math.max(0, Math.floor(bounds.minX - padding));
  const minY = Math.max(0, Math.floor(bounds.minY - padding));
  const maxX = Math.min(canvasWidth, Math.ceil(bounds.maxX + padding));
  const maxY = Math.min(canvasHeight, Math.ceil(bounds.maxY + padding));
  const activeWidth = maxX - minX;
  const activeHeight = maxY - minY;
  if (activeWidth <= 0 || activeHeight <= 0) return;

  if (!layerCanvas) layerCanvas = document.createElement("canvas");
  if (layerCanvas.width < activeWidth || layerCanvas.height < activeHeight) {
    layerCanvas.width = Math.max(layerCanvas.width, activeWidth);
    layerCanvas.height = Math.max(layerCanvas.height, activeHeight);
  }
  const layerCtx = layerCanvas.getContext("2d", { willReadFrequently: true });
  if (!layerCtx) return;

  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.clearRect(0, 0, activeWidth, activeHeight);
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = "source-over";
  layerCtx.save();
  layerCtx.translate(-minX, -minY);
  drawSource(layerCtx);
  layerCtx.restore();

  const imageData = layerCtx.getImageData(0, 0, activeWidth, activeHeight);
  applySoftwareGaussianBlur(imageData, blur);
  layerCtx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = clamp01(globalAlpha);
  ctx.drawImage(
    layerCanvas,
    0,
    0,
    activeWidth,
    activeHeight,
    minX,
    minY,
    activeWidth,
    activeHeight
  );
  ctx.restore();
};
