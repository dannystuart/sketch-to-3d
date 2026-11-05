#!/usr/bin/env node
// Pack the live draw-on into a folder you drop into a website.
//   node web.mjs <model file | --code module.js> --out <dir> [--play view|load|scroll|hover|click] [--end hold|loop|spin] [look options as render.mjs]
// Writes <out>/sketch-to-3d/ (the folder for the site: sketch-player.js with three.js inside, the model, decoders/ only
// if the model needs them, poster.jpg) and, beside it, index.html (preview), snippet.html (code to paste) and report.json.
// --base /path/ : where the folder will live on the site (default /sketch-to-3d/). --alt 'text' : the poster's alt text.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {bundle, SKILL} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const VALUED = ['studio', 'stop', 'hold', 'alt', 'base', 'code', 'out', 'play', 'end', 'size', 'look', 'pal', 'az', 'el', 'rot', 'rotX', 'fit', 'turn', 'aim', 'drop', 'tone', 'id'];
const code = opt('code');
const model = code ? null : args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1].slice(2))));
if (!model && !code) {
  console.error('usage: web.mjs <model file | --code module.js> --out <dir> [--play view|load|scroll|hover|click] [--end hold|loop|spin]');
  process.exit(1);
}
const top = path.resolve(opt('out', 'sketch-web'));
const out = path.join(top, 'sketch-to-3d'); // only this folder goes on the site
fs.mkdirSync(out, {recursive: true});
const file = path.basename(code ?? model);
const name = file.replace(/\.[^.]+$/, '');
const num = (k) => (opt(k) === undefined ? undefined : Number(opt(k)));
const list = (k) => (opt(k) ? opt(k).split(',').map((s) => s.trim()) : undefined);
const o = {
  ...(code ? {} : {model: file}), poster: 'poster.jpg', alt: opt('alt'), play: opt('play', 'view'), end: opt('end', 'hold'),
  look: opt('look'), pal: opt('pal'), stopAt: opt('stop'), hold: num('hold'), drag: args.includes('--drag') ? true : undefined, az: num('az'), el: num('el'), rot: num('rot'), rotX: num('rotX'), fit: num('fit'), turn: num('turn'),
  look3: opt('aim') ? opt('aim').split(',').map(Number) : undefined,
  colour: args.includes('--no-colour') ? false : undefined, circles: args.includes('--no-circles') ? false : undefined, drop: list('drop'),
  tone: list('tone') ? Object.fromEntries(list('tone').map((t) => t.split('='))) : undefined,
};
for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
const PAPER = {whitePaper: '#FAFAF8', redSheet: '#D9261C', pencil: '#F3F0E8', blueprint: '#1f4fa8'};
if (!o.studio) o.studio = opt('studio') ?? PAPER[o.pal ?? 'whitePaper'] ?? PAPER.whitePaper;
const [pw, ph] = opt('size', '1080x1080').split('x').map(Number); // the shape of the element in the page

// 1. the player, three.js included, in one file
let entry = path.join(SKILL, 'engine/player.js');
if (code) {
  // an object built in code: bake it into the player
  entry = path.join(out, '.entry.js');
  fs.writeFileSync(entry, `import {mount as m} from ${JSON.stringify(path.join(SKILL, 'engine/player.js'))};\nimport build from ${JSON.stringify(path.resolve(code))};\nexport const mount = (el, o = {}) => m(el, {...o, object: build});\n`);
}
await bundle(entry, {minify: true, outfile: path.join(out, 'sketch-player.js')});
if (code) fs.rmSync(entry);

// 2. the model (and the files a .gltf or .obj points to), and the decoders only if it's compressed
const src = path.resolve(code ?? model);
if (!code) fs.copyFileSync(src, path.join(out, file));
const ext = path.extname(file).toLowerCase();
let gltfJson = null;
if (ext === '.glb') {
  const b = fs.readFileSync(src);
  gltfJson = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
} else if (ext === '.gltf') gltfJson = JSON.parse(fs.readFileSync(src, 'utf8'));
if (ext === '.gltf')
  for (const r of [...(gltfJson.buffers ?? []), ...(gltfJson.images ?? [])]) if (r.uri && !r.uri.startsWith('data:')) fs.cpSync(path.join(path.dirname(src), r.uri), path.join(out, r.uri));
