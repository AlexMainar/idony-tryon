import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd(), loaded = new Map();
assert(/const ETHEREAL_LIVE_MATERIAL:\s*EtherealMaterial\s*=\s*"film"\s*;/.test(fs.readFileSync('app/tryon/components/FaceMesh.tsx','utf8')),
  'production and development must both select the approved Ethereal film material');
globalThis.renderCalls = [];
const leafNames = { lips: 'renderLipGrace', blush: 'renderBlush', bronzer: 'renderBronzer', highlighter: 'renderHighlighter' };
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function compile(file) {
  if (loaded.has(file)) return loaded.get(file);
  const leaf = path.basename(file, '.ts');
  if (file.includes('/tonePresets/') && leafNames[leaf]) {
    const result = url(`export function ${leafNames[leaf]}(ctx, points, tone) { globalThis.renderCalls.push([${JSON.stringify(leaf)}, tone.display_name]); }`);
    loaded.set(file, result); return result;
  }
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  code = code.replace(/from\s+["']([^"']+)["']/g, (match, spec) => {
    if (!spec.startsWith('@/') && !spec.startsWith('.')) throw new Error(`Unexpected runtime dependency: ${spec}`);
    const target = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(file), spec);
    return `from ${JSON.stringify(compile(target + '.ts'))}`;
  });
  const result = url(code); loaded.set(file, result); return result;
}
const { applyTone } = await import(compile(path.join(root, 'lib/render/applyTone.ts')));
const { getLipOilColor } = await import(compile(path.join(root, 'lib/render/mobile/applyMobileLipOilTone.ts')));
const catalog = JSON.parse(fs.readFileSync('data/products.json'));
let depth = 0;
const ctx = { save() { depth++; }, restore() { depth--; } };
const oil = { draw(_ctx, _points, tone) { globalThis.renderCalls.push(['oil3d', getLipOilColor(tone)]); } };
const ethereal = { renderer: { draw(_ctx, frame) {
  globalThis.renderCalls.push(['ethereal3d', frame.product.display_name]);
  assert.equal(frame.exposureGain, 1.2);
  assert.equal(frame.source, 'same-camera-frame');
}}, source: 'same-camera-frame', exposureGain: 1.2, enabled: true, frozen: true, timestampMs: 1000 };
for (const mode of ['desktop', 'mobile']) {
  globalThis.window = { location: { search: `?tonepipeline=${mode}&cheekdebug=direct` }, matchMedia: () => ({ matches: mode === 'mobile' }) };
  for (const [id, tone] of Object.entries(catalog)) {
    globalThis.renderCalls = [];
    assert.equal(applyTone(ctx, [], tone, 960, 720, () => '', 1, oil, ethereal), true, id);
    assert.equal(depth, 0, 'restore canvas state');
    assert.equal(renderCalls.length, 1, 'exactly one family pass');
    const expected = id.startsWith('lip_bloom') ? 'oil3d' : id.startsWith('lip_grace') ? 'lips' : id.includes('bronzer') ? 'bronzer' : id.includes('ethereal') ? 'ethereal3d' : 'blush';
    assert.equal(renderCalls[0][0], expected, id);
  }
}
for (const [id, color] of [['clover_club', '#a53a39'], ['barbados', '#84362c'], ['ruby_vice', '#9b282f']]) {
  assert.equal(getLipOilColor(catalog['lip_bloom_' + id]), color);
}
assert.throws(() => applyTone(ctx, [], catalog.lip_bloom_clover_club, 960, 720, () => ''), /3D/);
assert.equal(depth, 0, 'restore even when a material is unavailable');
assert.throws(() => applyTone(ctx, [], catalog.ethereal_luminizer, 960, 720, () => ''), /Ethereal/);
assert.equal(depth, 0, 'restore when Ethereal is unavailable; no old white overlay fallback');
assert(![...loaded.keys()].some(file => file.includes('/desktop/')), 'no desktop renderer dependency');
console.log('12 tones × mouse/touch: one mobile route, Ethereal surface only with the same frame/exposure, approved oil colors, canvas state restored.');
