# Dashboard

One site, three BTP projects, presented as a system you fly through.

```
BEGIN  ->  the galaxy blooms out of the button
        ->  three planets on tilted orbits, one per project
        ->  dive through the disc into a project
        ->  its sections, switched from the bar at the bottom
```

Built with Vite and plain three.js. No framework, no model or texture files --
every pixel is generated at runtime.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

---

## Adding your project

You touch **two files**. Nothing else, ever.

### 1. Claim your planet in `src/lib/projects.js`

```js
{
  id: 'nisarg',                     // also the URL: #/nisarg
  name: 'Your Project Name',
  owner: 'Your Name',
  tagline: 'One line, shown under your planet.',
  blurb:   'A paragraph for the project page.',
  accent:  '#4dd8ff',               // planet, orbit, glow, page chrome, dust tint
  planetSize: 0.30,               // radius of your planet
  sections: [
    { id: 'overview', label: 'Overview', icon: ICON.orbit,
      title: 'Heading on the page', body: 'Body copy.' },
  ],
  load: () => import('../pages/nisarg/index.js'),
}
```

Each entry in `sections` becomes a button in the bar at the bottom of your page.

You do not place your planet. Every project shares one orbit and its angle comes
from its position in the array, so the planets are always evenly spaced and adding
or removing a project re-spaces the rest. The orbit itself is `ORBIT` at the top of
the same file.

### 2. Write `src/pages/<your id>/index.js`

For a text page, that is one line:

```js
import { createProjectPage } from '../../ui/ProjectPage.js';
export default createProjectPage();
```

The factory builds the back control, the wordmark, your text and the section bar
from the registry. To render something richer for a section -- a viewer, an
upload form, a chart -- return an element for it:

```js
export default createProjectPage({
  renderSection(section, { project, stage, navigate }) {
    if (section.id !== 'viewer') return null;      // null keeps the default text
    const el = document.createElement('div');
    el.append(/* whatever you like */);
    return el;
  },
  onLeave() { /* dispose anything you created */ },
});
```

**If what you build keeps running on its own** -- a playing video, a WebGL scene,
a timer, an open fetch -- return `{ element, dispose }` instead of a bare element.
`dispose` runs when the visitor clicks a different section button and again when
they leave the page, so it fires exactly once either way.

```js
const viewer = new Thing({ stage });
return { element: viewer.element, dispose: () => viewer.destroy() };
```

Removing the element is not enough by itself. A detached `<video>` carries on
decoding, and an unsubscribed frame callback carries on running.

Pass `rememberSection: true` if your sections keep their own state and the page
should reopen on whichever one the visitor used last, including after a reload.
It is off by default, so a page opens on its first section unless it asks.
`src/pages/vandan/index.js` is the worked example.

### Writing a page from scratch instead

If you would rather not use the factory, default-export `{ mount(ctx), unmount() }`.
`ctx` is `{ root, stage, navigate, project }`: `root` is an empty full-screen div,
`stage` is the shared WebGL stage, `navigate(null)` goes home.

**`unmount` must clean up completely.** The router calls it before the next page
mounts, so anything you leak becomes someone else's bug. After navigating away,
`stage.scene.children.length` should be back to 2 and `stage._callbacks.size` to 1.

### Drawing in 3D

Add to the shared scene and subscribe to the shared frame loop. Never create your
own renderer or `requestAnimationFrame` loop.

```js
const stop = stage.onFrame((dt, elapsed) => { mesh.rotation.y += dt; });
stage.scene.add(mesh);
// in unmount(): stop(); stage.scene.remove(mesh); mesh.geometry.dispose();
```

If your page needs a **world of its own** -- a 360 viewer, a VR scene, anything
where the shared camera drifting along the dust wave is the wrong camera -- borrow
the renderer rather than building a second one:

```js
const restore = stage.setView(myScene, myCamera);
restore();   // in your dispose
```

Still one renderer and one loop; only what gets drawn changes. Afterwards
`stage._view` should be null again.

---

## Layout

```
frontend/src/
├── main.js            boots the stage, starfield and particle field, starts the router
├── core/              shared WebGL. Not for per-project edits.
│   ├── Stage.js         renderer, camera, pointer tracking, one frame loop
│   ├── ParticleField.js the galaxy and the dust wave, in one 34k-point system
│   ├── fieldShaders.js  its GLSL: rotation, morph, cursor repulsion
│   ├── Starfield.js     faint parallax backdrop
│   └── shaders.js       starfield and nebula GLSL
├── lib/
│   ├── projects.js    THE REGISTRY -- the file you edit
│   ├── viewConfig.js  camera angle, distance, disc tilt (see above)
│   ├── router.js      hash routing over the registry
│   ├── tween.js       small timeline runner used by the page transitions
│   └── math.js        easing, damping, seeded RNG
├── pages/
│   ├── entry/         begin screen, galaxy bloom, planets, the dive
│   └── vandan/  nisarg/  sakshi/
├── ui/
│   ├── ProjectPage.js the shared project page factory
│   └── page.css
└── styles/            tokens.css (colours, fonts) + base.css
```

