// Web player: the same draw-on, live in a page element.
//   import {mount} from './sketch-player.js';
//   mount(document.getElementById('sketch'), {model: 'boombox.glb', play: 'scroll', end: 'spin'});
// play: 'load' | 'view' (when scrolled into view) | 'scroll' (tied to scroll position) | 'pin' (stays put while a tall
//       track scrolls past: put el, position sticky, inside an element with data-sketch-track) | 'hover' | 'click'
// end:  'hold' (stay at the end) | 'loop' | 'spin' (stay at the end; drag turns it)
// drag: true lets people turn the object by dragging at any stage, sketch included (default: on with end 'spin')
// stopAt: 'render' (default) | 'colour' | 'sketch': where the draw-on ends
// object: (THREE) => Object3D instead of model, for an object built in code.
// Other options are the stage's: look, pal, az, el, rot, fit, turn, colour, drop, tone, circles.
// Paths (model, poster, decoders) are relative to this script unless absolute. alt: text for the poster image.
// Returns a promise of {seek(0..1), progress, destroy()}, or null if the browser can't show 3D (the poster stays).
import {createStage, loadModel, PALETTES} from './stage.js';

const here = (p) => new URL(p, import.meta.url).href;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export async function mount(el, o = {}) {
  const play = o.play ?? 'view';
  const end = o.end ?? 'hold';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  // while the 3D loads: plain paper (a picture of the finished render here flashed the end before the start)
  const paper = (PALETTES[o.pal] ?? PALETTES.whitePaper).ground;
  const bg0 = el.style.background;
  el.style.background = paper;
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'pan-y'});
  el.appendChild(canvas);
  const w = () => Math.max(1, el.clientWidth);
  const h = () => Math.max(1, el.clientHeight);
  // phones: fewer lines on very detailed objects, and at most 2x pixels
  const phone = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
  let st;
  try {
    st = await createStage({
      canvas,
      object: o.object ?? ((T, renderer) => loadModel(here(o.model), renderer, here(o.decoders ?? './decoders/'))),
      width: w(),
      height: h(),
      pixelRatio: Math.min(devicePixelRatio || 1, 2),
      opts: {...o, maxSegs: o.maxSegs ?? (phone ? 40000 : undefined)},
    });
  } catch (e) {
    // no 3D in this browser: show the poster (the finished render) instead
    canvas.remove();
    if (o.poster) {
      const img = Object.assign(document.createElement('img'), {src: here(o.poster), alt: o.alt ?? 'A 3D model'});
      Object.assign(img.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover'});
      el.appendChild(img);
    }
    console.warn('sketch-to-3d:', e);
    return null;
  }
  el.style.background = bg0;
  const D = st.duration;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let t = reduced ? D : 0;
  let dir = play === 'load' || reduced ? 1 : 0;
  let spin = 0;
  let last = performance.now();
  let pause = 0;
  let dirty = true;
  if (play === 'view' && !reduced)
    new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (dir = 1)), {threshold: 0.4}).observe(el);
  if (play === 'hover') {
    el.addEventListener('pointerenter', () => (dir = 1));
    el.addEventListener('pointerleave', () => (dir = -2));
  }
  if (play === 'click') el.addEventListener('click', () => (dir = t >= D ? -2 : 1));
  // pin: the element sticks while its track scrolls past; the drawing follows how far through the track you are
  const track = play === 'pin' ? (o.track ?? el.closest('[data-sketch-track]') ?? el.parentElement) : null;
  const pinT = () => {
    const r = track.getBoundingClientRect();
    return clamp01(-r.top / Math.max(1, r.height - innerHeight)) * D;
  };
  const scrollT = () => {
    // starts as the element's top comes up from the bottom of the screen, finishes when its middle reaches the middle
    const r = el.getBoundingClientRect();
    const vh = innerHeight;
    return clamp01((vh - r.top) / (vh / 2 + r.height / 2)) * D;
  };
  const drag = o.drag ?? end === 'spin';
  if (drag) {
    let x0 = null;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (e) => ((x0 = e.clientX), canvas.setPointerCapture(e.pointerId), (canvas.style.cursor = 'grabbing')));
    canvas.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      spin -= ((e.clientX - x0) / w()) * 180;
      x0 = e.clientX;
      dirty = true;
    });
    const up = () => ((x0 = null), (canvas.style.cursor = 'grab'));
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }
  const ro = new ResizeObserver(() => {
    st.resize(w(), h());
    dirty = true;
  });
  ro.observe(el);
  let raf = 0;
  let gone = false;

  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t0 = t;
    if (play === 'scroll' && !reduced) t = scrollT();
    else if (play === 'pin' && !reduced) t = pinT();
    else if (dir) t = Math.min(D, Math.max(0, t + dir * dt));
    if (end === 'loop' && t >= D && dir > 0) {
      pause += dt;
      if (pause > 1.5) (t = 0), (pause = 0);
    }
    if (dir < 0 && t <= 0) dir = 0;
    if (t !== t0 || dirty) {
      st.frame(t, {spin});
      dirty = false;
    }
    if (!gone) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    stage: st,
    // seek(0..1) jumps the drawing (in 'scroll' mode the scroll position takes over again on the next frame)
    seek: (s) => ((t = clamp01(s) * D), (dirty = true)),
    // play it again from the start
    replay: () => ((t = 0), (pause = 0), (dir = 1), (dirty = true)),
    get progress() {
      return t / D;
    },
    // stop and remove it (for frameworks that unmount)
    destroy: () => {
      gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      st.renderer.dispose();
      canvas.remove();
    },
  };
}
