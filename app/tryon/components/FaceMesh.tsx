"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
} from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import productsCatalog from "@/data/products.json";
import { initFaceLandmarker } from "@/lib/face/detectLandmarks";
import { applyTone, shouldUseDirectCheekDebugRender } from "@/lib/render/applyTone";
import { createCameraFrameLoop } from "@/lib/render/mobile/cameraFrameLoop";
import { createMobileLipOilRenderer, type MobileLipOilRenderer } from "@/lib/render/mobile/applyMobileLipOilTone";
import {
  hexToRgba,
  resolveProductToneData,
  ProductToneData,
  ProductToneDefinition,
} from "@/lib/utils";
import CameraFeed from "./CameraFeed";
import Controls from "./Controls";
import { BeautyFilter } from "@/lib/render/effects/BeautyFilter";
import { createEtherealExposure } from "@/lib/render/complexion/etherealExposure";
import { createEtherealRenderer, isEtherealProduct, ETHEREAL_RENDER_REVISION, ETHEREAL_FILM_REVISION, type EtherealRenderer, type EtherealMaterial, type EtherealSurfaceState } from "@/lib/render/ethereal/renderer";
import type { EtherealLight } from "@/lib/render/ethereal/lighting";

interface FaceMeshProps {
  product: any;
  selectedVariant?: string | null;
}

type LipLandmark = { x: number; y: number; z?: number };
type LipPose = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angle: number;
};
type FacePose = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angle: number;
};
type FaceLandmarkerRunningMode = "IMAGE" | "VIDEO";
type CanonicalPoint3D = { x: number; y: number; z: number };
type LipCanonicalShape = Record<number, CanonicalPoint3D>;
type FreezeCompareState = {
  frameCanvas: HTMLCanvasElement;
  landmarks: LipLandmark[];
  capturedAtMs: number;
  width: number;
  height: number;
};
type EtherealFixture = {
  kind: "ethereal_fixture_v1";
  width: number;
  height: number;
  basePng: string;
  landmarks: LipLandmark[];
  productData?: ProductToneData;
  createdAt: string;
  userAgent?: string;
  productName?: string;
  renderState?: { exposureGain: number; lighting: EtherealLight; revision: string; material?: EtherealMaterial; surface?:EtherealSurfaceState };
};
type FixtureDebugState = {
  status: "idle" | "captured" | "loaded" | "error";
  message: string;
};

const productCatalog = productsCatalog as Record<
  string,
  ProductToneDefinition
>;

const DEFAULT_CAMERA_ZOOM = 1.34;
const ENABLE_COLOR_CHANGED_SYNC = true;
const ETHEREAL_LIVE_MATERIAL: EtherealMaterial = "film";
const ETHEREAL_LIVE_REVISION = ETHEREAL_LIVE_MATERIAL === "film" ? ETHEREAL_FILM_REVISION : ETHEREAL_RENDER_REVISION;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function getLipDebugFlags() {
  if (typeof window === "undefined") return new Set<string>();
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("lipdebug") || "").toLowerCase();
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function hasLipDebugFlag(flag: string) {
  return getLipDebugFlags().has(flag.toLowerCase());
}

function getNormalizedCheekDebugValue() {
  if (typeof window === "undefined") return "";
  return (
    new URLSearchParams(window.location.search)
      .get("cheekdebug")
      ?.toLowerCase()
      .replace(/-/g, "_")
      .trim() || ""
  );
}

function shouldUseEtherealFreezeCompare() {
  return getNormalizedCheekDebugValue() === "ethereal_freeze_compare";
}

function shouldCaptureEtherealFixture() {
  return getNormalizedCheekDebugValue() === "ethereal_fixture_capture";
}

function shouldReplayEtherealFixture() {
  return getNormalizedCheekDebugValue() === "ethereal_fixture_replay";
}

function cloneLandmarks(landmarks: LipLandmark[]) {
  return landmarks.map((point) => ({ ...point }));
}

function createCanvasFrameCopy(source: HTMLCanvasElement) {
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = source.width;
  frameCanvas.height = source.height;
  const frameCtx = frameCanvas.getContext("2d");
  if (!frameCtx) return null;
  frameCtx.drawImage(source, 0, 0);
  return frameCanvas;
}

function isValidEtherealFixture(value: any): value is EtherealFixture {
  return (
    value?.kind === "ethereal_fixture_v1" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.basePng === "string" &&
    Array.isArray(value.landmarks) &&
    value.landmarks.length > 0
  );
}

function downloadEtherealFixture(fixture: EtherealFixture) {
  const blob = new Blob([JSON.stringify(fixture)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ethereal-fixture-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadFixtureImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load fixture base PNG"));
    image.src = dataUrl;
  });
}

function drawFreezeCompareOverlay(
  ctx: CanvasRenderingContext2D,
  state: FreezeCompareState | null,
  isUsingFrozenFrame: boolean
) {
  const label = isUsingFrozenFrame && state ? "FROZEN" : "CAPTURING";
  const ageMs = state ? Math.round(performance.now() - state.capturedAtMs) : 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(10, 66, 330, 70);
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px sans-serif";
  ctx.fillText("ETHEREAL FREEZE COMPARE", 20, 86);
  ctx.fillText(`${label} frame=${state ? `${state.width}x${state.height}` : "pending"}`, 20, 104);
  if (state) ctx.fillText(`landmarks=${state.landmarks.length} age=${ageMs}ms`, 178, 104);
  ctx.fillText("renderer=legacy_desktop_original", 20, 122);
  ctx.restore();
}

function drawDebugContour(
  ctx: CanvasRenderingContext2D,
  landmarks: LipLandmark[],
  indices: number[],
  width: number,
  height: number,
  strokeStyle: string,
  lineWidth = 1.2
) {
  if (!indices.length) return;
  let started = false;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.beginPath();
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) continue;
    const x = point.x * width;
    const y = point.y * height;
    if (!started) {
      started = true;
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) {
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

type PathPoint = { x: number; y: number };

function buildClosedPath(points: PathPoint[]) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.closePath();
  return path;
}

function mapIndicesToCanvasPoints(
  landmarks: LipLandmark[] | null | undefined,
  indices: number[],
  width: number,
  height: number
) {
  if (!landmarks?.length) return [];
  const points: PathPoint[] = [];
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) return [];
    points.push({
      x: point.x * width,
      y: point.y * height,
    });
  }
  return points;
}

function isLipGraceProduct(productData: ProductToneData | null | undefined) {
  if (!productData) return false;
  const name = productData.display_name?.toLowerCase() || "";
  const type = (productData.product_type || "").toLowerCase();
  return name.includes("lip grace") || name.includes("lipstick") || type.includes("lips_inner");
}

function shouldUseLipBandClip(productData: ProductToneData | null | undefined) {
  return isLipBloomProduct(productData) || isLipGraceProduct(productData);
}

function buildLipBandClipPath(
  landmarks: LipLandmark[] | null | undefined,
  outerIndices: number[],
  innerIndices: number[],
  width: number,
  height: number
) {
  if (!landmarks?.length) return null;
  const outerPoints = mapIndicesToCanvasPoints(landmarks, outerIndices, width, height);
  if (outerPoints.length < 6) return null;

  const innerPoints = mapIndicesToCanvasPoints(landmarks, innerIndices, width, height);
  const upperInner = landmarks[13];
  const lowerInner = landmarks[14];
  const mouthGapPx =
    upperInner && lowerInner ? Math.abs(lowerInner.y - upperInner.y) * height : 0;

  // When the lips are closed or only slightly parted, the full outer contour is
  // the most stable clip. Split bands are only needed once the cavity is visible.
  if (innerPoints.length < 6 || mouthGapPx < 8) {
    return buildClosedPath(outerPoints);
  }

  const outerSplit = Math.floor(outerPoints.length / 2);
  const innerSplit = Math.floor(innerPoints.length / 2);

  const upperOuter = outerPoints.slice(0, outerSplit + 1);
  const upperInnerRev = innerPoints.slice(0, innerSplit + 1).slice().reverse();
  const lowerOuter = [
    outerPoints[outerSplit],
    ...outerPoints.slice(outerSplit + 1),
    outerPoints[0],
  ];
  const lowerInnerRev = [
    innerPoints[0],
    ...innerPoints.slice(innerSplit + 1).reverse(),
    innerPoints[innerSplit],
  ];

  const clipPath = new Path2D();
  clipPath.addPath(buildClosedPath([...upperOuter, ...upperInnerRev]));
  clipPath.addPath(buildClosedPath([...lowerOuter, ...lowerInnerRev]));
  return clipPath;
}

type FaceMeshUiState = {
  zoom: number;
  isCameraOn: boolean;
  isStreamReady: boolean;
  productData: ProductToneData | null;
  isAwaitingVariantSync: boolean;
  activeVariantId: string | null;
  activeVariantTitle: string | null;
};



function ensureCanvasPresentationStyles(canvas: HTMLCanvasElement) {
  if (canvas.style.width !== "100%") canvas.style.width = "100%";
  if (canvas.style.height !== "100%") canvas.style.height = "100%";
  if (canvas.style.zIndex !== "10") canvas.style.zIndex = "10";
  if (canvas.style.position !== "absolute") canvas.style.position = "absolute";
  if (canvas.style.pointerEvents !== "none") canvas.style.pointerEvents = "none";
}

function syncCanvasResolution(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const dpr =
    typeof window === "undefined"
      ? 1
      : Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
  const nextHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
}

function isLipBloomProduct(productData: ProductToneData | null | undefined) {
  if (!productData) return false;
  const name = productData.display_name?.toLowerCase() || "";
  const type = (productData.product_type || "").toLowerCase();
  return name.includes("lip bloom") || name.includes("oil & tint") || type.includes("lip oil");
}

const normalizeRegion = (region: number[] | number[][]): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

