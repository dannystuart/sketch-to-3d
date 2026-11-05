#!/usr/bin/env node
// Render the marker-sketch draw-on of one object to video, stills and a moments strip, plus a self-check report.
//   node render.mjs <model file | --code module.js> --out <dir> [options]
// Options:
//   --size 1080x1920   any frame size     --fps 60
//   --look marker|classic                 --pal whitePaper|redSheet|pencil|blueprint
//   --az 38 --el 24 --rot 0 --fit 1.35 --turn 2.2 (deg/s) --aim x,y,z (close-ups: aim offset, share of size)
//   --no-colour        skip the colour stage
//   --drop name,name   leave out meshes or materials by name (stands, floors)
//   --tone name=skip,name=dark   force a material's tone (light|mid|dark|skip)
//   --no-circles       no circle guides
//   --only stills      stills and report only (fast check before a video)
//   --at 1,2.5         also save single frames of the draw-on at these times (seconds)
//   --alpha            also write a see-through version (.mov, HEVC with transparency); --prores: the same as ProRes 4444
//   --stop sketch|colour  end the draw-on there instead of on the render
//   --studio '#hex'    the render's background colour      --hold 1.5   extra seconds on the render at the end
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle, SKILL} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const code = opt('code');
const VALUED = ['stop', 'studio', 'hold', 'at', 'size', 'fps', 'look', 'pal', 'az', 'el', 'rot', 'rotX', 'fit', 'turn', 'aim', 'drop', 'tone', 'only', 'out', 'code'];
const model = code ? null : args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1].slice(2))));
if (!model && !code) {
  console.error('usage: render.mjs <model file | --code module.js> --out <dir> [options]');
  process.exit(1);
}
const out = path.resolve(opt('out', 'sketch-out'));
const [W, H] = opt('size', '1080x1920').split('x').map(Number);
const fps = Number(opt('fps', 60));
const num = (k) => (opt(k) === undefined ? undefined : Number(opt(k)));
const list = (k) => (opt(k) ? opt(k).split(',').map((s) => s.trim()) : undefined);
const cfg = {
  look: opt('look'), pal: opt('pal'), studio: opt('studio'), hold: num('hold'), stopAt: opt('stop'), az: num('az'), el: num('el'), rot: num('rot'), rotX: num('rotX'), fit: num('fit'), turn: num('turn'),
  look3: opt('aim') ? opt('aim').split(',').map(Number) : undefined,
  colour: flag('no-colour') ? false : undefined, circles: flag('no-circles') ? false : undefined, drop: list('drop'),
  tone: list('tone') ? Object.fromEntries(list('tone').map((t) => t.split('='))) : undefined,
};
for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k];
const name = path.basename(code ?? model).replace(/\.[^.]+$/, '');
fs.mkdirSync(out, {recursive: true});

