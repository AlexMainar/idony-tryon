"use client";

import { useEffect, useRef, useState } from "react";

type ThreeModule = typeof import("three");

type InitState = "idle" | "loading" | "ready" | "error";
type ViewPreset = "asset" | "frontA" | "frontB" | "side" | "top";
type AssetPreset =
  | "canonical"
  | "canonicalUpper"
  | "canonicalLower"
  | "lipProfiled"
  | "lipProfiledTight"
  | "lipClean"
  | "lipCleanTight"
  | "lipFront"
  | "lipTight"
  | "lipStandard"
  | "lipWide"
  | "fullMouth";
type GeneratedAsset = "canonical" | "canonicalUpper" | "canonicalLower";
type AssetPresetConfig =
  | { id: AssetPreset; label: string; source: "generated"; generated: GeneratedAsset }
  | { id: AssetPreset; label: string; source: "url"; url: string };

type MaterialSettings = {
  color: string;
  roughness: number;
  metalness: number;
  ior: number;
  reflectivity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  envMapIntensity: number;
};

type TransformSettings = {
  scale: number;
  x: number;
  y: number;
  z: number;
};

const CLOVER_CLUB_COLOR = "#af4b55";
const CLOVER_CLUB_PREVIEW_COLOR = "#9f3f4c";
const ASSET_PRESETS: AssetPresetConfig[] = [
  {
    id: "canonical",
    label: "Canonical",
    source: "generated",
    generated: "canonical",
  },
  {
    id: "canonicalUpper",
    label: "Canon upper",
    source: "generated",
    generated: "canonicalUpper",
  },
  {
    id: "canonicalLower",
    label: "Canon lower",
    source: "generated",
    generated: "canonicalLower",
  },
  {
    id: "lipProfiled",
    label: "Lip profiled",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-clean-profiled.glb",
  },
  {
    id: "lipProfiledTight",
    label: "Lip prof tight",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-clean-tight-profiled.glb",
  },
  {
    id: "lipClean",
    label: "Lip clean",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-clean.glb",
  },
  {
    id: "lipCleanTight",
    label: "Lip clean tight",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-clean-tight.glb",
  },
  {
    id: "lipFront",
    label: "Lip front",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-front.glb",
  },
  {
    id: "lipTight",
    label: "Lip tight",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-tight.glb",
  },
  {
    id: "lipStandard",
    label: "Lip standard",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-standard.glb",
  },
  {
    id: "lipWide",
    label: "Lip wide",
    source: "url",
    url: "/assets/lip-lab/extracted/realistic-open-mouth-lips-wide.glb",
  },
  {
    id: "fullMouth",
    label: "Full mouth",
    source: "url",
    url: "/assets/lip-lab/realistic-open-mouth-10k.glb",
  },
];
const DEFAULT_ASSET_PRESET = ASSET_PRESETS[0] as Extract<
  AssetPresetConfig,
  { source: "generated" }
>;
const INITIAL_MATERIAL_SETTINGS: MaterialSettings = {
  color: CLOVER_CLUB_PREVIEW_COLOR,
  roughness: 0.2,
  metalness: 0,
  ior: 1.45,
  reflectivity: 0.5,
  clearcoat: 1,
  clearcoatRoughness: 0.07,
  specularIntensity: 1,
  envMapIntensity: 0.88,
};
const INITIAL_TRANSFORM_SETTINGS: TransformSettings = {
  scale: 1.22,
  x: 0.15,
  y: -0.1,
  z: 0.16,
};

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

