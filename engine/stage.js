// The stage: loads any object, frames it, and plays the marker v1 draw-on. Video and web use the same code.
//   const st = await createStage({canvas, object, width, height, opts});
//   st.frame(t)          draw the draw-on at t seconds (0..st.duration)
//   st.still(stage)      'construct' | 'lines' | 'sketch' | 'colour' | 'real'
//   st.resize(w, h)
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {USDZLoader} from 'three/addons/loaders/USDZLoader.js';
import {ThreeMFLoader} from 'three/addons/loaders/3MFLoader.js';
import {ColladaLoader} from 'three/addons/loaders/ColladaLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {createSketchAny, PALETTES} from './sketch.js';

export {PALETTES};
const D2R = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoother = (x) => {
  const u = clamp01(x);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// marker v1 defaults (see preset.json)
export const DEFAULTS = {look: 'marker', pal: 'whitePaper', az: 38, el: 24, rot: 0, fit: 1.35, turn: 2.2, colour: true, paper: 1, hold: 0};

const plain = () => new THREE.MeshStandardMaterial({color: 0xd8d8d8, roughness: 0.6});
/** load a model file by its extension. decoders: base url of the draco/ and basis/ folders */
export async function loadModel(url, renderer, decoders = './decoders/') {
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') {
    const l = new GLTFLoader()
      .setDRACOLoader(new DRACOLoader().setDecoderPath(decoders + 'draco/'))
      .setKTX2Loader(new KTX2Loader().setTranscoderPath(decoders + 'basis/').detectSupport(renderer))
      .setMeshoptDecoder(MeshoptDecoder);
    return (await l.loadAsync(url)).scene;
  }
  if (ext === 'obj') return new OBJLoader().loadAsync(url);
  if (ext === 'fbx') return new FBXLoader().loadAsync(url);
  if (ext === 'usdz' || ext === 'usda' || ext === 'usdc' || ext === 'usd') return new USDZLoader().loadAsync(url);
  if (ext === '3mf') return new ThreeMFLoader().loadAsync(url);
  if (ext === 'dae') return (await new ColladaLoader().loadAsync(url)).scene;
  if (ext === 'stl' || ext === 'ply') {
    const g = await (ext === 'stl' ? new STLLoader() : new PLYLoader()).loadAsync(url);
    if (!g.attributes.normal) g.computeVertexNormals();
    return new THREE.Mesh(g, plain());
  }
  throw new Error(`can't open .${ext}`);
}

