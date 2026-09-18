# Integration notes: plugging ProtonFluxTimeSeries into the dashboard

Research pass over `Dashboard/frontend/` (Vandan's completed project + the shared
scaffolding) to plan bringing the SEP proton-flux ML forecasting work in as project
three, in the same style Vandan used. No app code was changed to produce this file.

## 1. Architecture

`Dashboard/frontend/` is a **Vite** project, **no UI framework** — plain JS/DOM plus
`three.js` (`^0.186.0`). No React/Vue/Svelte, no state library, no GSAP (all animation
is hand-rolled), no post-processing library. Routing is a tiny hand-rolled hash router
(`src/lib/router.js`).

```
src/
├── core/    Stage.js (one renderer/camera/scene/frame-loop, owns pointer state),
│            ParticleField.js + fieldShaders.js (ambient particle field, GLSL),
│            Starfield.js + shaders.js (parallax backdrop)
├── lib/     projects.js (registry — the file you edit), viewConfig.js (camera
│            framing constants), router.js (hash router), tween.js (Timeline),
│            math.js (easing/lerp/damp/RNG), media.js
├── pages/   entry/ (landing scene), vandan/, nisarg/, sakshi/
│            — each pages/<id>/index.js default-exports { mount(ctx), unmount() }
├── ui/      ProjectPage.js (shared page factory incl. bottom nav "dock"), page.css
└── styles/  tokens.css (colors incl. per-project accents), base.css
```

**Golden rule** (from `Dashboard/frontend/README.md`): never create your own
`WebGLRenderer` or `requestAnimationFrame` loop. One `Stage` owns both; a page that
needs its own 3D world borrows the shared renderer via `stage.setView(scene, camera)`
/ `stage.restore()`.

## 2. The landing scene (3 planets)

`src/pages/entry/index.js` + `Planets.js`. Planets are procedural (`SphereGeometry` +
`MeshStandardMaterial`, emissive = accent color) with a shared canvas-generated glow
sprite, evenly spaced around one shared orbit ring (`ORBIT.radius`, `ORBIT.speed`,
`ORBIT.phase0` in `projects.js`), auto-spaced by `2π / PROJECTS.length` — no per-planet
layout math needed when a project is added.

**Interaction is DOM-based, not 3D raycasting.** Each planet has an absolutely
positioned HTML `<button class="node">` whose position is updated every frame to the
planet's *projected screen position* (`Planets.screenPosition(i, camera, w, h)` via
`Vector3.project`). Hover/click are ordinary pointer events on these buttons.

**Click → navigation** is a ~1.2s camera fly-through (`dive()` in `entry/index.js`):
camera z eases from `camDistance` to `-3`, the ambient particle field morphs
(`uMorph`) and dims (`uOpacity`), then `navigate(id)` fires at the end — it is not an
instant page swap. The particle field is owned by `Stage`, not the page, so it
persists continuously across the landing → project-page boundary; `ui/ProjectPage.js`
picks the field up wherever the timeline left it and eases the rest of the way in.
There's no separate loading-screen/overlay component — continuity is masked purely by
this shared dim/morph.

## 3. `src/lib/projects.js` — the registry

Single file to edit. Sakshi's slot **already exists** as a live (not commented-out)
placeholder entry:

```js
{
  id: 'sakshi',
  name: 'Project Three',
  owner: 'Sakshi',
  tagline: 'Claim this planet. Set your name, tagline and accent in lib/projects.js.',
  blurb: `This planet is unclaimed. Open src/lib/projects.js, set your name, tagline
          and accent colour, then build your page in src/pages/sakshi/index.js.`,
  accent: '#b98cff',
  planetSize: 0.30,
  sections: [
    { id: 'overview', label: 'Overview', icon: ICON.orbit, title: 'Your project',
      body: 'Add as many sections as you like. Each one becomes a button in the bar below.' },
  ],
  load: () => import('../pages/sakshi/index.js'),
}
```

Field meanings: `id` doubles as the URL hash (`#/sakshi`) and the `src/pages/<id>/`
directory name. `accent` drives planet color/glow, the dock's active-button glow, and
particle-field tint on dive/section-change — no per-project CSS needed. `sections[]`
is an array of `{ id, label, icon (inline 24×24 SVG path string), tint?, title, body }`
— **each entry becomes one button in the bottom nav bar automatically.** `load` is a
dynamic import so unopened projects cost nothing on the landing screen.

`tokens.css` already defines `--a-sakshi: #b98cff` matching this accent.

## 4. The bottom navigation bar — already built, zero new code needed

Key finding: **Vandan did not build a custom nav bar.** The "dock" is a shared
component in `src/ui/ProjectPage.js` / `src/ui/page.css`, generated automatically from
whatever `project.sections` array is in `projects.js`. Every project gets the
identical dock; Vandan's looks distinctive only because his `sections` array has 2
richer entries and his `renderSection` swaps in real 3D content instead of the default
text panel.