function getLipRegionIndices(productData: ProductToneData | null | undefined) {
  if (!productData?.regions?.lips_outer || !productData?.regions?.lips_inner) {
    return {
      outerIndices: [] as number[],
      innerIndices: [] as number[],
      allIndices: [] as number[],
    };
  }
  const outerIndices = normalizeRegion(productData.regions.lips_outer);
  const innerIndices = normalizeRegion(productData.regions.lips_inner);
  return {
    outerIndices,
    innerIndices,
    allIndices: Array.from(new Set([...outerIndices, ...innerIndices, 13, 14])),
  };
}

function getLandmarkSubsetBounds(
  landmarks: LipLandmark[],
  indices: number[]
) {
  if (!landmarks.length || !indices.length) return null;
  let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0, sumY = 0, count = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) continue;
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    sumX += point.x; sumY += point.y; count++;
  }
  if (!count) return null;
  return {
    centerX: sumX / count, centerY: sumY / count,
    width: Math.max(0.0001, maxX - minX),
    height: Math.max(0.0001, maxY - minY),
  };
}

function computeLipMotionScore(
  prev: LipLandmark[],
  next: LipLandmark[],
  outerIndices: number[]
) {
  if (!prev.length || prev.length !== next.length || !outerIndices.length) return 0;
  const prevBounds = getLandmarkSubsetBounds(prev, outerIndices);
  const nextBounds = getLandmarkSubsetBounds(next, outerIndices);
  if (!prevBounds || !nextBounds) return 0;
  // Vertical lip travel should be measured against lip height, not width.
  const widthSize = Math.max(0.02, nextBounds.width);
  const heightSize = Math.max(0.012, nextBounds.height);
  const centerShiftX =
    Math.abs(nextBounds.centerX - prevBounds.centerX) / widthSize;
  const centerShiftY =
    Math.abs(nextBounds.centerY - prevBounds.centerY) / heightSize;
  const widthShift = Math.abs(nextBounds.width - prevBounds.width) / widthSize;
  const heightShift = Math.abs(nextBounds.height - prevBounds.height) / Math.max(0.02, nextBounds.height);
  return centerShiftX + centerShiftY + widthShift * 0.7 + heightShift * 0.45;
}

function blendLipAnchorPoint(
  primary: LipLandmark | null | undefined,
  secondary: LipLandmark | null | undefined,
  secondaryWeight = 0.5
) {
  if (primary && secondary) {
    const primaryWeight = 1 - secondaryWeight;
    return {
      x: primary.x * primaryWeight + secondary.x * secondaryWeight,
      y: primary.y * primaryWeight + secondary.y * secondaryWeight,
    };
  }
  if (primary) return { x: primary.x, y: primary.y };
  if (secondary) return { x: secondary.x, y: secondary.y };
  return null;
}

function getLipAnchorLayout(outerIndices: number[], innerIndices: number[]) {
  const outerSplit = Math.floor(outerIndices.length / 2);
  const innerSplit = Math.floor(innerIndices.length / 2);
  const outerQuarter = Math.floor(outerIndices.length / 4);
  const innerQuarter = Math.floor(innerIndices.length / 4);
  const outerThreeQuarter = Math.min(
    outerIndices.length - 1,
    outerSplit + outerQuarter
  );
  const innerThreeQuarter = innerIndices.length
    ? Math.min(innerIndices.length - 1, innerSplit + innerQuarter)
    : -1;

  return {
    outerSplit,
    innerSplit,
    outerQuarter,
    innerQuarter,
    outerThreeQuarter,
    innerThreeQuarter,
    anchorIndices: Array.from(
      new Set(
        [
          outerIndices[0],
          outerIndices[outerSplit],
          outerIndices[outerQuarter],
          outerIndices[outerThreeQuarter],
          innerIndices[0],
          innerIndices[innerSplit],
          innerIndices[innerQuarter],
          innerIndices[innerThreeQuarter],
          13,
          14,
        ].filter((index): index is number => Number.isInteger(index) && index >= 0)
      )
    ),
  };
}

function getLipPose(
  landmarks: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[]
): LipPose | null {
  const bounds = getLandmarkSubsetBounds(
    landmarks,
    Array.from(new Set([...outerIndices, ...innerIndices, 13, 14]))
  );
  if (!bounds || outerIndices.length < 2) return null;

  const {
    outerSplit,
    innerSplit,
    outerQuarter,
    outerThreeQuarter,
  } = getLipAnchorLayout(outerIndices, innerIndices);
  const leftCorner = blendLipAnchorPoint(
    landmarks[outerIndices[0]],
    innerIndices.length ? landmarks[innerIndices[0]] : null,
    0.35
  );
  const rightCorner = blendLipAnchorPoint(
    landmarks[outerIndices[outerSplit]],
    innerIndices.length ? landmarks[innerIndices[innerSplit]] : null,
    0.35
  );
  const upperCenter = blendLipAnchorPoint(
    landmarks[outerIndices[outerQuarter]],
    landmarks[13],
    0.58
  );
  const lowerCenter = blendLipAnchorPoint(
    landmarks[outerIndices[outerThreeQuarter]],
    landmarks[14],
    0.58
  );

  if (!leftCorner || !rightCorner || !upperCenter || !lowerCenter) {
    return {
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      width: Math.max(0.0001, bounds.width),
      height: Math.max(0.0001, bounds.height),
      angle: 0,
    };
  }

  const angle = Math.atan2(
    rightCorner.y - leftCorner.y,
    rightCorner.x - leftCorner.x
  );
  const cornerMidX = (leftCorner.x + rightCorner.x) * 0.5;
  const cornerMidY = (leftCorner.y + rightCorner.y) * 0.5;
  const verticalMidX = (upperCenter.x + lowerCenter.x) * 0.5;
  const verticalMidY = (upperCenter.y + lowerCenter.y) * 0.5;
  const cornerWidth = Math.hypot(
    rightCorner.x - leftCorner.x,
    rightCorner.y - leftCorner.y
  );
  const verticalSpan = Math.hypot(
    lowerCenter.x - upperCenter.x,
    lowerCenter.y - upperCenter.y
  );

  return {
    centerX: cornerMidX * 0.34 + verticalMidX * 0.66,
    centerY: cornerMidY * 0.18 + verticalMidY * 0.82,
    width: Math.max(0.0001, Math.max(bounds.width, cornerWidth * 1.02)),
    height: Math.max(0.0001, Math.max(bounds.height, verticalSpan * 1.9)),
    angle,
  };
}

function getLipFrameAnchor(
  landmarks: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[]
) {
  if (!outerIndices.length) return null;

  const {
    outerSplit,
    innerSplit,
    outerQuarter,
  } = getLipAnchorLayout(outerIndices, innerIndices);
  const leftCorner = blendLipAnchorPoint(
    landmarks[outerIndices[0]],
    innerIndices.length ? landmarks[innerIndices[0]] : null,
    0.35
  );
  const rightCorner = blendLipAnchorPoint(
    landmarks[outerIndices[outerSplit]],
    innerIndices.length ? landmarks[innerIndices[innerSplit]] : null,
    0.35
  );
  const upperCenter = blendLipAnchorPoint(
    landmarks[outerIndices[outerQuarter]],
    landmarks[13],
    0.6
  );
  const outerThreeQuarter = Math.min(
    outerIndices.length - 1,
    outerSplit + outerQuarter
  );
  const lowerCenter = blendLipAnchorPoint(
    landmarks[outerIndices[outerThreeQuarter]],
    landmarks[14],
    0.6
  );

  if (!leftCorner || !rightCorner) {
    if (upperCenter && lowerCenter) {
      return {
        x: (upperCenter.x + lowerCenter.x) * 0.5,
        y: upperCenter.y * 0.28 + lowerCenter.y * 0.72,
      };
    }
    return upperCenter || lowerCenter;
  }

  const cornerMidX = (leftCorner.x + rightCorner.x) * 0.5;
  const cornerMidY = (leftCorner.y + rightCorner.y) * 0.5;
  const lipBodyMidY =
    upperCenter && lowerCenter
      ? upperCenter.y * 0.3 + lowerCenter.y * 0.7
      : upperCenter
        ? upperCenter.y
        : lowerCenter
          ? lowerCenter.y
          : cornerMidY;

  return {
    x: cornerMidX,
    y: cornerMidY * 0.08 + lipBodyMidY * 0.92,
  };
}

function getLipSimilarityFrame(
  landmarks: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[],
  width: number,
  height: number
) {
  if (!outerIndices.length) return null;
  const { outerSplit, innerSplit } = getLipAnchorLayout(outerIndices, innerIndices);
  const leftCorner = blendLipAnchorPoint(
    landmarks[outerIndices[0]],
    innerIndices.length ? landmarks[innerIndices[0]] : null,
    0.35
  );
  const rightCorner = blendLipAnchorPoint(
    landmarks[outerIndices[outerSplit]],
    innerIndices.length ? landmarks[innerIndices[innerSplit]] : null,
    0.35
  );
  const anchor = getLipFrameAnchor(landmarks, outerIndices, innerIndices);
  if (!leftCorner || !rightCorner || !anchor) return null;

  const leftX = leftCorner.x * width;
  const leftY = leftCorner.y * height;
  const rightX = rightCorner.x * width;
  const rightY = rightCorner.y * height;
  const frameWidth = Math.hypot(rightX - leftX, rightY - leftY);
  if (!Number.isFinite(frameWidth) || frameWidth < 4) return null;

  return {
    centerX: anchor.x * width,
    centerY: anchor.y * height,
    angle: Math.atan2(rightY - leftY, rightX - leftX),
    width: frameWidth,
  };
}