function buildCanonicalLipGeometry(
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
      indices.push(fa, fc, fb, fb, fc, fd);

      const ba = backIndex(widthIndex, heightIndex);
      const bb = backIndex(widthIndex + 1, heightIndex);
      const bc = backIndex(widthIndex, heightIndex + 1);
      const bd = backIndex(widthIndex + 1, heightIndex + 1);
      indices.push(ba, bc, bb, bb, bc, bd);
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

function buildGeneratedLipObject(
  THREE: ThreeModule,
  material: import("three").MeshPhysicalMaterial,
  generated: GeneratedAsset
) {
  const root = new THREE.Group();
  const buildPatch = (kind: "upper" | "lower") =>
    buildCanonicalLipGeometry(THREE, {
      kind,
      widthSegments: 72,
      heightSegments: 16,
      frontDepth: kind === "upper" ? 0.25 : 0.27,
      backDepth: kind === "upper" ? 0.12 : 0.14,
    });

  if (generated === "canonical" || generated === "canonicalUpper") {
    const upperGeometry = buildPatch("upper");
    const upperMesh = new THREE.Mesh(upperGeometry, material);
    upperMesh.frustumCulled = false;
    root.add(upperMesh);
  }

  if (generated === "canonical" || generated === "canonicalLower") {
    const lowerGeometry = buildPatch("lower");
    const lowerMesh = new THREE.Mesh(lowerGeometry, material);
    lowerMesh.frustumCulled = false;
    root.add(lowerMesh);
  }

  return root;
}

function createStudioEnvironment(THREE: ThreeModule, renderer: import("three").WebGLRenderer) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const resources: Array<{ dispose: () => void }> = [];

  const roomGeometry = new THREE.BoxGeometry(16, 10, 16);
  const roomMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.1, 0.09, 0.09),
    side: THREE.BackSide,
    toneMapped: false,
  });
  const room = new THREE.Mesh(roomGeometry, roomMaterial);
  scene.add(room);
  resources.push(roomGeometry, roomMaterial);

  const addPanel = (
    size: [number, number],
    color: number,
    position: [number, number, number],
    rotation: [number, number, number]
  ) => {
    const geometry = new THREE.PlaneGeometry(size[0], size[1]);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(position[0], position[1], position[2]);
    panel.rotation.set(rotation[0], rotation[1], rotation[2]);
    scene.add(panel);
    resources.push(geometry, material);
  };

  addPanel([4.2, 4.8], 0xffffff, [-4.2, 0.8, 2], [0, Math.PI / 2, 0]);
  addPanel([3.2, 3.8], 0xf7f2ff, [3.8, -0.3, -1.5], [0, -Math.PI / 2.6, 0]);
  addPanel([7.2, 2.2], 0xfff8f2, [0, 4.1, 0.4], [Math.PI / 2, 0, 0]);

  const target = pmremGenerator.fromScene(scene, 0.03);
  pmremGenerator.dispose();
  for (const resource of resources) resource.dispose();
  return target;
}

function applyMaterialSettings(
  THREE: ThreeModule,
  material: import("three").MeshPhysicalMaterial,
  settings: MaterialSettings
) {
  material.color.set(settings.color);
  material.roughness = settings.roughness;
  material.metalness = settings.metalness;
  material.ior = settings.ior;
  material.reflectivity = settings.reflectivity;
  material.clearcoat = settings.clearcoat;
  material.clearcoatRoughness = settings.clearcoatRoughness;
  material.specularIntensity = settings.specularIntensity;
  material.specularColor = new THREE.Color(0xffffff);
  material.envMapIntensity = settings.envMapIntensity;
  material.needsUpdate = true;
}

function applyGroupTransform(
  group: import("three").Group,
  settings: TransformSettings
) {
  group.position.set(settings.x, settings.y, settings.z);
  group.scale.setScalar(settings.scale);
}

function LabSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(92px, 1fr) 150px 44px",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
      <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {value.toFixed(step < 0.01 ? 2 : 2)}
      </span>
    </label>
  );
}

async function loadGltfScene(url: string) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  return new Promise<import("three").Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error)
    );
  });
}

function disposeObjectGeometries(object: import("three").Object3D) {
  object.traverse((child) => {
    const mesh = child as import("three").Mesh;
    mesh.geometry?.dispose?.();
  });
}

function replaceLipGroupContent(
  lipGroup: import("three").Group,
  object: import("three").Object3D
) {
  for (const child of [...lipGroup.children]) {
    lipGroup.remove(child);
    disposeObjectGeometries(child);
  }
  lipGroup.add(object);
}

function prepareImportedLipObject(
  THREE: ThreeModule,
  object: import("three").Object3D,
  material: import("three").Material,
  targetSize = 1.9
) {
  object.traverse((child) => {
    const mesh = child as import("three").Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.computeVertexNormals?.();
    mesh.material = material;
    mesh.frustumCulled = false;
  });

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;

  object.position.sub(center);

  const root = new THREE.Group();
  root.add(object);
  root.scale.setScalar(targetSize / maxDimension);
  return root;
}

