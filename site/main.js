// The demo page: three live sketches made with the skill's own player, plus the small bits around them.
import {mount} from './live/sketch-player.js';
import lamp from './live/lamp.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// mount a player when its element gets near the screen, so the page opens fast
const whenNear = (el, fn) => {
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) (io.disconnect(), fn());
  }, {rootMargin: '100% 0px'});
  io.observe(el);
};

const players = {}; // promises from mount()
const resolved = {}; // the finished players, for the frame loop
const use = (k, promise) => {
  players[k] = promise;
  delete resolved[k];
  promise.then((p) => players[k] === promise && (resolved[k] = p));
  return promise;
};

// 1. hero: the boombox draws on as soon as the page opens; drag to turn it at the end
use('hero', mount($('#hero-sketch'), {
  model: 'boombox.glb', poster: 'boombox-poster.jpg', alt: 'A boombox, rendered in 3D',
  play: 'load', end: 'spin', az: 28, fit: 0.95, look3: [0, -0.12, 0], studio: '#FAFAF8',
}));

// 2. pinned: the lamp (built in three.js code) draws on as the track scrolls past
whenNear($('#pin-sketch'), () => {
  use('pin', mount($('#pin-sketch'), {object: lamp, poster: 'lamp-poster.jpg', alt: 'A desk lamp, rendered in 3D', play: 'pin', end: 'spin', fit: 1.15, studio: '#FAFAF8'}));
});

// 3. sketch only: the kettle stops on the drawing; the paper can be swapped
const PAPER = {whitePaper: '#FAFAF8', pencil: '#F3F0E8', redSheet: '#D9261C'};
const kettle = (pal, play = 'view') =>
  mount($('#kettle-sketch'), {model: 'kettle.obj', poster: 'kettle-poster.jpg', alt: 'A kettle', play, end: 'spin', stopAt: 'sketch', colour: false, fit: 1.1, pal, studio: PAPER[pal]});
whenNear($('#kettle-sketch'), () => use('kettle', kettle('whitePaper')));
$$('.papers [role=radio]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (b.getAttribute('aria-checked') === 'true') return;
    $$('.papers [role=radio]').forEach((x) => x.setAttribute('aria-checked', x === b));
    $('.paper-frame').dataset.pal = b.dataset.pal;
    $('.note-spin').classList.remove('show');
    const old = players.kettle;
    delete resolved.kettle;
    (await old)?.destroy();
    use('kettle', kettle(b.dataset.pal, 'load'));
  }),
);

// replay buttons
$$('[data-replay]').forEach((b) => b.addEventListener('click', async () => (await players[b.dataset.replay])?.replay()));

// the stage names under the hero and beside the pinned lamp follow the drawing
const KEYS = ['construct', 'major', 'ghost', 'lines', 'ink', 'colour', 'wipe'];
const tickers = {hero: $('[data-ticker=hero]'), pin: $('[data-ticker=pin]')};
const paint = (list, s) => {
  if (!list) return;
  const items = list.children;
  let cur = -1;
  KEYS.forEach((k, i) => s[k] > 0.01 && (cur = i));
  KEYS.forEach((k, i) => {
    items[i].classList.toggle('on', i === cur);
    items[i].classList.toggle('done', i < cur);
    items[i].style.setProperty('--p', Math.min(1, s[k]).toFixed(3));
  });
};
const loop = () => {
  for (const k of ['hero', 'pin']) {
    const p = resolved[k];
    if (p?.stage) paint(tickers[k], p.stage.stagesAt(p.progress * p.stage.duration));
  }
  $('.note-drag').classList.toggle('show', (resolved.hero?.progress ?? 0) >= 1);
  $('.pin-hint').classList.toggle('gone', (resolved.pin?.progress ?? 0) > 0.04);
  $('.note-spin').classList.toggle('show', (resolved.kettle?.progress ?? 0) >= 1);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
// videos: play only while on screen; with reduced motion, show controls instead
$$('video').forEach((v) => {
  if (reduced) {
    v.controls = true;
    v.preload = 'metadata';
    return;
  }
  new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause())), {threshold: 0.35}).observe(v);
});

// copy buttons
$$('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    const label = $('.copy-label', b);
    const was = label.textContent;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      label.textContent = 'Copied';
    } catch {
      label.textContent = 'Select and copy';
    }
    b.classList.add('done');
    setTimeout(() => ((label.textContent = was), b.classList.remove('done')), 1800);
  }),
);