if (ext === '.obj' && fs.existsSync(src.replace(/\.obj$/i, '.mtl'))) fs.copyFileSync(src.replace(/\.obj$/i, '.mtl'), path.join(out, name + '.mtl'));
const used = gltfJson?.extensionsUsed ?? [];
const libs = path.join(SKILL, 'node_modules/three/examples/jsm/libs');
if (used.includes('KHR_draco_mesh_compression')) fs.cpSync(path.join(libs, 'draco'), path.join(out, 'decoders/draco'), {recursive: true});
if (used.includes('KHR_texture_basisu')) fs.cpSync(path.join(libs, 'basis'), path.join(out, 'decoders/basis'), {recursive: true});

// 3. a poster: the finished render, shown while 3D loads (and if it can't)
const tmp = path.join(top, '.poster');
const r = spawnSync('node', [path.join(SKILL, 'scripts/render.mjs'), ...(code ? ['--code', src] : [src]), '--out', tmp, '--studio', o.studio, '--size', `${pw}x${ph}`, '--only', 'stills', ...args.filter((a, i) => !['--out', '--play', '--end', '--id', '--alt', '--base'].includes(a) && !['--out', '--play', '--end', '--id', '--alt', '--base'].includes(args[i - 1]) && a !== model && a !== '--code' && a !== code)], {encoding: 'utf8'});
if (fs.existsSync(path.join(tmp, 'stills/real.png'))) spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(tmp, 'stills/real.png'), '-q:v', '3', path.join(out, 'poster.jpg')]);
const report = fs.existsSync(path.join(tmp, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(tmp, 'report.json'), 'utf8')) : {error: r.stderr};
fs.rmSync(tmp, {recursive: true, force: true});

// 4. the code to paste, and a preview page
const id = opt('id', `sketch-${name}`);
const ratio = `${pw} / ${ph}`;
// where the folder will live on the site; an address from the site's root works from any page
const base = opt('base', '/sketch-to-3d/').replace(/\/?$/, '/');

// the paste-in code for one way of playing. pin needs a tall track around a sticky element
const codeFor = (opts, elId, src) => {
  const call = JSON.stringify(opts);
  const box = opts.play === 'pin'
    ? `<section data-sketch-track style="height: 300vh;">\n  <div id="${elId}" style="position: sticky; top: 0; height: 100vh;"></div>\n</section>`
    : `<div id="${elId}" style="width: 100%; aspect-ratio: ${ratio};"></div>`;
  return `${box}\n<script type="module">\n  import {mount} from '${src}sketch-player.js';\n  mount(document.getElementById('${elId}'), ${call});\n</script>`;
};
const call = JSON.stringify(o);
const snippet = `<!-- sketch-to-3d. Put the "sketch-to-3d" folder on your site at ${base} then paste this where it should appear. -->
${codeFor(o, id, base)}

<!-- React / Next.js: put the folder in public${base} and use this client component.
'use client';
import {useEffect, useRef} from 'react';
export function Sketch() {
  const el = useRef(null);
  useEffect(() => {
    let player;
    let cancelled = false;
    import(/* webpackIgnore: true */ '${base}sketch-player.js').then(async ({mount}) => {
      const p = await mount(el.current, ${call});
      if (cancelled) p?.destroy();
      else player = p;
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, []);
  return <div ref={el} style={{width: '100%', aspectRatio: '${ratio}'}} />;
}
-->
`;
fs.writeFileSync(path.join(top, 'snippet.html'), snippet);