// the page: the stage, the object (a model file or your own code), and hooks for the recorder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch3d-'));
const entry = path.join(tmp, 'entry.js');
fs.writeFileSync(
  entry,
  `import {createStage, loadModel, inspect} from ${JSON.stringify(path.join(SKILL, 'engine/stage.js'))};
${code ? `import build from ${JSON.stringify(path.resolve(code))};` : ''}
const cfg = window.__CFG;
document.body.style.margin = '0';
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
let report;
const object = async (THREE, renderer) => {
  const o = ${code ? 'await build(THREE)' : `await loadModel('/model/' + ${JSON.stringify(path.basename(model ?? ''))}, renderer, '/decoders/')`};
  report = inspect(o, cfg.opts);
  return o;
};
const st = await createStage({canvas, object, width: cfg.width, height: cfg.height, opts: cfg.opts});
const grab = () => canvas.toDataURL('image/png');
// ink on the page: how far each pixel is from the paper, summed on a small copy (for the "lines only build" check)
const small = document.createElement('canvas');
small.width = 216; small.height = Math.round(216 * cfg.height / cfg.width);
const sx = small.getContext('2d', {willReadFrequently: true});
const g = st.ground.replace('#', '');
const P = [0, 2, 4].map((i) => parseInt(g.slice(i, i + 2), 16));
window.INK = () => {
  sx.filter = 'blur(' + (cfg.width / 216) * 2 + 'px)';
  sx.drawImage(canvas, 0, 0, small.width, small.height);
  const d = sx.getImageData(0, 0, small.width, small.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += Math.max(0, (P[0] - d[i]) + (P[1] - d[i + 1]) + (P[2] - d[i + 2])) / 765;
  return s / (d.length / 4);
};
window.FRAME = (t) => (st.frame(t), grab());
// the same moment with the camera held still: what the lines-only-build check measures
window.INK_AT = (t) => (st.frame(t, {turn: false}), window.INK());
window.STILL = (s) => (st.still(s) === false ? null : grab());
window.INFO = () => ({report, sketch: st.info, bounds: st.bounds(), duration: st.duration, stages: [0, 1, 2, 3, 4, 5, 6].map((t) => st.stagesAt(t))});
window.READY = true;
`,
);
const js = await bundle(entry);
const modelDir = model ? path.dirname(path.resolve(model)) : null;
const decoders = path.join(SKILL, 'node_modules/three/examples/jsm/libs');
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (u === '/' || u === '/index.html') return res.end('<!doctype html><html><body><script type="module" src="/app.js"></script></body></html>');
  if (u === '/app.js') return res.writeHead(200, {'content-type': 'text/javascript'}), res.end(js);
  if (u.startsWith('/model/') && modelDir) file = path.join(modelDir, u.slice(7));
  if (u.startsWith('/decoders/')) file = path.join(decoders, u.slice(10));
  if (!file || !fs.existsSync(file)) return res.writeHead(404), res.end();
  const type = {'.js': 'text/javascript', '.wasm': 'application/wasm'}[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, {'content-type': type});
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const {chromium} = (await import(path.join(SKILL, 'node_modules/playwright/index.mjs'))).default;
const browser = await chromium.launch({args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl']});
const page = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1});
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.addInitScript((c) => (window.__CFG = c), {width: W, height: H, opts: cfg});
await page.goto(url);
await page.waitForFunction(() => window.READY, null, {timeout: 120000});
const info = await page.evaluate(() => window.INFO());
const png = (d) => Buffer.from(d.split(',')[1], 'base64');

// stills of each stage
fs.mkdirSync(path.join(out, 'stills'), {recursive: true});
for (const s of ['construct', 'lines', 'sketch', 'colour', 'real']) {
  const d = await page.evaluate((x) => window.STILL(x), s);
  if (d) fs.writeFileSync(path.join(out, 'stills', `${s}.png`), png(d));
}

// single frames at chosen times (seconds): --at 1,2.5
if (opt('at')) for (const t of opt('at').split(',').map(Number)) fs.writeFileSync(path.join(out, 'stills', `at-${t}.png`), png(await page.evaluate((x) => window.FRAME(x), t)));

const checks = [];
const b = info.bounds;
// the object's longest side (thin parts shaved off) against the frame's short side
const share = Math.max(b.core[2] - b.core[0], b.core[3] - b.core[1]) / Math.min(b.W, b.H);
checks.push({check: 'object fills the frame', pass: share >= 0.495, detail: `its longest side is ${Math.round(share * 100)}% of the frame's short side (needs 50% or more; closer with a lower --fit)`});
checks.push({check: 'object inside the frame', pass: b.x0 > -0.02 * b.W && b.x1 < 1.02 * b.W && b.y0 > -0.02 * b.H && b.y1 < 1.02 * b.H, detail: `box ${[b.x0, b.y0, b.x1, b.y1].map(Math.round).join(',')} in ${b.W}x${b.H}`});
checks.push({check: 'circle guides found', pass: (info.sketch.circles ?? 0) > 0 || cfg.circles === false, detail: `${info.sketch.circles} circles`});