## Changing the camera angle

Every value that controls the framing lives in **`src/lib/viewConfig.js`** and
nowhere else -- the disc's inclination, the camera distance and height, where it
points, and the spin speed. The particle field, the planets and the orbit ring all
read from it, so they can never drift out of agreement.

The one that matters most is `discTilt`. The disc is drawn as an ellipse whose
height is `sin(discTilt)` times its width:

| discTilt | how it reads                                      |
|----------|---------------------------------------------------|
| 0.00     | edge-on, a flat line                              |
| 0.30     | a very shallow ellipse, seen almost from the side |
| 0.52     | half as tall as it is wide                        |
| 0.79     | current, about seven tenths as tall as wide       |
| 1.00     | nearly circular, looking down onto the disc       |
| 1.57     | exactly face-on                                   |

The sign sets which side you view from: positive looks up at the disc from below,
negative looks down on it from above.

## How the field works

One `THREE.Points` carries the whole site. Every particle is generated once with
**two** home positions -- one in the galaxy disc, one in the dust wave -- and the
vertex shader blends between them with a `uMorph` uniform. Navigating is that
uniform going 0 to 1 while the camera falls through the disc. After construction
the CPU only writes uniforms, so 34,000 particles cost nothing per frame.

Three details worth knowing:

- **The disc rotates differentially.** Inner orbits are faster than outer ones,
  following a Keplerian falloff. Rigid rotation reads as a spinning texture.
- **It is three populations, not one.** A dense bulge, a gap, an arm-bearing ring,
  then a diffuse halo. A single smooth radial distribution is just a smudge.
- **The cursor repels it.** Particles are pushed away from the pointer with a
  tangential component so the field swirls rather than dents, and they brighten
  as they move. Stateless, computed per-vertex from a smoothed pointer uniform.

## Vandan's 360 viewer

`src/pages/vandan/viewer/` is the largest thing on the site and a worked example
of the section contract. Three stages behind one `renderSection`:

| stage | file | what it is |
|---|---|---|
| overview | `Overview.js`, `ViewpointCards.js` | what the renders are, and four cards to choose from |
| viewer | `Viewer360.js` | inside the sphere at one planet, with the timeline |
| compare | `CompareGrid.js` | all four viewpoints locked to one timestep |

`ViewerSection.js` owns the door between them and only ever keeps one alive.

- **`ControlPanel.js` is shared by the viewer and the grid.** The caller declares
  which groups it wants and supplies its own buttons; every control does nothing
  but patch a `ViewerState`. It slides away after a few seconds of stillness
  while playing, and the chevron pins it either way.
- **`ViewerState.js` is why that works.** Frame, playing, speed, viewpoint and
  look direction live in one object that emits changes. The panel is a view over
  it, so a second view — a world-space panel inside a headset — is a subscriber
  rather than a rewrite.
- **Playback reports and control requests are told apart by provenance, not by
  comparing values.** `_reportFrame()` sets a flag across one synchronous patch;
  seeks only happen when it is clear. Comparing timestamps with a tolerance
  looked equivalent and deadlocked the video at 2x and 4x.
- **The grid draws four 360 views through one renderer** by putting each sphere
  on its own render layer and drawing the scene four times through scissored
  viewports. Renderer coordinates start at the bottom left, so the flip is
  against `renderer.getSize()` and never `window.innerHeight`.

## Vandan's VTK → Frames

`src/pages/vandan/pipeline/` is feature two: upload one `.vtk` timestep, choose
viewpoints and quality, and get an equirectangular frame per viewpoint back.
Four states behind one `renderSection`, and `PipelineSection.js` owns the door.

| state | file | what it is |
|---|---|---|
| intake | `Intake.js` | drop a `.vtk`, or take whichever archived timestep the inspector shows |
| configure | `JobForm.js` | viewpoints, samples, resolution, the date the cameras use |
| running | `JobMonitor.js` | the job stage by stage, against measured costs |
| done | `Results.js`, `FrameExplorer.js` | the frames, the receipt, and single or compare views inside them |

- **One three.js world runs under all four and never restarts.**
  `PipelineScene.js` borrows the renderer through `stage.setView`, the same
  contract the 360 viewer uses. The cells rush in, the resampling plane sweeps
  through them, the block falls into the Sun, the heliosphere opens out and a
  beam reaches each camera in turn. Only the panels are swapped.
- **The volume is evaluated on the GPU, so it can be handled.** The density field
  lives in the vertex shader (`volumeShaders.js`), which makes the timestep,
  slice, wind/ejecta isolation and density floor in `VolumeInspector.js` plain
  uniforms. Drag orbits with inertia, the wheel dollies, double-click resets.
  Pointing at the volume marches the pointer ray through the field with the CPU
  twin of the shader function in `VolumeCloud.js` and reads out the densest
  cell. The two copies of `fieldParts` must stay identical.