// the preview: one tab per way of playing, each with its own paste-in code
const look = {...o};
delete look.play;
delete look.end;
const modes = [
  {key: 'hero', title: 'Hero', note: 'Sits at the top of the page and draws itself on when the page opens. Drag to turn it at any time.', opts: {...look, play: 'load', end: 'spin'}},
  {key: 'pin', title: 'Pinned scroll', note: 'Stays in place while you scroll; scrolling draws it on, and scrolling back rewinds it. Drag to turn it.', opts: {...look, play: 'pin', end: 'spin'}},
  {key: 'scroll', title: 'Scroll into place', note: 'Draws on as it comes up the page; finished when it reaches the middle of the screen.', opts: {...look, play: 'scroll', end: 'spin'}},
  {key: 'sketch', title: 'Sketch only', note: 'Draws on and stops on the finished sketch. Drag to turn the sketch itself: it is live 3D, not a video.', opts: {...look, colour: false, stopAt: 'sketch', play: 'load', end: 'spin'}},
  {key: 'hover', title: 'Hover', note: 'Draws on while the pointer is over it, rewinds when it leaves.', opts: {...look, play: 'hover', end: 'hold'}},
];
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const panel = (m) => {
  const elId = `${id}-${m.key}`;
  const stage = m.key === 'pin'
    ? `<p class="hint">Scroll down ↓</p><section data-sketch-track style="height: 300vh;"><div id="${elId}" class="pinned"></div></section><p class="hint">That's the end of the track.</p>`
    : m.key === 'scroll'
      ? `<div class="gap">Scroll down ↓</div><div id="${elId}" class="obj"></div><div class="gap"></div>`
      : `<div id="${elId}" class="obj"></div>`;
  return `<section class="panel" data-tab="${m.key}" hidden>
  <p class="note">${m.note}${m.key === 'hero' || m.key === 'sketch' ? ' <button data-replay>Replay</button>' : ''}</p>
  ${stage}
  <details><summary>Code for this version</summary><pre>${esc(`<!-- put the sketch-to-3d folder on your site at ${base} -->\n` + codeFor(m.opts, elId, base))}</pre></details>
</section>`;
};
fs.writeFileSync(
  path.join(top, 'index.html'),
  `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name} – sketch-to-3d preview</title>
<style>
  body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#fafaf8;color:#222}
  nav{position:sticky;top:0;z-index:5;display:flex;gap:4px;padding:10px 16px;background:#fafaf8ee;backdrop-filter:blur(6px);border-bottom:1px solid #e6e4df;overflow-x:auto}
  nav button{font:inherit;padding:6px 12px;border:1px solid #d9d6cf;border-radius:999px;background:#fff;cursor:pointer;white-space:nowrap}
  nav button[aria-selected=true]{background:#222;color:#fff;border-color:#222}
  .panel{max-width:760px;margin:0 auto;padding:16px}
  .note{color:#555;margin:0 0 12px} .note button{font:inherit;margin-left:8px;padding:2px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
  .obj{width:100%;aspect-ratio:${ratio};max-height:78vh}
  .pinned{position:sticky;top:52px;height:calc(100vh - 60px)}
  .gap{height:80vh;display:grid;place-items:center;color:#999}
  .hint{color:#999;text-align:center}
  details{margin:16px 0 40px} pre{white-space:pre-wrap;background:#fff;border:1px solid #e6e4df;border-radius:8px;padding:12px;font-size:12px}
</style></head>
<body>
<nav role="tablist">${modes.map((m) => `<button role="tab" data-tab="${m.key}">${m.title}</button>`).join('')}</nav>
${modes.map(panel).join('\n')}
<script type="module">
  import {mount} from './sketch-to-3d/sketch-player.js';
  const modes = ${JSON.stringify(Object.fromEntries(modes.map((m) => [m.key, m.opts])))};
  const players = {};
  const show = async (key) => {
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === key));
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.dataset.tab !== key));
    scrollTo(0, 0);
    history.replaceState(null, '', '#' + key);
    // each version starts when its tab is first opened, so the hero plays from the start
    if (!players[key]) players[key] = mount(document.getElementById('${id}-' + key), modes[key]);
    else (await players[key])?.replay?.();
  };
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  document.querySelectorAll('[data-replay]').forEach((b) => b.addEventListener('click', async () => (await players[b.closest('.panel').dataset.tab])?.replay()));
  show(location.hash.slice(1) in modes ? location.hash.slice(1) : ${JSON.stringify({load: 'hero', pin: 'pin', scroll: 'scroll', view: 'scroll', hover: 'hover', click: 'hero'}[o.play] ?? 'hero')});
  window.PLAYERS = players;
</script></body></html>
`,
);
const sizes = fs.readdirSync(out).map((f) => [f, fs.statSync(path.join(out, f)).isFile() ? fs.statSync(path.join(out, f)).size : 0]);
const total = sizes.reduce((s, [, b]) => s + b, 0);
const modelMB = code ? 0 : fs.statSync(path.join(out, file)).size / 1e6;
const checks = [
  ...(report.checks ?? []),
  {check: 'model small enough for a page', pass: modelMB < 8, detail: `${modelMB.toFixed(1)} MB (aim under 8 MB; compress textures or simplify if larger)`},
];
fs.writeFileSync(path.join(top, 'report.json'), JSON.stringify({...report, web: {play: o.play, end: o.end, base, siteFolderMB: +(total / 1e6).toFixed(2)}, checks}, null, 2));
console.log(`site folder → ${out} (${(total / 1e6).toFixed(1)} MB); preview, snippet and report → ${top}`);
for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.check}: ${c.detail}`);
console.log(`preview: in ${top} run python3 -m http.server <any free port> --bind 127.0.0.1 and open that address (needs http, not a file opened from disk)`);
