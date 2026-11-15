type ThreeModule = typeof import("three");

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function gaussian(value: number, center: number, width: number) {
  const normalized = (value - center) / Math.max(width, 1e-4);
  return Math.exp(-(normalized * normalized));
}

type ContourPoint = {
  y: number;
  z: number;
  frontScale: number;
  backScale: number;
};

function blendToCorner(
  point: ContourPoint,
  side: number,
  targetY: number,
  targetFrontScale = 0.24,
  targetBackScale = 0.22
): ContourPoint {
  const cornerT = smoothstep01((Math.abs(side) - 0.74) / 0.26);
  const cornerRound = 1 - 0.16 * gaussian(Math.abs(side), 0.96, 0.06);
  const targetZ = 1.46 * side * cornerRound;
  return {
    y: lerp(point.y, targetY, cornerT),
    z: lerp(point.z, targetZ, cornerT),
    frontScale: lerp(point.frontScale, targetFrontScale, cornerT),
    backScale: lerp(point.backScale, targetBackScale, cornerT),
  };
}

function sampleUpperOuterContour(side: number): ContourPoint {
  const wing = Math.max(0, 1 - Math.abs(side));
  const arch = 0.14 + 0.18 * Math.pow(wing, 0.68);
  const tubercles =
    0.05 * gaussian(side, -0.24, 0.14) + 0.05 * gaussian(side, 0.24, 0.14);
  const cupidDip = 0.09 * gaussian(side, 0, 0.16);
  return blendToCorner(
    {
      y: arch + tubercles - cupidDip,
      z: (1.46 - 0.06 * gaussian(side, 0, 0.32)) * side,
      frontScale:
        0.92 -
        0.18 * gaussian(side, 0, 0.13) +
        0.08 * (gaussian(side, -0.24, 0.14) + gaussian(side, 0.24, 0.14)),
      backScale: 0.62,
    },
    side,
    0.024,
    0.28,
    0.24
  );
}

function sampleUpperInnerContour(side: number): ContourPoint {
  const wing = Math.max(0, 1 - Math.abs(side));
  const lineLift = 0.018 + 0.06 * Math.pow(wing, 0.84);
  const centerDip = 0.025 * gaussian(side, 0, 0.18);
  return blendToCorner(
    {
      y: lineLift - centerDip,
      z: (1.22 - 0.08 * gaussian(side, 0, 0.26)) * side,
      frontScale: 0.54,
      backScale: 0.46,
    },
    side,
    0.014,
    0.24,
    0.2
  );
}

function sampleLowerOuterContour(side: number): ContourPoint {
  const wing = Math.max(0, 1 - Math.abs(side));
  const body = -0.1 - 0.18 * Math.pow(wing, 0.8);
  const centerFullness = 0.042 * gaussian(side, 0, 0.42);
  return blendToCorner(
    {
      y: body - centerFullness,
      z: (1.4 - 0.04 * gaussian(side, 0, 0.3)) * side,
      frontScale: 0.96 + 0.16 * gaussian(side, 0, 0.44),
      backScale: 0.84,
    },
    side,
    -0.022,
    0.3,
    0.28
  );
}

function sampleLowerInnerContour(side: number): ContourPoint {
  const wing = Math.max(0, 1 - Math.abs(side));
  const lineDrop = -0.024 - 0.055 * Math.pow(wing, 0.9);
  const centerDrop = 0.012 * gaussian(side, 0, 0.34);
  return blendToCorner(
    {
      y: lineDrop - centerDrop,
      z: (1.16 - 0.08 * gaussian(side, 0, 0.28)) * side,
      frontScale: 0.58,
      backScale: 0.54,
    },
    side,
    -0.012,
    0.26,
    0.24
  );
}