if (opt('only') !== 'stills') {
  const n = Math.round(info.duration * fps);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', path.join(out, `${name}.mp4`)], {stdio: ['pipe', 'inherit', 'inherit']});
  const momentsDir = path.join(tmp, 'moments');
  fs.mkdirSync(momentsDir);
  const momentAt = new Set([...Array(10).keys()].map((k) => Math.round(((k + 0.5) / 10) * (n - 1))));
  const ink = [];
  const fillStart = cfg.look === 'classic' ? 2.2 : 3.3; // the marker fill starts here
  for (let i = 0; i < n; i++) {
    const buf = png(await page.evaluate((t) => window.FRAME(t), i / fps));
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (momentAt.has(i)) fs.writeFileSync(path.join(momentsDir, `m_${String([...momentAt].indexOf(i)).padStart(2, '0')}.png`), buf);
    if (i % 6 === 0 && i / fps < fillStart) ink.push([i / fps, await page.evaluate((t) => window.INK_AT(t), i / fps)]);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  // moments: ten frames in a 5x2 grid
  await new Promise((r) => spawn('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(momentsDir, 'm_%02d.png'), '-vf', `scale=${Math.round((360 * W) / H)}:360,tile=5x2`, '-frames:v', '1', path.join(out, 'moments.png')], {stdio: 'inherit'}).on('close', r));
  let worst = 0;
  let when = 0;
  for (let i = 1; i < ink.length; i++) {
    const d = (ink[i][1] - ink[i - 1][1]) / Math.max(ink[i - 1][1], 1e-6);
    if (d < worst) (worst = d), (when = ink[i][0]);
  }
  checks.push({check: 'lines only build (no ink drops before the fill)', pass: worst > -0.03, detail: `largest drop ${Math.round(-worst * 100)}%${worst < 0 ? ` at ${when.toFixed(1)} s` : ''} (measured with the camera held still)`});
  console.log(`video → ${path.join(out, `${name}.mp4`)} (${n} frames, ${info.duration.toFixed(1)} s)`);
}
if ((flag('alpha') || flag('prores')) && opt('only') !== 'stills') {
  // the see-through version: same draw-on, paper transparent, recorded to ProRes 4444 (keeps transparency)
  const p2 = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1});
  p2.on('pageerror', (e) => console.error('[page error]', e.message));
  await p2.addInitScript((c) => (window.__CFG = c), {width: W, height: H, opts: {...cfg, alpha: true}});
  await p2.goto(url);
  await p2.waitForFunction(() => window.READY, null, {timeout: 120000});
  const n = Math.round(info.duration * fps);
  const mov = path.join(out, `${name}-seethrough.mov`);
  // --alpha: HEVC with transparency (small; Final Cut, DaVinci, Keynote, Safari, Premiere on a Mac). --prores: ProRes 4444 (large; any editor)
  const codec = flag('prores') ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'] : ['-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.9', '-q:v', '65', '-tag:v', 'hvc1', '-pix_fmt', 'bgra'];
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...codec, mov], {stdio: ['pipe', 'inherit', 'inherit']});
  for (let i = 0; i < n; i++) {
    const buf = png(await p2.evaluate((t) => window.FRAME(t), i / fps));
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i === Math.round(n * 0.55)) fs.writeFileSync(path.join(out, 'stills', 'seethrough-check.png'), buf);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`see-through → ${mov}`);
}

const {cal, ...sketchInfo} = info.sketch ?? {}; // cal is internal (colour calibration), not a check
const report = {object: path.basename(code ?? model), size: `${W}x${H}`, settings: cfg, model: info.report, sketch: sketchInfo, checks};
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
fs.rmSync(tmp, {recursive: true, force: true});
console.log(opt('only') === 'stills' ? `stills and report → ${out}` : `stills, moments and report → ${out}`);
for (const w of info.report?.warn ?? []) console.log(`warning: ${w}`);
for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.check}: ${c.detail}`);