function correctLipFrameDrift(
  rawLandmarks: LipLandmark[],
  renderedLandmarks: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[],
  allIndices: number[],
  width: number,
  height: number
) {
  const rawFrame = getLipSimilarityFrame(
    rawLandmarks,
    outerIndices,
    innerIndices,
    width,
    height
  );
  const renderedFrame = getLipSimilarityFrame(
    renderedLandmarks,
    outerIndices,
    innerIndices,
    width,
    height
  );
  if (!rawFrame || !renderedFrame) return renderedLandmarks;

  const centerDx = rawFrame.centerX - renderedFrame.centerX;
  const centerDy = rawFrame.centerY - renderedFrame.centerY;
  const centerMismatchPx = Math.hypot(centerDx, centerDy);
  const angleDelta = normalizeAngleDelta(rawFrame.angle - renderedFrame.angle);
  const angleMismatchPx = Math.abs(angleDelta) * rawFrame.width;
  const widthMismatchPx = Math.abs(rawFrame.width - renderedFrame.width);
  const mismatchPx = Math.max(centerMismatchPx, angleMismatchPx * 0.62, widthMismatchPx * 0.45);
  const release = clamp01((mismatchPx - 1.1) / 3.0);
  if (release <= 0) return renderedLandmarks;

  const translationStrength = 0.2 + 0.8 * release;
  const rotationStrength = 0.16 + 0.84 * release;
  const scaleStrength = 0.12 + 0.76 * release;
  const correctionAngle = angleDelta * rotationStrength;
  const rawScale = rawFrame.width / Math.max(1, renderedFrame.width);
  const correctionScale = Math.max(
    0.92,
    Math.min(1.08, 1 + (rawScale - 1) * scaleStrength)
  );
  const targetCenterX = renderedFrame.centerX + centerDx * translationStrength;
  const targetCenterY = renderedFrame.centerY + centerDy * translationStrength;
  const cos = Math.cos(correctionAngle);
  const sin = Math.sin(correctionAngle);
  const corrected = renderedLandmarks.map((point) => ({ ...point }));

  for (const index of allIndices) {
    const point = renderedLandmarks[index];
    if (!point) continue;
    const px = point.x * width;
    const py = point.y * height;
    const localX = (px - renderedFrame.centerX) * correctionScale;
    const localY = (py - renderedFrame.centerY) * correctionScale;
    corrected[index] = {
      ...point,
      x: (targetCenterX + localX * cos - localY * sin) / width,
      y: (targetCenterY + localX * sin + localY * cos) / height,
    };
  }

  return corrected;
}

function normalizeAngleDelta(delta: number) {
  if (delta > Math.PI) return delta - Math.PI * 2;
  if (delta < -Math.PI) return delta + Math.PI * 2;
  return delta;
}

function smoothLipLocalPose(prev: LipPose | null, raw: LipPose): LipPose {
  if (!prev) return raw;
  const widthSize = Math.max(0.008, raw.width);
  const heightSize = Math.max(0.005, raw.height);
  const centerShiftX = Math.abs(raw.centerX - prev.centerX) / widthSize;
  const centerShiftY = Math.abs(raw.centerY - prev.centerY) / heightSize;
  const widthShift = Math.abs(raw.width - prev.width) / widthSize;
  const heightShift = Math.abs(raw.height - prev.height) / heightSize;
  const angleShift = Math.abs(normalizeAngleDelta(raw.angle - prev.angle)) / (Math.PI / 4);
  const motionScore = centerShiftX + centerShiftY * 1.2 + widthShift * 0.7 + heightShift * 0.9 + angleShift * 0.5;
  const release = clamp01((motionScore - 0.008) / 0.075);
  return {
    centerX: prev.centerX + (raw.centerX - prev.centerX) * (0.22 + 0.46 * release),
    centerY: prev.centerY + (raw.centerY - prev.centerY) * (0.22 + 0.46 * release),
    width: prev.width + (raw.width - prev.width) * (0.28 + 0.44 * release),
    height: prev.height + (raw.height - prev.height) * (0.28 + 0.44 * release),
    angle: prev.angle + normalizeAngleDelta(raw.angle - prev.angle) * (0.26 + 0.42 * release),
  };
}

function toLipLocal(point: LipLandmark, pose: LipPose) {
  const dx = point.x - pose.centerX;
  const dy = point.y - pose.centerY;
  const cos = Math.cos(-pose.angle);
  const sin = Math.sin(-pose.angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: rx / pose.width,
    y: ry / pose.height,
  };
}

function fromLipLocal(local: { x: number; y: number }, pose: LipPose) {
  const rx = local.x * pose.width;
  const ry = local.y * pose.height;
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return {
    x: pose.centerX + rx * cos - ry * sin,
    y: pose.centerY + rx * sin + ry * cos,
  };
}

function getFacePose(landmarks: LipLandmark[]): FacePose | null {
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  const nose = landmarks[1];
  const forehead = landmarks[10];
  const chin = landmarks[152];
  if (!leftTemple || !rightTemple || !nose) return null;

  const angle = Math.atan2(
    rightTemple.y - leftTemple.y,
    rightTemple.x - leftTemple.x
  );
  const templeMidX = (leftTemple.x + rightTemple.x) * 0.5;
  const templeMidY = (leftTemple.y + rightTemple.y) * 0.5;
  const width = Math.max(
    0.0001,
    Math.hypot(rightTemple.x - leftTemple.x, rightTemple.y - leftTemple.y)
  );

  const height = forehead && chin
    ? Math.max(
      0.0001,
      Math.hypot(chin.x - forehead.x, chin.y - forehead.y)
    )
    : Math.max(0.0001, width * 1.22);
  const faceVerticalMidY =
    forehead && chin ? (forehead.y + chin.y) * 0.5 : templeMidY;

  return {
    centerX: templeMidX * 0.4 + nose.x * 0.6,
    centerY: templeMidY * 0.16 + faceVerticalMidY * 0.62 + nose.y * 0.22,
    width,
    height,
    angle,
  };
}

function toFaceLocal(point: LipLandmark, pose: FacePose) {
  const dx = point.x - pose.centerX;
  const dy = point.y - pose.centerY;
  const cos = Math.cos(-pose.angle);
  const sin = Math.sin(-pose.angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: rx / pose.width,
    y: ry / pose.height,
  };
}

function fromFaceLocal(local: { x: number; y: number }, pose: FacePose) {
  const rx = local.x * pose.width;
  const ry = local.y * pose.height;
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return {
    x: pose.centerX + rx * cos - ry * sin,
    y: pose.centerY + rx * sin + ry * cos,
  };
}

function stabilizeLipLandmarks(
  prev: LipLandmark[],
  next: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[],
  allIndices: number[]
) {
  if (!prev.length || prev.length !== next.length || !outerIndices.length || !allIndices.length) {
    return next;
  }
  const motionScore = computeLipMotionScore(prev, next, outerIndices);
  if (motionScore > 0.48) {
    return next;
  }
  const prevPose = getLipPose(prev, outerIndices, innerIndices);
  const nextPose = getLipPose(next, outerIndices, innerIndices);
  if (!prevPose || !nextPose) return next;

  const anchorIndicesSet = new Set(
    getLipAnchorLayout(outerIndices, innerIndices).anchorIndices
  );
  const poseRelease = clamp01((motionScore - 0.004) / 0.04);
  const hardRelease = clamp01((motionScore - 0.09) / 0.1);
  const translationAlphaX = 0.76 + (1 - 0.76) * poseRelease;
  const translationAlphaY = 0.84 + (1 - 0.84) * hardRelease;
  const scaleAlphaX = 0.7 + (1 - 0.7) * poseRelease;
  const scaleAlphaY = 0.76 + (1 - 0.76) * hardRelease;
  const angleAlpha = 0.72 + (1 - 0.72) * poseRelease;
  const stabilizedPose: LipPose = {
    centerX:
      prevPose.centerX + (nextPose.centerX - prevPose.centerX) * translationAlphaX,
    centerY:
      prevPose.centerY + (nextPose.centerY - prevPose.centerY) * translationAlphaY,
    width: prevPose.width + (nextPose.width - prevPose.width) * scaleAlphaX,
    height: prevPose.height + (nextPose.height - prevPose.height) * scaleAlphaY,
    angle:
      prevPose.angle +
      normalizeAngleDelta(nextPose.angle - prevPose.angle) * angleAlpha,
  };

  const stabilized = next.map((point) => ({ ...point }));
  const outerSet = new Set(outerIndices);
  const innerSet = new Set(innerIndices);
  for (const index of allIndices) {
    const prevPoint = prev[index];
    const nextPoint = next[index];
    if (!prevPoint || !nextPoint) continue;

    const prevLocal = toLipLocal(prevPoint, prevPose);
    const nextLocal = toLipLocal(nextPoint, nextPose);
    const localDelta = Math.hypot(nextLocal.x - prevLocal.x, nextLocal.y - prevLocal.y);
    let alphaX = 1;
    let alphaY = 1;
    if (outerSet.has(index)) {
      if (localDelta < 0.014) {
        alphaX = 0.05;
        alphaY = 0.16;
      } else if (localDelta < 0.028) {
        alphaX = 0.16;
        alphaY = 0.28;
      } else if (localDelta < 0.05) {
        alphaX = 0.34;
        alphaY = 0.46;
      }
    } else if (innerSet.has(index) || index === 13 || index === 14) {
      if (localDelta < 0.016) {
        alphaX = 0.08;
        alphaY = 0.18;
      } else if (localDelta < 0.032) {
        alphaX = 0.22;
        alphaY = 0.32;
      } else if (localDelta < 0.058) {
        alphaX = 0.46;
        alphaY = 0.54;
      }
    }
    if (anchorIndicesSet.has(index)) {
      alphaX = Math.max(alphaX, 0.84);
      alphaY = Math.max(alphaY, 0.88);
    }
    alphaX += (1 - alphaX) * poseRelease;
    alphaY += (1 - alphaY) * Math.max(poseRelease * 0.92, hardRelease * 0.88);
    const blendedLocal = {
      x: prevLocal.x + (nextLocal.x - prevLocal.x) * alphaX,
      y: prevLocal.y + (nextLocal.y - prevLocal.y) * alphaY,
    };
    const stabilizedPoint = fromLipLocal(blendedLocal, stabilizedPose);
    stabilized[index] = {
      x: stabilizedPoint.x,
      y: stabilizedPoint.y,
      z:
        prevPoint.z == null || nextPoint.z == null
          ? nextPoint.z
          : prevPoint.z +
          (nextPoint.z - prevPoint.z) *
          ((anchorIndicesSet.has(index) ? 0.7 : 0.28) +
            (1 - (anchorIndicesSet.has(index) ? 0.7 : 0.28)) * poseRelease),
    };
  }
  return stabilized;
}

