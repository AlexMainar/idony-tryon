// Conservative camera compensation, independent of whether makeup is enabled.
// This does not estimate a skin colour or neutralise the lamp's white balance.
export function exposureGainFromPixels(pixels: Uint8ClampedArray): number {
  const levels: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    levels.push((0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255);
  }
  if (!levels.length) return 1;
  levels.sort((a, b) => a - b);
  const light = levels[Math.floor((levels.length - 1) * 0.7)];
  const darkness = Math.max(0, Math.min(1, (0.42 - light) / 0.28));
  return 1 + 0.55 * darkness * darkness * (3 - 2 * darkness);
}

export function followExposure(current: number, target: number, seconds: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, Math.min(seconds, 0.25)) / 0.6);
  return current + (target - current) * alpha;
}

export function createEtherealExposure() {
  const sample = document.createElement("canvas");
  sample.width = sample.height = 24;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  let gain = 1, target = 1, previousTime = 0, sampledTime = -Infinity;
  return {
    update(source: HTMLCanvasElement, points: { x: number; y: number }[] | null, time: number, frozen: boolean) {
      if (frozen) return gain;
      const elapsed = previousTime ? (time - previousTime) / 1000 : 0;
      previousTime = time;
      if (time - sampledTime >= 150) {
        sampledTime = time;
        const anchors = [234, 454, 10, 152].map(i => points?.[i]);
        if (ctx && anchors.every(Boolean)) {
          const xs = anchors.map(p => p!.x), ys = anchors.map(p => p!.y);
          const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys));
          const right = Math.min(1, Math.max(...xs)), bottom = Math.min(1, Math.max(...ys));
          if (right > left && bottom > top) {
            ctx.drawImage(source, left * source.width, top * source.height,
              (right - left) * source.width, (bottom - top) * source.height, 0, 0, 24, 24);
            target = exposureGainFromPixels(ctx.getImageData(0, 0, 24, 24).data);
          } else target = 1;
        } else target = 1;
      }
      gain = followExposure(gain, target, elapsed);
      return gain;
    },
  };
}