- **The render loader is HTML, not geometry.** `ViewpointMarkers.js` pins a small
  progress ring and a label to each projected planet. Labels are pushed outward
  from the Sun, separated by a few passes of pairwise repulsion, and eased so
  they glide rather than jitter. World-space rings grew with perspective until
  they covered the Sun and each other.
- **Nothing about a job lives in a mount.** `store.js` holds the state, the draft,
  the job, the last snapshot and the explorer's mode at module level, mirrored to
  sessionStorage. Leaving for the 360 viewer tears the section down as the page
  contract requires, and coming back picks up exactly where it was. The
  simulator is shared through `connectOnce()` and can `restore()` a job from its
  start time. `viewer/memory.js` does the same for the 360 section.
- **Single and compare are one view.** `FrameExplorer.js` keeps every pane alive
  with a rectangle and a fade, and changing mode only changes where each
  rectangle is heading. Easing toward those targets is the transition. Textures
  step up from a thumbnail to a 2048 px still, and to the full render only for a
  single view that has been held for a moment.
- **`cost.js` is where every number comes from.** Per-frame cost is dominated by
  how much CME is in shot and spans a factor of fifty across one run, so the
  curve interpolates the real anchors out of `render5.log` in log space rather
  than quoting the 30.2 s run average. A flat average says "thirty seconds" and
  then takes ten minutes.
- **`api.js` talks to the render service, and falls back when it is not there.**
  The service is `backend/`; `npm run dev` forwards `/api` to it on
  port 8000 (`BTP_API` overrides that). `connect()` probes `/api/health` once
  per tab. If nothing answers, or the service says this machine cannot render,
  it drops to a local simulator that walks the same stage list, paces itself
  from `cost.js`, and hands back the archived render of the timestep. The
  simulator never reads an uploaded file. The intake panel says which one is
  answering before anything is dropped, and a job that fails on the real
  service shows the service's own error and log.
- **The wait is compressed per stage, not by one multiplier.** Fast enough to
  make a ten-minute render watchable is fast enough to make the eleven-second
  conversion a single frame, and the conversion is the step worth watching.
  Every time quoted on screen is still the real measured one.
- **Submission is never a blocking POST.** A job id comes back immediately and
  everything after it is polling, off the shared frame loop rather than a
  `setInterval`. A dropped link costs a reconnect, not a render.
- **`FrameExplorer` borrows the view from `PipelineScene`, not from the Stage.**
  `setView` has one slot, so a second caller taking it directly would leave
  nothing to restore. `PipelineScene.takeView` hands it over and hands it back.
- **Escape is never bound inside a section.** The page shell uses it to leave the
  project, and both listeners would fire.

The volume's field is synthetic and meant to be -- parsing a hundred megabytes
of PLUTO output in a browser tab to decorate a form would be absurd, and the
real occupancy comes back from the worker after conversion. What is faithful is
the shape: a radial wind, and the ejection as a flux rope rather than a blob.

## The rendered assets

The 360 viewer plays roughly ten gigabytes of renders that live in the pipeline's
own output folder and are **not** copied into the site. A plugin in
`vite.config.js` mounts `Vandan/output/renders` at `/media` with HTTP Range
support, and `src/lib/media.js` is the only file that builds URLs from it. In
production FastAPI mounts the same folder at the same path, so nothing under
`src/` changes when the site moves to the GPU box.

That plugin serves exactly one directory and answers 403 to any path that
resolves outside it. Keep it that way.

Two sets of derived files are generated once with ffmpeg and checked for by the
viewer: `public/posters/<body>.jpg`, a real perspective view reprojected out of
each sphere with the `v360` filter for the viewpoint cards, and
`renders/cme_360_proxy/`, 1024x512 copies used only by the comparison grid. A
grid pane is about 640 pixels wide, and four full-resolution streams cost far
more in texture upload than the extra detail could ever show.

VTK → Frames adds two more stills sets, one file per frame per body:
`renders/cme_360_thumb/` at 512x256 for the result cards, and
`renders/cme_360_still/` at 2048x1024 for the frame explorer. The commands are
next to `thumbUrl` and `stillUrl` in `src/lib/media.js`.

Range support is not a nicety. Without a `206` response the browser downloads an
entire 4096x2048 video before it can show a frame, and seeking does not work.

## Notes

- **The frame loop runs through `renderer.setAnimationLoop`**, not
  `requestAnimationFrame`, and `renderer.xr.enabled` is on. Outside a headset the
  two are identical. Inside one, only the former is called at all.
- **The intro plays once per tab**, remembered in `sessionStorage`, so returning
  from a project does not replay it. `prefers-reduced-motion` skips it entirely.
- **`stage.step(dt)`** advances the scene by an exact amount and renders one frame.
  Use it to inspect a specific moment when `requestAnimationFrame` is throttled,
  which it is in any background tab.
- The only network request is the Google Fonts stylesheet.

## Backend

`backend/` is the render service for Vandan's VTK → Frames section, documented
in its own README. Everything else is a pure frontend.
