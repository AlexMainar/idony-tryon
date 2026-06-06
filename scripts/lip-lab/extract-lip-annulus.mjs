import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE_OBJ = "public/assets/lip-lab/source/realistic-open-mouth-10k.obj";
const SOURCE_GLB = "public/assets/lip-lab/realistic-open-mouth-10k.glb";
const OUTPUT_DIR = "public/assets/lip-lab/extracted";
const CANONICAL_OUTPUT_DIR = "public/assets/lip-lab/canonical";
const CANONICAL_SOURCE_CUT = "clean-tight-profiled";
const CANONICAL_MIN_COMPONENT_FACES = 120;
const CANONICAL_MERGED_COMPONENT_RATIO = 0.18;

const CUTS = [
  {
    name: "clean-profiled",
    inner: 0.76,
    outer: 1.22,
    minDepth: 0.02,
    minSaturation: 0.35,
    minValue: 0.16,
    maxValue: 0.88,
    keepLargestComponents: 2,
    minComponentFaces: 900,
    profileInnerEdge: true,
    profileRadius: 0.8,
    profileBand: 0.18,
  },
  {
    name: "clean-tight-profiled",
    inner: 0.82,
    outer: 1.22,
    minDepth: 0.02,
    minSaturation: 0.35,
    minValue: 0.16,
    maxValue: 0.88,
    keepLargestComponents: 2,
    minComponentFaces: 900,
    profileInnerEdge: true,
    profileRadius: 0.86,
    profileBand: 0.16,
  },
  {
    name: "clean",
    inner: 0.76,
    outer: 1.22,
    minDepth: 0.02,
    minSaturation: 0.35,
    maxValue: 0.88,
    keepLargestComponents: 2,
    minComponentFaces: 900,
  },
  {
    name: "clean-tight",
    inner: 0.82,
    outer: 1.22,
    minDepth: 0.02,
    minSaturation: 0.35,
    maxValue: 0.88,
    keepLargestComponents: 2,
    minComponentFaces: 900,
  },
  { name: "front", inner: 0.52, outer: 1.22, minDepth: 0.02 },
  { name: "tight", inner: 0.62, outer: 1.18, minDepth: -0.08 },
  { name: "standard", inner: 0.52, outer: 1.22, minDepth: -0.16 },
  { name: "wide", inner: 0.44, outer: 1.28, minDepth: -0.24 },
];

function parseObj(filePath) {
  const positions = [null];
  const uvs = [null];
  const normals = [null];
  const faces = [];

  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;

    const parts = line.split(/\s+/);
    if (parts[0] === "v") {
      positions.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === "vt") {
      uvs.push([Number(parts[1]), Number(parts[2])]);
    } else if (parts[0] === "vn") {
      normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === "f") {
      const verts = parts.slice(1).map((token) => {
        const [v, vt, vn] = token.split("/").map(Number);
        return {
          v: v < 0 ? positions.length + v : v,
          vt: vt < 0 ? uvs.length + vt : vt,
          vn: vn < 0 ? normals.length + vn : vn,
        };
      });

      for (let i = 1; i < verts.length - 1; i += 1) {
        faces.push([verts[0], verts[i], verts[i + 1]]);
      }
    }
  }

  return { positions, uvs, normals, faces };
}

function parseGlb(filePath) {
  const glb = fs.readFileSync(filePath);
  let offset = 12;
  let json = null;
  let bin = null;

  while (offset < glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    offset += 4;
    const chunkType = glb.toString("utf8", offset, offset + 4);
    offset += 4;
    const data = glb.subarray(offset, offset + chunkLength);
    offset += chunkLength;

    if (chunkType === "JSON") json = JSON.parse(data.toString("utf8"));
    if (chunkType === "BIN\0") bin = data;
  }

  if (!json || !bin) throw new Error("Invalid GLB");
  return { json, bin };
}

