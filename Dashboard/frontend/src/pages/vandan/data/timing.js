/**
 * FRAMES ARE REAL DATES
 * =====================
 * The simulation files carry no timestamp of their own -- this mapping came
 * from the professor directly, and it is what lets the viewer say
 * "6 November 2024, 23:40 UTC" instead of "frame 180".
 *
 *     t(N) = 2024-09-18 02:52:02.428 UTC + N x 23936 s
 *
 * where N is the index in the original `data.NNNN.vtk` filename. The renders
 * are numbered `frame_0001.png` upward and `frame_0001` is N = 0, so the video's
 * own 0-based frame index IS N. No offset, and worth keeping that way.
 *
 * The whole run spans 200 x 23936 s = 55.4 days.
 * Full derivation: Vandan/docs/SOLAR_WIND_CME_GUIDE.md section 8.
 */

/** First timestep, assumed UTC. The .428 is not noise -- it is in the source. */
export const EPOCH_MS = Date.UTC(2024, 8, 18, 2, 52, 2, 428);

/** Seconds of simulated time between consecutive indices: 598400 / 25. */
export const STEP_SECONDS = 23936;

/** 201 renders, N = 0 .. 200. */
export const FRAME_COUNT = 201;
export const LAST_FRAME = FRAME_COUNT - 1;

/** Playback rate the videos were encoded at. */
export const FPS = 20;

/**
 * What the plasma is doing at each index.
 *
 * These boundaries are measured, not guessed: all 21 source timesteps were
 * scanned for rho, prs and the tracers. Before 160 every tracer is identically
 * zero. At 160-170 `tr1` switches on across 595,938 cells. At 180 the pressure
 * maximum jumps from about 9 to 109, the non-radial velocity components wake
 * up, and a second tracer appears alongside the first -- the signature of a
 * flux rope, not merely a dense blob.
 */
export const PHASES = [
  { id: 'quiet',  from: 0,   to: 159, label: 'Quiet solar wind' },
  { id: 'onset',  from: 160, to: 179, label: 'CME onset' },
  { id: 'peak',   from: 180, to: 189, label: 'CME peak' },
  { id: 'fading', from: 190, to: 200, label: 'Fading' },
];

export const clampFrame = (n) =>
  Number.isFinite(+n) ? Math.max(0, Math.min(LAST_FRAME, Math.round(+n))) : 0;

/** Frame index -> Date. */
export const frameToUtc = (n) =>
  new Date(EPOCH_MS + clampFrame(n) * STEP_SECONDS * 1000);

/** "2024-11-06 23:40 UTC" -- the readout format. */
export function utcLabel(n) {
  const d = frameToUtc(n);
  const p = (v, w = 2) => String(v).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** "18 Sep 2024" -- the compact form, for tight spaces. */
export function dateLabel(n) {
  const d = frameToUtc(n);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Days of simulated time elapsed since the first frame. */
export const elapsedDays = (n) => (clampFrame(n) * STEP_SECONDS) / 86400;

export const phaseAt = (n) => {
  const f = clampFrame(n);
  return PHASES.find((p) => f >= p.from && f <= p.to) ?? PHASES[0];
};

/** Video playback position, in seconds, for a frame index. */
export const frameToTime = (n) => clampFrame(n) / FPS;

/**
 * Video position -> frame index.
 *
 * Rounds down deliberately: a frame is on screen from its own timestamp until
 * the next one, so `time` sitting anywhere inside that window is still that
 * frame. Rounding to nearest would report the next frame half a frame early.
 */
export const timeToFrame = (t) => Math.max(0, Math.min(LAST_FRAME, Math.floor(t * FPS + 1e-6)));