function stabilizeLipRenderLandmarks(
  landmarks: LipLandmark[],
  outerIndices: number[],
  innerIndices: number[],
  allIndices: number[],
  shapeState: LipCanonicalShape | null,
  prevSmoothedLipPose: LipPose | null,
  width: number,
  height: number
) {
  if (!landmarks.length || !outerIndices.length || !allIndices.length) {
    return {
      landmarks,
      shapeState,
      smoothedPose: prevSmoothedLipPose,
    };
  }

  const facePose = getFacePose(landmarks);
  if (!facePose) {
    return {
      landmarks,
      shapeState,
      smoothedPose: prevSmoothedLipPose,
    };
  }
  const outputFacePose = facePose;

  const outerSet = new Set(outerIndices);
  const innerSet = new Set(innerIndices);
  const anchorIndicesSet = new Set(
    getLipAnchorLayout(outerIndices, innerIndices).anchorIndices
  );
  const faceLocalLandmarks: LipLandmark[] = landmarks.map((point) => {
    const local = toFaceLocal(point, facePose);
    return {
      x: local.x,
      y: local.y,
      z: point.z,
    };
  });
  const lipLocalPose = getLipPose(faceLocalLandmarks, outerIndices, innerIndices);
  if (!lipLocalPose) {
    return {
      landmarks,
      shapeState,
      smoothedPose: prevSmoothedLipPose,
    };
  }
  const smoothedLipPose = smoothLipLocalPose(prevSmoothedLipPose, lipLocalPose);
  const nextShapeState: LipCanonicalShape = shapeState
    ? { ...shapeState }
    : {};
  const rendered = landmarks.map((point) => ({ ...point }));

  for (const index of allIndices) {
    const point = landmarks[index];
    if (!point) continue;

    const currentFaceLocal = faceLocalLandmarks[index];
    if (!currentFaceLocal) continue;
    const currentLocal = toLipLocal(currentFaceLocal, lipLocalPose);
    const previousLocal = nextShapeState[index] || {
      x: currentLocal.x,
      y: currentLocal.y,
      z: point.z ?? 0,
    };
    const localDelta = Math.hypot(
      currentLocal.x - previousLocal.x,
      currentLocal.y - previousLocal.y
    );
    let alphaX = 0.24;
    let alphaY = 0.28;

    if (outerSet.has(index)) {
      if (localDelta < 0.01) {
        alphaX = 0.08;
        alphaY = 0.12;
      } else if (localDelta < 0.024) {
        alphaX = 0.22;
        alphaY = 0.28;
      } else {
        alphaX = 0.62;
        alphaY = 0.68;
      }
    } else if (innerSet.has(index)) {
      if (localDelta < 0.012) {
        alphaX = 0.12;
        alphaY = index === 13 || index === 14 ? 0.18 : 0.16;
      } else if (localDelta < 0.028) {
        alphaX = 0.30;
        alphaY = index === 13 || index === 14 ? 0.42 : 0.38;
      } else {
        alphaX = 0.72;
        alphaY = index === 13 || index === 14 ? 0.78 : 0.74;
      }
    }

    if (index === 13 || index === 14) {
      alphaX = Math.max(alphaX, 0.42);
      alphaY = Math.max(alphaY, 0.54);
    }

    if (anchorIndicesSet.has(index)) {
      alphaX = Math.max(alphaX, 0.72);
      alphaY = Math.max(alphaY, 0.78);
    }

    const stabilizedLocal = {
      x: previousLocal.x + (currentLocal.x - previousLocal.x) * alphaX,
      y: previousLocal.y + (currentLocal.y - previousLocal.y) * alphaY,
      z: point.z ?? 0,
    };
    nextShapeState[index] = stabilizedLocal;

    const stabilizedFaceLocal = fromLipLocal(stabilizedLocal, smoothedLipPose);
    const stabilizedPoint = fromFaceLocal(stabilizedFaceLocal, outputFacePose);
    rendered[index] = {
      ...point,
      x: stabilizedPoint.x,
      y: stabilizedPoint.y,
    };
  }

  const correctedRendered = correctLipFrameDrift(
    landmarks,
    rendered,
    outerIndices,
    innerIndices,
    allIndices,
    width,
    height
  );

  return {
    landmarks: correctedRendered,
    shapeState: nextShapeState,
    smoothedPose: smoothedLipPose,
  };
}

function applyFaceFocusVignette(
  ctx: CanvasRenderingContext2D,
  landmarks: LipLandmark[],
  width: number,
  height: number
) {
  const nose = landmarks[1];
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (!nose || !leftTemple || !rightTemple) return;

  const cx = nose.x * width;
  const cy = nose.y * height;
  const faceWidth = Math.max(
    120,
    Math.abs(rightTemple.x - leftTemple.x) * width
  );
  const innerRadius = faceWidth * 0.58;
  const outerRadius = faceWidth * 1.35;

  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    innerRadius,
    cx,
    cy,
    outerRadius
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.04)");
  vignette.addColorStop(1, "rgba(0,0,0,0.2)");

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}