/** a short report of what's in the object, and anything that needs a decision */
export function inspect(root, {drop = [], tone = {}} = {}) {
  const meshes = [];
  const mats = new Set();
  let tris = 0;
  root.traverse((m) => {
    if (!m.isMesh) return;
    meshes.push(m);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    mats.add(mat);
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const warn = [];
  if (meshes.length === 1) warn.push('one merged piece: circles come from round edges only; dark areas from its colours');
  if (tris > 1.5e6) warn.push(`very dense (${Math.round(tris / 1000)}k triangles): lines are capped to the sharper folds`);
  const names = meshes.map((m) => `${m.name}:${m.material?.name ?? ''}`.toLowerCase());
  // a stand or floor: named like one, or flat, at the bottom and wider than everything else
  const stands = meshes
    .filter((m, i) => {
      if (drop.some((d) => names[i].split(':').includes(d.toLowerCase()))) return false; // already left out
      if (/floor|ground|socle|plinth|pedestal|backdrop|cyclorama|display|\bstand\b/.test(names[i])) return true;
      const b = new THREE.Box3().setFromObject(m);
      const s = b.getSize(new THREE.Vector3());
      return meshes.length > 1 && s.y < 0.03 * Math.max(s.x, s.z) && b.min.y - box.min.y < 0.02 * size.y && Math.max(s.x, s.z) > 0.95 * Math.max(size.x, size.z);
    })
    .map((m) => m.name || m.material?.name);
  if (stands.length) warn.push(`possible stand or floor (leave out with drop): ${stands.slice(0, 5).join(', ')}`);
  const skipped = Object.entries(tone).filter(([, v]) => v === 'skip').map(([k]) => k.toLowerCase());
  const glass = [...mats].filter((m) => m && !skipped.includes((m.name ?? '').toLowerCase()) && (m.transmission > 0 || (m.transparent && m.opacity < 0.7) || /glass/i.test(m.name ?? '')));
  if (glass.length) warn.push(`see-through glass (hide in the sketch with tone NAME=skip): ${glass.map((m) => m.name).join(', ')}`);
  if (root.getObjectByProperty('isSkinnedMesh', true)) warn.push('bending (skinned) parts: not drawn by the sketch');
  if (root.getObjectByProperty('isPoints', true)) warn.push('point cloud parts: not drawn by the sketch');
  let lum = 0;
  let n = 0;
  for (const m of mats) if (m?.color) (lum += 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b), n++;
  if (n && lum / n < 0.05) warn.push('mostly black: fine for the sketch; the colour stage will be dark');
  return {meshes: meshes.length, materials: mats.size, triangles: Math.round(tris), size: size.toArray().map((x) => +x.toPrecision(3)), names: names.slice(0, 60), warn};
}

/**
 * opts: look 'marker'|'classic', pal, az, el, rot, rotX, fit, look3 [x,y,z] (aim offset, share of size), turn (deg/s),
 *       colour (stage on/off), drop [names], tone {materialName: 'light'|'mid'|'dark'|'skip'}, circles, hi, alpha
 */
export async function createStage({canvas, object, width, height, pixelRatio = 1, opts = {}}) {
  const cfg = {...DEFAULTS, ...opts};
  const pro = cfg.look !== 'classic';
  let W = width;
  let H = height;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true, alpha: !!cfg.alpha});
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  const studioBg = new THREE.Color(cfg.studio ?? '#efede8');
  scene.background = cfg.alpha ? null : studioBg; // studio: the render's background (default a light warm grey)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(20, W / H, 0.01, 100);

  // object: an Object3D, or (THREE, renderer) => Object3D (a loader or your own code)
  const model = typeof object === 'function' ? await object(THREE, renderer) : object;
  // leave out stands and floors by mesh or material name
  const dropNames = (cfg.drop ?? []).map((d) => d.toLowerCase());
  const drop = [];
  model.traverse((m) => {
    if (!m.isMesh) return;
    const names = [m.name, m.material?.name ?? ''].map((n) => n.toLowerCase());
    if (dropNames.some((d) => names.includes(d))) drop.push(m);
  });
  for (const m of drop) m.parent.remove(m);
  // no glass refraction in this studio: see-through glass shows as a light tint in the render
  model.traverse((m) => {
    if (!m.isMesh) return;
    if (m.material?.transmission > 0 || /glass/i.test(m.material?.name ?? '')) Object.assign(m.material, {transmission: 0, transparent: true, opacity: 0.2, depthWrite: false});
  });

  // normalise: largest side 1 unit, sitting on the floor, centred
  const holder = new THREE.Group();
  holder.add(model);
  holder.rotation.y = (cfg.rot ?? 0) * D2R;
  if (cfg.rotX) holder.rotation.x = cfg.rotX * D2R;
  scene.add(holder);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  holder.scale.setScalar(1 / Math.max(...box.getSize(new THREE.Vector3()).toArray()));
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  model.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  // the studio render: a key light and a soft shadow on an invisible floor
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-1.2, 2.4, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 10;
  Object.assign(key.shadow.camera, {left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.1, far: 8});
  scene.add(key);
  // the shadow catcher stays inside the shadow camera's reach: beyond it, wide frames showed a faint edge line
  const floorMat = new THREE.ShadowMaterial({color: 0x000000, opacity: 0.22});
  // and fades out before the edge of that reach, where a soft shadow map leaves a stray dark tick
  floorMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vFl;\nvoid main() {\n\tvFl = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying vec2 vFl;\nvoid main() {')
      .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', 'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( 0.95, 1.1, max( abs( vFl.x ), abs( vFl.y ) ) ) ) );');
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // framing: the bounding sphere fits the narrower field of view, so any frame shape works
  const size = box.getSize(new THREE.Vector3());
  const aim = cfg.look3 ?? [0, 0, 0];
  const target = new THREE.Vector3(aim[0] * size.x, size.y * (0.45 + aim[1]), aim[2] * size.z);
  const R = box.getBoundingSphere(new THREE.Sphere()).radius;
  let dist = 1;
  const fitCamera = () => {
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const vfov = camera.fov * D2R;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    dist = (R / Math.sin(Math.min(hfov, vfov) / 2)) * cfg.fit;
  };
  fitCamera();
  const pose = (az, el) => {
    camera.position.set(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), Math.cos(az * D2R) * Math.cos(el * D2R)).multiplyScalar(dist).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  pose(cfg.az, cfg.el);

  // the draw-on sweeps left to right as the camera sees it
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  right.normalize();
  const toneBy = Object.fromEntries(Object.entries(cfg.tone ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const pal = PALETTES[cfg.pal] ?? PALETTES.whitePaper;
  const hi = cfg.hi ?? (cfg.pal === 'redSheet' ? '#ffd9cf' : undefined);
  const sketch = createSketchAny({tone: (m, mat) => toneBy[(mat?.name ?? '').toLowerCase()], root: holder, scene, renderer, camera, pal, sweep: right.toArray(), circles: cfg.circles, maxSegs: cfg.maxSegs, pro, multiply: pro, hi});

  // paper (marker look): the sketch is drawn into its own multisampled buffer, then laid on paper with a faint tooth,
  // and ink that skips over the tops of the tooth
  const paperAmt = pro ? cfg.paper : 0;
  const rt = new THREE.WebGLRenderTarget(W * pixelRatio, H * pixelRatio, {samples: 4, type: THREE.HalfFloatType});
  const paperQ = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {t: {value: rt.texture}, paper: {value: new THREE.Color(pal.ground)}, res: {value: new THREE.Vector2(W, H)}, amt: {value: paperAmt}, kcol: {value: 0}, unmix: {value: cfg.alpha ? 1 : 0}},
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D t; uniform vec3 paper; uniform vec2 res; uniform float amt; uniform float kcol; uniform float unmix; varying vec2 vUv;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          vec3 c = texture2D(t, vUv).rgb;
          vec2 p = vUv * res;
          float tooth = 0.55 * vn(p / 1.4) + 0.3 * vn(p / 3.3) + 0.15 * vn(p / 9.0);
          vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
          float fib = vn(vec2(q.x / 60.0, q.y / 2.5)) * vn(vec2(q.x / 23.0, q.y / 1.7));
          vec3 W3 = vec3(0.2126, 0.7152, 0.0722);
          float d = clamp(1.0 - dot(c, W3) / max(dot(paper, W3), 1e-3), 0.0, 1.0);
          vec2 sq = mat2(0.5, -0.866, 0.866, 0.5) * p;
          float drag = 0.6 * vn(vec2(sq.x / 2.2, sq.y / 14.0)) + 0.4 * vn(p / 4.0);
          vec3 o = mix(c, paper, amt * (1.0 - 0.85 * kcol) * d * 0.28 * smoothstep(0.62, 0.9, drag));
          o *= 1.0 - amt * (1.0 - unmix) * (0.04 * (tooth - 0.5) + 0.015 * fib); // no paper texture in the see-through version
          gl_FragColor = linearToOutputTexel(vec4(o, 1.0));
          if (unmix > 0.5) {
            // see-through: the smallest opacity that, laid over the paper, gives back this pixel (premultiplied out)
            vec3 cs = gl_FragColor.rgb;
            vec3 ps = linearToOutputTexel(vec4(paper, 1.0)).rgb;
            vec3 need = max((ps - cs) / max(ps, 1e-3), (cs - ps) / max(1.0 - ps, 1e-3));
            float a = clamp(max(need.r, max(need.g, need.b)), 0.0, 1.0);
            a = a < 0.02 ? 0.0 : a;
            gl_FragColor = vec4(cs - (1.0 - a) * ps, a);
          }
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const sketchTo = (o, scissor) => {
    if (!paperAmt && !cfg.alpha) return sketch.render({...o, scissor});
    paperQ.material.uniforms.kcol.value = o.colour ?? 0;
    renderer.setRenderTarget(rt);
    sketch.render(o);
    renderer.setRenderTarget(null);
    if (scissor) {
      renderer.setScissorTest(true);
      renderer.setScissor(scissor[0], 0, scissor[1], H);
    }
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    paperQ.render(renderer);
    renderer.autoClear = ac;
    renderer.setScissorTest(false);
  };
  const real = () => {
    if (cfg.alpha) renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
  };

  // the timeline (seconds), marker v1: circles, box, block-in, faint pass, tracing, fill, colour, wipe
  const noCol = cfg.colour === false;
  const sh = pro ? 1.1 : 0;
  // stopAt: end the draw-on on the finished sketch, or on the colour stage, instead of the render
  const stop = cfg.stopAt ?? 'render';
  const duration = (stop === 'sketch' ? 3.1 : stop === 'colour' && !noCol ? 4.25 : noCol ? 4.7 : 5.8) + sh + (cfg.hold ?? 0);
  const stagesAt = (t) => {
    const gu = clamp01((t - 0.35 - sh) / 1.2);
    return {
      construct: smoother(t / (pro ? 1.3 : 1.0)),
      major: pro ? smoother((t - 1.0) / 1.0) : t > 0.95 ? 1 : 0,
      ghost: pro ? gu * gu * (3 - 2 * gu) : smoother((t - 0.6 - sh) / 0.5),
      lines: smoother((t - 0.95 - sh) / 1.25),
      ink: smoother((t - 2.2 - sh) / 0.85),
      colour: noCol || stop === 'sketch' ? 0 : smoother((t - 3.3 - sh) / 0.9),
      wipe: stop !== 'render' ? 0 : smoother((t - (noCol ? 3.45 : 4.55) - sh) / 0.75),
    };
  };
  // spin: extra turn in degrees (the web player's drag-to-turn)
  const frame = (t, {turn = true, spin = 0} = {}) => {
    pose(cfg.az + (turn ? cfg.turn * t : 0) + spin, cfg.el);
    const s = stagesAt(t);
    const x = Math.round(s.wipe * W);
    if (x > 0) real();
    if (x < W) sketchTo({construct: s.construct, major: s.major, ghost: s.ghost, lines: s.lines, ink: s.ink, colour: s.colour, hide: [floor]}, [x, W - x]);
    if (x > 2 && x < W - 2) {
      // the wipe edge: a thin ink stroke
      renderer.setScissorTest(true);
      renderer.setScissor(x - 2, 0, 4, H);
      renderer.setClearColor(new THREE.Color(noCol ? pal.ink : '#2b2622'), 1);
      renderer.clear(true, false, false);
      renderer.setScissorTest(false);
    }
  };
  const still = (st) => {
    pose(cfg.az, cfg.el);
    if (st === 'colour' && noCol) return false;
    if (st === 'real') return real();
    sketchTo({construct: 1, lines: st === 'construct' ? 0 : 1, ink: st === 'sketch' || st === 'colour' ? 1 : 0, colour: st === 'colour' ? 1 : 0, hide: [floor]});
  };
  const resize = (w, h) => {
    W = w;
    H = h;
    renderer.setSize(W, H, false);
    rt.setSize(W * pixelRatio, H * pixelRatio);
    paperQ.material.uniforms.res.value.set(W, H);
    fitCamera();
  };
  // where the object sits on screen (px), at the start pose
  // where the object sits on screen (px), from its silhouette: the full outline (for "inside the frame"), and the
  // outline with very thin parts (an aerial, a cable) shaved off (for "fills the frame")
  const bounds = () => {
    pose(cfg.az, cfg.el);
    const k = 4;
    const w = Math.max(1, Math.round(W / k));
    const h = Math.max(1, Math.round(H / k));
    const rt2 = new THREE.WebGLRenderTarget(w, h);
    const bg = scene.background;
    const cc = renderer.getClearColor(new THREE.Color());
    const ca = renderer.getClearAlpha();
    scene.overrideMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide});
    scene.background = null;
    floor.visible = false;
    renderer.setRenderTarget(rt2);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt2, 0, 0, w, h, px);
    renderer.setRenderTarget(null);
    renderer.setClearColor(cc, ca);
    scene.overrideMaterial = null;
    scene.background = bg;
    floor.visible = true;
    rt2.dispose();
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0;
    const box = (test) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (test(x, y)) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
      // rows are read bottom-up
      return [x0 * k, (h - 1 - y1) * k, (x1 + 1) * k, (h - y0) * k];
    };
    const r = 3; // shave parts thinner than about 6 * k px
    const core = box((x, y) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!on(x + dx, y + dy)) return false;
      return true;
    });
    const [x0, y0, x1, y1] = box(on);
    return {x0, y0, x1, y1, core: Number.isFinite(core[0]) ? core : [x0, y0, x1, y1], W, H};
  };
  return {frame, still, resize, bounds, stagesAt, duration, renderer, scene, camera, holder, info: sketch.info, pose, ground: pal.ground};
}
