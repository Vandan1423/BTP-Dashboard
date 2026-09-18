/**
 * THE PROJECT REGISTRY
 * ====================
 * The only file you edit to add or change a project. The mission-select screen
 * builds its planets from this array, the router resolves routes from it, and
 * each project page builds its bottom navbar from its `sections`.
 *
 * To claim your slot:
 *   1. Edit your entry below.
 *   2. Write your page in `src/pages/<your id>/index.js` -- it must
 *      default-export `{ mount(ctx), unmount() }`. See pages/nisarg/index.js.
 *   3. That is it. Do not touch main.js, the router, or anything in core/.
 *
 * `load` is a dynamic import on purpose: your code is only downloaded when
 * someone opens your project, so a heavy page cannot slow the landing screen.
 */

/**
 * The shared orbit.
 *
 * Every planet sits on this one ring, and its angle is derived from its position
 * in the PROJECTS array below -- so they are always exactly evenly spaced, and
 * adding or removing a project re-spaces the rest automatically. There are no
 * per-project angles to keep in sync by hand.
 *
 * One shared speed matters too: different speeds would slowly pull them out of
 * even spacing over a session.
 */
export const ORBIT = {
  radius: 7.6,
  speed: 0.016,             // radians per second, the same for every planet
  phase0: -Math.PI / 2,     // the first project sits at the top of the ellipse
};

/* Small inline icons for the bottom navbar. Stroked, 24x24, currentColor. */
const ICON = {
  sphere: `<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.4"/><path d="M12 3.5v17"/>`,
  stack:  `<path d="M12 3.6 3.8 8l8.2 4.4L20.2 8 12 3.6Z"/><path d="M3.8 12.4 12 16.8l8.2-4.4"/><path d="M3.8 16.6 12 21l8.2-4.4"/>`,
  orbit:  `<circle cx="12" cy="12" r="3.6"/><ellipse cx="12" cy="12" rx="9.4" ry="4.6" transform="rotate(-28 12 12)"/>`,
  wave:   `<path d="M2 15c2.2-5 4.4-5 6.6 0s4.4 5 6.6 0 4.4-5 6.6 0"/>`,
};

export const PROJECTS = [
  {
    id: 'vandan',
    name: 'Solar Wind & CME',
    owner: 'Vandan Nagori',
    tagline: 'A coronal mass ejection crossing the inner heliosphere, rendered in 360° from four planets.',
    blurb: `Real magnetohydrodynamic simulation data from a PLUTO run, turned into
            something you can look around inside. Two hundred and one timesteps of a
            coronal mass ejection leaving the Sun and washing over Mercury, Venus,
            Earth and Mars, rendered at 4096×2048 in equirectangular 360° from each
            planet's real orbital position.`,
    accent: '#ff9d4d',
    // Where this planet sits on the disc. Angles are spread so the labels never
    // collide; the drift is slow enough that the layout stays stable.
    planetSize: 0.34,
    sections: [
      {
        id: 'viewer',
        label: '360° Viewer',
        icon: ICON.sphere,
        tint: '#ff9d4d',
        title: 'Explore the render',
        body: `Every frame is equirectangular, so it only looks right mapped onto the
               inside of a sphere. Switch viewpoint between the four planets, scrub
               through the CME arrival, and swap between the plasma tracer and the
               magnetic field lines.`,
      },
      {
        id: 'pipeline',
        label: 'VTK → Frames',
        icon: ICON.stack,
        tint: '#8f7bff',
        title: 'Render your own timestep',
        body: `Upload a single .vtk file, choose which viewpoints you want, and the
               pipeline converts it to a voxel volume, places the cameras at real
               planetary positions, and renders a stack of frames you can explore in
               the same viewer.`,
      },
    ],
    load: () => import('../pages/vandan/index.js'),
  },
  {
    id: 'nisarg',
    name: 'Project Two',
    owner: 'Nisarg',
    tagline: 'Claim this planet. Set your name, tagline and accent in lib/projects.js.',
    blurb: `This planet is unclaimed. Open src/lib/projects.js, set your name, tagline
            and accent colour, then build your page in src/pages/nisarg/index.js.`,
    accent: '#4dd8ff',
    planetSize: 0.30,
    sections: [
      { id: 'overview', label: 'Overview', icon: ICON.orbit, title: 'Your project',
        body: 'Add as many sections as you like. Each one becomes a button in the bar below.' },
    ],
    load: () => import('../pages/nisarg/index.js'),
  },
  {
    id: 'sakshi',
    name: 'SEP Proton Flux Forecasting',
    owner: 'Sakshi Sidhe',
    tagline: 'Relativistic electrons outrun the protons that follow them -- enough of a head start to forecast a solar radiation storm before it arrives.',
    blurb: `Neural networks (M1, M3-MT, M3-ML) trained on SOHO/EPHIN electron and
            proton measurements learn the electron-proton velocity dispersion and
            use it to forecast >10 MeV proton flux 30-60 minutes ahead. Validated
            not just on the held-out 2000-2002 test set but on a real 2003 SEP
            event and a live event that occurred during this project -- neither
            seen during training.`,
    accent: '#b98cff',
    planetSize: 0.30,
    sections: [
      { id: 'overview', label: 'Overview', icon: ICON.orbit, title: 'SEP Proton Flux Forecasting',
        body: `Solar energetic particle (SEP) events can damage spacecraft and
               endanger astronauts. Relativistic electrons from the same eruption
               travel far faster than the following proton flux, so a rise in
               electron flux is an early warning sign. This project trains neural
               networks on that precursor relationship to forecast proton flux
               before the dangerous protons arrive -- see the Forecast tab: pick
               any date range and model, and watch that model's real prediction
               play out as a Sun-to-Earth particle stream.` },
      { id: 'forecast', label: 'Forecast', icon: ICON.wave, tint: '#b98cff',
        title: 'Forecast a real SEP event',
        body: 'Pick a date range and model to see the forecast.' },
    ],
    load: () => import('../pages/sakshi/index.js'),
  },
];

export const getProject = (id) => PROJECTS.find((p) => p.id === id) || null;

/** The select screen scales the orbit down on narrow viewports so no planet is
 *  ever pushed off frame. */
export const MAX_ORBIT = ORBIT.radius;

/* The disc inclination and every other camera value now live in
   lib/viewConfig.js, so there is one place to tune the framing. */