async function extractBaseColorTexture(filePath) {
  const { json, bin } = parseGlb(filePath);
  const textureIndex = json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const imageIndex = json.textures?.[textureIndex]?.source ?? 1;
  const image = json.images?.[imageIndex];
  const view = json.bufferViews?.[image?.bufferView];

  if (!image || !view) throw new Error("GLB base color texture not found");

  const imageBytes = bin.subarray(
    view.byteOffset || 0,
    (view.byteOffset || 0) + view.byteLength
  );
  const pipeline = sharp(imageBytes).ensureAlpha();
  const metadata = await pipeline.metadata();
  const raw = await pipeline.raw().toBuffer();

  return {
    raw,
    width: metadata.width,
    height: metadata.height,
  };
}

function centroid(face, positions) {
  const out = [0, 0, 0];
  for (const vertex of face) {
    const position = positions[vertex.v];
    out[0] += position[0] / face.length;
    out[1] += position[1] / face.length;
    out[2] += position[2] / face.length;
  }
  return out;
}

function centroidUv(face, uvs) {
  const out = [0, 0];
  for (const vertex of face) {
    const uv = uvs[vertex.vt] ?? [0, 0];
    out[0] += uv[0] / face.length;
    out[1] += uv[1] / face.length;
  }
  return out;
}

function lipAnnulusRadius(position) {
  const yCenter = 0;
  const zRadius = 0.46;
  const yRadius = 0.44;
  return Math.hypot(position[2] / zRadius, (position[1] - yCenter) / yRadius);
}

function projectToLipAnnulus(position, targetRadius) {
  const yCenter = 0;
  const zRadius = 0.46;
  const yRadius = 0.44;
  const normalizedY = (position[1] - yCenter) / yRadius;
  const normalizedZ = position[2] / zRadius;
  const radius = Math.hypot(normalizedZ, normalizedY);

  if (radius < 1e-5) return position;

  const scale = targetRadius / radius;
  return [
    position[0],
    yCenter + normalizedY * scale * yRadius,
    normalizedZ * scale * zRadius,
  ];
}

function sampleTexture(texture, uv) {
  if (!texture) return [0, 0, 0];

  const u = Math.max(0, Math.min(1, uv[0]));
  const v = Math.max(0, Math.min(1, uv[1]));
  const x = Math.max(0, Math.min(texture.width - 1, Math.round(u * (texture.width - 1))));
  const y = Math.max(
    0,
    Math.min(texture.height - 1, Math.round((1 - v) * (texture.height - 1)))
  );
  const index = (y * texture.width + x) * 4;
  return [texture.raw[index], texture.raw[index + 1], texture.raw[index + 2]];
}

function rgbToHsv([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }

  return {
    hue,
    saturation: max > 0 ? delta / max : 0,
    value: max,
  };
}

function isLipFace(face, source, cut, texture) {
  const center = centroid(face, source.positions);
  const annulus = lipAnnulusRadius(center);
  if (!(annulus >= cut.inner && annulus <= cut.outer && center[0] >= cut.minDepth)) {
    return false;
  }

  if (
    cut.minSaturation !== undefined ||
    cut.minValue !== undefined ||
    cut.maxValue !== undefined
  ) {
    const color = rgbToHsv(sampleTexture(texture, centroidUv(face, source.uvs)));
    if (cut.minSaturation !== undefined && color.saturation < cut.minSaturation) return false;
    if (cut.minValue !== undefined && color.value < cut.minValue) return false;
    if (cut.maxValue !== undefined && color.value > cut.maxValue) return false;
  }

  return true;
}

function sortedEdgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function boundaryPositionIndices(faces) {
  const edges = new Map();

  for (const face of faces) {
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i].v;
      const b = face[(i + 1) % face.length].v;
      const key = sortedEdgeKey(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  const boundary = new Set();
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    const [a, b] = key.split(":").map(Number);
    boundary.add(a);
    boundary.add(b);
  }

  return boundary;
}

