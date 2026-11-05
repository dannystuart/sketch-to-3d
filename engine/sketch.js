// sketch-to-3d engine: a copy of marker v1 (locked 2026-11-05). Draws any three.js object as a marker sketch.
//   const sk = createSketchAny({root, scene, renderer, camera, pal: PALETTES.whitePaper, pro: true, multiply: true});
//   sk.render({construct, major, ghost, lines, ink, colour, scissor, hide})   // each stage 0..1; pose the object first
// Change from marker v1: line and hatch sizes follow the frame's short side (any video shape), so 1080x1920 is unchanged.
import * as THREE from 'three';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';

export const PALETTES = {
  redSheet: {ground: '#D9261C', ink: '#2a0605', shade: '#8f130c'}, // the car's red video still
  whitePaper: {ground: '#FAFAF8', shade: '#F3D6D3', ink: '#D9261C'}, // the car's build sketch
  pencil: {ground: '#F3F0E8', shade: '#DAD4C6', ink: '#26241f'},
  blueprint: {ground: '#1f4fa8', shade: '#173e86', ink: '#eaf1ff'},
};

// hand hatching, in screen space: k1 = how much of the first direction, k2 = the cross-hatch (0..1 each)
const HATCH_GLSL = /* glsl */ `
  float hh(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
  float hatchAt(vec2 p, float H, float k1, float k2){
    // one direction only (no cross-hatching). The page is warped a touch so lines wander slightly;
    // each line has its own weight and place in its band, breaks now and then, and stops at its own point at the edge
    // of the shade. k2 is kept in the signature but no longer used.
    vec2 q = p + vec2(2.5 * sin(p.y * 0.016 + 2.0 * sin(p.x * 0.006)), 2.5 * sin(p.x * 0.014 + 1.5 * sin(p.y * 0.008)));
    float g = 0.75 + 0.25 * hh(dot(floor(p / 1.5), vec2(1.0, 57.0)));
    float u1 = q.x + q.y;
    float id1 = floor(u1 / H);
    float f1 = mod(u1, H) - H * (0.4 + 0.2 * hh(id1 * 7.7));
    float w1 = H * (0.07 + 0.08 * hh(id1 * 1.7));
    float seg1 = floor((q.x - q.y) / (H * (4.0 + 8.0 * hh(id1))));
    float on1 = step(0.12, hh(id1 * 3.1 + seg1 * 1.37));
    float l1 = step(abs(f1), w1) * on1 * step(0.06 + 0.93 * hh(id1 * 5.3 + seg1 * 0.71), k1);
    return l1 * g;
  }`;
// the floor shadow: quick hand hatching with no fill. Each line reaches its own distance into the shadow's soft edge
// (some run well past it, some stop short), sits anywhere in its band, has its own weight and lifts off now and then
const SHADOW_HATCH = /* glsl */ `
  float shadowHatch(vec2 p, float H, float m){
    vec2 q = p + vec2(3.0 * sin(p.y * 0.02 + 2.0 * sin(p.x * 0.007)), 3.0 * sin(p.x * 0.017));
    float u = q.x + q.y;
    float id = floor(u / H);
    float f = mod(u, H) - H * (0.25 + 0.5 * hh(id * 7.1));
    float w = H * (0.05 + 0.12 * hh(id * 1.9));
    float seg = floor((q.x - q.y) / (H * (5.0 + 10.0 * hh(id * 2.7))));
    float on = step(0.15, hh(id * 3.7 + seg * 1.21));
    float reach = 0.05 + 0.55 * hh(id * 4.3) * hh(id * 9.1 + 0.5);
    float g = 0.7 + 0.3 * hh(dot(floor(p / 1.5), vec2(1.0, 57.0)));
    return step(abs(f), w) * on * step(reach, m) * g;
  }`;
