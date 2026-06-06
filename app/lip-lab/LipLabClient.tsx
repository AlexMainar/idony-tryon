"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ThreeModule = typeof import("three");

type LipControls = {
  color: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  ior: number;
  envMapIntensity: number;
  topDepth: number;
  bottomDepth: number;
};

type LobeOptions = {
  isUpper: boolean;
  width: number;
  uSegments: number;
  radialSegments: number;
  depthScale: number;
};

const INITIAL_CONTROLS: LipControls = {
  color: "#cb5365",
  roughness: 0.34,
  clearcoat: 1,
  clearcoatRoughness: 0.08,
  specularIntensity: 1,
  ior: 1.45,
  envMapIntensity: 0.85,
  topDepth: 0.22,
  bottomDepth: 0.28,
};

const LAB_BACKGROUND =
  "radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 52%), linear-gradient(160deg, #241d20 0%, #171315 65%, #110e0f 100%)";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function buildUpperOuterY(x: number) {
  const arch = -0.11 - 0.13 * Math.pow(1 - x * x, 0.72);
  const cupidNotch = -0.045 * Math.exp(-Math.pow(x / 0.12, 2));
  const cupidPeaks =
    0.04 * Math.exp(-Math.pow((x - 0.24) / 0.14, 2)) +
    0.04 * Math.exp(-Math.pow((x + 0.24) / 0.14, 2));
  return arch + cupidNotch + cupidPeaks;
}

function buildUpperInnerY(x: number) {
  return -0.015 - 0.05 * Math.pow(1 - x * x, 0.78);
}

function buildLowerOuterY(x: number) {
  return 0.095 + 0.24 * Math.pow(1 - x * x, 0.68);
}

function buildLowerInnerY(x: number) {
  return 0.025 + 0.065 * Math.pow(1 - x * x, 0.82);
}

function buildLipLobeGeometry(THREE: ThreeModule, options: LobeOptions) {
  const { isUpper, width, uSegments, radialSegments, depthScale } = options;
  const positions = new Float32Array((uSegments + 1) * (radialSegments + 1) * 3);
  const uvs = new Float32Array((uSegments + 1) * (radialSegments + 1) * 2);
  const indices: number[] = [];

  const radiusT = Math.PI * 2;
  const centerYOffset = isUpper ? -0.03 : 0.03;

  let ptr = 0;
  let uvPtr = 0;
  for (let uIndex = 0; uIndex <= uSegments; uIndex += 1) {
    const u = uIndex / uSegments;
    const xNorm = lerp(-1, 1, u);
    const x = xNorm * width * 0.5;

    const outerY = isUpper ? buildUpperOuterY(xNorm) : buildLowerOuterY(xNorm);
    const innerY = isUpper ? buildUpperInnerY(xNorm) : buildLowerInnerY(xNorm);
    const centerY = (outerY + innerY) * 0.5 + centerYOffset;
    const halfHeight = Math.max(0.012, Math.abs(innerY - outerY) * 0.5);
    const cornerFade = Math.pow(Math.max(0, 1 - xNorm * xNorm), isUpper ? 0.7 : 0.58);
    const depth = halfHeight * lerp(0.78, 1.16, cornerFade) * depthScale;

    for (let vIndex = 0; vIndex <= radialSegments; vIndex += 1) {
      const v = vIndex / radialSegments;
      const theta = v * radiusT;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const backCompression = sinT < 0 ? 0.3 : 1;
      const y = centerY + halfHeight * cosT;
      const z = depth * sinT * backCompression;

      positions[ptr] = x;
      positions[ptr + 1] = y;
      positions[ptr + 2] = z;
      uvs[uvPtr] = u;
      uvs[uvPtr + 1] = v;
      ptr += 3;
      uvPtr += 2;
    }
  }

  const vertsPerRow = radialSegments + 1;
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex < radialSegments; vIndex += 1) {
      const a = uIndex * vertsPerRow + vIndex;
      const b = a + 1;
      const c = (uIndex + 1) * vertsPerRow + vIndex;
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createStudioEnvironment(THREE: ThreeModule, renderer: import("three").WebGLRenderer) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const resources: Array<{ dispose: () => void }> = [];

  const roomGeometry = new THREE.BoxGeometry(16, 10, 16);
  const roomMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.08, 0.075, 0.078),
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

