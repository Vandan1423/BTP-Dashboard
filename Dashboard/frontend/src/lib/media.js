/**
 * WHERE THE RENDERED ASSETS LIVE
 * ==============================
 * Every URL that points at a render is built here and nowhere else. When the
 * site moves from the Vite dev server to FastAPI on the GPU box, the base
 * changes in one place and no page code is touched.
 *
 * In dev, `/media` is served by the `btp-media` plugin in vite.config.js
 * straight out of `BTP/Vandan/output/renders`, so nothing is copied or
 * duplicated. In production FastAPI mounts the same folder at the same path.
 */

export const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE ?? '/media';

/** The four viewpoints, in orbital order outward from the Sun. */
export const BODIES = ['Mercury', 'Venus', 'Earth', 'Mars'];

/**
 * The two render sets. Both are complete: 201 frames per body, 4096x2048
 * equirectangular, 20 fps.
 *
 *   cme    - the `tr1` plasma tracer, the CME itself.  7-12 MB per body.
 *   field  - the traced magnetic field lines.          45-75 MB per body.
 */
export const LAYERS = {
  cme: {
    id: 'cme',
    label: 'CME plasma',
    video: (body) => `${MEDIA_BASE}/cme_360/${body}.mp4`,
    frame: (body, n) => `${MEDIA_BASE}/cme_360/${body}/frame_${String(n + 1).padStart(4, '0')}.png`,
  },
  field: {
    id: 'field',
    label: 'Magnetic field',
    video: (body) => `${MEDIA_BASE}/fieldlines_360/${body}_fieldlines.mp4`,
    frame: (body, n) => `${MEDIA_BASE}/fieldlines_360/${body}/frame_${String(n + 1).padStart(4, '0')}.png`,
  },
};

export const videoUrl = (body, layer = 'cme') => LAYERS[layer].video(body);

/**
 * A 1024x512 copy of the same render, for the four-up comparison grid.
 *
 * Not a shortcut. The full 4096x2048 stream is right for the single viewer,
 * where you can zoom in and a whole screen is given to one sphere. In the grid
 * a pane is roughly 640 pixels wide, so a 4096-wide texture is sixteen times
 * more data than any pixel can show -- and with four of them the per-frame
 * texture upload, not the drawing, is what costs. Measured at 22 to 38 ms a
 * frame on the full streams; the proxies bring that back inside the budget.
 *
 * Generated once with ffmpeg from the originals:
 *   ffmpeg -i cme_360/<body>.mp4 -vf scale=1024:512 -crf 20 \
 *          cme_360_proxy/<body>.mp4
 */
export const gridVideoUrl = (body) => `${MEDIA_BASE}/cme_360_proxy/${body}.mp4`;

/** Full-resolution still for one frame. `n` is the 0-based VTK index. */
export const frameUrl = (body, n, layer = 'cme') => LAYERS[layer].frame(body, n);

/**
 * A 512x256 still of the same frame, for a card-sized preview.
 *
 * The originals are 8.7 MB each. Four of them on one results grid is 35 MB of
 * download to fill four thumbnails a few hundred pixels wide, which is the
 * same mistake the scrubber would have made against the full-resolution
 * frames. These are 7 KB apiece.
 *
 * Generated once from the proxies, which is far faster than re-decoding 804
 * PNGs:
 *   for b in Mercury Venus Earth Mars; do
 *     ffmpeg -i cme_360_proxy/$b.mp4 -vf scale=512:256 -q:v 5 \
 *            cme_360_thumb/$b/frame_%04d.jpg
 *   done
 */
export const thumbUrl = (body, n) =>
  `${MEDIA_BASE}/cme_360_thumb/${body}/frame_${String(n + 1).padStart(4, '0')}.jpg`;

/**
 * A 2048x1024 still of the same frame, about 250 KB, for looking around inside.
 *
 * The frame explorer shows up to four of these at once. Four full renders is
 * 35 MB to download and 130 MB of texture memory, for panes that are a third
 * of the screen wide and show a fifth of the sphere's width each -- detail with
 * nowhere to go. The full PNG is still fetched for a single view, once it has
 * been looked at for a moment.
 *
 *   for b in Mercury Venus Earth Mars; do for f in cme_360/$b/frame_*.png; do
 *     ffmpeg -i "$f" -vf scale=2048:1024 -q:v 4 cme_360_still/$b/$(basename "$f" .png).jpg
 *   done; done
 */
export const stillUrl = (body, n) =>
  `${MEDIA_BASE}/cme_360_still/${body}/frame_${String(n + 1).padStart(4, '0')}.jpg`;

/* The Solar-MACH ephemeris (`Vandan/input/ephemeris/camera_positions.csv`) is
   NOT under the media root and is deliberately not reachable through it -- the
   guard in vite.config.js rejects anything that escapes. It is 72 KB, so when
   phase 5 needs it, it gets copied into `public/data/` and shipped as a normal
   build asset rather than punching a second hole in the static server. */