export function buildCanonicalLipGeometry(
  THREE: ThreeModule,
  opts: {
    kind: "upper" | "lower";
    widthSegments: number;
    heightSegments: number;
    frontDepth: number;
    backDepth: number;
  }
) {
  const { kind, widthSegments, heightSegments, frontDepth, backDepth } = opts;
  const rowSize = heightSegments + 1;
  const frontCount = (widthSegments + 1) * rowSize;
  const positions = new Float32Array(frontCount * 2 * 3);
  const indices: number[] = [];
  const uvs = new Float32Array(frontCount * 2 * 2);

  const frontIndex = (widthIndex: number, heightIndex: number) =>
    widthIndex * rowSize + heightIndex;
  const backIndex = (widthIndex: number, heightIndex: number) =>
    frontCount + widthIndex * rowSize + heightIndex;

  const outerSampler =
    kind === "upper" ? sampleUpperOuterContour : sampleLowerOuterContour;
  const innerSampler =
    kind === "upper" ? sampleUpperInnerContour : sampleLowerInnerContour;

  for (let widthIndex = 0; widthIndex <= widthSegments; widthIndex += 1) {
    const u = widthIndex / widthSegments;
    const side = u * 2 - 1;
    const outer = outerSampler(side);
    const inner = innerSampler(side);
    const widthShape = Math.pow(Math.max(0, 1 - Math.abs(side)), 0.42);
    const cupidGroove = kind === "upper" ? 1 - 0.24 * gaussian(side, 0, 0.12) : 1;
    const lobeBoost =
      kind === "upper"
        ? 1 +
          0.12 * gaussian(side, -0.24, 0.16) +
          0.12 * gaussian(side, 0.24, 0.16)
        : 1 + 0.12 * gaussian(side, 0, 0.4);
    const centerBias =
      kind === "upper" ? 0.96 - 0.06 * gaussian(side, 0, 0.2) : 1.08;

    for (let heightIndex = 0; heightIndex <= heightSegments; heightIndex += 1) {
      const v = heightIndex / heightSegments;
      const t = smoothstep01(v);
      const y = lerp(inner.y, outer.y, t);
      const z = lerp(inner.z, outer.z, t);
      const frontScale = lerp(inner.frontScale, outer.frontScale, t);
      const backScale = lerp(inner.backScale, outer.backScale, t);
      const stripSine = Math.sin(Math.PI * v);
      const stripProfile =
        0.18 + 0.82 * Math.pow(stripSine, kind === "upper" ? 0.76 : 0.68);
      const frontProfile =
        kind === "upper"
          ? 0.72 +
            0.12 * smoothstep01(v) +
            0.16 * Math.pow(stripSine, 0.8)
          : 0.8 + 0.2 * Math.pow(stripSine, 0.62);
      const backProfile =
        0.56 + 0.44 * Math.pow(stripSine, kind === "upper" ? 1.06 : 0.9);
      const volume = widthShape * stripProfile * lobeBoost * cupidGroove * centerBias;
      const xFront = frontDepth * volume * frontScale * frontProfile;
      const xBack = -backDepth * volume * backScale * backProfile;

      const fIndex = frontIndex(widthIndex, heightIndex);
      const bIndex = backIndex(widthIndex, heightIndex);

      positions[fIndex * 3] = xFront;
      positions[fIndex * 3 + 1] = y;
      positions[fIndex * 3 + 2] = z;
      uvs[fIndex * 2] = u;
      uvs[fIndex * 2 + 1] = v;

      positions[bIndex * 3] = xBack;
      positions[bIndex * 3 + 1] = y;
      positions[bIndex * 3 + 2] = z;
      uvs[bIndex * 2] = u;
      uvs[bIndex * 2 + 1] = v;
    }
  }

  for (let widthIndex = 0; widthIndex < widthSegments; widthIndex += 1) {
    for (let heightIndex = 0; heightIndex < heightSegments; heightIndex += 1) {
      const fa = frontIndex(widthIndex, heightIndex);
      const fb = frontIndex(widthIndex + 1, heightIndex);
      const fc = frontIndex(widthIndex, heightIndex + 1);
      const fd = frontIndex(widthIndex + 1, heightIndex + 1);
      if (kind === "upper") indices.push(fa, fc, fb, fb, fc, fd);
      else indices.push(fa, fb, fc, fb, fd, fc);

      const ba = backIndex(widthIndex, heightIndex);
      const bb = backIndex(widthIndex + 1, heightIndex);
      const bc = backIndex(widthIndex, heightIndex + 1);
      const bd = backIndex(widthIndex + 1, heightIndex + 1);
      if (kind === "upper") indices.push(ba, bb, bc, bb, bd, bc);
      else indices.push(ba, bc, bb, bb, bc, bd);
    }
  }

  for (let widthIndex = 0; widthIndex < widthSegments; widthIndex += 1) {
    const nextWidthIndex = widthIndex + 1;
    const innerFrontA = frontIndex(widthIndex, 0);
    const innerFrontB = frontIndex(nextWidthIndex, 0);
    const innerBackA = backIndex(widthIndex, 0);
    const innerBackB = backIndex(nextWidthIndex, 0);
    indices.push(innerFrontA, innerBackB, innerBackA, innerFrontA, innerFrontB, innerBackB);

    const outerFrontA = frontIndex(widthIndex, heightSegments);
    const outerFrontB = frontIndex(nextWidthIndex, heightSegments);
    const outerBackA = backIndex(widthIndex, heightSegments);
    const outerBackB = backIndex(nextWidthIndex, heightSegments);
    indices.push(outerFrontA, outerBackA, outerBackB, outerFrontA, outerBackB, outerFrontB);
  }

  for (let heightIndex = 0; heightIndex < heightSegments; heightIndex += 1) {
    const nextHeightIndex = heightIndex + 1;

    const leftFrontA = frontIndex(0, heightIndex);
    const leftFrontB = frontIndex(0, nextHeightIndex);
    const leftBackA = backIndex(0, heightIndex);
    const leftBackB = backIndex(0, nextHeightIndex);
    indices.push(leftFrontA, leftBackB, leftBackA, leftFrontA, leftFrontB, leftBackB);

    const rightFrontA = frontIndex(widthSegments, heightIndex);
    const rightFrontB = frontIndex(widthSegments, nextHeightIndex);
    const rightBackA = backIndex(widthSegments, heightIndex);
    const rightBackB = backIndex(widthSegments, nextHeightIndex);
    indices.push(
      rightFrontA,
      rightBackA,
      rightBackB,
      rightFrontA,
      rightBackB,
      rightFrontB
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