// Canvas fijo y simple
export default function FaceMeshComponent({
  product,
  selectedVariant,
}: FaceMeshProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const beautyFilterRef = useRef<BeautyFilter | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const landmarkerRunningModeRef = useRef<FaceLandmarkerRunningMode | null>(null);
  const sourceFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const makeupBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeCompareRef = useRef<FreezeCompareState | null>(null);
  const etherealRenderStateRef = useRef<EtherealFixture["renderState"]>(undefined);
  const fixtureCaptureDoneRef = useRef(false);
  const fixtureReplayRef = useRef<EtherealFixture | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const faceAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(DEFAULT_CAMERA_ZOOM);
  const productDataRef = useRef<ProductToneData | null>(null);
  const stabilizedLandmarksRef = useRef<LipLandmark[]>([]);
  const canonicalLipShapeRef = useRef<LipCanonicalShape | null>(null);
  const smoothedLipLocalPoseRef = useRef<LipPose | null>(null);
  const isCameraOnRef = useRef(true);
  const isStreamReadyRef = useRef(false);
  const cameraStartRequestAtRef = useRef<number | null>(null);
  const firstLandmarksMetricSentRef = useRef(false);
  const variantSyncTimeoutRef = useRef<number | null>(null);

  const [uiState, setUiState] = useState<FaceMeshUiState>({
    zoom: DEFAULT_CAMERA_ZOOM,
    isCameraOn: true,
    isStreamReady: false,
    productData: null,
    isAwaitingVariantSync: false,
    activeVariantId: null,
    activeVariantTitle: null,
  });
  const {
    zoom,
    isCameraOn,
    isStreamReady,
    productData,
    isAwaitingVariantSync,
    activeVariantId,
    activeVariantTitle,
  } = uiState;
  const lipDebugShowContours = hasLipDebugFlag("contours");
  const [comparePanelOpen, setComparePanelOpen] = useState(false);
  const etherealCompareAvailable = process.env.NODE_ENV === "development" &&
    !!productData?.display_name?.toLowerCase().includes("ethereal");
  const etherealCompareEnabled = etherealCompareAvailable &&
    (comparePanelOpen || getNormalizedCheekDebugValue() === "ethereal_compare");
  const etherealFreezeCompareEnabled = shouldUseEtherealFreezeCompare() || etherealCompareEnabled;
  const compareCaptureRequestedRef = useRef(false);
  const compareProductEnabledRef = useRef(true);
  const compareRawCameraRef = useRef(false);
  const [compareRawCamera, setCompareRawCamera] = useState(false);
  const [compareFrozen, setCompareFrozen] = useState(false);
  const [compareCapturePending, setCompareCapturePending] = useState(false);
  const [compareProductEnabled, setCompareProductEnabled] = useState(true);
  const etherealFixtureCaptureEnabled = shouldCaptureEtherealFixture();
  const etherealFixtureReplayEnabled = shouldReplayEtherealFixture();
  const [fixtureDebugState, setFixtureDebugState] = useState<FixtureDebugState>({
    status: "idle",
    message: etherealFixtureReplayEnabled
      ? "Load a Chrome fixture JSON"
      : etherealFixtureCaptureEnabled
      ? "Waiting for first pre-makeup frame"
      : "",
  });
  const patchUiState = useCallback((patch: Partial<FaceMeshUiState>) => {
    setUiState((prev) => ({ ...prev, ...patch }));
  }, []);
  const resetFreezeCompareState = useCallback(() => {
    freezeCompareRef.current = null;
    etherealRenderStateRef.current = undefined;
    compareCaptureRequestedRef.current = false;
    setCompareFrozen(false);
    setCompareCapturePending(false);
  }, []);
  const resetFixtureState = useCallback(() => {
    fixtureCaptureDoneRef.current = false;
    fixtureReplayRef.current = null;
    setFixtureDebugState({
      status: "idle",
      message: etherealFixtureReplayEnabled
        ? "Load a Chrome fixture JSON"
        : etherealFixtureCaptureEnabled
        ? "Waiting for first pre-makeup frame"
        : "",
    });
  }, [etherealFixtureCaptureEnabled, etherealFixtureReplayEnabled]);
  const resetLipRuntimeState = useCallback(() => {
    stabilizedLandmarksRef.current = [];
    canonicalLipShapeRef.current = null;
    smoothedLipLocalPoseRef.current = null;
  }, []);
  const renderFixtureReplay = useCallback(async (fixtureOverride?: EtherealFixture) => {
    const fixture = fixtureOverride ?? fixtureReplayRef.current;
    const canvas = canvasRef.current;
    const currentProductData = fixture?.productData ?? productDataRef.current;

    if (!fixture || !canvas) return;
    if (!currentProductData) {
      setFixtureDebugState({
        status: "loaded",
        message: "Fixture loaded; waiting for product data",
      });
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      syncCanvasResolution(canvas);
      ensureCanvasPresentationStyles(canvas);

      let makeupBaseCanvas = makeupBaseCanvasRef.current;
      if (!makeupBaseCanvas) {
        makeupBaseCanvas = document.createElement("canvas");
        makeupBaseCanvasRef.current = makeupBaseCanvas;
      }
      if (
        makeupBaseCanvas.width !== fixture.width ||
        makeupBaseCanvas.height !== fixture.height
      ) {
        makeupBaseCanvas.width = fixture.width;
        makeupBaseCanvas.height = fixture.height;
      }

      const makeupBaseCtx = makeupBaseCanvas.getContext("2d");
      if (!makeupBaseCtx) return;

      const image = await loadFixtureImage(fixture.basePng);
      makeupBaseCtx.setTransform(1, 0, 0, 1, 0, 0);
      makeupBaseCtx.globalCompositeOperation = "source-over";
      makeupBaseCtx.globalAlpha = 1;
      makeupBaseCtx.filter = "none";
      makeupBaseCtx.clearRect(0, 0, fixture.width, fixture.height);
      makeupBaseCtx.drawImage(image, 0, 0, fixture.width, fixture.height);

      const fixtureOil = isLipBloomProduct(currentProductData) ? await createMobileLipOilRenderer() : undefined;
      const fixtureEthereal = isEtherealProduct(currentProductData)
        ? createEtherealRenderer(fixture.renderState?.material ?? "surface") : undefined;
      try {
        applyTone(makeupBaseCtx, cloneLandmarks(fixture.landmarks), currentProductData,
          fixture.width, fixture.height, hexToRgba, 1, fixtureOil,
          fixtureEthereal ? { renderer: fixtureEthereal, source: makeupBaseCanvas,
            exposureGain: fixture.renderState?.exposureGain ?? 1,
            lightingOverride: fixture.renderState?.lighting,
            surfaceOverride: fixture.renderState?.surface,
            enabled: true, frozen: false, timestampMs: performance.now() } : undefined);
      } finally { fixtureOil?.dispose(); fixtureEthereal?.dispose(); }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const baseScale = Math.max(
        canvas.width / fixture.width,
        canvas.height / fixture.height
      );
      const scale = baseScale * zoomRef.current;
      let offsetX = (canvas.width - fixture.width * scale) / 2;
      let offsetY = (canvas.height - fixture.height * scale) / 2;
      const nose = fixture.landmarks[1];
      if (nose) {
        offsetX = canvas.width * 0.5 - nose.x * fixture.width * scale;
        offsetY = canvas.height * 0.5 - nose.y * fixture.height * scale;
        const minOffsetX = canvas.width - fixture.width * scale;
        const minOffsetY = canvas.height - fixture.height * scale;
        offsetX = Math.min(0, Math.max(minOffsetX, offsetX));
        offsetY = Math.min(0, Math.max(minOffsetY, offsetY));
      }

      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(makeupBaseCanvas, 0, 0, fixture.width, fixture.height);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fillRect(10, 142, 390, 86);
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px sans-serif";
      ctx.fillText("ETHEREAL FIXTURE REPLAY", 20, 162);
      ctx.fillText(`fixture=${fixture.width}x${fixture.height}`, 20, 180);
      ctx.fillText("camera=false mediapipe=false beauty=false", 20, 198);
      ctx.fillText(
        `productData=${fixture.productData ? "fixture" : "active_page"}`,
        20,
        216
      );
      ctx.restore();

      setFixtureDebugState({
        status: "loaded",
        message: "Fixture replay rendered",
      });
    } catch (error) {
      setFixtureDebugState({
        status: "error",
        message: error instanceof Error ? error.message : "Fixture replay failed",
      });
    }
  }, []);
  useEffect(() => {
    // Initialize BeautyFilter once when canvas is available
    if (canvasRef.current && !beautyFilterRef.current) {
      try {
        beautyFilterRef.current = new BeautyFilter(canvasRef.current);
      } catch (err) {
        console.warn("⚠ BeautyFilter initialization failed:", err);
        // If WebGL fails, continue without filter
      }
    }

    return () => {
      // Cleanup on unmount
      if (beautyFilterRef.current) {
        beautyFilterRef.current.dispose();
        beautyFilterRef.current = null;
      }
    };
  }, []);
  // Mantener zoomRef sincronizado (aunque ahora el zoom es mínimo)
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    isCameraOnRef.current = isCameraOn;
  }, [isCameraOn]);

  useEffect(() => {
    isStreamReadyRef.current = isStreamReady;
  }, [isStreamReady]);

  useEffect(() => {
    const isEmbedded =
      typeof window !== "undefined" && window.parent && window.parent !== window;
    if (!isEmbedded) {
      patchUiState({ isAwaitingVariantSync: false });
      return;
    }

    patchUiState({
      isAwaitingVariantSync: true,
      productData: null,
    });
    productDataRef.current = null;
    if (variantSyncTimeoutRef.current !== null) {
      window.clearTimeout(variantSyncTimeoutRef.current);
    }
    variantSyncTimeoutRef.current = window.setTimeout(() => {
      variantSyncTimeoutRef.current = null;
      patchUiState({ isAwaitingVariantSync: false });
    }, 400);

    return () => {
      if (variantSyncTimeoutRef.current !== null) {
        window.clearTimeout(variantSyncTimeoutRef.current);
        variantSyncTimeoutRef.current = null;
      }
    };
  }, []);

  // Resolver datos de tono del producto
  useEffect(() => {
    if (!product) return;
    if (isAwaitingVariantSync) return;
    if (activeVariantId || activeVariantTitle) return;

    const variantTitle =
      selectedVariant ||
      product?.selectedVariant?.title ||
      product?.variants?.edges?.[0]?.node?.title;

    const resolved = resolveProductToneData(
      product,
      productCatalog,
      product?.selectedVariant || selectedVariant
    );

    if (resolved) {
      patchUiState({ productData: resolved });
    } else {
      console.warn(
        "⚠️ No matching product tone data for",
        variantTitle
      );
      patchUiState({ productData: null });
    }
  }, [product, selectedVariant, activeVariantId, activeVariantTitle, isAwaitingVariantSync, patchUiState]);

  useEffect(() => {
    if (etherealFixtureReplayEnabled) return;
    if (!productData || !isStreamReady) return;

    let isMounted = true;
    let lipOilRenderer: MobileLipOilRenderer | undefined;
    let etherealRenderer: EtherealRenderer | undefined;
    const etherealExposure = createEtherealExposure();
    const preferImageLandmarker = true;
    let frameErrorReported = false;
    const frameLoop = createCameraFrameLoop({
      video: () => videoRef.current,
      frozen: () => !!(etherealCompareEnabled && freezeCompareRef.current),
      draw: timestamp => detectFace(timestamp),
      onError: error => {
        // A failed frame must not permanently stop camera presentation.
        if (!frameErrorReported) console.error("❌ Try-on frame failed:", error);
        frameErrorReported = true;
      },
    });

    const detectFace = (frameTimestampMs?: number) => {
      if (!isMounted) return;

      if (
        !videoRef.current ||
        !canvasRef.current ||
        !landmarkerRef.current
      ) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      let sourceCanvas = sourceFrameCanvasRef.current;

      if (!ctx) {
        return;
      }
      if (!sourceCanvas) {
        sourceCanvas = document.createElement("canvas");
        sourceFrameCanvasRef.current = sourceCanvas;
      }
      const sourceCtx = sourceCanvas.getContext("2d");
      if (!sourceCtx) {
        return;
      }

      // Esperar a que el vídeo tenga metadata
      if (!video.videoWidth || !video.videoHeight) {
        return;
      }

      // Opcional: evitar procesar el mismo frame dos veces. En freeze compare
      // queremos repintar la misma entrada aunque el vídeo no avance.
      if (
        !etherealFreezeCompareEnabled &&
        frameTimestampMs == null &&
        video.currentTime === lastVideoTimeRef.current
      ) {
        return;
      }
      lastVideoTimeRef.current = video.currentTime;

      // Match the backing store to the real iframe viewport so Shopify gallery
      // aspect ratios do not stretch the rendered frame on some products.
      // ensureStyles AFTER syncResolution so setting canvas.width never resets the CSS display size.
      syncCanvasResolution(canvas);
      ensureCanvasPresentationStyles(canvas);

      const frozenState = etherealFreezeCompareEnabled
        ? freezeCompareRef.current
        : null;
      const isUsingFrozenFrame = Boolean(frozenState);
      const frameWidth = frozenState?.width ?? video.videoWidth;
      const frameHeight = frozenState?.height ?? video.videoHeight;

      if (sourceCanvas.width !== frameWidth || sourceCanvas.height !== frameHeight) {
        sourceCanvas.width = frameWidth;
        sourceCanvas.height = frameHeight;
      }
      sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
      sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);

      let rawLandmarks: LipLandmark[] | null = null;
      if (frozenState) {
        sourceCtx.drawImage(frozenState.frameCanvas, 0, 0, frameWidth, frameHeight);
        rawLandmarks = cloneLandmarks(frozenState.landmarks);
      } else {
        sourceCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        const detectionTimestampMs = frameTimestampMs ?? video.currentTime * 1000;
        const results = preferImageLandmarker
          ? landmarkerRef.current.detect(sourceCanvas)
          : landmarkerRef.current.detectForVideo(
            sourceCanvas,
            detectionTimestampMs
          );
        if (!isMounted) return;

        rawLandmarks = results.faceLandmarks?.[0] || null;
        if (
          etherealFreezeCompareEnabled &&
          (!etherealCompareEnabled || compareCaptureRequestedRef.current) &&
          rawLandmarks &&
          !freezeCompareRef.current
        ) {
          const frameCopy = createCanvasFrameCopy(sourceCanvas);
          if (frameCopy) {
            freezeCompareRef.current = {
              frameCanvas: frameCopy,
              landmarks: cloneLandmarks(rawLandmarks),
              capturedAtMs: performance.now(),
              width: sourceCanvas.width,
              height: sourceCanvas.height,
            };
            if (etherealCompareEnabled) {
              compareCaptureRequestedRef.current = false;
              setCompareCapturePending(false);
              setCompareFrozen(true);
            }
          }
        }

        if (
          !firstLandmarksMetricSentRef.current &&
          results.faceLandmarks &&
          results.faceLandmarks.length > 0
        ) {
          firstLandmarksMetricSentRef.current = true;
          const sinceStartMs =
            cameraStartRequestAtRef.current == null
              ? null
              : Math.round(performance.now() - cameraStartRequestAtRef.current);
          window.parent?.postMessage(
            {
              type: "TRYON_METRIC",
              stage: "first_landmarks",
              sinceStartMs,
            },
            "*"
          );
        }
      }
      const currentProductData = productDataRef.current;
      if (!currentProductData) {
        return;
      }
      const isLipBloom = isLipBloomProduct(currentProductData);
      const isEthereal = isEtherealProduct(currentProductData);
      const lipRegions = getLipRegionIndices(currentProductData);
      const hasLipRegions =
        lipRegions.outerIndices.length > 0 &&
        lipRegions.innerIndices.length > 0 &&
        lipRegions.allIndices.length > 0;
      const sourceLandmarks = rawLandmarks;

      const trackedLandmarks = isLipBloom && lipOilRenderer
        ? lipOilRenderer.track(sourceCtx, sourceLandmarks, frameWidth, frameHeight, frameTimestampMs ?? video.currentTime * 1000)
        : sourceLandmarks
        ? hasLipRegions
          ? stabilizeLipLandmarks(
            stabilizedLandmarksRef.current,
            sourceLandmarks,
            lipRegions.outerIndices,
            lipRegions.innerIndices,
            lipRegions.allIndices
          )
          : sourceLandmarks
        : null;
      const shouldStabilizeRenderGeometry =
        !!trackedLandmarks && hasLipRegions && !isLipBloom;
      const renderLipResult = shouldStabilizeRenderGeometry
        ? stabilizeLipRenderLandmarks(
          trackedLandmarks || sourceLandmarks,
          lipRegions.outerIndices,
          lipRegions.innerIndices,
          lipRegions.allIndices,
          canonicalLipShapeRef.current,
          smoothedLipLocalPoseRef.current,
          frameWidth,
          frameHeight
        )
        : null;
      const landmarks =
        renderLipResult?.landmarks || trackedLandmarks || rawLandmarks;
      canonicalLipShapeRef.current = renderLipResult?.shapeState || null;
      smoothedLipLocalPoseRef.current = renderLipResult?.smoothedPose || null;

      // Limpiar y dibujar el frame de cámara 1:1
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const baseScale = Math.max(
        canvas.width / frameWidth,
        canvas.height / frameHeight
      );
      const scale = baseScale * zoomRef.current;
      const baseOffsetX =
        (canvas.width - frameWidth * scale) / 2;
      const baseOffsetY =
        (canvas.height - frameHeight * scale) / 2;
      let offsetX = baseOffsetX;
      let offsetY = baseOffsetY;
      let frameTargetX = canvas.width * 0.5;
      let frameTargetY = canvas.height * 0.5;
      if (rawLandmarks) {
        let nextAnchor: { x: number; y: number } | null = null;
        let anchorFollowAlphaX = 0.34;
        let anchorFollowAlphaY = 0.34;

        if (isLipBloom) {
          if (landmarks && hasLipRegions) {
            const lipAnchor = getLipFrameAnchor(
              landmarks,
              lipRegions.outerIndices,
              lipRegions.innerIndices
            );
            if (lipAnchor) {
              nextAnchor = {
                x: lipAnchor.x * frameWidth,
                y: lipAnchor.y * frameHeight,
              };
              anchorFollowAlphaX = 0.84;
              anchorFollowAlphaY = 0.92;
            }
          }
          // Keep last lip anchor instead of snapping to nose when a single
          // lip-anchor frame is invalid; this avoids large vertical jumps.
          if (!nextAnchor && faceAnchorRef.current) {
            nextAnchor = {
              x: faceAnchorRef.current.x,
              y: faceAnchorRef.current.y,
            };
            anchorFollowAlphaX = 1;
            anchorFollowAlphaY = 1;
          }
          if (!nextAnchor) {
            const nose = rawLandmarks[1];
            if (nose) {
              nextAnchor = {
                x: nose.x * frameWidth,
                y: nose.y * frameHeight,
              };
            }
          }
        } else {
          const nose = rawLandmarks[1];
          if (nose) {
            nextAnchor = {
              x: nose.x * frameWidth,
              y: nose.y * frameHeight,
            };
          }
        }

        if (nextAnchor) {
          if (etherealFreezeCompareEnabled) {
            anchorFollowAlphaX = 1;
            anchorFollowAlphaY = 1;
          }
          const prevAnchor = faceAnchorRef.current;
          const smoothedAnchor = prevAnchor
            ? {
              x:
                prevAnchor.x +
                (nextAnchor.x - prevAnchor.x) * anchorFollowAlphaX,
              y:
                prevAnchor.y +
                (nextAnchor.y - prevAnchor.y) * anchorFollowAlphaY,
            }
            : nextAnchor;

          faceAnchorRef.current = smoothedAnchor;

          const rawTargetOffsetX = frameTargetX - smoothedAnchor.x * scale;
          const rawTargetOffsetY = frameTargetY - smoothedAnchor.y * scale;
          if (hasLipRegions) {
            // For lip products, disable frame auto-centering completely.
            // The mask should track landmarks on a fixed camera frame to avoid
            // "pursuit" artifacts from anchor smoothing.
            offsetX = baseOffsetX;
            offsetY = baseOffsetY;
          } else {
            offsetX = rawTargetOffsetX;
            offsetY = rawTargetOffsetY;
          }

          const minOffsetX = canvas.width - frameWidth * scale;
          const minOffsetY = canvas.height - frameHeight * scale;
          offsetX = Math.min(0, Math.max(minOffsetX, offsetX));
          offsetY = Math.min(0, Math.max(minOffsetY, offsetY));
        }
      } else {
        faceAnchorRef.current = null;
      }

      if (!trackedLandmarks) {
        resetLipRuntimeState();
      } else {
        stabilizedLandmarksRef.current = trackedLandmarks;
      }

      // ===== BEAUTY FILTER INPUT PIPELINE =====
      // Apply the beauty/selfie-camera treatment BEFORE any makeup rendering.
      // This keeps gloss reflections sharp while integrating the lip oil into
      // a softer premium-looking skin environment.
      let cameraFrameCanvas: HTMLCanvasElement = sourceCanvas;

      const exposureGain = isEthereal
        ? etherealExposure.update(sourceCanvas, rawLandmarks, performance.now(), isUsingFrozenFrame)
        : 1;
      const compareOriginalCamera = etherealCompareEnabled && compareRawCameraRef.current;
      if (beautyFilterRef.current && !isLipBloom && !isEthereal) {
        try {
          beautyFilterRef.current.processFrame(sourceCanvas);

          cameraFrameCanvas =
            beautyFilterRef.current.getRenderedWebGLCanvas();
        } catch (err) {
          console.warn("⚠ BeautyFilter process failed:", err);
          cameraFrameCanvas = sourceCanvas;
        }
      }

      let makeupBaseCanvas = makeupBaseCanvasRef.current;
      if (!makeupBaseCanvas) {
        makeupBaseCanvas = document.createElement("canvas");
        makeupBaseCanvasRef.current = makeupBaseCanvas;
      }
      if (
        makeupBaseCanvas.width !== frameWidth ||
        makeupBaseCanvas.height !== frameHeight
      ) {
        makeupBaseCanvas.width = frameWidth;
        makeupBaseCanvas.height = frameHeight;
      }
      const makeupBaseCtx = makeupBaseCanvas.getContext("2d");
      if (!makeupBaseCtx) {
        return;
      }

      makeupBaseCtx.setTransform(1, 0, 0, 1, 0, 0);
      makeupBaseCtx.globalCompositeOperation = "source-over";
      makeupBaseCtx.globalAlpha = 1;
      makeupBaseCtx.filter = "none";
      makeupBaseCtx.imageSmoothingEnabled = true;
      makeupBaseCtx.imageSmoothingQuality = "high";
      makeupBaseCtx.clearRect(0, 0, frameWidth, frameHeight);
      makeupBaseCtx.drawImage(cameraFrameCanvas, 0, 0, frameWidth, frameHeight);

      // Lip Bloom owns pigment and coating in Three on the same camera frame.
      // Other families retain their calibrated canvas finishes.
      if (etherealFixtureCaptureEnabled && landmarks && !fixtureCaptureDoneRef.current) {
        fixtureCaptureDoneRef.current = true;
        const fixture: EtherealFixture = {
          kind: "ethereal_fixture_v1",
          width: frameWidth,
          height: frameHeight,
          basePng: makeupBaseCanvas.toDataURL("image/png"),
          landmarks: cloneLandmarks(landmarks),
          productData: currentProductData,
          createdAt: new Date().toISOString(),
          userAgent:
            typeof navigator === "undefined" ? undefined : navigator.userAgent,
          productName: currentProductData.display_name,
        };
        (window as any).__idonyEtherealFixture = fixture;
        downloadEtherealFixture(fixture);
        setFixtureDebugState({
          status: "captured",
          message: `Downloaded fixture ${fixture.width}x${fixture.height}`,
        });
      }

      let toneYawFade = 1;
      if (isEthereal && etherealRenderer) {
        // The Ethereal renderer owns camera + coating + one exposure transform.
        // Draw even without a face: camera presentation must continue on loss.
        applyTone(makeupBaseCtx, rawLandmarks || [], currentProductData,
          frameWidth, frameHeight, hexToRgba, 1, undefined, {
            renderer: etherealRenderer, source: sourceCanvas,
            exposureGain: compareOriginalCamera ? 1 : exposureGain,
            enabled: !etherealCompareEnabled || compareProductEnabledRef.current,
            frozen: isUsingFrozenFrame, timestampMs: performance.now(),
            onRendered: (lighting) => {
              etherealRenderStateRef.current = {
                exposureGain: compareOriginalCamera ? 1 : exposureGain,
                lighting: { ...lighting, direction: [...lighting.direction] },
                revision: etherealRenderer.revision,
                material: etherealRenderer.material,
                surface: etherealRenderer.surfaceState,
              };
            },
          });
      } else if (landmarks && (!etherealCompareEnabled || compareProductEnabledRef.current)) {
        // Derive yaw from the same smoothed landmarks used for centering/rendering
        // so gloss fade and lip geometry do not jitter against the frame anchor.
        const leftTemple = landmarks[234];
        const rightTemple = landmarks[454];
        const noseCenterPoint = landmarks[1];
        const signedFaceYaw =
          leftTemple && rightTemple && noseCenterPoint
            ? (() => {
              const faceWidth = Math.abs(rightTemple.x - leftTemple.x);
              if (faceWidth < 0.01) return 0;
              const noseCenter = (leftTemple.x + rightTemple.x) / 2;
              return (noseCenterPoint.x - noseCenter) / (faceWidth / 2);
            })()
            : 0;
        const faceYaw = Math.abs(signedFaceYaw);
        const yawFade = Math.max(0, Math.min(1, 1 - (faceYaw - 0.15) / 0.25));
        toneYawFade = yawFade;
        const lipBandClipPath =
          shouldUseLipBandClip(currentProductData) && hasLipRegions
            ? buildLipBandClipPath(
              landmarks,
              lipRegions.outerIndices,
              lipRegions.innerIndices,
              frameWidth,
              frameHeight
            )
            : null;

        const useDirectCheekDebug = shouldUseDirectCheekDebugRender(currentProductData);

        if (isLipBloom) {
          applyTone(makeupBaseCtx, landmarks, currentProductData, frameWidth, frameHeight, hexToRgba, yawFade, lipOilRenderer);
        } else if (useDirectCheekDebug) {
          // Debug direct mode paints on the final canvas below.
        } else if (lipBandClipPath) {
          makeupBaseCtx.save();
          makeupBaseCtx.clip(lipBandClipPath);
          applyTone(
            makeupBaseCtx,
            landmarks,
            currentProductData,
            frameWidth,
            frameHeight,
            hexToRgba,
            yawFade,
          );
          makeupBaseCtx.restore();
        } else {
          applyTone(
            makeupBaseCtx,
            landmarks,
            currentProductData,
            frameWidth,
            frameHeight,
            hexToRgba,
            yawFade,
          );
        }
      }

      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      // CRITICAL FIX: Disable native browser contrast filter
      // BeautyFilter already applies calibrated contrast curves internally.
      // Applying contrast(1.055) here causes double contrast multiplication → white nuclear burn.
      // Keep final canvas filters off; product renderers already manage their own blending.
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1.0;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(makeupBaseCanvas, 0, 0, frameWidth, frameHeight);
      if (rawLandmarks && currentProductData && shouldUseDirectCheekDebugRender(currentProductData)) {
        applyTone(
          ctx,
          rawLandmarks,
          currentProductData,
          frameWidth,
          frameHeight,
          hexToRgba,
          toneYawFade,
        );
      }
      if (lipDebugShowContours && rawLandmarks && hasLipRegions) {
        drawDebugContour(
          ctx,
          rawLandmarks,
          lipRegions.outerIndices,
          frameWidth,
          frameHeight,
          "#76ff03",
          1.8 / Math.max(0.7, scale)
        );
        drawDebugContour(
          ctx,
          rawLandmarks,
          lipRegions.innerIndices,
          frameWidth,
          frameHeight,
          "#76ff03",
          1.2 / Math.max(0.7, scale)
        );
        if (landmarks !== rawLandmarks) {
          drawDebugContour(
            ctx,
            landmarks,
            lipRegions.outerIndices,
            frameWidth,
            frameHeight,
            "#ff4081",
            1.8 / Math.max(0.7, scale)
          );
          drawDebugContour(
            ctx,
            landmarks,
            lipRegions.innerIndices,
            frameWidth,
            frameHeight,
            "#40c4ff",
            1.2 / Math.max(0.7, scale)
          );
        }
      }
      if (etherealFreezeCompareEnabled && !etherealCompareEnabled) {
        drawFreezeCompareOverlay(ctx, freezeCompareRef.current, isUsingFrozenFrame);
      }
      ctx.filter = "none";

    };

    const init = async () => {
      try {
        const desiredRunningMode: FaceLandmarkerRunningMode = preferImageLandmarker
          ? "IMAGE"
          : "VIDEO";
        if (
          !landmarkerRef.current ||
          landmarkerRunningModeRef.current !== desiredRunningMode
        ) {
          landmarkerRef.current = await initFaceLandmarker(desiredRunningMode);
          landmarkerRunningModeRef.current = desiredRunningMode;
          lastVideoTimeRef.current = -1;
          resetLipRuntimeState();
        }
        if (!isMounted) return;
        if (isEtherealProduct(productData)) {
          etherealRenderer = createEtherealRenderer(ETHEREAL_LIVE_MATERIAL);
        }
        if (isLipBloomProduct(productData)) {
          const prepared = await createMobileLipOilRenderer();
          if (!isMounted) { prepared.dispose(); return; }
          lipOilRenderer = prepared;
        }
        if (isMounted) frameLoop.start();
      } catch (error) {
        console.error("❌ FaceMesh init failed:", error);
        if (isMounted) {
          patchUiState({ isCameraOn: false, isStreamReady: false });
          window.parent?.postMessage({ type: "TRYON_CAMERA_ERROR", message:
            error instanceof Error ? error.message : "No se pudo preparar el render." }, "*");
        }
      }
    };

    init();

    return () => {
      isMounted = false;
      lipOilRenderer?.dispose();
      etherealRenderer?.dispose();
      frameLoop.stop();
    };
  }, [
    etherealFixtureCaptureEnabled,
    etherealFreezeCompareEnabled,
    etherealCompareEnabled,
    etherealFixtureReplayEnabled,
    isStreamReady,
    lipDebugShowContours,
    productData,
    resetLipRuntimeState,
  ]);

  useEffect(() => {
    productDataRef.current = productData;
  }, [productData]);

  useEffect(() => {
    resetFreezeCompareState();
  }, [etherealFreezeCompareEnabled, productData, resetFreezeCompareState]);

  useEffect(() => {
    resetFixtureState();
  }, [resetFixtureState]);

  useEffect(() => {
    if (!etherealFixtureReplayEnabled) return;
    void renderFixtureReplay();
  }, [etherealFixtureReplayEnabled, productData, renderFixtureReplay, zoom]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      let payload: any = event.data;

      // Shopify or other scripts might send strings; attempt to parse JSON
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      if (!payload || typeof payload !== "object") return;

      if (payload.type === "TRYON_STOP_CAMERA") {
        cameraStartRequestAtRef.current = null;
        firstLandmarksMetricSentRef.current = false;
        faceAnchorRef.current = null;
        resetFreezeCompareState();
        resetLipRuntimeState();
        patchUiState({
          isCameraOn: false,
          isStreamReady: false,
        });
        return;
      }

      if (payload.type === "TRYON_START_CAMERA") {
        cameraStartRequestAtRef.current = performance.now();
        firstLandmarksMetricSentRef.current = false;
        faceAnchorRef.current = null;
        resetFreezeCompareState();
        resetLipRuntimeState();
        patchUiState({
          isAwaitingVariantSync: true,
          productData: null,
        });
        productDataRef.current = null;
        if (variantSyncTimeoutRef.current !== null) {
          window.clearTimeout(variantSyncTimeoutRef.current);
        }
        variantSyncTimeoutRef.current = window.setTimeout(() => {
          variantSyncTimeoutRef.current = null;
          patchUiState({ isAwaitingVariantSync: false });
        }, 400);
        if (isCameraOnRef.current && isStreamReadyRef.current) {
          window.parent?.postMessage(
            { type: "TRYON_METRIC", stage: "already_ready_on_start_cmd" },
            "*"
          );
          window.parent?.postMessage({ type: "TRYON_READY" }, "*");
          return;
        }
        window.parent?.postMessage(
          { type: "TRYON_METRIC", stage: "start_cmd_received" },
          "*"
        );
        patchUiState({
          isStreamReady: false,
          isCameraOn: true,
        });
        return;
      }

      if (payload.type === "COLOR_CHANGED") {
        if (!ENABLE_COLOR_CHANGED_SYNC) return;
        const incomingVariantId = payload.variantId
          ? String(payload.variantId)
          : null;
        const incomingVariantTitle = payload.variantTitle
          ? String(payload.variantTitle)
          : null;
        if (!incomingVariantId && !incomingVariantTitle) return;
        if (variantSyncTimeoutRef.current !== null) {
          window.clearTimeout(variantSyncTimeoutRef.current);
          variantSyncTimeoutRef.current = null;
        }
        patchUiState({ isAwaitingVariantSync: false });

        // Shopify re-open flow can send COLOR_CHANGED without TRYON_START_CAMERA.
        // If camera was stopped on close, wake it up here so the iframe can become ready again.
        if (!isCameraOnRef.current) {
          cameraStartRequestAtRef.current = performance.now();
          firstLandmarksMetricSentRef.current = false;
          faceAnchorRef.current = null;
          resetFreezeCompareState();
          resetLipRuntimeState();
          patchUiState({
            isStreamReady: false,
            isCameraOn: true,
          });
        }

        (window as any).__lastVariant = {
          id: incomingVariantId,
          title: incomingVariantTitle,
        };
        patchUiState({
          ...(incomingVariantId ? { activeVariantId: incomingVariantId } : {}),
          ...(incomingVariantTitle ? { activeVariantTitle: incomingVariantTitle } : {}),
        });
        window.parent?.postMessage(
          {
            type: "TRYON_COLOR_ACK",
            variantId: incomingVariantId,
            variantTitle: incomingVariantTitle,
          },
          "*"
        );
      }
    }

    window.addEventListener("message", handleMessage, false);
    return () => {
      window.removeEventListener("message", handleMessage, false);
    };
  }, [patchUiState, resetFreezeCompareState, resetLipRuntimeState]); // 👈 runs once, just sets up the listener in shopify for color swap

  // When Shopify sends new variant → update the tone data
  useEffect(() => {
    if (!product || (!activeVariantId && !activeVariantTitle)) return;

    const normalizeVariantId = (id: any) => {
      if (!id) return "";
      const str = String(id);
      const match = str.match(/(\d+)$/);
      return match ? match[1] : str;
    };

    const targetId = activeVariantId
      ? normalizeVariantId(activeVariantId)
      : "";

    // find the variant object by ID first
    const variantNode =
      targetId &&
      product?.variants?.edges?.find(
        (v: any) => {
          const vid = normalizeVariantId(v?.node?.id);
          return vid === targetId;
        }
      )?.node;

    let resolved: ProductToneData | null = null;
    let title = variantNode?.title || activeVariantTitle || "";

    if (variantNode) {
      resolved = resolveProductToneData(
        { ...product, selectedVariant: variantNode },
        productCatalog,
        variantNode
      );
    } else if (activeVariantTitle) {
      console.warn("⚠️ Variant node not found for ID:", activeVariantId);
      resolved = resolveProductToneData(
        product,
        productCatalog,
        activeVariantTitle
      );
    }

    if (resolved) {
      productDataRef.current = resolved;
      patchUiState({ productData: resolved });
    } else {
      console.warn("⚠️ No tone data found for variant:", title);
    }
  }, [activeVariantId, activeVariantTitle, product, patchUiState]);

  // Callbacks de cámara
  const handleStreamReady = useCallback(() => {
    patchUiState({ isStreamReady: true });
    lastVideoTimeRef.current = -1;
    faceAnchorRef.current = null;
    resetFreezeCompareState();
    resetLipRuntimeState();
    const sinceStartMs =
      cameraStartRequestAtRef.current == null
        ? null
        : Math.round(performance.now() - cameraStartRequestAtRef.current);
    window.parent?.postMessage(
      {
        type: "TRYON_METRIC",
        stage: "stream_ready",
        sinceStartMs,
      },
      "*"
    );
    // 🔔 Tell Shopify: camera + canvas are ready
    window.parent?.postMessage({ type: "TRYON_READY" }, "*");
  }, [patchUiState, resetFreezeCompareState, resetLipRuntimeState]);

  const handleStreamStopped = useCallback(() => {
    patchUiState({ isStreamReady: false });
    faceAnchorRef.current = null;
    resetFreezeCompareState();
    resetLipRuntimeState();
  }, [patchUiState, resetFreezeCompareState, resetLipRuntimeState]);

  const handleStreamError = useCallback((error: Error) => {
    patchUiState({ isStreamReady: false });
    faceAnchorRef.current = null;
    resetFreezeCompareState();
    resetLipRuntimeState();
    window.parent?.postMessage(
      {
        type: "TRYON_METRIC",
        stage: "stream_error",
        message: error?.message || "Failed to access camera",
      },
      "*"
    );
    window.parent?.postMessage(
      {
        type: "TRYON_CAMERA_ERROR",
        message: error?.message || "Failed to access camera",
      },
      "*"
    );
  }, [patchUiState, resetFreezeCompareState, resetLipRuntimeState]);

  const stopCamera = useCallback(() => {
    cameraStartRequestAtRef.current = null;
    firstLandmarksMetricSentRef.current = false;
    faceAnchorRef.current = null;
    patchUiState({
      isCameraOn: false,
      isStreamReady: false,
    });
    resetLipRuntimeState();
  }, [patchUiState, resetLipRuntimeState]);

  const closeTryOn = useCallback(() => {
    stopCamera();
    window.parent?.postMessage({ type: "TRYON_CLOSE" }, "*");
  }, [stopCamera]);

  const zoomIn = useCallback(
    () =>
      setUiState((prev) => ({
        ...prev,
        zoom: Math.min(prev.zoom + 0.1, 2.2),
      })),
    []
  );
  const zoomOut = useCallback(
    () =>
      setUiState((prev) => ({
        ...prev,
        zoom: Math.max(prev.zoom - 0.1, 1),
      })),
    []
  );

  const handleFixtureReplayFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      try {
        const parsed = JSON.parse(await file.text());
        if (!isValidEtherealFixture(parsed)) {
          throw new Error("Invalid ethereal fixture JSON");
        }
        fixtureReplayRef.current = parsed;
        setFixtureDebugState({
          status: "loaded",
          message: `Loaded ${file.name}`,
        });
        await renderFixtureReplay(parsed);
      } catch (error) {
        setFixtureDebugState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load fixture",
        });
      }
    },
    [renderFixtureReplay]
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* VIDEO (invisible, only used for detection) */}
      <CameraFeed
        videoRef={videoRef}
        isActive={!etherealFixtureReplayEnabled && isCameraOn}
        onStreamReady={handleStreamReady}
        onStreamStopped={handleStreamStopped}
        onStreamError={handleStreamError}
        className="absolute inset-0 w-full h-full object-cover opacity-0 z-0"
      />

      {/* CANVAS (visible layer with makeup) */}
      <canvas
        ref={canvasRef}
        className="
        absolute inset-0
        w-full h-full
        pointer-events-none 
        z-10
      "
      />
      {/* CONTROLS (must be ABOVE canvas) */}
      <Controls
        className="controls absolute top-4 right-4 z-50 pointer-events-auto flex items-center gap-3"
        onClose={closeTryOn}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />

      <div className="tryon-whisper-copy" aria-hidden="true">
        <div className="tryon-whisper-copy__text">
          ¡Sonríe!
        </div>
      </div>

      {etherealCompareAvailable && !etherealCompareEnabled && isCameraOn && (
        <button type="button"
          className="ethereal-compare-launch"
          onClick={() => setComparePanelOpen(true)}>
          Comparar Ethereal
        </button>
      )}

      {etherealCompareEnabled && isCameraOn && (
        <div className="ethereal-compare-panel">
          <div className="font-semibold">Ethereal · {ETHEREAL_LIVE_REVISION}</div>
          <div className="my-2" role="status">
            {compareFrozen ? "Imagen congelada" : compareCapturePending ? "Esperando rostro…" : "Cámara en directo"}
            {compareFrozen && (compareRawCamera ? " · Cámara original" : compareProductEnabled ? " · CON Ethereal · exposición compensada" : " · SIN Ethereal · exposición compensada")}
          </div>
          <button type="button" className="rounded border px-3 py-2" disabled={compareCapturePending}
            onClick={() => {
              if (compareFrozen) resetFreezeCompareState();
              else {
                compareCaptureRequestedRef.current = true;
                setCompareCapturePending(true);
              }
            }}>
            {compareFrozen ? "Volver al directo" : "Congelar imagen"}
          </button>
          <button type="button" className="mt-2 block rounded border px-3 py-2 disabled:opacity-40"
            disabled={!compareFrozen} aria-pressed={compareProductEnabled}
            onClick={() => {
              compareRawCameraRef.current = false;
              setCompareRawCamera(false);
              const enabled = !compareProductEnabledRef.current;
              compareProductEnabledRef.current = enabled;
              setCompareProductEnabled(enabled);
            }}>
            {compareProductEnabled ? "Ver SIN Ethereal" : "Ver CON Ethereal"}
          </button>
          <button type="button" disabled={!compareFrozen} aria-pressed={compareRawCamera}
            onClick={() => {
              const raw = !compareRawCameraRef.current;
              compareRawCameraRef.current = raw;
              setCompareRawCamera(raw);
              compareProductEnabledRef.current = false;
              setCompareProductEnabled(false);
            }}>
            {compareRawCamera ? "Ver exposición compensada" : "Ver cámara original"}
          </button>
          <button type="button" disabled={!compareFrozen}
            onClick={() => {
              const frozen = freezeCompareRef.current;
              if (!frozen || !productDataRef.current) return;
              downloadEtherealFixture({
                kind: "ethereal_fixture_v1", width: frozen.width, height: frozen.height,
                basePng: frozen.frameCanvas.toDataURL("image/png"),
                landmarks: cloneLandmarks(frozen.landmarks), productData: productDataRef.current,
                renderState: etherealRenderStateRef.current,
                createdAt: new Date().toISOString(),
                productName: productDataRef.current.display_name,
              });
            }}>
            Guardar prueba para revisar
          </button>
        </div>
      )}

      {etherealFixtureReplayEnabled && (
        <div className="absolute left-4 top-4 z-50 max-w-sm rounded-md bg-black/80 p-3 text-xs text-white shadow-lg">
          <div className="mb-2 font-semibold">Ethereal fixture replay</div>
          <input
            type="file"
            accept="application/json"
            onChange={handleFixtureReplayFileChange}
            className="block w-full text-xs"
          />
          <div className="mt-2 opacity-80">{fixtureDebugState.message}</div>
        </div>
      )}

      {etherealFixtureCaptureEnabled && (
        <div className="absolute left-4 top-4 z-50 max-w-sm rounded-md bg-black/80 p-3 text-xs text-white shadow-lg">
          <div className="font-semibold">Ethereal fixture capture</div>
          <div className="mt-1 opacity-80">{fixtureDebugState.message}</div>
        </div>
      )}

      {/* REACTIVATE CAMERA BUTTON */}
      {!etherealFixtureReplayEnabled && !isCameraOn && (
        <button
          onClick={() => patchUiState({ isCameraOn: true })}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-black text-white rounded-md shadow-md hover:bg-gray-800 z-50"
        >
          🎥 Volver a activar cámara
        </button>
      )}
    </div>
  );
}
