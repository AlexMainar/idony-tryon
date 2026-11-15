// Product coverage in canonical skin coordinates. Evaluate densely once, rather
// than interpolating sparse vertex weights into visible triangular ramps.
export const COVERAGE_SIZE = 256;
export const surfaceUv = (x: number, y: number): [number, number] => [(x + 9) / 18, (y + 10) / 20];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function skinCoverage(x: number, y: number) {
  x = Math.abs(x);
  const ridge = [[6.465170, .937119], [5.258659, .945811], [4.432338, .722096], [3.300681, .861641]];
  let distance = Infinity, progress = 0;
  for (let i = 0; i < ridge.length - 1; i++) {
    const a = ridge[i], b = ridge[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1] + .22) * dy) / (dx * dx + dy * dy)));
    const d = (x - a[0] - t * dx) ** 2 + (y - a[1] + .22 - t * dy) ** 2;
    if (d < distance) { distance = d; progress = (i + t) / (ridge.length - 1); }
  }
  return Math.exp(-distance / (.68 * .68)) * smooth(0, .22, progress) * smooth(0, .22, 1 - progress) * (1 - smooth(1.5, 2.05, y));
}
export function createCoveragePixels(coverage = skinCoverage, halo = coverage) {
  const data = new Uint8Array(COVERAGE_SIZE * COVERAGE_SIZE * 4);
  for (let y = 0; y < COVERAGE_SIZE; y++) for (let x = 0; x < COVERAGE_SIZE; x++) {
    const cx = (x + .5) / COVERAGE_SIZE * 18 - 9, cy = (y + .5) / COVERAGE_SIZE * 20 - 10;
    const value = Math.round(255 * coverage(cx, cy));
    const i = (y * COVERAGE_SIZE + x) * 4;
    data[i] = data[i + 2] = value;
    data[i + 1] = Math.round(255 * halo(cx, cy)); data[i + 3] = 255;
  }
  return data;
}
