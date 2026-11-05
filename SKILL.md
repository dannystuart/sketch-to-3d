---
name: sketch-to-3d
description: Turns any 3D object into a hand-drawn marker sketch that draws itself on (circles, construction box, outlines, hatching, marker fill, colour) and then wipes to the real 3D render. Makes a video at any size (with a see-through version, stage stills and a review strip) and a live version for a web page with code to paste in. Works on three.js scenes, objects built in three.js code, and GLB, GLTF, OBJ, FBX, STL, PLY, USDZ, 3MF and DAE files. Use it whenever someone wants a 3D model shown as a sketch, a drawn-on or sketch-to-render reveal, a concept or marker sketch of a product, or a sketch effect on a 3D object for a video or a website, even if they don't name this skill.
---

# sketch-to-3d

Draws a 3D object as a designer's marker sketch, then wipes to the real render. Video and web use the same engine, so they match.

Order of the draw-on (6.9 s, or 5.8 s without colour): circles on round parts, box guides, main outer lines, a faint pencil pass, darker tracing, marker fill with a hatched shadow, the colour stage, the wipe to the render.

Run commands from this skill's folder. First time only: `pnpm install` (or `npm install`). Needs Node 18+ and ffmpeg. If Chromium is missing: `npx playwright install chromium`.

## Steps

1. **Check the object (seconds).**
   `node scripts/render.mjs <model> --out <dir> --only stills --size <final size>`
   - Use the same `--size` and look options you'll use for the final output, so the stills are framed the same way. The web version defaults to `1080x1080`.
   - Read the warnings it prints.
   - Look at `stills/construct.png`, `lines.png`, `sketch.png`, `colour.png` (if the colour stage is on) and `real.png`.
   - Fix problems with the options below, not by editing `engine/`.
2. **Show the stills to the user** before making the video or the web version.
3. **Video:** `node scripts/render.mjs <model> --out <dir> --size <same size> [--alpha | --prores] [--hold 1]`
4. **Web:** `node scripts/web.mjs <model> --out <dir> --play scroll --end spin`. Its preview page has a tab for each way of playing, so the user can choose. Only `<dir>/sketch-to-3d/` goes on the site. See `references/web.md`.
5. **Check before handing over.**
   - Every check in `report.json` passes. `lines only build` runs only on a full video, not on stills or web.
   - Look at `moments.png`, or at the web preview served over http.
   - Say what each output is for.

For an object built in code, use `--code <module.js>` instead of a model path. The module exports `default (THREE) => Object3D` (async is fine). For an existing three.js scene, write a small module like this that returns the object to sketch.

## Options (render.mjs and web.mjs)

| Option | Use |
|---|---|
| `--size WxH` | Video frame, or the web element's shape. Any shape: `1080x1920` (vertical), `1080x1080` (square), `1920x1080` (wide), `3840x2160` (4K) |
| `--look marker\|classic` | `marker` (default) is the full look. `classic` is the earlier, plainer one |
| `--pal whitePaper\|redSheet\|pencil\|blueprint` | Paper and ink colours. Default `whitePaper` |
| `--az 38 --el 24` | Camera angle in degrees (around, and up) |
| `--rot`, `--rotX` | Turn the object itself, in degrees (for models that face the wrong way or lie on their side) |
| `--fit 1.35` | Framing. Smaller is closer. Thin parts like an aerial make objects sit small: try 1.0. The `inside the frame` check catches going too far |
| `--aim x,y,z` | Move the aim point, as a share of the object's size. A negative y moves the object up the frame: use it when a tall thin part (an aerial) leaves the body sitting low, e.g. `0,-0.12,0`. For a close-up on one part: `0.25,0,0` with `--fit 0.55` |
| `--turn 2.2` | Camera turn during the draw-on, in degrees per second (0 = still camera) |
| `--no-colour` | Skip the colour stage |
| `--studio '#hex'` | The render's background. Video default: a light warm grey. When someone asks for red paper, keep it red with `--studio '#D9261C'`. The web version defaults to the paper colour |
| `--stop sketch\|colour` | End the draw-on on the finished sketch, or on the colour stage, instead of the render |
| `--hold 1` | Extra seconds on the finished render at the end. Without it the render shows for about half a second; 1 is good for social video |
| `--drop a,b` | Leave out meshes or materials by name (display stands, floors, backdrops) |
| `--tone name=skip` | Per material: `skip` (hide in the sketch; use for clear glass over a dial), `dark`, `mid`, `light` |
| `--no-circles` | No circle guides (for organic shapes where they land on odd parts) |
| `--at 1,2.5` | render.mjs: also save single frames at these seconds |
| `--alpha` | render.mjs: also write a see-through `.mov` (HEVC with transparency, small). Opens in Final Cut, DaVinci, Keynote, and Premiere on a Mac |
| `--prores` | Like `--alpha`, but ProRes 4444: opens in any editor, about 20x larger |

## Outputs

render.mjs writes into `--out`:

| File | What it is |
|---|---|
| `<name>.mp4` | The draw-on video |
| `<name>-seethrough.mov` | Only with `--alpha` or `--prores`. Paper is transparent, ink and the final render keep their colour. For laying over other footage. If an editor shows black where it should be clear, use `--prores` |
| `stills/*.png` | One still per stage |
| `moments.png` | Ten frames on one sheet, for review |
| `report.json` | The model report, warnings and checks |

web.mjs writes:
- `sketch-to-3d/`, the only folder that goes on the site:
  - `sketch-player.js` (three.js included)
  - the model
  - `decoders/`, only for compressed models
  - `poster.jpg`
- `index.html`, a preview page
- `snippet.html`, the code to paste
- `report.json`

## What the warnings mean

- **One merged piece:** circles come only from round edges, and dark areas come from the model's colours. Usually fine.
- **Possible stand or floor:** leave it out with `--drop`, or it gets drawn as part of the object.
- **See-through glass:** add `--tone <material>=skip` so the dial or display under it shows in the sketch.
- **Mostly black:** the sketch is fine; the colour stage will be dark.
- **Very dense:** only the sharper folds get lines. Raw 3D scans come out as scribble; don't promise them.
- **Bending (skinned) parts or point clouds:** these aren't drawn. Moving rigid parts are fine.

## Keep the look intact

`engine/sketch.js` is a copy of the approved "marker v1" look. Tune one object with the options above.

If the engine itself must change, keep these rules:
- Lines only ever build. Nothing drawn early disappears until the marker fill covers it.
- Every stage is drawn on, not faded.
- Circles go only on real round parts.
- Hatching runs in one direction only.
- The shadow is hatch lines with no fill.

The `lines only build` check in `report.json` catches the first rule. It measures with the camera held still, so a failure means lines really disappear.
