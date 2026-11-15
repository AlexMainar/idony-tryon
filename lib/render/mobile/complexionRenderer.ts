import { collectRgbDeposits, type DepositFieldLayer, type RgbDepositPass } from "../complexion/depositRgb";
// The same sRGB deposit, luminance response, Gaussian fields and per-pass byte
// rounding as depositRgb.ts. Only the execution device changes; presets own
// colours, strength, shape and order on every browser.
const vertex = `attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 vUv;uniform sampler2D uSource;uniform sampler2D uMasks;
uniform vec2 uSize;uniform vec4 uBounds;uniform vec3 uTarget;uniform int uCount;
uniform vec4 uGeometry[4];uniform vec4 uShape[4];uniform vec4 uOptical[4];uniform vec4 uField[4];
void main(){
 vec4 source=texture2D(uSource,vUv);vec2 p=vec2(gl_FragCoord.x,uSize.y-gl_FragCoord.y);
 if(uCount==0||p.x<uBounds.x||p.y<uBounds.y||p.x>=uBounds.z||p.y>=uBounds.w){gl_FragColor=source;return;}
 float response=sqrt(dot(source.rgb,vec3(.299,.587,.114))),total=0.;
 vec4 masks=texture2D(uMasks,(p-uBounds.xy)/(uBounds.zw-uBounds.xy));
 for(int i=0;i<4;i++){
  if(i>=uCount)break;
  vec4 g=uGeometry[i],s=uShape[i],o=uOptical[i],f=uField[i];
  vec2 d=p-g.xy;float along=d.x*s.x+d.y*s.y,across=-d.x*s.y+d.y*s.x;
  float rx=along<0.?s.z:s.w,ry=p.y>=g.z?o.x:g.w;
  float q=along*along/(rx*rx)+across*across/(ry*ry),field;
  if(f.z>2.5)field=1.;else if(f.z>1.5)field=1.-smoothstep(0.,f.w,sqrt(q));
  else if(f.z>.5)field=clamp(1.-sqrt(q)/f.w,0.,1.);else field=exp(-q);
  field=pow(field,f.y);
  float mask=i==0?masks.r:i==1?masks.g:i==2?masks.b:masks.a;
  total+=field*o.y*(1.+(max(response,o.z)-1.)*o.w)*(f.x>.5?mask:1.);
 }
 if(total<=.00001){gl_FragColor=source;return;}
 vec3 result=mix(source.rgb,uTarget,clamp(total,0.,1.));
 gl_FragColor=vec4(floor(result*255.+.5)/255.,source.a);
}`;
const boundsFor = (layers: DepositFieldLayer[], w: number, h: number) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const l of layers) {
        const c = Math.cos(l.rotation ?? 0), s = Math.sin(l.rotation ?? 0);
        const rx = Math.max(1, l.radiusX, l.negativeRadiusX ?? 0, l.positiveRadiusX ?? 0), ry = Math.max(1, l.radiusY, l.lowerRadiusY ?? 0), scale = l.radiusScale ?? 2;
        const ex = (Math.abs(c) * rx + Math.abs(s) * ry) * scale, ey = (Math.abs(s) * rx + Math.abs(c) * ry) * scale;
        left = Math.min(left, l.centerX - ex);
        right = Math.max(right, l.centerX + ex);
        top = Math.min(top, l.centerY - ey);
        bottom = Math.max(bottom, l.centerY + ey);
    }
    return [Math.max(0, Math.floor(left)), Math.max(0, Math.floor(top)), Math.min(w, Math.ceil(right)), Math.min(h, Math.ceil(bottom))] as const;
};
function createGpuComplexionRenderer() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl)
        throw new Error("No se pudo iniciar el renderer mobile de pigmento.");
    const shaders: WebGLShader[] = [];
    const compile = (type: number, code: string) => { const s = gl.createShader(type)!; shaders.push(s); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        fail(gl.getShaderInfoLog(s) ?? "Shader mobile inválido"); return s; };
    const program = gl.createProgram()!;
    const fail = (message: string): never => { for (const s of shaders)
        gl.deleteShader(s); gl.deleteProgram(program); gl.getExtension("WEBGL_lose_context")?.loseContext(); throw Error(message); };
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        fail(gl.getProgramInfoLog(program) ?? "Programa mobile inválido");
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = () => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const images = [texture(), texture()], mask = texture(), fbos = images.map(t => { const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; });
    const names = ["uSource", "uMasks", "uSize", "uBounds", "uTarget", "uCount", "uGeometry", "uShape", "uOptical", "uField"];
    const u = Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)]));
    gl.uniform1i(u.uSource, 0);
    gl.uniform1i(u.uMasks, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const geometry = new Float32Array(16), shape = new Float32Array(16), optical = new Float32Array(16), field = new Float32Array(16);
    let disposed = false;
    const uploadMask = (ctx: CanvasRenderingContext2D, pass: RgbDepositPass, b: readonly number[]) => {
        const [left, top, right, bottom] = b, w = right - left, h = bottom - top;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mask);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        if (!pass.layers.some(l => l.clipToPath && l.path)) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
            return;
        }
        const packed = new Uint8Array(w * h * 4);
        const paths = new Map<Path2D, Map<CanvasFillRule, Uint8Array>>();
        pass.layers.forEach((l, channel) => {
            if (!l.clipToPath || !l.path)
                return;
            const rule = l.fillRule ?? "nonzero";
            let rules = paths.get(l.path);
            if (!rules) {
                rules = new Map();
                paths.set(l.path, rules);
            }
            let binary = rules.get(rule);
            if (!binary) {
                binary = new Uint8Array(w * h);
                for (let y = 0; y < h; y++)
                    for (let x = 0; x < w; x++)
                        binary[y * w + x] = ctx.isPointInPath(l.path!, left + x + .5, top + y + .5, rule) ? 255 : 0;
                rules.set(rule, binary);
            }
            for (let i = 0; i < binary.length; i++)
                packed[i * 4 + channel] = binary[i];
        });
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed);
    };
    return {
        draw<T>(ctx: CanvasRenderingContext2D, draw: () => T): T {
            if (disposed)
                throw Error("El renderer mobile ya se ha cerrado.");
            if (gl.isContextLost())
                return draw();
            const { result, passes } = collectRgbDeposits(ctx, draw), w = ctx.canvas.width, h = ctx.canvas.height;
            if (!passes.length)
                return result;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                for (const t of images) {
                    gl.bindTexture(gl.TEXTURE_2D, t);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                }
            }
            gl.useProgram(program);
            gl.viewport(0, 0, w, h);
            gl.uniform2f(u.uSize, w, h);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, images[0]);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
            let current = 0;
            for (const pass of passes) {
                if (pass.layers.length > 4 || pass.layers.some(l => l.fieldLine?.length || (l.clipPolygon && (l.clipFeatherPx ?? 0) > 0)))
                    throw Error("Campo mobile de pigmento no soportado.");
                const b = boundsFor(pass.layers, w, h);
                if (b[2] <= b[0] || b[3] <= b[1])
                    continue;
                uploadMask(ctx, pass, b);
                pass.layers.forEach((l, i) => {
                    const offset = i * 4, rx = Math.max(1, l.radiusX), ry = Math.max(1, l.radiusY);
                    geometry.set([l.centerX, l.centerY, Math.ceil(l.centerY - .5) + .5, ry], offset);
                    shape.set([Math.cos(l.rotation ?? 0), Math.sin(l.rotation ?? 0), Math.max(1, l.negativeRadiusX ?? rx), Math.max(1, l.positiveRadiusX ?? rx)], offset);
                    optical.set([Math.max(ry, l.lowerRadiusY ?? ry), l.strength, Math.max(0, Math.min(1, l.responseFloor ?? 0)), Math.max(0, Math.min(1, l.responseInfluence ?? 1))], offset);
                    field.set([l.clipToPath && l.path ? 1 : 0, Math.max(.1, l.falloffPower ?? 1), l.falloff === "constant" ? 3 : l.falloff === "smooth" ? 2 : l.falloff === "linear" ? 1 : 0, Math.max(1, l.radiusScale ?? 2)], offset);
                });
                gl.uniform4fv(u.uGeometry, geometry);
                gl.uniform4fv(u.uShape, shape);
                gl.uniform4fv(u.uOptical, optical);
                gl.uniform4fv(u.uField, field);
                gl.uniform4f(u.uBounds, ...b);
                gl.uniform1i(u.uCount, pass.layers.length);
                const hex = pass.color.replace("#", "");
                const value = parseInt(hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex, 16);
                gl.uniform3f(u.uTarget, (value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, images[current]);
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[1 - current]);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                current = 1 - current;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, images[current]);
            gl.uniform1i(u.uCount, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            ctx.drawImage(canvas, 0, 0, w, h);
            return result;
        },
        dispose() { if (disposed)
            return; disposed = true; for (const t of [...images, mask])
            gl.deleteTexture(t); for (const f of fbos)
            gl.deleteFramebuffer(f); gl.deleteBuffer(buffer); gl.deleteProgram(program); for (const s of shaders)
            gl.deleteShader(s); gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    };
}
/** Preserve the same presets when a browser cannot allocate a WebGL context. */
export function createMobileComplexionRenderer(): ReturnType<typeof createGpuComplexionRenderer> {
    try {
        return createGpuComplexionRenderer();
    }
    catch (error) {
        console.warn("Mobile pigment GPU unavailable; using the same CPU presets.", error);
        return { draw<T>(_ctx: CanvasRenderingContext2D, draw: () => T): T { return draw(); }, dispose() { } };
    }
}