const INK_VERT = /* glsl */ `varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const INK_FRAG = /* glsl */ `uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uInk; uniform vec3 uL; uniform float uDark; uniform float uAlpha;
  uniform float uHatch; uniform float uFill; uniform vec3 uSweepO; uniform vec3 uSweepD; varying vec3 vN; varying vec3 vW;
  uniform float uPro; uniform float uP0; uniform float uP1; uniform float uAlbOut; uniform float uMetal; uniform vec3 uHi; uniform float uHiA;
  uniform float uWash; uniform vec3 uBase; uniform sampler2D uMap; uniform float uHasMap; uniform float uMapDecode; uniform mat3 uMapXf; uniform float uColour; varying vec2 vUv;
  ${HATCH_GLSL}
  void main(){
    // the model's own colour, blurred so painted detail reads as marker shapes rather than photo grain
    vec3 alb = uBase;
    if (uHasMap > 0.5) {
      vec3 tb = texture2D(uMap, (uMapXf * vec3(vUv, 1.0)).xy, 4.5).rgb;
      if (uMapDecode > 0.5) tb = pow(tb, vec3(2.2));
      alb *= tb;
    }
    float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
    if (uAlbOut > 0.5) { gl_FragColor = vec4(sqrt(lum), 0.0, 0.0, 1.0); return; }
    // the fill sweeps across the object; its edge is ragged along the hatch diagonals, like marker strokes
    float k = dot(vW - uSweepO, uSweepD);
    float band = fract(sin(floor((gl_FragCoord.x + gl_FragCoord.y) / (uHatch * 2.0)) * 43758.5453));
    // ahead of the solid marker, an optional see-through wash (the car's glassy stage); otherwise nothing yet
    float a = uAlpha;
    if (k > uFill * 1.3 - 0.3 * band) {
      if (uWash < 0.001) discard;
      a = uWash * 0.38;
    }
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float l = dot(n, uL);
    float s = 1.0 - smoothstep(-0.05, 0.18, l);
    vec3 col = mix(uLit, uShade, s * 0.85);
    // hatching where the face turns from the light (ragged edge, each line stops at its own point), cross-hatching
    // where it turns well away
    float k1 = smoothstep(0.16, -0.12, l);
    float k2 = smoothstep(-0.2, -0.6, l);
    float hatch = hatchAt(gl_FragCoord.xy, uHatch, k1, k2);
    float dk = uDark;
    if (uPro > 0.5) {
      vec3 V = normalize(cameraPosition - vW);
      // three values, as a designer blocks a box: top in paper, the face toward us a light marker, the side away the
      // full marker with hatching
      float midF = 1.0 - smoothstep(0.4, 0.48, l);
      vec3 c3 = mix(uLit, mix(uLit, uShade, 0.42), midF);
      c3 = mix(c3, uShade, s * 0.95);
      // marker streaks: the tint goes on in parallel strokes, darker where two strokes overlap
      float sp = gl_FragCoord.x * 0.5 - gl_FragCoord.y * 0.866;
      float bw = uHatch * 3.2;
      float bid = floor(sp / bw);
      float fr = fract(sp / bw);
      float streak = 0.86 + 0.22 * hh(bid * 3.3) + 0.22 * smoothstep(0.82, 0.97, fr) * (1.0 - smoothstep(0.97, 1.0, fr));
      c3 = uLit + (c3 - uLit) * streak;
      // chrome and polished metal: the marker trick of a sky above the horizon and a dark band just under it
      if (uMetal > 0.5) {
        vec3 r = reflect(-V, n);
        float sky = smoothstep(-0.03, 0.05, r.y);
        float band = (1.0 - smoothstep(-0.12, -0.03, r.y)) * smoothstep(-0.45, -0.25, r.y);
        c3 = mix(mix(uShade, uInk, 0.3), uLit, sky);
        c3 = mix(c3, uInk, band * 0.9);
        dk = 0.0;
      }
      col = mix(c3, uInk, hatch * 0.75);
      // dark accents: the darkest of the model's own colours go to solid ink, the next band to the full marker; the
      // undersides go dark too. This is what gives the car its punch (glass, vents) on objects with no dark parts
      float rel = (sqrt(lum) - uP0) / max(1e-4, uP1 - uP0);
      float aInk = 1.0 - smoothstep(0.1, 0.2, rel);
      float aMid = 1.0 - smoothstep(0.38, 0.48, rel);
      col = mix(col, mix(uShade, uInk, 0.25), aMid * (1.0 - aInk) * 0.85);
      float under = smoothstep(-0.3, -0.6, n.y);
      dk = max(dk, max(aInk * 0.9, under * 0.7));
      // painted detail (numerals, text, logos): marks much darker than their blurred surroundings go down as crisp
      // ink, marks much lighter as paper, the way a hand would draw them in
      if (uHasMap > 0.5) {
        vec3 tf = texture2D(uMap, (uMapXf * vec3(vUv, 1.0)).xy, 0.3).rgb * uBase;
        float lf = sqrt(dot(tf, vec3(0.2126, 0.7152, 0.0722)));
        float lb = sqrt(lum);
        dk = max(dk, 0.85 * smoothstep(0.22, 0.38, (lb - lf) / max(lb, 0.06)));
        col = mix(col, uLit, 0.85 * smoothstep(0.35, 0.6, (lf - lb) / max(lf, 0.06)));
      }
      // white pencil where the light glints
      float sp2 = pow(max(dot(reflect(-uL, n), V), 0.0), 24.0);
      float hiM = smoothstep(0.45, 0.7, sp2) * (0.6 + 0.4 * hatchAt(gl_FragCoord.xy + 3.0, uHatch * 0.6, 1.0, 0.0));
      col = mix(col, uInk, dk);
      col = mix(col, uHi, hiM * uHiA);
      dk = 0.0;
    } else {
      col = mix(col, uInk, hatch * 0.75);
    }
    col = mix(col, uInk, dk);
    // the colour stage: the part's own colour (and its image, if it has one) as flat marker, a darker marker in the
    // shade, hatching in a deeper tone of the same colour; it sweeps on like a second marker
    if (uColour > 0.0) {
      vec3 base = uBase;
      if (uHasMap > 0.5) {
        vec3 tx = uPro > 0.5 ? texture2D(uMap, (uMapXf * vec3(vUv, 1.0)).xy, 0.8).rgb : texture2D(uMap, (uMapXf * vec3(vUv, 1.0)).xy).rgb;
        // compressed images can arrive still in display colours: bring them to the same footing as the rest
        if (uMapDecode > 0.5) tx = pow(tx, vec3(2.2));
        base *= tx;
      }
      vec3 cc = mix(mix(base, vec3(1.0), 0.1), base * 0.55, s * 0.85);
      cc = mix(cc, base * 0.28, hatch * 0.7);
      float on = step(k, uColour * 1.3 - 0.3 * band);
      col = mix(col, cc, on);
    }
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;
// the outline: back faces pushed out along the normal by a fixed number of pixels
// the weight swells and thins along the outline (pen pressure), and each of the two outlines sits a little off
const HULL_VERT = /* glsl */ `uniform vec3 uL; uniform float uPro; uniform float uWidth; uniform vec2 uRes; uniform vec3 uSeed; uniform float uFreq; uniform vec2 uShift; varying vec3 vW;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec3 q = w.xyz * uFreq;
    float n = 0.5 + 0.5 * sin(dot(q, vec3(1.0, 1.31, 0.73)) + uSeed.x + 1.7 * sin(dot(q, vec3(-0.6, 2.1, 1.4)) * 1.9 + uSeed.y));
    vec4 c = projectionMatrix * viewMatrix * w;
    vec3 nW = normalize(mat3(modelMatrix) * normal);
    vec2 nC = (projectionMatrix * viewMatrix * vec4(nW, 0.0)).xy;
    float side = uPro > 0.5 ? 0.55 + 1.1 * (1.0 - smoothstep(-0.15, 0.45, dot(nW, uL))) + 0.5 * smoothstep(0.0, -0.6, nW.y) : 1.0;
    if (length(nC) > 1e-6) c.xy += normalize(nC) * uWidth * side * (0.2 + 1.5 * n * n) * 2.0 / uRes * c.w;
    c.xy += uShift * 2.0 / uRes * c.w;
    gl_Position = c;
  }`;
// it arrives with the fill (same sweep), or an object with no fill yet would show as a solid ink shape
const HULL_FRAG = /* glsl */ `uniform vec3 uInk; uniform float uAlpha; uniform float uHatch; uniform float uFill; uniform vec3 uSweepO; uniform vec3 uSweepD; varying vec3 vW;
  void main(){
    float k = dot(vW - uSweepO, uSweepD);
    float band = fract(sin(floor((gl_FragCoord.x + gl_FragCoord.y) / (uHatch * 2.0)) * 43758.5453));
    if (k > uFill * 1.3 - 0.3 * band) discard;
    float grain = 0.72 + 0.28 * fract(sin(dot(floor(gl_FragCoord.xy / 1.5), vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(uInk, uAlpha * grain);
    #ifdef MULTIPLY
    gl_FragColor = vec4(mix(vec3(1.0), uInk, uAlpha * grain), 1.0);
    #endif
  #include <colorspace_fragment>
  }`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
// ink that darkens what's under it (two strokes crossing get darker, as marker does)
function mulBlend(mat) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.DstColorFactor;
  mat.blendDst = THREE.ZeroFactor;
}
// teach a LineMaterial pen pressure: each segment's width and darkness follow its instancePress (start, end), and the
// line picks up a slight grain, as marker on paper does
function pressure(mat, multiply = false) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('attribute vec3 instanceEnd;', 'attribute vec3 instanceEnd;\n\t\tattribute vec2 instancePress;\n\t\tvarying float vPress;')
      .replace('void main() {', 'void main() {\n\t\t\tvPress = ( position.y < 0.5 ) ? instancePress.x : instancePress.y;')
      .replace('offset *= linewidth;', 'offset *= linewidth * vPress;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vPress;\n\t\tvoid main() {')
      .replace(
        'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        'float grain = 0.72 + 0.28 * fract( sin( dot( floor( gl_FragCoord.xy / 1.5 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha * clamp( 0.35 + 0.65 * vPress, 0.0, 1.0 ) * grain );',
      );
    if (multiply) sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha * clamp( 0.35 + 0.65 * vPress, 0.0, 1.0 ) * grain );', 'gl_FragColor = vec4( mix( vec3( 1.0 ), diffuseColor.rgb, alpha * clamp( 0.35 + 0.65 * vPress, 0.0, 1.0 ) * grain ), 1.0 );');
  };
  mat.customProgramCacheKey = () => (multiply ? 'sketch-pressure-mul' : 'sketch-pressure');
  if (multiply) mulBlend(mat);
}
// the pale ghost (pro): each line fades in over a soft band behind a travelling front, rather than switching on
function ghostify(mat) {
  const prev = mat.onBeforeCompile;
  mat.userData.front = {value: 0};
  mat.userData.soft = {value: 0.2};
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uFront = mat.userData.front;
    sh.uniforms.uSoft = mat.userData.soft;
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'attribute float instanceKey;\n\t\tvarying float vKey;\n\t\tvoid main() {\n\t\t\tvKey = instanceKey;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uFront;\n\t\tuniform float uSoft;\n\t\tvarying float vKey;\n\t\tvoid main() {')
      .replace('float grain = 0.72', 'float gk = clamp( ( uFront - vKey ) / uSoft, 0.0, 1.0 );\n\t\t\tgk = gk * gk * ( 3.0 - 2.0 * gk );\n\t\t\tfloat grain = 0.72')
      .replace('alpha * clamp( 0.35 + 0.65 * vPress', 'alpha * gk * clamp( 0.35 + 0.65 * vPress');
  };
  const key0 = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key0 + '-ghost';
}
// run a polyline on past both ends along its end directions
function extend(pts, o0, o1) {
  const p0 = pts[0];
  const pn = pts[pts.length - 1];
  const d0 = unit3(p0, pts[1]);
  const d1 = unit3(pts[pts.length - 2], pn);
  return [[p0[0] - d0[0] * o0, p0[1] - d0[1] * o0, p0[2] - d0[2] * o0], ...pts, [pn[0] + d1[0] * o1, pn[1] + d1[1] * o1, pn[2] + d1[2] * o1]];
}
// add points along long straight runs, so a stroke can taper and wobble along its length
function subdivide(pts, maxLen) {
  const outp = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.ceil(dist3(a, b) / maxLen);
    for (let k = 1; k <= n; k++) outp.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  return outp;
}
const dist3 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
const unit3 = (p, q) => {
  const d = dist3(p, q) || 1;
  return [(q[0] - p[0]) / d, (q[1] - p[1]) / d, (q[2] - p[2]) / d];
};