export default function LipLabClient() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const materialRef = useRef<import("three").MeshPhysicalMaterial | null>(null);
  const upperRef = useRef<import("three").Mesh<import("three").BufferGeometry, import("three").MeshPhysicalMaterial> | null>(null);
  const lowerRef = useRef<import("three").Mesh<import("three").BufferGeometry, import("three").MeshPhysicalMaterial> | null>(null);
  const [controls, setControls] = useState<LipControls>(INITIAL_CONTROLS);
  const [initError, setInitError] = useState<string | null>(null);
  const [initState, setInitState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const colorSwatches = useMemo(
    () => ["#d40a39", "#af4b55", "#845557", "#c25b78", "#a3352d"],
    []
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: import("three").WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let envTarget: import("three").WebGLRenderTarget | null = null;
    let floorGeometry: import("three").CircleGeometry | null = null;
    let floorMaterial: import("three").ShadowMaterial | null = null;
    let upperGeometry: import("three").BufferGeometry | null = null;
    let lowerGeometry: import("three").BufferGeometry | null = null;
    let raf = 0;
    let cancelled = false;

    setInitState("loading");

    void (async () => {
      try {
        const THREE = await import("three");
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#efe7e0");

        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
        camera.position.set(0, 0.04, 3.45);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
        keyLight.position.set(-2.2, 2.6, 3.8);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffe8dc, 1.1);
        fillLight.position.set(2.4, 1.2, 3.1);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.75);
        rimLight.position.set(-0.3, -1.6, 2.9);
        scene.add(rimLight);

        const hemi = new THREE.HemisphereLight(0xfff8f3, 0x8d6e66, 0.8);
        scene.add(hemi);

        const material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(INITIAL_CONTROLS.color),
          roughness: INITIAL_CONTROLS.roughness,
          metalness: 0,
          clearcoat: INITIAL_CONTROLS.clearcoat,
          clearcoatRoughness: INITIAL_CONTROLS.clearcoatRoughness,
          specularIntensity: INITIAL_CONTROLS.specularIntensity,
          specularColor: new THREE.Color(0xffffff),
          ior: INITIAL_CONTROLS.ior,
          envMapIntensity: INITIAL_CONTROLS.envMapIntensity,
          side: THREE.DoubleSide,
        });
        materialRef.current = material;

        upperGeometry = buildLipLobeGeometry(THREE, {
          isUpper: true,
          width: 2.7,
          uSegments: 72,
          radialSegments: 28,
          depthScale: INITIAL_CONTROLS.topDepth,
        });
        lowerGeometry = buildLipLobeGeometry(THREE, {
          isUpper: false,
          width: 2.7,
          uSegments: 72,
          radialSegments: 28,
          depthScale: INITIAL_CONTROLS.bottomDepth,
        });

        const upperMesh = new THREE.Mesh(upperGeometry, material);
        const lowerMesh = new THREE.Mesh(lowerGeometry, material);
        const upperWire = new THREE.Mesh(
          upperGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x24191d,
            wireframe: true,
            transparent: true,
            opacity: 0.08,
          })
        );
        const lowerWire = new THREE.Mesh(
          lowerGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x24191d,
            wireframe: true,
            transparent: true,
            opacity: 0.08,
          })
        );
        upperMesh.position.y = -0.02;
        lowerMesh.position.y = 0.02;
        upperWire.position.copy(upperMesh.position);
        lowerWire.position.copy(lowerMesh.position);
        upperRef.current = upperMesh;
        lowerRef.current = lowerMesh;

        const group = new THREE.Group();
        group.add(upperMesh, lowerMesh, upperWire, lowerWire);
        group.rotation.set(-0.42, 0.62, 0.08);
        group.scale.setScalar(1.85);
        scene.add(group);

        envTarget = createStudioEnvironment(THREE, renderer);
        material.envMap = envTarget.texture;
        material.needsUpdate = true;

        floorGeometry = new THREE.CircleGeometry(4.6, 64);
        floorMaterial = new THREE.ShadowMaterial({ opacity: 0.08 });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -1.1, 0);
        scene.add(floor);

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

        let frame = 0;
        const tick = () => {
          frame += 1;
          group.rotation.y = 0.62 + Math.sin(frame * 0.006) * 0.16;
          renderer?.render(scene, camera);
          raf = window.requestAnimationFrame(tick);
        };
        tick();
        setInitError(null);
        setInitState("ready");
      } catch (error) {
        console.error("Lip lab init failed", error);
        setInitError(error instanceof Error ? error.message : "Unknown Three.js init error");
        setInitState("error");
      }
    })();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      floorGeometry?.dispose();
      floorMaterial?.dispose();
      upperGeometry?.dispose();
      lowerGeometry?.dispose();
      materialRef.current?.dispose();
      envTarget?.dispose();
      renderer?.dispose();
      if (renderer?.domElement && mount?.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.color.set(controls.color);
    material.roughness = controls.roughness;
    material.clearcoat = controls.clearcoat;
    material.clearcoatRoughness = controls.clearcoatRoughness;
    material.specularIntensity = controls.specularIntensity;
    material.ior = controls.ior;
    material.envMapIntensity = controls.envMapIntensity;
    material.needsUpdate = true;
  }, [
    controls.color,
    controls.roughness,
    controls.clearcoat,
    controls.clearcoatRoughness,
    controls.specularIntensity,
    controls.ior,
    controls.envMapIntensity,
  ]);

  useEffect(() => {
    const upper = upperRef.current;
    const lower = lowerRef.current;
    if (!upper || !lower) return;
    const oldUpper = upper.geometry;
    const oldLower = lower.geometry;
    import("three").then((THREE) => {
      upper.geometry = buildLipLobeGeometry(THREE, {
        isUpper: true,
        width: 2.7,
        uSegments: 72,
        radialSegments: 28,
        depthScale: controls.topDepth,
      });
      lower.geometry = buildLipLobeGeometry(THREE, {
        isUpper: false,
        width: 2.7,
        uSegments: 72,
        radialSegments: 28,
        depthScale: controls.bottomDepth,
      });
      oldUpper.dispose();
      oldLower.dispose();
    });
  }, [controls.topDepth, controls.bottomDepth]);

  const update = <K extends keyof LipControls>(key: K, value: LipControls[K]) => {
    setControls((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="min-h-screen bg-[#161214] text-[#f7ede9]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1600px] gap-0 lg:grid-cols-[1.4fr_0.8fr]">
        <section
          className="relative min-h-[60vh] border-b border-white/10 lg:min-h-screen lg:border-b-0 lg:border-r"
          style={{ background: LAB_BACKGROUND }}
        >
          <div className="absolute left-6 top-6 z-10 max-w-md">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#f2c7ba]">
              Lip Material Lab
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-none text-white">
              Probar el labio como objeto, no como máscara
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/72">
              Este laboratorio aísla sólo la geometría y el material físico de Three para validar
              volumen, brillo y color antes de volver a tocar el try-on.
            </p>
          </div>
          <div ref={mountRef} className="h-[60vh] w-full lg:h-screen" />
          {initState !== "ready" && !initError ? (
            <div className="absolute bottom-6 left-6 max-w-sm rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/75">
              {initState === "loading" ? "Inicializando Three..." : "Esperando visor..."}
            </div>
          ) : null}
          {initError ? (
            <div className="absolute bottom-6 left-6 max-w-sm rounded-2xl border border-red-400/30 bg-black/50 p-4 text-sm text-red-200">
              Error inicializando Three: {initError}
            </div>
          ) : null}
        </section>

        <aside className="flex flex-col gap-8 px-6 py-8 lg:px-10 lg:py-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#f2c7ba]">
              Material
            </p>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Si aquí no conseguimos el look, no tiene sentido reintentar sobre la cara. Si aquí
              se ve bien, entonces ya sabremos que el problema era de integración.
            </p>
          </div>

          <div className="space-y-4 rounded-[28px] border border-white/10 bg-white/5 p-5">
            <label className="block text-sm text-white/90">Color</label>
            <div className="flex flex-wrap gap-3">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => update("color", swatch)}
                  className="h-11 w-11 rounded-full border-2 transition"
                  style={{
                    backgroundColor: swatch,
                    borderColor:
                      controls.color === swatch ? "#fff8f2" : "rgba(255,255,255,0.16)",
                    boxShadow:
                      controls.color === swatch
                        ? "0 0 0 3px rgba(255,248,242,0.22)"
                        : "none",
                  }}
                />
              ))}
            </div>
          </div>

          <ControlSlider
            label="Roughness"
            min={0}
            max={1}
            step={0.01}
            value={controls.roughness}
            onChange={(value) => update("roughness", value)}
          />
          <ControlSlider
            label="Clearcoat"
            min={0}
            max={1}
            step={0.01}
            value={controls.clearcoat}
            onChange={(value) => update("clearcoat", value)}
          />
          <ControlSlider
            label="Clearcoat Roughness"
            min={0}
            max={1}
            step={0.01}
            value={controls.clearcoatRoughness}
            onChange={(value) => update("clearcoatRoughness", value)}
          />
          <ControlSlider
            label="Specular Intensity"
            min={0}
            max={2}
            step={0.01}
            value={controls.specularIntensity}
            onChange={(value) => update("specularIntensity", value)}
          />
          <ControlSlider
            label="IOR"
            min={1}
            max={2}
            step={0.01}
            value={controls.ior}
            onChange={(value) => update("ior", value)}
          />
          <ControlSlider
            label="Environment Intensity"
            min={0}
            max={3}
            step={0.01}
            value={controls.envMapIntensity}
            onChange={(value) => update("envMapIntensity", value)}
          />
          <ControlSlider
            label="Upper Depth"
            min={0.06}
            max={0.36}
            step={0.005}
            value={controls.topDepth}
            onChange={(value) => update("topDepth", value)}
          />
          <ControlSlider
            label="Lower Depth"
            min={0.06}
            max={0.4}
            step={0.005}
            value={controls.bottomDepth}
            onChange={(value) => update("bottomDepth", value)}
          />

          <div className="rounded-[28px] border border-[#f2c7ba]/18 bg-[#24191d] p-5 text-sm leading-6 text-[#f9e4dc]">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#f2c7ba]">
              Siguiente criterio
            </p>
            <p className="mt-3">
              Si aquí vemos un labio jugoso y el material responde bien, el siguiente paso será
              adaptar esta misma superficie a la boca real. Si aquí no se ve bien, el problema no
              es el tracking sino el objeto.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ControlSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const { label, min, max, step, value, onChange } = props;
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm text-white/90">{label}</label>
        <span className="font-mono text-xs tracking-[0.18em] text-[#f2c7ba]">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        className="mt-4 w-full accent-[#f2c7ba]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
