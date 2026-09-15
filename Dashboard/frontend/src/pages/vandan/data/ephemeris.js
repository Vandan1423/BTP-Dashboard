/**
 * WHERE THE PLANETS ACTUALLY WERE
 * ===============================
 * `camera_positions.csv` is the output of the Solar-MACH step of the pipeline:
 * for each of the 201 timesteps, the real heliocentric position of Mercury,
 * Venus, Earth and Mars on that date. Those same numbers were typed into the
 * Blender cameras, so a planet's dot on the orbital map and the viewpoint you
 * stand at inside the sphere are literally the same coordinate.
 *
 * That is the whole reason the map is worth drawing. It is not decoration
 * standing in for the data; it is the data.
 *
 * Positions are in AU in an inertial frame, recovered from Solar-MACH's
 * Carrington longitudes by adding back the Sun's own sidereal rotation -- see
 * SOLAR_WIND_CME_GUIDE.md section 8 for why the raw Carrington values made
 * Earth appear to lap the Sun twice in 55 days.
 */
import { BODIES } from '../../../lib/media.js';

const CSV_URL = `${import.meta.env.BASE_URL}data/camera_positions.csv`;

let cache = null;

/**
 * @returns {Promise<{ byBody: Record<string, Array<{x,y,z,r}>>, extent: number }>}
 * `byBody.Earth[n]` is Earth's position at timestep n. `extent` is the furthest
 * any body gets from the Sun, which is what the map scales itself to.
 */
export function loadEphemeris() {
  if (cache) return cache;
  cache = fetch(CSV_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`ephemeris ${r.status}`);
      return r.text();
    })
    .then(parse);
  return cache;
}

function parse(text) {
  const lines = text.trim().split('\n');
  const head = lines[0].split(',').map((s) => s.trim());
  const col = (name) => head.indexOf(name);
  const iIdx = col('vtk_index');
  const iBody = col('body');
  const iX = col('x_au');
  const iY = col('y_au');
  const iZ = col('z_au');

  const byBody = Object.fromEntries(BODIES.map((b) => [b, []]));
  let extent = 0;

  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const body = f[iBody];
    if (!byBody[body]) continue;
    const x = +f[iX], y = +f[iY], z = +f[iZ];
    const r = Math.hypot(x, y, z);
    byBody[body][+f[iIdx]] = { x, y, z, r };
    if (r > extent) extent = r;
  }
  return { byBody, extent };
}

/** Mean orbital radius over the run -- the faint ring the arc is drawn against. */
export const meanRadius = (track) =>
  track.reduce((s, p) => s + p.r, 0) / track.length;
