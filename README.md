# sketch-to-3d

**A skill for Claude that turns any 3D model into a marker sketch that draws itself on, then wipes to the real render.**
You get a video at any size, or a live version for your website.

<p align="center"><img src="docs/preview.gif" width="360" alt="A boombox drawn as a red marker sketch, coloured in, then wiped to the real 3D render"></p>

**[See it live →](https://dannystuart.github.io/sketch-to-3d/)**

The drawing goes in the order a designer would: circles on the round parts, a construction box, the outer lines, a faint pencil pass, darker tracing, marker fill with a hatched shadow, colour, and then a wipe to the real thing. About seven seconds.

Works with **GLB, GLTF, OBJ, FBX, STL, PLY, USDZ, 3MF and DAE** files, objects built in three.js code, and existing three.js scenes.

---

## Install

You need [Claude Code](https://claude.com/claude-code), [Node 18 or newer](https://nodejs.org), [git](https://git-scm.com) and [ffmpeg](https://ffmpeg.org/download.html) (on a Mac: `brew install ffmpeg`). [pnpm](https://pnpm.io) is optional; npm works too.

Paste these into a terminal, one line at a time:

```bash
git clone https://github.com/dannystuart/sketch-to-3d.git ~/.claude/skills/sketch-to-3d
```

```bash
cd ~/.claude/skills/sketch-to-3d
```

```bash
pnpm install
```

(No pnpm? `npm install` does the same.)

```bash
npx playwright install chromium
```

That last one downloads the browser the skill draws in: about 500 MB, once. If that exact version is already on your computer, it finishes straight away.

**Check it works.** This takes a few seconds and saves five pictures of a desk lamp, one per stage, in `test-lamp/stills/`, plus a `report.json`:

```bash
node scripts/render.mjs --code evals/lamp-code-video/files/lamp.js --out test-lamp --only stills
```

You should see three lines starting with `ok`. A line starting with `FAIL` is the skill's self-check saying something needs adjusting, usually the framing (`--fit`). Claude reads these and fixes them for you.

Then start a new Claude Code session so it picks up the skill.

## What to say to Claude

Plain words are enough. Claude picks the size, paper and framing, shows you stills of each stage first, then makes the video.

> Make a marker sketch video of chair.glb, square, for Instagram.

> I built a desk lamp in three.js code (lamp.js). Turn it into a sketch-to-render video, widescreen, and give me a see-through version I can drop over other footage in Premiere.

> Make a red-paper sketch of boombox.glb. Skip the colour, go straight from the sketch to the real thing. Frame it a bit tighter.

> I've got a kettle as an OBJ. Put it on my product page so it sketches itself in as people scroll, and they can drag to spin it at the end.

> Just the sketch of my chair, no render, on pencil paper.

## What you get

**Video** (`render.mjs`)

| File | What it is |
|---|---|
| `<name>.mp4` | The draw-on video, any size |
| `<name>-seethrough.mov` | Optional. The paper is see-through, for laying over other footage |
| `stills/*.png` | One picture per stage, for checking before the video is made. With a see-through version, also `seethrough-check.png` |
| `moments.png` | Ten frames on one sheet, for review |
| `report.json` | What's in the model, any warnings, and the self-checks |

**Web** (`web.mjs`)

| File | What it is |
|---|---|
| `sketch-to-3d/` | The only folder that goes on your site: the player (three.js included), your model, a poster image |
| `index.html` | A preview page with a tab for each way of playing, each with its own code |
| `snippet.html` | The code to paste: plain HTML (Webflow and Framer embeds too) and a React / Next.js component |
| `report.json` | The checks, and the folder's size |

The web version can play on load, when it scrolls into view, tied to scrolling, pinned while the page scrolls past, on hover or on click. It can hold on the render, loop, or let people drag to turn it. People who turn off motion in their settings see the finished render straight away. More in [references/web.md](references/web.md).

## Run it yourself

You don't need Claude to use it. From the skill folder:

```bash
node scripts/render.mjs chair.glb --out chair --size 1080x1080
```

```bash
node scripts/web.mjs chair.glb --out chair-web --play scroll --end spin
```

For an object built in code, use `--code lamp.js` instead of a model file. The file exports `default (THREE) => Object3D`.

To preview the web version, the page has to be served over http, because a page opened straight from disk can't load the model. In the output folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`.

## Options

These work for both `render.mjs` and `web.mjs`.

| Option | What it does |
|---|---|
| `--size WxH` | Frame size. `1080x1920` vertical, `1080x1080` square, `1920x1080` wide, `3840x2160` 4K. Video default `1080x1920`, web default `1080x1080` |
| `--pal` | Paper and ink: `whitePaper` (default), `redSheet`, `pencil`, `blueprint` |
| `--look` | `marker` (default) or `classic`, an earlier, plainer look |
| `--az 38 --el 24` | Camera angle in degrees: around, and up |
| `--rot`, `--rotX` | Turn the object itself, for models that face the wrong way or lie on their side |
| `--fit 1.35` | Framing. Smaller is closer |
| `--aim x,y,z` | Move the aim point, as a share of the object's size. `0,-0.12,0` moves the object up the frame |
| `--turn 2.2` | How fast the camera turns while drawing, in degrees per second. `0` holds it still |
| `--no-colour` | Skip the colour stage |
| `--stop sketch\|colour` | End on the finished sketch, or on the colour stage, instead of the render |
| `--studio '#hex'` | The render's background colour |
| `--hold 1` | Extra seconds on the finished render at the end |
| `--drop a,b` | Leave out parts or materials by name (stands, floors, backdrops) |
| `--tone name=skip` | Per material: `skip` (hide it, e.g. clear glass over a dial), `dark`, `mid`, `light` |
| `--no-circles` | No circle guides |
| `--only stills` | `render.mjs`: just the stills and report, in seconds |
| `--at 1,2.5` | `render.mjs`: also save single frames at these seconds |
| `--alpha` | `render.mjs`: also write a see-through `.mov` (a few times the size of the mp4). Mac only. Opens in Final Cut, DaVinci, Keynote, and Premiere on a Mac |
| `--prores` | `render.mjs`: a see-through `.mov` that opens in any editor and can be made on any computer. About 20x larger |
| `--play`, `--end` | `web.mjs`: how it plays and how it ends. See [references/web.md](references/web.md) |

## Good to know

- **Made objects work best.** Raw 3D scans have no clean edges, so they come out as scribble.
- **Bending (rigged) parts and point clouds aren't drawn.** Moving rigid parts are fine.
- **Stands and floors** get drawn as part of the object unless you leave them out with `--drop`.
- **Clear glass** over a dial or screen hides what's under it in the sketch. `--tone <glass material>=skip` fixes that.
- **Big models** make heavy web pages. The report flags anything over 8 MB.
- **A 7-second 1080p video takes about 30 seconds** to make on a recent laptop, and about twice that with a see-through version.
- **White or uncoloured models** (an OBJ with no materials, say) end as a white render on near-white paper. Ask for a darker background, or use `--studio '#hex'`.

## What's in this repo

| Folder | What it is |
|---|---|
| `SKILL.md` | The instructions Claude reads |
| `engine/` | The drawing itself (three.js) and the web player |
| `scripts/` | `render.mjs` (video) and `web.mjs` (web) |
| `references/` | More detail on the web version |
| `evals/` | Three test cases: a lamp in code, a boombox GLB and a kettle OBJ |
| `site/` | The demo page. Not needed to use the skill |
| `docs/` | The preview image above |

## Credits

- Boombox and Alarm Clock 01 models from [Poly Haven](https://polyhaven.com), released as CC0.
- The lamp and kettle were made for this project.
- Built on [three.js](https://threejs.org) (MIT), with [Playwright](https://playwright.dev) and [esbuild](https://esbuild.github.io) for recording and packing.

## Licence

[MIT](LICENSE). Use it for anything, including client work.
