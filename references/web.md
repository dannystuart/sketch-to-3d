# Web output

`node scripts/web.mjs <model | --code module.js> --out <dir> [--play ...] [--end ...] [--base /path/] [--alt 'text'] [look options]`

Only `<dir>/sketch-to-3d/` goes on the site. `index.html`, `snippet.html` and `report.json` stay beside it.

## How it plays

| `--play` | Behaviour |
|---|---|
| `view` (default) | Draws on once the element is 40% on screen |
| `load` | Draws on as soon as the page loads |
| `scroll` | Tied to scrolling: it starts as the element's top comes up from the bottom of the screen, and finishes when its middle reaches the middle of the screen. Scrolling back undraws it. Leave room to scroll below it |
| `pin` | Stays fixed in place while a tall track scrolls past, and the drawing follows how far through the track you are. The paste-in code includes the track |
| `hover` | Draws on while the pointer is over it, and rewinds when it leaves |
| `click` | A click draws it on; another click rewinds it |

| `--end` | Behaviour |
|---|---|
| `hold` (default) | Stays on the render |
| `loop` | Pauses 1.5 s, then starts again |
| `spin` | Stays at the end; dragging turns the object |

`--drag` lets people turn it by dragging at any stage, sketch included (on by default with `--end spin`). `--stop sketch` or `--stop colour` ends on the sketch or the colour stage instead of the render, so people can turn the finished sketch in 3D.

`--size WxH` sets the element's shape (an aspect ratio, default `1080x1080`).

## Built-in care

- The render sits on the paper colour, so the element blends into a page of that colour instead of ending as a grey square. Change it with `--studio`.
- People who turn off motion in their system settings see the finished render straight away.
- Phones get fewer lines on very detailed objects, and at most 2x pixels.
- Plain paper shows while the 3D loads. `poster.jpg` (the finished render) shows only if the browser has no 3D. Give it a description with `--alt`.
- It only redraws when something changes, which saves battery.

## Putting it in a site

Put the `sketch-to-3d/` folder on the site at `/sketch-to-3d/` (or wherever `--base` says), then paste the first block of `snippet.html` where the object should appear. The code points at the site's root, so it works from any page.

- **Plain HTML, Webflow embed, Framer embed:** use the `<div>` and `<script type="module">` block. On Webflow or Framer, host the folder somewhere and pass that address with `--base https://.../sketch-to-3d/`.
- **React / Next.js:** put the folder in `public/sketch-to-3d/` and use the commented client component in `snippet.html`. It loads the player at runtime, and removes it when the component unmounts.
- Several on one page: give each `<div>` its own id (`--id`). Each needs its own folder, or share the player and point `model` at different files.

`mount(el, options)` returns a promise of `{seek(0..1), replay(), progress, destroy()}`, or `null` if the browser can't show 3D (the poster stays). A page can drive it itself, for example from a GSAP timeline. In `scroll` mode the scroll position takes over again on the next frame.

## Previewing

`index.html` has one tab per way of playing: Hero, Pinned scroll, Scroll into place, Sketch only and Hover. It opens on the version chosen with `--play`, and each tab shows its own code, so the user can try them all and pick one. `snippet.html` holds the version chosen with `--play`.

The page needs http, not a file opened from disk, because the model loads over the network:

`python3 -m http.server <port> --bind 127.0.0.1` in the folder (any free port), then open that address.

## File size

The `report.json` check flags models over 8 MB. If one is too big, compress its textures (for example to WebP or KTX2) or simplify the mesh in Blender or with gltf-transform. The player itself is about 1.2 MB (about 300 KB when the server compresses it).

## Inside an existing three.js app

To sketch an object that already lives in your own renderer and scene, import from `engine/stage.js` or `engine/sketch.js` and bundle them with your app.

- `createStage({canvas, object, width, height, opts})` brings its own renderer and studio, and gives `frame(t)`, `still(stage)` and `resize(w, h)`.
- `createSketchAny({root, scene, renderer, camera, pal, pro: true, multiply: true})` draws over your own scene: call `render({construct, major, ghost, lines, ink, colour})` with each stage from 0 to 1. A stage made by `createStage` also gives `stagesAt(t)`, the stage values at time `t`.