// crease segments (pairs of points) → strokes: follow each run of segments end to end while exactly two meet at a
// point and the line turns less than ~40°; a corner or a junction starts a new stroke, as a hand would
function chainsOf(arr, tol, segW = null) {
  const n = arr.length / 6;
  const pt = (i, e) => [arr[i * 6 + e * 3], arr[i * 6 + e * 3 + 1], arr[i * 6 + e * 3 + 2]];
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;
  const at = new Map();
  for (let i = 0; i < n; i++)
    for (const e of [0, 1]) {
      const k = key(pt(i, e));
      if (!at.has(k)) at.set(k, []);
      at.get(k).push([i, e]);
    }
  const used = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const grow = (pts, seg, end) => {
    // walk on from point `end` of segment `seg`, appending to pts
    for (;;) {
      const here = pts[pts.length - 1];
      const list = at.get(key(here));
      if (!list || list.length !== 2) return;
      const [ni, ne] = list[0][0] === seg ? list[1] : list[0];
      if (used[ni]) return;
      const next = pt(ni, 1 - ne);
      const dIn = unit3(pts[pts.length - 2], here);
      const dOut = unit3(here, next);
      if (dIn[0] * dOut[0] + dIn[1] * dOut[1] + dIn[2] * dOut[2] < 0.77) return;
      used[ni] = 1;
      pts.push(next);
      seg = ni;
    }
  };
  const chains = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd = [pt(i, 0), pt(i, 1)];
    grow(fwd, i, 1);
    const back = [pt(i, 1), pt(i, 0)];
    grow(back, i, 0);
    const ch = [...back.slice(2).reverse(), ...fwd];
    if (segW) {
      // the stroke's weight: the heaviest of its pieces
      let w = segW[i];
      for (let q = 0; q < n; q++) if (used[q] === 1 && !seen[q]) {
        seen[q] = 1;
        w = Math.max(w, segW[q]);
      }
      ch.w = w;
    }
    chains.push(ch);
  }
  return chains;
}

// crease edges like THREE.EdgesGeometry, plus a weight per edge from the faces either side: heavy where a face turns
// from the light or faces down, light ("lost") where both faces are in full light. nm: the mesh's normal matrix
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function edgesWithFaces(geometry, angle, nm, L) {
  const pm = 1e4;
  const th = Math.cos(THREE.MathUtils.DEG2RAD * angle);
  const idx = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  const count = idx ? idx.count : pos.count;
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ii = [0, 0, 0];
  const h = ['', '', ''];
  const n = new THREE.Vector3();
  const T = new THREE.Triangle();
  const data = new Map();
  const out = [];
  const ws = [];
  const w1 = new THREE.Vector3();
  const w2 = new THREE.Vector3();
  const wOf = (n1, n2) => {
    w1.copy(n1).applyMatrix3(nm).normalize();
    w2.copy(n2).applyMatrix3(nm).normalize();
    const l1 = w1.dot(L);
    const l2 = w2.dot(L);
    if (Math.min(l1, l2) > 0.55) return 0.38;
    const shade = Math.max(1 - sstep(-0.05, 0.35, l1), 1 - sstep(-0.05, 0.35, l2));
    const down = clamp01(Math.max(-w1.y, -w2.y));
    return 0.55 + 0.8 * shade + 0.35 * down;
  };
  for (let i = 0; i < count; i += 3) {
    for (let j = 0; j < 3; j++) {
      ii[j] = idx ? idx.getX(i + j) : i + j;
      tri[j].fromBufferAttribute(pos, ii[j]);
      h[j] = `${Math.round(tri[j].x * pm)},${Math.round(tri[j].y * pm)},${Math.round(tri[j].z * pm)}`;
    }
    if (h[0] === h[1] || h[1] === h[2] || h[2] === h[0]) continue;
    T.set(tri[0], tri[1], tri[2]).getNormal(n);
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3;
      const rev = `${h[k]}_${h[j]}`;
      const e = data.get(rev);
      if (e) {
        if (n.dot(e.normal) <= th) {
          out.push(tri[j].x, tri[j].y, tri[j].z, tri[k].x, tri[k].y, tri[k].z);
          ws.push(wOf(n, e.normal));
        }
        data.set(rev, null);
      } else if (!data.has(`${h[j]}_${h[k]}`)) data.set(`${h[j]}_${h[k]}`, {a: tri[j].clone(), b: tri[k].clone(), normal: n.clone()});
    }
  }
  for (const e of data.values()) {
    if (!e) continue;
    out.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
    ws.push(wOf(e.normal, e.normal));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.userData.w = ws;
  return g;
}

// default tone from a material: dark parts (tyres, glass, black plastic) nearly black, metal mid, the rest light
export function autoTone(mat) {
  if (!mat) return 'light';
  if (mat.transparent && mat.opacity < 0.7) return 'dark';
  if (mat.transmission > 0.2) return 'dark';
  const c = mat.color ?? new THREE.Color(1, 1, 1);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  if (lum < 0.035) return 'dark';
  if ((mat.metalness ?? 0) > 0.6 || lum < 0.2) return 'mid';
  return 'light';
}

/**
 * @param o.root      the object to sketch (posed before each render)
 * @param o.pal       {ground, ink, shade}
 * @param o.tone      (mesh, material) => 'light'|'mid'|'dark'|'skip', or undefined for the automatic choice
 * @param o.crease    crease angle in degrees for edge lines (36, as the car)
 * @param o.maxSegs   cap on edge segments; the crease angle rises until the count fits (very dense meshes)
 * @param o.outline   outline width in px at 1920 tall (0 = off)
 * @param o.circles   true = find disc-shaped parts; or an array of {mesh, center:[x,y,z], axis:'x'|'y'|'z', r} in mesh space
 * @param o.maxCircles how many found circles to keep (largest first)
 * @param o.guides    true = bounding-box construction lines
 * @param o.sweep     world direction the draw-on travels along (default left to right on screen at build time)
 * @param o.reveal    'strokes' (default) or 'fade' (the car's)
 * @param o.light     direction the flat light comes from
 */
