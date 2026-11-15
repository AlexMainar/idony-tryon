// Thin optical coating approximation, not measured spectral pearl optics.
// Keep pigment out of this model: the substrate comes from the camera frame.
export const etherealFilm = {
  ior: 1.46,
  transmissionInfluence: 0.35,
  maxTransmissionFresnel: 0.15,
  pearlRoughnessAlong: 0.56,
  pearlRoughnessAcross: 0.46,
  pearlSheenRoughness: 0.50,
  coatRoughness: 0.50,
  pearlReflectance: 0.12,
  pearlSheenReflectance: 0.45,
  reflectionBudget: 0.22,
  reflectionGain: 9.0,
  // Concentration controls where the finish is focused, independently of
  // the global product amount. The outer spread keeps its softer response.
  focusStart: 0.08,
  focusEnd: 0.90,
  coreReflectionScale: 1.8,
  spreadReflectionScale: 0.95,
  coreDiffusionMix: 0.08,
  edgeDiffusionMix: 0.78,
  diffusionRadius: 0.045,
  coreSkinColourRetention: 0.55,
  edgeSkinColourRetention: 0.75,
  thinRoughnessAlong: 0.80,
  thinRoughnessAcross: 0.76,
  thinCoatRoughness: 0.75,
} as const;

export function filmFocus(density: number) {
  const t=Math.max(0,Math.min(1,(density-etherealFilm.focusStart)/(etherealFilm.focusEnd-etherealFilm.focusStart)));
  return t*t*(3-2*t);
}
export const filmFocusShader=`float filmFocus(float density){return smoothstep(${etherealFilm.focusStart},${etherealFilm.focusEnd},density);}`;

export const filmF0 = ((etherealFilm.ior - 1) / (etherealFilm.ior + 1)) ** 2;

export function filmTransmission(nDotV: number, coverage: number) {
  const nv = Math.max(0, Math.min(1, nDotV));
  const amount = Math.max(0, Math.min(1, coverage));
  const fresnel = filmF0 + (1 - filmF0) * (1 - nv) ** 5;
  return 1 - amount * Math.min(fresnel, etherealFilm.maxTransmissionFresnel)
    * etherealFilm.transmissionInfluence;
}
