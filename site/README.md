# The demo page

A plain static page: `index.html`, `style.css` and `main.js`, no build step. It's published to GitHub Pages from this folder whenever `main` changes.

To look at it locally, serve this folder over http (a page opened straight from disk can't load the 3D models):

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

## How the pieces were made

Everything here came out of the skill itself, run from the repo root.

**`live/`** holds the web player and the models. The player and the boombox come from:

```bash
node scripts/web.mjs evals/boombox-square-redsheet/files/boombox.glb --out <tmp> --play load --end spin --az 28 --fit 0.95 --aim 0,-0.12,0
```

The same player file also draws the alarm clock (`alarm-clock.glb`, Poly Haven's Alarm Clock 01, with `tone: {alarm_clock_01_Glass: 'skip'}` and `fit: 1.05`) and the lamp (`lamp.js`, passed in as `object`). The posters are the `real.png` still from a `render.mjs` run on each.

**`media/`** holds the short clips, made with `render.mjs` and then made smaller for the web (`ffmpeg -vf scale=…,fps=30 -crf 28`):

| Clip | Made with |
|---|---|
| `lamp-16x9.mp4` | `--code evals/lamp-code-video/files/lamp.js --size 1920x1080 --hold 1` |
| `boombox-red-1x1.mp4` | `boombox.glb --size 1080x1080 --pal redSheet --no-colour --studio '#D9261C' --az 28 --fit 0.95 --aim 0,-0.12,0 --hold 1` |
| `clock-9x16.mp4` | Poly Haven's Alarm Clock 01 as a GLB, `--size 1080x1920 --tone alarm_clock_01_Glass=skip --fit 1.0 --hold 1` |

Each clip's poster is the `sketch.png` still from the same run.