export default function LipLabScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<{
    THREE: ThreeModule;
    lipGroup: import("three").Group;
    material: import("three").MeshPhysicalMaterial;
  } | null>(null);
  const rotationRef = useRef({ x: 0, y: -Math.PI / 2, z: 0 });
  const transformRef = useRef<TransformSettings>(INITIAL_TRANSFORM_SETTINGS);
  const [initState, setInitState] = useState<InitState>("idle");
  const [initError, setInitError] = useState<string | null>(null);
  const [loadedAssetName, setLoadedAssetName] = useState<string>(DEFAULT_ASSET_PRESET.label);
  const [assetPreset, setAssetPreset] = useState<AssetPreset>(DEFAULT_ASSET_PRESET.id);
  const [viewPreset, setViewPreset] = useState<ViewPreset>("frontA");
  const [materialSettings, setMaterialSettings] = useState<MaterialSettings>(
    INITIAL_MATERIAL_SETTINGS
  );
  const [transformSettings, setTransformSettings] = useState<TransformSettings>(
    INITIAL_TRANSFORM_SETTINGS
  );

  const updateMaterialSetting = <Key extends keyof MaterialSettings>(
    key: Key,
    value: MaterialSettings[Key]
  ) => {
    setMaterialSettings((current) => ({ ...current, [key]: value }));
  };

  const updateTransformSetting = <Key extends keyof TransformSettings>(
    key: Key,
    value: TransformSettings[Key]
  ) => {
    setTransformSettings((current) => ({ ...current, [key]: value }));
  };

  const setLipView = (preset: ViewPreset) => {
    const rotations: Record<ViewPreset, { x: number; y: number; z: number }> = {
      asset: { x: -0.12, y: 0.18, z: 0 },
      frontA: { x: 0, y: -Math.PI / 2, z: 0 },
      frontB: { x: 0, y: Math.PI / 2, z: 0 },
      side: { x: 0, y: 0, z: 0 },
      top: { x: -Math.PI / 2, y: 0, z: 0 },
    };

    rotationRef.current = rotations[preset];
    setViewPreset(preset);
    const lipGroup = runtimeRef.current?.lipGroup;
    if (lipGroup) {
      lipGroup.rotation.set(
        rotationRef.current.x,
        rotationRef.current.y,
        rotationRef.current.z
      );
    }
  };

  const loadPresetAsset = async (preset: (typeof ASSET_PRESETS)[number]) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    try {
      if (preset.source === "generated") {
        const generated = buildGeneratedLipObject(
          runtime.THREE,
          runtime.material,
          preset.generated
        );
        replaceLipGroupContent(runtime.lipGroup, generated);
      } else {
        const scene = await loadGltfScene(preset.url);
        const imported = prepareImportedLipObject(runtime.THREE, scene, runtime.material);
        replaceLipGroupContent(runtime.lipGroup, imported);
      }
      runtime.lipGroup.rotation.set(
        rotationRef.current.x,
        rotationRef.current.y,
        rotationRef.current.z
      );
      applyGroupTransform(runtime.lipGroup, transformRef.current);
      setAssetPreset(preset.id);
      setLoadedAssetName(preset.label);
      setInitError(null);
      setInitState("ready");
    } catch (error) {
      setInitError(error instanceof Error ? error.message : "No se pudo cargar el asset");
      setInitState("error");
    }
  };

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyMaterialSettings(runtime.THREE, runtime.material, materialSettings);
  }, [materialSettings]);

  useEffect(() => {
    transformRef.current = transformSettings;
    const lipGroup = runtimeRef.current?.lipGroup;
    if (lipGroup) applyGroupTransform(lipGroup, transformSettings);
  }, [transformSettings]);

  const handleAssetFile = async (file: File) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();

      if (extension === "glb" || extension === "gltf") {
        const url = URL.createObjectURL(file);
        try {
          const scene = await loadGltfScene(url);
          const imported = prepareImportedLipObject(runtime.THREE, scene, runtime.material);
          replaceLipGroupContent(runtime.lipGroup, imported);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const buffer = await file.arrayBuffer();
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();

        const box = geometry.boundingBox;
        if (!box) throw new Error("STL sin bounding box valida");

        const mesh = new runtime.THREE.Mesh(geometry, runtime.material);
        const imported = prepareImportedLipObject(runtime.THREE, mesh, runtime.material);
        imported.rotation.x = -Math.PI / 2;
        replaceLipGroupContent(runtime.lipGroup, imported);
      }

      runtime.lipGroup.rotation.set(0, -Math.PI / 2, 0);
      rotationRef.current = { x: 0, y: -Math.PI / 2, z: 0 };
      setViewPreset("frontA");
      applyGroupTransform(runtime.lipGroup, transformRef.current);
      setLoadedAssetName(file.name);
    } catch (error) {
      setInitError(error instanceof Error ? error.message : "No se pudo cargar el STL");
      setInitState("error");
    }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let envTarget: import("three").WebGLRenderTarget | null = null;
    let raf = 0;
    const disposables: Array<{ dispose: () => void }> = [];

    setInitState("loading");

    void (async () => {
      try {
        const THREE = await import("three");
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.96;
        renderer.setClearColor("#efe7e0");
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#efe7e0");

        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
        camera.position.set(0, 0.08, 6.35);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
        keyLight.position.set(-2.3, 2.8, 4.2);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffe6d9, 1.0);
        fillLight.position.set(2.4, 1.2, 3.2);
        scene.add(fillLight);

        const hemi = new THREE.HemisphereLight(0xfffaf7, 0x8d6e66, 0.86);
        scene.add(hemi);

        envTarget = createStudioEnvironment(THREE, renderer);

        const lipMaterial = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(materialSettings.color),
          roughness: materialSettings.roughness,
          metalness: materialSettings.metalness,
          clearcoat: materialSettings.clearcoat,
          clearcoatRoughness: materialSettings.clearcoatRoughness,
          specularIntensity: materialSettings.specularIntensity,
          specularColor: new THREE.Color(0xffffff),
          ior: materialSettings.ior,
          reflectivity: materialSettings.reflectivity,
          envMapIntensity: materialSettings.envMapIntensity,
          envMap: envTarget.texture,
          side: THREE.DoubleSide,
        });
        applyMaterialSettings(THREE, lipMaterial, materialSettings);
        disposables.push(lipMaterial);

        const lipGroup = new THREE.Group();
        const defaultGenerated = buildGeneratedLipObject(
          THREE,
          lipMaterial,
          DEFAULT_ASSET_PRESET.generated
        );
        lipGroup.add(defaultGenerated);
        applyGroupTransform(lipGroup, transformRef.current);
        lipGroup.rotation.set(0, -Math.PI / 2, 0);
        scene.add(lipGroup);
        runtimeRef.current = { THREE, lipGroup, material: lipMaterial };

        const floorGeometry = new THREE.CircleGeometry(5.2, 96);
        const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.08 });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -1.25, 0);
        scene.add(floor);
        disposables.push(floorGeometry, floorMaterial);

        const resize = () => {
          if (!renderer || !mount) return;
          const width = mount.clientWidth;
          const height = mount.clientHeight;
          renderer.setSize(width, height, false);
          camera.aspect = width / Math.max(height, 1);
          camera.updateProjectionMatrix();
        };

        resize();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);

        const tick = () => {
          lipGroup.rotation.set(
            rotationRef.current.x,
            rotationRef.current.y,
            rotationRef.current.z
          );
          renderer?.render(scene, camera);
          raf = window.requestAnimationFrame(tick);
        };
        tick();
        setInitError(null);
        setInitState("ready");
      } catch (error) {
        console.error("Lip lab scene init failed", error);
        setInitError(error instanceof Error ? error.message : "Unknown Three.js init error");
        setInitState("error");
      }
    })();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      for (const disposable of disposables) disposable.dispose();
      envTarget?.dispose();
      renderer?.dispose();
      runtimeRef.current = null;
      if (renderer?.domElement && mount?.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
      }}
    >
      <div
        ref={mountRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 20,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.46)",
          color: "#f8eee9",
          fontSize: 12,
          lineHeight: 1.2,
        }}
      >
        <label
          style={{
            cursor: "pointer",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Cargar GLB/STL
          <input
            accept=".glb,.gltf,.stl,model/gltf-binary,model/gltf+json,model/stl"
            type="file"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleAssetFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <span style={{ opacity: 0.72 }}>{loadedAssetName}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 20,
          zIndex: 20,
          display: "flex",
          transform: "translateX(-50%)",
          gap: 8,
          padding: 8,
          borderRadius: 14,
          background: "rgba(0,0,0,0.38)",
        }}
      >
        {[
          ["asset", "Asset"],
          ["frontA", "Frontal A"],
          ["frontB", "Frontal B"],
          ["side", "Lateral"],
          ["top", "Top"],
        ].map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            onClick={() => setLipView(preset as ViewPreset)}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "8px 10px",
              background:
                viewPreset === preset ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.22)",
              color: viewPreset === preset ? "#251b1b" : "#fff5ef",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 74,
          zIndex: 20,
          display: "flex",
          transform: "translateX(-50%)",
          gap: 8,
          padding: 8,
          borderRadius: 14,
          background: "rgba(0,0,0,0.32)",
        }}
      >
        {ASSET_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => void loadPresetAsset(preset)}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "8px 10px",
              background:
                assetPreset === preset.id ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.18)",
              color: assetPreset === preset.id ? "#251b1b" : "#fff5ef",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 76,
          zIndex: 20,
          width: 360,
          maxHeight: "calc(100vh - 170px)",
          overflowY: "auto",
          padding: 16,
          borderRadius: 18,
          background: "rgba(18,15,15,0.72)",
          color: "#fff5ef",
          boxShadow: "0 16px 44px rgba(0,0,0,0.22)",
          fontSize: 12,
          lineHeight: 1.3,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <strong
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Material
          </strong>
          <button
            onClick={() => {
              setMaterialSettings(INITIAL_MATERIAL_SETTINGS);
              setTransformSettings(INITIAL_TRANSFORM_SETTINGS);
              setLipView("frontA");
            }}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "7px 9px",
              background: "rgba(255,255,255,0.16)",
              color: "#fff5ef",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
            }}
            type="button"
          >
            Reset
          </button>
        </div>
        <label
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(92px, 1fr) 150px 66px",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <span>color</span>
          <input
            onChange={(event) => updateMaterialSetting("color", event.currentTarget.value)}
            style={{ width: "100%", height: 32 }}
            type="color"
            value={materialSettings.color}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
            {materialSettings.color}
          </span>
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <LabSlider
            label="roughness"
            max={1}
            min={0}
            onChange={(value) => updateMaterialSetting("roughness", value)}
            step={0.01}
            value={materialSettings.roughness}
          />
          <LabSlider
            label="metalness"
            max={1}
            min={0}
            onChange={(value) => updateMaterialSetting("metalness", value)}
            step={0.01}
            value={materialSettings.metalness}
          />
          <LabSlider
            label="ior"
            max={2.33}
            min={1}
            onChange={(value) => updateMaterialSetting("ior", value)}
            step={0.01}
            value={materialSettings.ior}
          />
          <LabSlider
            label="reflectivity"
            max={1}
            min={0}
            onChange={(value) => updateMaterialSetting("reflectivity", value)}
            step={0.01}
            value={materialSettings.reflectivity}
          />
          <LabSlider
            label="clearcoat"
            max={1}
            min={0}
            onChange={(value) => updateMaterialSetting("clearcoat", value)}
            step={0.01}
            value={materialSettings.clearcoat}
          />
          <LabSlider
            label="clearcoatR"
            max={1}
            min={0}
            onChange={(value) => updateMaterialSetting("clearcoatRoughness", value)}
            step={0.01}
            value={materialSettings.clearcoatRoughness}
          />
          <LabSlider
            label="specular"
            max={2}
            min={0}
            onChange={(value) => updateMaterialSetting("specularIntensity", value)}
            step={0.01}
            value={materialSettings.specularIntensity}
          />
          <LabSlider
            label="envMap"
            max={2}
            min={0}
            onChange={(value) => updateMaterialSetting("envMapIntensity", value)}
            step={0.01}
            value={materialSettings.envMapIntensity}
          />
        </div>
        <strong
          style={{
            display: "block",
            marginTop: 18,
            marginBottom: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Objeto
        </strong>
        <div style={{ display: "grid", gap: 8 }}>
          <LabSlider
            label="scale"
            max={2.4}
            min={0.35}
            onChange={(value) => updateTransformSetting("scale", value)}
            step={0.01}
            value={transformSettings.scale}
          />
          <LabSlider
            label="x"
            max={2.8}
            min={-2.8}
            onChange={(value) => updateTransformSetting("x", value)}
            step={0.01}
            value={transformSettings.x}
          />
          <LabSlider
            label="y"
            max={1.8}
            min={-1.8}
            onChange={(value) => updateTransformSetting("y", value)}
            step={0.01}
            value={transformSettings.y}
          />
          <LabSlider
            label="z"
            max={1.2}
            min={-1.2}
            onChange={(value) => updateTransformSetting("z", value)}
            step={0.01}
            value={transformSettings.z}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          zIndex: 20,
          padding: "10px 14px",
          borderRadius: 16,
          background: "rgba(0,0,0,0.48)",
          color: "#f8eee9",
          fontSize: 13,
          lineHeight: 1.5,
          maxWidth: 320,
        }}
      >
        {initError
          ? `Error inicializando Three: ${initError}`
          : initState === "ready"
            ? "Deberías ver una esfera glossy a la izquierda y un objeto labial glossy a la derecha."
            : "Inicializando Three y la escena de prueba..."}
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          bottom: 20,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.46)",
          color: "#f8eee9",
          fontSize: 12,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: CLOVER_CLUB_COLOR,
            border: "1px solid rgba(255,255,255,0.55)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.28)",
          }}
        />
        <span>
          Clover Club
          <br />
          {CLOVER_CLUB_COLOR}
        </span>
      </div>
    </div>
  );
}