function createProfiledPositionMap(source, faces, cut) {
  if (!cut.profileInnerEdge) return new Map();

  const profiled = new Map();
  const boundary = boundaryPositionIndices(faces);
  const targetRadius = cut.profileRadius ?? cut.inner + 0.04;
  const band = cut.profileBand ?? 0.14;

  for (const vertexIndex of boundary) {
    const position = source.positions[vertexIndex];
    const radius = lipAnnulusRadius(position);
    if (radius > cut.inner + band) continue;

    profiled.set(vertexIndex, projectToLipAnnulus(position, targetRadius));
  }

  return profiled;
}

function buildFaceComponents(faces) {
  const faceByPosition = new Map();
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    for (const vertex of faces[faceIndex]) {
      const key = vertex.v;
      const bucket = faceByPosition.get(key) ?? [];
      bucket.push(faceIndex);
      faceByPosition.set(key, bucket);
    }
  }

  const visited = new Uint8Array(faces.length);
  const components = [];

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    if (visited[faceIndex]) continue;

    const stack = [faceIndex];
    const component = [];
    visited[faceIndex] = 1;

    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);

      for (const vertex of faces[current]) {
        for (const neighbor of faceByPosition.get(vertex.v) ?? []) {
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

function filterSelectedFacesByComponents(faces, cut) {
  if (!cut.keepLargestComponents && !cut.minComponentFaces) return faces;

  const components = buildFaceComponents(faces);
  const keep = new Set();
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex];
    if (
      cut.keepLargestComponents &&
      componentIndex >= cut.keepLargestComponents
    ) {
      continue;
    }
    if (cut.minComponentFaces && component.length < cut.minComponentFaces) continue;

    for (const faceIndex of component) keep.add(faceIndex);
  }

  return faces.filter((_, faceIndex) => keep.has(faceIndex));
}

function buildSubset(source, cut, texture) {
  const selectedFaces = source.faces.filter((face) => isLipFace(face, source, cut, texture));
  const componentFilteredFaces = filterSelectedFacesByComponents(selectedFaces, cut);
  const profiledPositions = createProfiledPositionMap(source, componentFilteredFaces, cut);

  return buildSubsetFromFaces(source, componentFilteredFaces, profiledPositions);
}