export function createSketchAny(o) {
  const {root, scene, renderer, camera} = o;
  const pal = o.pal ?? PALETTES.redSheet;
  const reveal = o.reveal ?? 'strokes';
  const pro = !!o.pro;
  const multiply = !!o.multiply;
  const loops = o.loops ?? pro;
  const L = new THREE.Vector3(...(o.light ?? [-0.38, 0.86, 0.34])).normalize();

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const D = Math.max(size.x, size.y, size.z);
  const sweepD = new THREE.Vector3(...(o.sweep ?? [1, 0, 0])).normalize();
  // project the box onto the sweep axis, so 0..1 runs across the object
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const d = p.dot(sweepD);
    sMin = Math.min(sMin, d);
    sMax = Math.max(sMax, d);
  }
  const sweepO = sweepD.clone().multiplyScalar(sMin);
  const sweepK = sweepD.clone().divideScalar(sMax - sMin);
  const along = (p) => clamp01(p.clone().sub(sweepO).dot(sweepK));

  // ------------------------------------------------------------ the ink
  const col = (hex) => new THREE.Color(hex);
  const SH = {
    uLit: {value: col(pal.ground)}, uShade: {value: col(pal.shade)}, uInk: {value: col(pal.ink)}, uL: {value: L}, uAlpha: {value: 1},
    uHatch: {value: 7}, uFill: {value: 1}, uSweepO: {value: sweepO}, uSweepD: {value: sweepK}, uColour: {value: 0}, uWash: {value: 0},
    uPro: {value: pro ? 1 : 0}, uP0: {value: -1}, uP1: {value: -0.5}, uAlbOut: {value: 0}, uHi: {value: col(o.hi ?? '#ffffff')}, uHiA: {value: o.hiA ?? 0.9},
  };
  const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  WHITE.needsUpdate = true;
  const DARK = {light: 0, mid: 0.45, dark: 0.88};
  const inkMats = new Map();
  // the ink for one of the object's materials: the sketch tone it gets, plus its real colour for the colour stage
  const inkFor = (src, tone) => {
    const key = `${src?.uuid}:${tone}`;
    if (inkMats.has(key)) return inkMats.get(key);
    const map = src?.map ?? null;
    const m = new THREE.ShaderMaterial({
      vertexShader: INK_VERT,
      fragmentShader: INK_FRAG,
      uniforms: {...SH, uMetal: {value: tone === 'mid' && (src?.metalness ?? 0) > 0.5 ? 1 : 0}, uDark: {value: DARK[tone] ?? 0}, uBase: {value: src?.color ? src.color.clone() : new THREE.Color(1, 1, 1)}, uMap: {value: map ?? WHITE}, uHasMap: {value: map ? 1 : 0}, uMapDecode: {value: 0}, uMapXf: {value: map ? (map.updateMatrix(), map.matrix.clone()) : new THREE.Matrix3()}},
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1.5,
      polygonOffsetUnits: 2,
    });
    inkMats.set(key, m);
    return m;
  };
  const hullMat = (w, a, seed, shift) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: HULL_VERT,
      fragmentShader: HULL_FRAG,
      uniforms: {
        uWidth: {value: w}, uRes: {value: new THREE.Vector2(1080, 1920)}, uInk: {value: col(pal.ink)}, uAlpha: {value: a}, uHatch: {value: 7},
        uFill: {value: 1}, uSweepO: {value: sweepO}, uSweepD: {value: sweepK}, uSeed: {value: new THREE.Vector3(...seed)}, uFreq: {value: 9 / D},
        uShift: {value: new THREE.Vector2(...shift)}, uL: {value: L}, uPro: {value: pro ? 1 : 0},
      },
      defines: multiply ? {MULTIPLY: 1} : {},
      side: THREE.BackSide,
      transparent: true,
    });
    m.userData = {w, a, shift};
    return m;
  };
  // the outline: drawn twice, a firm one and a lighter one a touch off, both with a changing weight
  const HULLS = pro ? [hullMat(2.4, 0.95, [0, 1.3, 0], [0, 0]), hullMat(1.2, 0.5, [2.1, 4.7, 0], [1.2, -0.9])] : [hullMat(1.8, 0.95, [0, 1.3, 0], [0, 0]), hullMat(1.1, 0.5, [2.1, 4.7, 0], [1.2, -0.9])];
  if (multiply) for (const hm of HULLS) mulBlend(hm);

  // ------------------------------------------------------------ meshes, tones and the marker edges
  const lineMats = [];
  const lineMat = (w, a, press = false) => {
    const m = new LineMaterial({color: pal.ink, linewidth: w, transparent: true, opacity: a, worldUnits: false});
    if (press) pressure(m, multiply);
    m.userData.w = w;
    lineMats.push(m);
    return m;
  };
  const FIRM = lineMat(2.6, 0.95, true);
  const LOOSE = lineMat(1.4, 0.6, true);
  const GHOST = lineMat(1.0, 0.38, true);
  // lines behind the object: drawn faint (0 = hidden lines off)
  const hiddenA = o.hidden ?? 0.6;
  const HIDDEN = hiddenA > 0 ? lineMat(1.6, hiddenA, true) : null;
  if (HIDDEN) HIDDEN.depthFunc = THREE.GreaterDepth;
  const PALE = lineMat(1.5, 0.3, true);
  PALE.depthTest = false;
  if (o.pro) ghostify(PALE);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };

  const meshes = [];
  const skipped = []; // hidden while the sketch draws (clear glass over a dial, display stands)
  // the material that covers most of the object is the body: a sketch draws the body light, whatever its real colour
  const area = new Map();
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const b = new THREE.Box3().setFromObject(m);
    const s = b.getSize(new THREE.Vector3());
    area.set(mat, (area.get(mat) ?? 0) + s.x * s.y + s.y * s.z + s.z * s.x);
  });
  const body = [...area.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
  root.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || m.userData.sketchSkip || !m.geometry?.attributes?.position) return;
    const mat0 = Array.isArray(m.material) ? m.material[0] : m.material;
    const t = o.tone?.(m, mat0) ?? (mat0 === body && !(mat0.transparent && mat0.opacity < 0.7) ? 'light' : autoTone(mat0));
    if (t === 'skip') {
      skipped.push(m);
      return;
    }
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    meshes.push({m, ink: inkFor(mat0, DARK[t] === undefined ? 'light' : t)});
  });

  // edges per mesh, with a global cap: raise the crease angle until the whole object fits
  const edgesOf = (angle) => meshes.map(({m}) => (pro ? edgesWithFaces(m.geometry, angle, new THREE.Matrix3().getNormalMatrix(m.matrixWorld), L) : new THREE.EdgesGeometry(m.geometry, angle)));
  let angle = o.crease ?? 36;
  let eg = edgesOf(angle);
  const count = (list) => list.reduce((n, g) => n + g.attributes.position.count / 2, 0);
  const maxSegs = o.maxSegs ?? 120000;
  while (count(eg) > maxSegs && angle < 80) {
    angle += 10;
    eg = edgesOf(angle);
  }
  const loopFound = [];
  const blockIn = o.blockIn ?? pro; // a block-in beat: the longest outer strokes alone, after the circles and box
  const majorCands = [];
  const ray = new THREE.Raycaster();
  const dbgRings = [];
  const rayTargets = meshes.map(({m}) => m);
  const pales = []; // the pale see-through ghost of every firm stroke
  const strokes = []; // {l, t0, t1} per line object, so parts draw in turn along the sweep
  const tmp = new THREE.Vector3();
  meshes.forEach(({m}, idx) => {
    const g = eg[idx];
    const a0 = g.attributes.position.array;
    if (!a0.length) return;
    const wm = m.matrixWorld;
    const scl = new THREE.Vector3().setFromMatrixScale(wm);
    const sAvg = (Math.abs(scl.x) + Math.abs(scl.y) + Math.abs(scl.z)) / 3 || 1;
    // join the crease segments into whole pen strokes: runs of segments that meet end to end without a sharp turn
    const chains = chainsOf(a0, (1e-5 * D) / sAvg, pro ? g.userData.w : null);
    // closed rings of crease lines that are round and flat are circles (speaker rims, dials), even in a merged model
    if (loops)
      for (const pts of chains) {
        if (pts.length < 17) continue;
        let Lc = 0;
        for (let i = 1; i < pts.length; i++) Lc += dist3(pts[i - 1], pts[i]);
        if (dist3(pts[0], pts[pts.length - 1]) > 0.02 * Lc) continue;
        const P = pts.slice(0, -1);
        const c = [0, 0, 0];
        for (const q of P) for (let k = 0; k < 3; k++) c[k] += q[k] / P.length;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        for (let i = 0; i < P.length; i++) {
          const a = P[i];
          const b = P[(i + 1) % P.length];
          nx += (a[1] - b[1]) * (a[2] + b[2]);
          ny += (a[2] - b[2]) * (a[0] + b[0]);
          nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const nrm = [nx / nl, ny / nl, nz / nl];
        const rs = P.map((q) => dist3(q, c));
        const mean = rs.reduce((x, y) => x + y, 0) / rs.length;
        const sd = Math.sqrt(rs.reduce((x, y) => x + (y - mean) ** 2, 0) / rs.length);
        const flat = Math.max(...P.map((q) => Math.abs((q[0] - c[0]) * nrm[0] + (q[1] - c[1]) * nrm[1] + (q[2] - c[2]) * nrm[2])));
        const maxDev = Math.max(...rs.map((r) => Math.abs(r - mean))) / mean;
        if (sd / mean > 0.02 || maxDev > 0.05 || flat > 0.05 * mean || mean * sAvg < 0.03 * D) continue;
        // a ring hidden inside the object (behind the boombox's square cassette door) would draw a circle round
        // something square: keep only rings the camera can mostly see
        let hid = 0;
        for (let k = 0; k < 8; k++) {
          const q = P[Math.floor((k * P.length) / 8)];
          const wp = new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(wm);
          const dir = wp.clone().sub(camera.position);
          const dd = dir.length();
          ray.set(camera.position, dir.normalize());
          ray.far = dd;
          const hit = ray.intersectObjects(rayTargets, false)[0];
          if (hit && hit.distance < dd - 0.01 * D) hid++;
        }
        dbgRings.push([+(mean * sAvg / D).toFixed(3), P.length, hid, ...new THREE.Vector3(...c).applyMatrix4(wm).toArray().map((x) => +(x / D).toFixed(2))]);
        if (hid > 3) continue;
        loopFound.push({n: P.length, mesh: m, center: c, normal: nrm, r: mean, wr: mean * sAvg, wc: new THREE.Vector3(...c).applyMatrix4(wm)});
      }
    if (blockIn)
      for (const raw of chains) {
        let Lr = 0;
        for (let i = 1; i < raw.length; i++) Lr += dist3(raw[i - 1], raw[i]);
        const wl = Lr * sAvg;
        if (wl < 0.03 * D) continue;
        // rings are already circled; favour long, fairly straight outer strokes (the body's main edges)
        const chordR = dist3(raw[0], raw[raw.length - 1]) / Lr;
        if (chordR < 0.05) continue;
        const mid = raw[Math.floor(raw.length / 2)];
        const mw = new THREE.Vector3(mid[0], mid[1], mid[2]).applyMatrix4(wm);
        majorCands.push({m, raw, L: Lr, U: D / sAvg, wl, score: wl * (0.6 + mw.distanceTo(ctr) / D) * (0.4 + 0.6 * chordR), a: along(mw)});
      }
    // the order they draw in: along the sweep, with some randomness, a stroke at a time
    const keyed = chains.map((pts) => {
      const mid = pts[Math.floor(pts.length / 2)];
      tmp.set(mid[0], mid[1], mid[2]).applyMatrix4(wm);
      return [along(tmp) + 0.35 * rnd(), pts];
    });
    keyed.sort((p, q) => p[0] - q[0]);
    const U = D / sAvg; // object size in this mesh's own units
    // three passes per stroke: the firm line, a loose one and a faint third; each segment carries the pen pressure at
    // both its ends (thin where the pen lands and lifts, a different weight for every stroke)
    const out = [0, 1, 2].map(() => ({pos: [], press: []}));
    const emit = (o2, line, pressure, taper, gaps = 0) => {
      let L = 0;
      const acc = [0];
      for (let i = 1; i < line.length; i++) acc.push((L += dist3(line[i - 1], line[i])));
      // the pen presses harder and lighter along the stroke, not only at its ends
      const f = 4 + 6 * (rnd() + 0.5);
      const ph = rnd() * 6.28;
      const w = (i) => {
        const t = L > 0 ? acc[i] / L : 0.5;
        return pressure * (taper + (1 - taper) * Math.pow(Math.sin(Math.PI * t), 0.5)) * (0.6 + 0.8 * (0.5 + 0.5 * Math.sin(t * f + ph)));
      };
      // a loose pass now and then lifts off for a moment
      const holes = [];
      for (let g = 0; g < gaps; g++) if (rnd() > 0) holes.push([0.15 + 0.7 * (rnd() + 0.5), 0.03 + 0.06 * (rnd() + 0.5)]);
      for (let i = 0; i + 1 < line.length; i++) {
        const t = L > 0 ? (acc[i] + acc[i + 1]) / 2 / L : 0.5;
        if (holes.some(([c, h]) => Math.abs(t - c) < h / 2)) continue;
        o2.pos.push(...line[i], ...line[i + 1]);
        o2.press.push(w(i), w(i + 1));
      }
    };
    for (const [, raw] of keyed) {
      const pts = subdivide(raw, 0.02 * U); // long straight edges get points along them, so they can taper and wobble
      let L = 0;
      for (let i = 0; i + 1 < pts.length; i++) L += dist3(pts[i], pts[i + 1]);
      // the firm line runs past its ends a little too
      const cw = pro ? (raw.w ?? 1) : 1;
      // curves and closed rings: a hand laps round a ring, it doesn't flick off it, so no run-past there
      const chord = dist3(pts[0], pts[pts.length - 1]);
      const curl = pro ? (chord < 0.05 * L ? 0 : chord < 0.8 * L ? 0.2 : 1) : 1;
      const fo = () => curl * Math.min(0.5 * L, 0.03 * U, Math.max(0.004 * U, L * (0.04 + 0.1 * (rnd() + 0.5))));
      let firm = L < 0.004 * U ? pts : extend(pts, fo(), fo());
      if (L >= 0.004 * U) {
        // even the firm line isn't ruler-straight
        const fw = [rnd() * 0.0012 * U, rnd() * 0.0012 * U, rnd() * 0.0012 * U];
        const fl = (0.1 + 0.1 * (rnd() + 0.5)) * U;
        const fp = rnd() * 6.28;
        let sA = 0;
        firm = firm.map((q, i) => {
          if (i) sA += dist3(firm[i - 1], q);
          const w = Math.sin((sA / fl) * 6.28 + fp);
          return [q[0] + fw[0] * w, q[1] + fw[1] * w, q[2] + fw[2] * w];
        });
      }
      emit(out[0], firm, (0.6 + 0.75 * (rnd() + 0.5)) * cw, L < 0.004 * U ? 1 : 0.4);
      if (L < 0.004 * U) continue; // specks: one firm stroke is enough
      [1, 2].forEach((k) => {
        if (pro && k === 2 && cw < 0.45) return; // a lost line in full light gets one loose pass, not two
        // loose passes: run past both ends (more on long strokes, capped), sit a hair off the line, wobble gently
        const over = () => curl * Math.min(0.8 * L, 0.09 * U, Math.max(0.015 * U, L * (0.12 + 0.25 * (rnd() + 0.5)))) * (k === 2 ? 0.75 : 1);
        const amp = (k === 2 ? 0.006 : 0.0035) * U;
        const j = [rnd() * amp, rnd() * amp, rnd() * amp];
        const wa = (k === 2 ? 0.0038 : 0.0026) * U;
        const wv = [rnd() * wa, rnd() * wa, rnd() * wa];
        const lam = (0.12 + 0.1 * (rnd() + 0.5)) * U;
        const ph = rnd() * 6.28;
        const p0 = pts[0];
        const pn = pts[pts.length - 1];
        const d0 = unit3(p0, pts[1]);
        const d1 = unit3(pts[pts.length - 2], pn);
        const o0 = over();
        const o1 = over();
        const line = [[p0[0] - d0[0] * o0, p0[1] - d0[1] * o0, p0[2] - d0[2] * o0], ...pts, [pn[0] + d1[0] * o1, pn[1] + d1[1] * o1, pn[2] + d1[2] * o1]];
        let sAcc = -o0;
        const moved = line.map((q, i) => {
          if (i) sAcc += dist3(line[i - 1], q);
          const w = Math.sin((sAcc / lam) * 6.28 + ph);
          return [q[0] + j[0] + wv[0] * w, q[1] + j[1] + wv[1] * w, q[2] + j[2] + wv[2] * w];
        });
        emit(out[k], moved, (0.5 + 0.9 * (rnd() + 0.5)) * (pro ? 0.6 + 0.4 * cw : 1), 0.2, L > 0.05 * U ? 2 : 0);
      });
    }
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(wm);
    const t0 = along(c) * 0.55;
    const t1 = t0 + 0.45;
    const make = (o2, mat, pass) => {
      const g = new LineSegmentsGeometry().setPositions(new Float32Array(o2.pos));
      g.setAttribute('instancePress', new THREE.InstancedBufferAttribute(new Float32Array(o2.press), 2));
      const l = new LineSegments2(g, mat);
      l.userData.n = o2.pos.length / 6;
      l.userData.sketchSkip = true;
      l.visible = false;
      l.frustumCulled = false;
      m.add(l);
      strokes.push({l, t0, t1, pass});
      if (pass === 'firm') {
        // its own view of the same strokes, so it can show all of them while the tracing is part way
        let v = new LineSegmentsGeometry();
        let al = null;
        if (pro) {
          // pro: the ghost gets its own order, strictly across the object (a slightly ragged front), so it draws on
          // like a quick pencil pass travelling across, not strokes popping up all over
          const n = o2.pos.length / 6;
          const key = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const q = o2.pos;
            tmp.set((q[i * 6] + q[i * 6 + 3]) / 2, (q[i * 6 + 1] + q[i * 6 + 4]) / 2, (q[i * 6 + 2] + q[i * 6 + 5]) / 2).applyMatrix4(wm);
            // a wavy, uneven front: it bends with height and depth, and each line sits a little ahead or behind
            key[i] = along(tmp) + 0.09 * Math.sin((tmp.y / D) * 7 + 1.3) + 0.06 * Math.sin((tmp.z / D) * 11 + 4.1) + 0.08 * rnd();
          }
          const ord = Array.from({length: n}, (_, i) => i).sort((a, b) => key[a] - key[b]);
          const P2 = new Float32Array(n * 6);
          const R2 = new Float32Array(n * 2);
          al = new Float32Array(n);
          ord.forEach((j, i) => {
            for (let c = 0; c < 6; c++) P2[i * 6 + c] = o2.pos[j * 6 + c];
            R2[i * 2] = o2.press[j * 2];
            R2[i * 2 + 1] = o2.press[j * 2 + 1];
            al[i] = key[j];
          });
          v.setPositions(P2);
          v.setAttribute('instancePress', new THREE.InstancedBufferAttribute(R2, 2));
          v.setAttribute('instanceKey', new THREE.InstancedBufferAttribute(al, 1));
        } else for (const k in g.attributes) v.setAttribute(k, g.attributes[k]);
        const gl2 = new LineSegments2(v, PALE);
        gl2.userData.sketchSkip = true;
        gl2.visible = false;
        gl2.frustumCulled = false;
        gl2.renderOrder = 3;
        m.add(gl2);
        pales.push({l: gl2, t0, t1, n: o2.pos.length / 6, al});
      }
      return l;
    };
    if (out[0].pos.length) {
      const firm = make(out[0], FIRM, 'firm');
      // the same firm strokes again, faint, only where they are behind the object: the see-through ghost
      if (HIDDEN) {
        const h = new LineSegments2(firm.geometry, HIDDEN);
        Object.assign(h.userData, firm.userData);
        h.visible = false;
        h.frustumCulled = false;
        h.renderOrder = 2;
        m.add(h);
        strokes.push({l: h, t0, t1, pass: 'firm'});
      }
    }
    if (out[1].pos.length) make(out[1], LOOSE, 'loose');
    if (out[2].pos.length) make(out[2], GHOST, 'loose');
  });
  // depth only: lets the lines know what is in front of them before the fill arrives
  const DEPTH = new THREE.MeshBasicMaterial({colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4});
  const depthMeshes = meshes.map(({m}) => {
    const d = new THREE.Mesh(m.geometry, DEPTH);
    d.userData.sketchSkip = true;
    d.visible = false;
    d.renderOrder = -1;
    m.add(d);
    return d;
  });
  const hulls = [];
  if ((o.outline ?? 1.6) > 0) {
    for (const {m} of meshes) {
      for (const mat of HULLS) {
        const h = new THREE.Mesh(m.geometry, mat);
        h.userData.sketchSkip = true;
        h.visible = false;
        m.add(h);
        hulls.push(h);
      }
    }
  }

  // ------------------------------------------------------------ circles on disc-shaped parts (wheels, knobs, dials)
  let circles = [];
  if (Array.isArray(o.circles)) circles = o.circles;
  else if (o.circles ?? true) {
    const found = [];
    for (const {m} of meshes) {
      const bb = m.geometry.boundingBox;
      const s = bb.getSize(new THREE.Vector3());
      const scl = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
      const ws = [s.x * Math.abs(scl.x), s.y * Math.abs(scl.y), s.z * Math.abs(scl.z)];
      const idx = [0, 1, 2].sort((p, q) => ws[p] - ws[q]);
      const [lo, mid, hi] = idx.map((i) => ws[i]);
      if (hi < 0.08 * D || mid / hi < 0.9 || lo / hi > 0.6) continue;
      const axis = 'xyz'[idx[0]];
      const r = Math.max(s.toArray()[idx[1]], s.toArray()[idx[2]]) / 2;
      const center = bb.getCenter(new THREE.Vector3());
      const wc = center.clone().applyMatrix4(m.matrixWorld);
      if (found.some((f) => f.wc.distanceTo(wc) < 0.04 * D && Math.abs(f.wr - hi / 2) < 0.04 * D)) continue;
      found.push({mesh: m, center: center.toArray(), axis, r, wr: hi / 2, wc});
    }
    found.sort((p, q) => q.wr - p.wr);
    circles = found.slice(0, o.maxCircles ?? 6);
  }
  if (loops && !Array.isArray(o.circles) && (o.circles ?? true)) {
    const all = [...circles, ...loopFound].sort((p, q) => q.wr - p.wr);
    const keep = [];
    for (const c of all) if (!keep.some((k) => k.wc.distanceTo(c.wc) < 0.2 * k.wr && Math.abs(k.wr - c.wr) < 0.35 * k.wr)) keep.push(c);
    // circle what an illustrator would: the biggest round parts, plus any matching set (a watch's three small
    // dials). A lone smaller ring is skipped: on the boombox it was a round recess painted over as a square window
    const big = keep[0]?.wr ?? 0;
    const family = (c) => keep.some((k) => k !== c && Math.abs(k.wr - c.wr) < 0.08 * c.wr && k.wc.distanceTo(c.wc) > 0.5 * c.wr);
    circles = keep.filter((c) => c.wr >= 0.6 * big || family(c)).slice(0, o.maxCircles ?? 6);
  }
  // nothing round on the object: an illustrator still starts with an ellipse, on the floor round its footprint
  if (pro && !circles.length && !Array.isArray(o.circles) && (o.circles ?? true)) {
    circles = [{mesh: scene, center: [ctr.x, box.min.y + 0.001 * D, ctr.z], normal: [0, 1, 0], r: 0.6 * Math.max(size.x, size.z), wr: 0.6 * Math.max(size.x, size.z), floor: true}];
  }
  // a hand-drawn line made of pieces with pen pressure; returned arrays feed one line object per material
  const penOut = () => ({pos: [], press: [], n: 0});
  const pen = (out, pts, pressure, taper) => {
    let L = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push((L += dist3(pts[i - 1], pts[i])));
    const f = 3 + 5 * (rnd() + 0.5);
    const ph = rnd() * 6.28;
    const w = (i) => {
      const t = L > 0 ? acc[i] / L : 0.5;
      return pressure * (taper + (1 - taper) * Math.pow(Math.sin(Math.PI * t), 0.5)) * (0.55 + 0.9 * (0.5 + 0.5 * Math.sin(t * f + ph)));
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      out.pos.push(...pts[i], ...pts[i + 1]);
      out.press.push(w(i), w(i + 1));
    }
  };
  const lineObj = (out, mat, parent) => {
    if (!out.pos.length) return null;
    const g = new LineSegmentsGeometry().setPositions(new Float32Array(out.pos));
    g.setAttribute('instancePress', new THREE.InstancedBufferAttribute(new Float32Array(out.press), 2));
    const l = new LineSegments2(g, mat);
    l.userData.sketchSkip = true;
    l.userData.n = out.pos.length / 6;
    l.visible = false;
    l.frustumCulled = false;
    parent.add(l);
    return l;
  };
  // a quick, slightly wobbly line from a to b that runs on past both ends
  const sketchLine = (a, b, {over = [0, 0], wob = 0.002, jit = 0.0015} = {}) => {
    const d = unit3(a, b);
    const L = dist3(a, b);
    const A = [a[0] - d[0] * over[0] * L, a[1] - d[1] * over[0] * L, a[2] - d[2] * over[0] * L];
    const B = [b[0] + d[0] * over[1] * L, b[1] + d[1] * over[1] * L, b[2] + d[2] * over[1] * L];
    const pts = subdivide([A, B], 0.03 * D);
    const j = [rnd() * jit * D, rnd() * jit * D, rnd() * jit * D];
    const wv = [rnd() * wob * D, rnd() * wob * D, rnd() * wob * D];
    const ph = rnd() * 6.28;
    const n = pts.length - 1;
    const line = pts.map((q, i) => {
      const w = Math.sin((i / Math.max(1, n)) * 3.14 * 1.3 + ph);
      return [q[0] + j[0] + wv[0] * w, q[1] + j[1] + wv[1] * w, q[2] + j[2] + wv[2] * w];
    });
    return rnd() > 0 ? line : line.reverse(); // drawn from either end, as a hand flicks it
  };

  // ------------------------------------------------------------ circles: loose loops round disc-shaped parts
  const CIRC = lineMat(2.0, 0.85, true);
  const CIRC2 = lineMat(1.1, 0.5, true);
  const ells = [];
  for (const c of circles) {
    const [i1, i2] = c.axis === 'x' ? [1, 2] : c.axis === 'y' ? [0, 2] : [0, 1];
    // a ring found from crease lines has a normal instead of an axis: draw in its own plane
    let bu = null;
    let bv = null;
    if (c.normal) {
      const nn = new THREE.Vector3(...c.normal);
      bu = new THREE.Vector3(Math.abs(nn.x) < 0.9 ? 1 : 0, Math.abs(nn.x) < 0.9 ? 0 : 1, 0).cross(nn).normalize();
      bv = nn.clone().cross(bu);
    }
    for (const k of [0, 1]) {
      // a little more than one turn, starting anywhere, the radius drifting as a hand's does
      const out = penOut();
      const turns = 1.06 + 0.2 * (rnd() + 0.5);
      const a0 = rnd() * 6.28;
      const rb = c.r * (1.03 + 0.05 * k + 0.04 * rnd());
      const sq = 1 + 0.05 * rnd();
      const ph = [rnd() * 6.28, rnd() * 6.28];
      const n = 96;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * turns * Math.PI * 2;
        const r = rb * (1 + 0.025 * Math.sin(2 * a + ph[0]) + 0.012 * Math.sin(5 * a + ph[1]) + 0.02 * (i / n));
        const p = [...c.center];
        if (bu) {
          const ca = Math.cos(a) * r * sq;
          const sa = (Math.sin(a) * r) / sq;
          p[0] += bu.x * ca + bv.x * sa;
          p[1] += bu.y * ca + bv.y * sa;
          p[2] += bu.z * ca + bv.z * sa;
        } else {
          p[i1] += Math.cos(a) * r * sq;
          p[i2] += (Math.sin(a) * r) / sq;
        }
        pts.push(p);
      }
      pen(out, pts, 0.8 + 0.4 * (rnd() + 0.5), 0.2);
      const e = lineObj(out, k ? CIRC2 : CIRC, c.mesh);
      if (e) ells.push(e);
    }
  }

  // ------------------------------------------------------------ the block-in: the main outer strokes, drawn alone
  const MAJOR = lineMat(2.2, 0.85, true);
  const majors = [];
  if (blockIn) {
    const pick = majorCands.sort((p, q) => q.score - p.score).slice(0, o.majors ?? 30);
    const byMesh = new Map();
    for (const c of pick) {
      if (!byMesh.has(c.m)) byMesh.set(c.m, []);
      byMesh.get(c.m).push(c);
    }
    for (const [m, list] of byMesh) {
      list.sort((p, q) => p.a - q.a);
      const out = penOut();
      for (const c of list) {
        const pts = subdivide(c.raw, 0.02 * c.U);
        const ov = () => Math.min(0.06 * c.U, c.L * (0.08 + 0.12 * (rnd() + 0.5)));
        pen(out, extend(pts, ov(), ov()), 0.9 + 0.5 * (rnd() + 0.5), 0.3);
      }
      const l = lineObj(out, MAJOR, m);
      const a = list.reduce((x, c) => x + c.a, 0) / list.length;
      if (l) majors.push({l, t0: a * 0.45, t1: a * 0.45 + 0.55});
    }
  }

  // ------------------------------------------------------------ construction: a block-in box and long guides (world)
  const CON = lineMat(1.6, 0.6, true);
  const CON2 = lineMat(1.0, 0.32, true);
  const guideA = penOut();
  const guideB = penOut();
  const guides = [];
  if (o.guides ?? true) {
    const y0 = box.min.y + 0.0005 * D;
    const E = 0.9 * D;
    const gl = (a, b, over) => guides.push({a, b, over});
    const bx = [box.min.x, box.max.x];
    const by = [box.min.y, box.max.y];
    const bz = [box.min.z, box.max.z];
    // long lines on the floor first
    for (const z of bz) gl([bx[0] - E, y0, z], [bx[1] + E, y0, z], [0, 0]);
    for (const x of bx) gl([x, y0, bz[0] - E], [x, y0, bz[1] + E], [0, 0]);
    const ov = () => [0.12 + 0.3 * (rnd() + 0.5), 0.12 + 0.3 * (rnd() + 0.5)];
    // o.block: the box the object sits in, every edge run well past its corners (on by default; wanted back
    // after it was taken out, but without the centre lines and diagonals on top)
    if (o.block ?? true) {
      for (const y of by) for (const z of bz) gl([bx[0], y, z], [bx[1], y, z], ov());
      for (const y of by) for (const x of bx) gl([x, y, bz[0]], [x, y, bz[1]], ov());
      for (const x of bx) for (const z of bz) gl([x, by[0], z], [x, by[1], z], ov());
    }
    // the vertical axis, and one line along the top of the object's long side
    gl([ctr.x, y0, ctr.z], [ctr.x, by[1] + 0.35 * size.y, ctr.z], [0.1, 0]);
    if (size.x >= size.z) gl([bx[0], by[1], ctr.z], [bx[1], by[1], ctr.z], [0.6, 0.6]);
    else gl([ctr.x, by[1], bz[0]], [ctr.x, by[1], bz[1]], [0.6, 0.6]);
    for (const c of circles.filter((q) => !q.floor).slice(0, 2)) {
      // a line through the centre of the biggest circles, as through the car's wheel hubs
      const wc = new THREE.Vector3(...c.center).applyMatrix4(c.mesh.matrixWorld);
      gl([bx[0], wc.y, wc.z], [bx[1], wc.y, wc.z], [0.4, 0.4]);
    }
    for (const g of guides) {
      pen(guideA, sketchLine(g.a, g.b, {over: g.over, wob: 0.003, jit: 0.002}), 0.55 + 0.8 * (rnd() + 0.5), 0.25);
      // about half get a second, lighter pass a little off the first
      if (rnd() > 0.1) pen(guideB, sketchLine(g.a, g.b, {over: [g.over[0] * 0.6 + 0.05, g.over[1] * 0.6 + 0.05], jit: 0.004, wob: 0.003}), 0.7 + 0.5 * (rnd() + 0.5), 0.25);
    }
  }
  const conLs = [lineObj(guideA, CON, scene), lineObj(guideB, CON2, scene)].filter(Boolean);
  // what's drawn early (circles, guides, the block-in) only ever gets covered by the marker fill as it sweeps over,
  // never hidden all at once when the line stage starts (lines should only be built on). They draw before the
  // fill and the see-through depth pass, so only a nearer solid fill can paint over them
  // Where they lie on the object, a twin of each goes over the fill as it arrives, so they darken it rather than
  // leaving pale gaps in it
  const earlyB = [];
  const twins = new Map();
  if (pro && multiply) {
    for (const [mt, w, a] of [[CON, 1.6, 0.6], [CON2, 1.0, 0.32], [CIRC, 2.0, 0.85], [CIRC2, 1.1, 0.5], [MAJOR, 2.2, 0.85]]) {
      mt.transparent = false;
      mt.depthWrite = false;
      const b = lineMat(w, a, true);
      b.depthWrite = false;
      b.userData.a = a;
      twins.set(mt, b);
    }
    for (const l of [...conLs, ...ells, ...majors.map((x) => x.l)]) {
      l.renderOrder = -2;
      const b = new LineSegments2(l.geometry, twins.get(l.material));
      b.userData.sketchSkip = true;
      b.visible = false;
      b.frustumCulled = false;
      l.parent.add(b);
      earlyB.push({a: l, b});
    }
  }

  // ------------------------------------------------------------ the shadow: a soft ink shadow on the floor
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -1.2 * D;
  sc.right = sc.top = 1.2 * D;
  sc.near = 0.01 * D;
  sc.far = 6 * D;
  sun.position.copy(ctr).addScaledVector(L, 3 * D);
  sun.target.position.copy(ctr);
  // the floor shadow, hatched like the shade on the object: a faint wash, lines over most of it, cross-hatched in the core
  const floorMat = new THREE.ShadowMaterial({color: pal.ink, opacity: 1, transparent: true});
  const hatchU = {value: 7};
  const washU = {value: 0}; // a faint tint under the shadow lines: none in the sketch, coming in with the colour
  floorMat.onBeforeCompile = (sh) => {
    sh.uniforms.uHatch = hatchU;
    sh.uniforms.uWash = washU;
    // the shadow arrives in the same marker sweep as the fill, not on its own
    sh.uniforms.uFill = SH.uFill;
    sh.uniforms.uSweepO = SH.uSweepO;
    sh.uniforms.uSweepD = SH.uSweepD;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vWp;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvWp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform float uHatch; uniform float uWash; uniform float uFill; uniform vec3 uSweepO; uniform vec3 uSweepD; varying vec3 vWp;\n${HATCH_GLSL}\n${SHADOW_HATCH}\nvoid main() {`)
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `float ks = 0.8 * dot(vWp - uSweepO, uSweepD);
        float bandS = fract(sin(floor((gl_FragCoord.x + gl_FragCoord.y) / (uHatch * 2.0)) * 43758.5453));
        if (uFill < 0.999 && ks > uFill * 1.3 - 0.3 * bandS) discard;
        float m = 1.0 - getShadowMask();
        float lines = m < 0.03 ? 0.0 : shadowHatch(gl_FragCoord.xy, uHatch, m);
        gl_FragColor = vec4(color, opacity * max(m * 0.16 * uWash, lines * 0.75));`,
      );
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8 * D, 8 * D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ctr.x, box.min.y, ctr.z);
  floor.receiveShadow = true;
  floor.userData.sketchSkip = true;
  const extras = new THREE.Group();
  extras.add(sun, sun.target, floor);
  extras.visible = false;
  scene.add(extras);

  const bg = new THREE.Color(pal.ground);
  const groundC = new THREE.Color(pal.ground);
  const inkC = new THREE.Color(pal.ink);
  const LINER = new THREE.Color(o.liner ?? '#2b2622');
  const PAPER = new THREE.Color(o.paper ?? '#FAFAF8');
  /** o.construct, o.lines, o.ink: 0..1 progress of each stage; o.scissor [x, w] px; o.ground false = no backdrop;
   *  o.ghost 0..1: a pale see-through ghost of every line, before the tracing; o.wash 0..1: a see-through fill ahead of
 *  the solid one; o.colour 0..1: the colour stage after the ink; o.hide: objects of the normal scene to hide meanwhile (its own floor, helpers) */
  const render = (r = {}) => {
    const size2 = renderer.getSize(new THREE.Vector2());
    const W = size2.x;
    const H = size2.y;
    const px = Math.min(W, H) / 1080; // the short side; 1080x1920 is the reference
    for (const m of lineMats) {
      m.resolution.set(W, H);
      m.linewidth = m.userData.w * px;
    }
    const ow = (o.outline ?? 1.6) / 1.6;
    const kc = r.construct ?? 1;
    const kg = r.ghost ?? 0; // the pale see-through ghost of the whole object
    const kw = r.wash ?? 0; // the see-through wash ahead of the solid fill
    const kc2 = r.colour ?? 0;
    const kc2s = clamp01(kc2 * 1.6);
    const kl = r.lines ?? 1;
    const km = r.major ?? (kl > 0 ? 1 : 0);
    const ki = r.ink ?? 1;
    const fade = reveal === 'fade';
    FIRM.opacity = 0.95 * (fade ? kl : 1);
    LOOSE.opacity = 0.6 * (fade ? kl : 1);
    GHOST.opacity = 0.38 * (fade ? kl : 1);
    // the ghost lines fade as the fill comes in, so the finished sketch is solid
    if (HIDDEN) HIDDEN.opacity = hiddenA * (fade ? kl : 1) * (1 - clamp01(ki * 1.3)) * (1 - 0.4 * kw);
    CON.opacity = 0.6 * (fade ? kc : 1);
    CON2.opacity = 0.32 * (fade ? kc : 1);
    CIRC.opacity = 0.85 * (fade ? kc : 1);
    CIRC2.opacity = 0.5 * (fade ? kc : 1);
    // the outline goes down with the firm lines (the depth pass hides its inside), sweeping across like them
    const kFirm = clamp01((kl - 0.28) / 0.72);
    for (const hm of HULLS) {
      const u = hm.uniforms;
      u.uRes.value.set(W, H);
      u.uWidth.value = hm.userData.w * ow * px;
      u.uShift.value.set(hm.userData.shift[0] * px, hm.userData.shift[1] * px);
      u.uAlpha.value = hm.userData.a * (fade ? kl : 1);
      u.uFill.value = fade ? (kl > 0 ? 1 : 0) : kFirm;
      u.uHatch.value = Math.max(7, 13 * px);
    }
    SH.uHatch.value = Math.max(7, 13 * px);
    SH.uAlpha.value = fade ? ki : 1;
    SH.uFill.value = fade ? (ki > 0 ? 1 : 0) : ki;
    SH.uColour.value = kc2;
    SH.uWash.value = fade ? 0 : kw * (1 - clamp01(ki));
    for (const m of inkMats.values()) m.transparent = (fade && ki < 0.999) || (kw > 0.001 && ki < 0.999);
    // in the colour stage the lines turn from the sketch ink to a dark fineliner and the sheet to white paper
    for (const m of lineMats) m.color.lerpColors(inkC, LINER, kc2s);
    for (const hm of HULLS) hm.uniforms.uInk.value.lerpColors(inkC, LINER, kc2s);
    floorMat.color.lerpColors(inkC, LINER, kc2s);
    bg.lerpColors(groundC, PAPER, kc2s);
    // stroke-by-stroke: each part's lines appear in order within its own window of the stage
    for (const s of strokes) {
      // the loose, searching passes go down first; the firm line traces over them a beat later
      const kp = s.pass === 'loose' ? clamp01(kl / 0.7) : clamp01((kl - 0.28) / 0.72);
      const k = fade ? 1 : clamp01((kp - s.t0) / (s.t1 - s.t0));
      s.l.geometry.instanceCount = Math.floor(k * s.l.userData.n);
      s.l.visible = kl > 0.001 && k > 0;
    }
    // the circles loop round first (the car's wheel circles), then the guides go down one after another
    for (const l of conLs) {
      // with no circles to draw first, the guides start straight away
      l.geometry.instanceCount = fade ? l.userData.n : Math.floor(clamp01(ells.length ? kc * 1.45 - 0.4 : kc * 1.15) * l.userData.n);
      l.visible = kc > 0.001;
    }
    for (const e of ells) {
      e.geometry.instanceCount = fade ? e.userData.n : Math.floor(clamp01(kc * 2.2) * e.userData.n);
      e.visible = kc > 0.001;
    }
    for (const h of hulls) h.visible = kl > 0.001;
    for (const d of depthMeshes) d.visible = kl > 0.001;
    for (const b of twins.values()) b.opacity = b.userData.a * clamp01(ki * 1.5);
    for (const s of majors) {
      const k = clamp01((km - s.t0) / (s.t1 - s.t0));
      s.l.geometry.instanceCount = Math.floor(k * s.l.userData.n);
      s.l.visible = k > 0;
    }
    for (const e of earlyB) e.b.visible = e.a.visible && ki > 0.001;
    // the ghost comes up faint, then gives way as the traced lines and the fill take over
    PALE.opacity = 0.3 * kg * (1 - clamp01(ki * 1.5));
    // pro: the ghost is drawn on, stroke by stroke along the sweep, rather than faded up all at once (the fade
    // didn't feel drawn); it still gives way as the fill comes in
    if (pro) PALE.opacity = 0.3 * (1 - clamp01(ki * 1.5));
    for (const p of pales) {
      let cnt = p.n;
      if (p.al) {
        // the front travels across the whole object; everything before it is drawn
        const front = kg * 1.75 - 0.3;
        PALE.userData.front.value = front;
        let lo = 0;
        let hi = p.n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (p.al[mid] <= front) lo = mid + 1;
          else hi = mid;
        }
        cnt = lo;
      }
      p.l.geometry.instanceCount = cnt;
      p.l.visible = kg > 0.001 && cnt > 0 && PALE.opacity > 0.002;
    }

    // swap in the ink; hide the scene's own lights and extras
    const saved = [];
    for (const {m, ink: mat} of meshes) {
      saved.push([m, m.material, m.castShadow]);
      m.material = mat;
      m.castShadow = true;
    }
    const hidden = skipped.map((x) => [x, x.visible]);
    for (const x of skipped) x.visible = false;
    scene.traverse((x) => {
      if ((x.isLight && x !== sun) || (r.hide ?? []).includes(x)) {
        hidden.push([x, x.visible]);
        x.visible = false;
      }
    });
    floor.material.opacity = fade ? ki : 1;
    hatchU.value = Math.max(7, 13 * px);
    washU.value = kc2s;
    extras.visible = ki > 0.001;
    const back = scene.background;
    const env = scene.environment;
    scene.background = r.ground === false ? null : bg;
    scene.environment = null;
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    const sm = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.needsUpdate = true;
    if (r.scissor) {
      renderer.setScissorTest(true);
      renderer.setScissor(r.scissor[0], 0, r.scissor[1], H);
    }
    renderer.render(scene, camera);
    renderer.setScissorTest(false);

    renderer.shadowMap.enabled = sm;
    renderer.toneMapping = tm;
    scene.background = back;
    scene.environment = env;
    for (const [x, v] of hidden) x.visible = v;
    for (const [m, mat, cs] of saved) {
      m.material = mat;
      m.castShadow = cs;
    }
    for (const s of strokes) s.l.visible = false;
    for (const p of pales) p.l.visible = false;
    for (const e of ells) e.visible = false;
    for (const h of hulls) h.visible = false;
    for (const d of depthMeshes) d.visible = false;
    for (const l of conLs) l.visible = false;
    for (const s of majors) s.l.visible = false;
    for (const e of earlyB) e.b.visible = false;
    extras.visible = false;
  };
  const calibrate = () => {
    const w = 270;
    const h = 480;
    const rt = new THREE.WebGLRenderTarget(w, h);
    const saved = meshes.map(({m, ink}) => {
      const sv = [m, m.material];
      m.material = ink;
      return sv;
    });
    const vis = skipped.map((x) => [x, x.visible]);
    for (const x of skipped) x.visible = false;
    SH.uAlbOut.value = 1;
    SH.uFill.value = 1;
    const cc = renderer.getClearColor(new THREE.Color());
    const ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(root, camera);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(null);
    renderer.setClearColor(cc, ca);
    SH.uAlbOut.value = 0;
    for (const [m, mat] of saved) m.material = mat;
    for (const [x, v] of vis) x.visible = v;
    rt.dispose();
    const v = [];
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 200) v.push(px[i * 4] / 255);
    v.sort((a, b) => a - b);
    const q = (f) => v[Math.floor(f * (v.length - 1))] ?? 0;
    const p0 = q(0.01);
    const p1 = q(0.5);
    const ok = v.length > 200 && p1 - p0 > 0.08;
    if (ok) {
      SH.uP0.value = p0;
      SH.uP1.value = p1;
    }
    return {p0, p1, px: v.length, ok};
  };
  const cal = pro ? calibrate() : null;
  return {render, calibrate, info: {meshes: meshes.length, segments: count(eg), crease: angle, circles: circles.length, rings: loopFound.length, majors: majors.length, guides: guides.length, cal}};
}
