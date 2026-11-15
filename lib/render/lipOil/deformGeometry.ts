/** Fixed MediaPipe bindings, ordered from the same left corner to right corner. */
export const LIP_ANCHORS = {
  upper: {
    outer: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
    inner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  },
  lower: {
    outer: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    inner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  },
} as const;
export type LipPoint = { x: number; y: number; z?: number };

// Shape-preserving cubic interpolation. Shared tangents remove the lighting
// seams of linear contour segments without overshooting an observed interval.
function contourCoordinate(values: number[], i: number, t: number) {
  const delta = values[i+1]-values[i];
  const tangent = (at: number) => {
    if(at===0)return values[1]-values[0];
    if(at===values.length-1)return values[at]-values[at-1];
    const before=values[at]-values[at-1],after=values[at+1]-values[at];
    return before*after>0 ? 2*before*after/(before+after) : 0;
  };
  const m0=tangent(i),m1=tangent(i+1);
  return values[i]+delta*(-2*t*t*t+3*t*t)+m0*(t*t*t-2*t*t+t)+m1*(t*t*t-t*t);
}

function sample(points: LipPoint[], indices: readonly number[], u: number, smooth: boolean) {
  const f = Math.min(10, Math.max(0, u * 10));
  const i = Math.min(9, Math.floor(f));
  const t = f - i;
  const a = points[indices[i]], b = points[indices[i + 1]];
  if(smooth) return {
    x:contourCoordinate(indices.map(id=>points[id].x),i,t),
    y:contourCoordinate(indices.map(id=>points[id].y),i,t),
    z:contourCoordinate(indices.map(id=>points[id].z??0),i,t),
  };
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
}

/** Bind once. Rest positions and face indices never change during tracking. */
export function bindLipGeometry(geometry: import("three").BufferGeometry, kind: "upper" | "lower") {
  const rest = new Float32Array(geometry.attributes.position.array);
  const uv = geometry.attributes.uv.array;
  const frontCount = rest.length / 6;
  // The canonical mesh uses X for depth, Y for vertical, Z for horizontal.
  // Remove the depth chord at its two boundaries so the tracked border stays
  // exactly on the lip, retaining the canonical body's relief between them.
  const relief = new Float32Array(rest.length / 3);
  let rowSize = 1;
  while (rowSize < frontCount && uv[rowSize * 2] === uv[0]) rowSize++;
  // Mapping canonical (depth, up, across) to (across, up, depth)
  // reverses handedness, so reverse triangle winding once.
  const index = geometry.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.array[i + 1];
    index.array[i + 1] = index.array[i + 2];
    index.array[i + 2] = b;
  }
  index.needsUpdate = true;
  for (let i = 0; i < relief.length; i++) {
    const row = Math.floor(i / rowSize) * rowSize;
    const v = uv[i * 2 + 1];
    const t = v * v * (3 - 2 * v);
    const chord = rest[row * 3] * (1 - t) + rest[(row + rowSize - 1) * 3] * t;
    relief[i] = rest[i * 3] - chord;
  }
  // Keep the original relief available for an exact A/B comparison.
  const rowPeaks = new Float32Array(relief.length / rowSize);
  for (let i = 0; i < relief.length; i++) {
    const row = Math.floor(i / rowSize);
    rowPeaks[row] = Math.max(rowPeaks[row], Math.abs(relief[i]));
  }
  const edgeDistances = new Float32Array(relief.length * 3);
  // Clone a BufferAttribute to avoid coupling this binding to a Three import.
  const edgeAttribute = geometry.attributes.position.clone();
  edgeAttribute.array = edgeDistances;
  geometry.setAttribute("lipEdgeDistance", edgeAttribute);
  return {
    update(points: LipPoint[], width: number, height: number, integrated = false) {
      const anchors = LIP_ANCHORS[kind];
      if (![13, 14, ...anchors.inner, ...anchors.outer].every(i => {
        const p = points[i];
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0);
      })) return false;
      const left = points[61], right = points[291];
      const lipWidth = Math.hypot((right.x-left.x)*width, (right.y-left.y)*height,
        ((right.z ?? 0)-(left.z ?? 0))*width);
      if (lipWidth < 2) return false;
      const positions = geometry.attributes.position;
      const out = positions.array;
      // Every row shares contour samples across its height and both faces.
      const samples = Array.from({length:frontCount/rowSize},(_,row)=>{
        const u=uv[row*rowSize*2];
        return {inner:sample(points,anchors.inner,u,integrated),outer:sample(points,anchors.outer,u,integrated)};
      });
      // The visible band gets taller as the mouth opens; it must not inflate
      // its added volume with that height. The tracked XYZ borders stay exact.
      const gap = Math.hypot((points[13].x-points[14].x)*width,(points[13].y-points[14].y)*height);
      const openingRelief = 1 / (1 + 2 * gap / lipWidth);
      for (let i = 0; i < relief.length; i++) {
        const u = uv[i * 2], v = uv[i * 2 + 1];
        const t = v * v * (3 - 2 * v);
        const {inner,outer} = samples[Math.floor((i%frontCount)/rowSize)];
        out[i*3] = (inner.x + (outer.x-inner.x)*t) * width - width/2;
        out[i*3+1] = height/2 - (inner.y + (outer.y-inner.y)*t) * height;
        const originalDepth = relief[i] * lipWidth / 2.92;
        const thickness = Math.hypot((outer.x-inner.x)*width, (outer.y-inner.y)*height);
        const peak = rowPeaks[Math.floor(i / rowSize)];
        // Relief follows the local lip thickness, not just the overall mouth
        // width. A stretched/open mouth must not retain a thick inflated rim.
        const peakDepth = Math.min(peak * lipWidth / 2.92 * .22, thickness * .10) * openingRelief;
        const edgeSlope = Math.pow(Math.max(0, Math.sin(Math.PI * t)), .7);
        const fittedDepth = peak > 1e-8 ? relief[i] / peak * peakDepth * edgeSlope : 0;
        out[i*3+2] = -(inner.z + (outer.z-inner.z)*t) * width + (integrated ? fittedDepth : originalDepth);
        // Distances in camera pixels: only a narrow silhouette transition.
        edgeDistances[i*3] = t * thickness;
        edgeDistances[i*3+1] = (1-t) * thickness;
        edgeDistances[i*3+2] = Math.min(u, 1-u) * lipWidth;
      }
      positions.needsUpdate = true;
      edgeAttribute.needsUpdate = true;
      // Screen Y is inverted; use a fixed index winding selected at bind time.
      geometry.computeVertexNormals();
      return true;
    },
    frontCount,
  };
}