function buildSubsetFromFaces(source, faces, profiledPositions = new Map()) {
  const vertexMap = new Map();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let keptFaces = 0;

  const getVertexIndex = (vertex) => {
    const key = `${vertex.v}/${vertex.vt}/${vertex.vn}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;

    const index = positions.length / 3;
    const position = profiledPositions.get(vertex.v) ?? source.positions[vertex.v];
    const normal = source.normals[vertex.vn] ?? [0, 0, 1];
    const uv = source.uvs[vertex.vt] ?? [0, 0];

    positions.push(position[0], position[1], position[2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uv[0], uv[1]);
    vertexMap.set(key, index);
    return index;
  };

  for (const face of faces) {
    keptFaces += 1;
    indices.push(...face.map(getVertexIndex));
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    keptFaces,
    vertexCount: positions.length / 3,
  };
}

function vec3Size(min, max) {
  return [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
}

function averageVec3(positions) {
  if (!positions.length) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  const count = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    x += positions[i];
    y += positions[i + 1];
    z += positions[i + 2];
  }
  return [x / count, y / count, z / count];
}

function padBuffer(buffer, padByte = 0x00) {
  const padding = (4 - (buffer.byteLength % 4)) % 4;
  if (padding === 0) return buffer;

  return Buffer.concat([buffer, Buffer.alloc(padding, padByte)]);
}

function typedArrayToBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function minMaxVec3(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i]);
    min[1] = Math.min(min[1], positions[i + 1]);
    min[2] = Math.min(min[2], positions[i + 2]);
    max[0] = Math.max(max[0], positions[i]);
    max[1] = Math.max(max[1], positions[i + 1]);
    max[2] = Math.max(max[2], positions[i + 2]);
  }

  return { min, max };
}

function createGlb(subset, name) {
  const chunks = [
    { key: "positions", buffer: typedArrayToBuffer(subset.positions), target: 34962 },
    { key: "normals", buffer: typedArrayToBuffer(subset.normals), target: 34962 },
    { key: "uvs", buffer: typedArrayToBuffer(subset.uvs), target: 34962 },
    { key: "indices", buffer: typedArrayToBuffer(subset.indices), target: 34963 },
  ];

  let byteOffset = 0;
  const bufferViews = chunks.map((chunk) => {
    const view = {
      buffer: 0,
      byteOffset,
      byteLength: chunk.buffer.byteLength,
      target: chunk.target,
    };
    byteOffset += padBuffer(chunk.buffer).byteLength;
    return view;
  });

  const bin = Buffer.concat(chunks.map((chunk) => padBuffer(chunk.buffer)));
  const bounds = minMaxVec3(subset.positions);

  const json = {
    asset: { version: "2.0", generator: "idony lip-lab extraction" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              TEXCOORD_0: 2,
            },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        name: "Clover Club gloss preview",
        pbrMetallicRoughness: {
          baseColorFactor: [0.6235, 0.247, 0.298, 1],
          metallicFactor: 0,
          roughnessFactor: 0.18,
        },
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews,
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: subset.vertexCount,
        type: "VEC3",
        min: bounds.min,
        max: bounds.max,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: subset.vertexCount,
        type: "VEC3",
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: 5126,
        count: subset.vertexCount,
        type: "VEC2",
      },
      {
        bufferView: 3,
        byteOffset: 0,
        componentType: 5125,
        count: subset.indices.length,
        type: "SCALAR",
      },
    ],
  };

  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json)), 0x20);
  const totalLength = 12 + 8 + jsonBuffer.byteLength + 8 + bin.byteLength;
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.byteLength, 0);
  jsonHeader.write("JSON", 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.byteLength, 0);
  binHeader.write("BIN\0", 4);

  return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, bin]);
}

function toPublicAssetUrl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const publicPrefix = "public/";
  return normalized.startsWith(publicPrefix)
    ? `/${normalized.slice(publicPrefix.length)}`
    : `/${normalized}`;
}

function exportBandCandidates(
  source,
  texture,
  {
    key,
    outputDir,
    sourceCutName,
    minComponentFaces,
    mergedComponentRatio,
  }
) {
  const cut = CUTS.find((entry) => entry.name === sourceCutName);
  if (!cut) {
    throw new Error(`Band export source cut "${sourceCutName}" not found`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, "components"), { recursive: true });

  const selectedFaces = source.faces.filter((face) => isLipFace(face, source, cut, texture));
  const profiledPositions = createProfiledPositionMap(source, selectedFaces, cut);
  const allSubset = buildSubsetFromFaces(source, selectedFaces, profiledPositions);
  const allBounds = minMaxVec3(allSubset.positions);
  const splitY = (allBounds.min[1] + allBounds.max[1]) * 0.5;

  const components = buildFaceComponents(selectedFaces)
    .map((componentFaceIndices, componentIndex) => {
      const componentFaces = componentFaceIndices.map((faceIndex) => selectedFaces[faceIndex]);
      const subset = buildSubsetFromFaces(source, componentFaces, profiledPositions);
      if (!subset.keptFaces) return null;

      const bounds = minMaxVec3(subset.positions);
      const centroid = averageVec3(subset.positions);
      const size = vec3Size(bounds.min, bounds.max);
      const band = centroid[1] >= splitY ? "upper" : "lower";
      const id = `${key}-component-${String(componentIndex + 1).padStart(2, "0")}-${band}`;
      const relativePath = path.join(outputDir, "components", `${id}.glb`);
      fs.writeFileSync(relativePath, createGlb(subset, id));

      return {
        id,
        band,
        faceCount: subset.keptFaces,
        vertexCount: subset.vertexCount,
        centroid,
        bounds,
        size,
        outputPath: relativePath,
        url: toPublicAssetUrl(relativePath),
        faces: componentFaces,
      };
    })
    .filter(Boolean)
    .filter((component) => component.faceCount >= minComponentFaces)
    .sort((a, b) => b.faceCount - a.faceCount);

  const selectMergedBandComponents = (band) => {
    const entries = components.filter((component) => component.band === band);
    if (!entries.length) return [];
    const largestFaceCount = entries[0].faceCount;
    return entries.filter(
      (component) => component.faceCount >= largestFaceCount * mergedComponentRatio
    );
  };

  const selectedUpper = selectMergedBandComponents("upper");
  const selectedLower = selectMergedBandComponents("lower");

  const writeBandSubset = (name, selectedComponents) => {
    if (!selectedComponents.length) return null;
    const faces = selectedComponents.flatMap((component) => component.faces);
    const subset = buildSubsetFromFaces(source, faces, profiledPositions);
    const outputPath = path.join(outputDir, `realistic-open-mouth-lips-${name}.glb`);
    fs.writeFileSync(outputPath, createGlb(subset, name));
    return {
      name,
      faceCount: subset.keptFaces,
      vertexCount: subset.vertexCount,
      url: toPublicAssetUrl(outputPath),
      outputPath,
      componentIds: selectedComponents.map((component) => component.id),
    };
  };

  const upperExport = writeBandSubset(`${key}-upper`, selectedUpper);
  const lowerExport = writeBandSubset(`${key}-lower`, selectedLower);
  const combinedExport = writeBandSubset(key, [...selectedUpper, ...selectedLower]);

  const manifest = {
    generator: "idony lip-lab band export",
    exportKey: key,
    sourceCut: sourceCutName,
    sourceFaceCount: selectedFaces.length,
    splitY,
    outputs: {
      combined: combinedExport
        ? {
            url: combinedExport.url,
            faceCount: combinedExport.faceCount,
            vertexCount: combinedExport.vertexCount,
            componentIds: combinedExport.componentIds,
          }
        : null,
      upper: upperExport
        ? {
            url: upperExport.url,
            faceCount: upperExport.faceCount,
            vertexCount: upperExport.vertexCount,
            componentIds: upperExport.componentIds,
          }
        : null,
      lower: lowerExport
        ? {
            url: lowerExport.url,
            faceCount: lowerExport.faceCount,
            vertexCount: lowerExport.vertexCount,
            componentIds: lowerExport.componentIds,
          }
        : null,
    },
    components: components.map((component) => ({
      id: component.id,
      band: component.band,
      faceCount: component.faceCount,
      vertexCount: component.vertexCount,
      centroid: component.centroid,
      bounds: component.bounds,
      size: component.size,
      url: component.url,
    })),
  };

  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`${key}: ${components.length} components -> ${manifestPath}`);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const source = parseObj(SOURCE_OBJ);
const texture = await extractBaseColorTexture(SOURCE_GLB);

for (const cut of CUTS) {
  const subset = buildSubset(source, cut, texture);
  const outputPath = path.join(OUTPUT_DIR, `realistic-open-mouth-lips-${cut.name}.glb`);
  fs.writeFileSync(outputPath, createGlb(subset, `lips-${cut.name}`));
  console.log(
    `${cut.name}: ${subset.keptFaces} faces, ${subset.vertexCount} vertices -> ${outputPath}`
  );
}

exportBandCandidates(source, texture, {
  key: "canonical",
  outputDir: CANONICAL_OUTPUT_DIR,
  sourceCutName: CANONICAL_SOURCE_CUT,
  minComponentFaces: CANONICAL_MIN_COMPONENT_FACES,
  mergedComponentRatio: CANONICAL_MERGED_COMPONENT_RATIO,
});