**So: to get an identical bottom nav for the proton-flux project, no nav-bar code
needs to be written at all** — just populate `sections` in `projects.js` (e.g.
`overview`, `forecast`, maybe `models` for the M1/M3-MT/M3-ML comparison) and
implement `renderSection` in `src/pages/sakshi/index.js`.

DOM (built by `ProjectPage.js`):
```js
el.innerHTML = `
  <header class="page__top">
    <button class="back" type="button">
      <span class="back__ring">${BACK_ARROW}</span>
      <span class="back__label">All missions</span>
    </button>
    <span class="wordmark">B.TECH<br>PROJECT</span>
    <span class="page__owner">${project.owner}</span>
  </header>
  <main class="page__body"><div class="panel"></div></main>
  <nav class="dock" aria-label="${project.name} sections">
    ${project.sections.map(s => `
      <button class="dock__btn${s.id === active.id ? ' is-active' : ''}" type="button"
              data-id="${s.id}" aria-label="${s.label}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg>
        <span class="dock__tip">${s.label}</span>
      </button>`).join('')}
  </nav>`;
```

Clicking a `.dock__btn` toggles `.is-active`, optionally persists the choice to
`sessionStorage` (`rememberSection: true`), and cross-fades the panel (CSS
`is-out`/`is-in`, ~0.28s) into whatever `renderSection(section, {project, stage,
navigate})` returns. **Contract**: return `{ element, dispose }` — `dispose()` is
called before the next section mounts, so any running three.js scene, timers, or
model-inference calls must be torn down there.

## 5. Vandan's page as the reference pattern

```js
// src/pages/vandan/index.js
import { createProjectPage } from '../../ui/ProjectPage.js';
import { createViewerSection } from './viewer/ViewerSection.js';
import { createPipelineSection } from './pipeline/PipelineSection.js';

const SECTIONS = { viewer: createViewerSection, pipeline: createPipelineSection };

export default createProjectPage({
  rememberSection: true,
  renderSection(section, { stage }) {
    const build = SECTIONS[section.id];
    if (!build) return null;
    const s = build({ stage });
    return { element: s.element, dispose: () => s.destroy() };
  },
});
```

Sakshi's current stub (`src/pages/sakshi/index.js`) is identical to Nisarg's — just
`export default createProjectPage();` with no `renderSection`, so it falls back to the
default title/body text panel. This is the file to flesh out.

## 6. Shared animation/cursor utilities to reuse (no new dependency needed)

- **`src/lib/tween.js`** — `Timeline` class (`{from,to,dur,delay,ease,onUpdate,onDone}`
  tweens), advanced via a page's own `stage.onFrame` callback. This is the mechanism
  for any transition/camera-move in the new page — no external tweening lib anywhere
  in this project.
- **`src/lib/math.js`** — `clamp`, `lerp`, `invLerp`, `remap`, `damp` (framerate-
  independent smoothing), easing fns (`easeOutCubic`, `easeOutQuint`, `easeInCubic`,
  `easeInOutCubic`, `easeOutBack`), seeded RNG (`mulberry32`), `randomOnSphere`,
  `prefersReducedMotion()`.
- **`stage.pointer` / `pointerSmooth` / `pointerWorld` / `pointerActive`**
  (`core/Stage.js`) — centralized cursor state; read these instead of adding new
  `pointermove` listeners for any in-scene hover interaction.

## 7. Planned integration shape (not yet built)

1. Expand `sections` for the `sakshi` entry in `projects.js` — e.g. `overview`
   (project blurb), `forecast` (the three.js proton-flux visualization), `models`
   (M1 / M3-MT / M3-ML comparison, could reuse the block-diagram style from the LaTeX
   report). Pick real icons (24×24 stroked SVG paths, matching `ICON.sphere/stack/orbit`
   style already in `projects.js`).
2. Build `src/pages/sakshi/forecast/ForecastSection.js` (mirroring
   `vandan/viewer/ViewerSection.js`): construct a private `THREE.Scene`/`Camera`,
   mount via `stage.setView(scene, camera)`, visualize proton/electron flux (e.g. a
   3D time-series ribbon, or an animated Earth/Sun/particle-path scene reacting to
   live or historical flux values), expose `{ element, destroy() }`.
3. Wire it in `src/pages/sakshi/index.js` exactly like Vandan's `SECTIONS` map +
   `renderSection`.
4. Update `accent`/`tagline`/`blurb`/`name` in the `sakshi` entry away from the
   placeholder text.
5. No changes needed anywhere else — landing scene, camera fly-through, and bottom
   nav all pick up the new sections automatically.
