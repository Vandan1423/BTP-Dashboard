/**
 * WHAT A RENDER ACTUALLY COSTS
 * ============================
 * Every number in this file is measured on this exact scene, on the A30 in the
 * lab, and is written up in `Vandan/docs/SOLAR_WIND_CME_GUIDE.md` section 10.
 * None of it is guessed, and that is the whole point: the professor accepted a
 * multi-minute wait per frame because he was shown real timings, so the ETA the
 * dashboard quotes has to come from the same place.
 *
 * The one thing that makes an honest ETA hard is that per-frame cost is NOT
 * roughly constant. It is dominated by how much CME material is in shot, and
 * `render5.log` spans a factor of fifty across one run:
 *
 *     quiet, pre-CME          ~12 s
 *     CME peak (frame 169)     636 s
 *     fading (Mars 184)         64 s
 *     fading (Mars 201)         29 s
 *     run average             30.2 s        <- the number NOT to quote
 *
 * A flat average tells a user "thirty seconds" and then takes ten minutes. So
 * the cost curve below interpolates the real anchor points instead, in log
 * space, and every other lever is applied on top of it as a measured factor.
 */

/** Full-resolution frame, in megapixels. Resolution scales near-linearly. */
const FULL_MPX = (4096 * 2048) / 1e6;

/**
 * Seconds per frame at 4096 spp, 4096x2048, on the A30 -- straight out of
 * `render5.log`, which is the run that produced the videos the professor
 * approved. Indices are VTK indices, the same N the filenames carry.
 */
const COST_ANCHORS = [
  { n: 0,   s: 12 },
  { n: 155, s: 14 },     // tracers are still identically zero here
  { n: 169, s: 636 },    // the worst frame in the entire 804-frame run
  { n: 184, s: 64 },
  { n: 200, s: 29 },
];

/** The run average, for a file whose index cannot be read from its name. */
export const RUN_AVERAGE_S = 30.2;

/**
 * VTK -> VDB for one 102 MB file: read 2.5 s, cell-to-point 0.1 s, 256^3
 * resample 8.5 s. Measured on the M3; it is CPU-bound, so the box is similar.
 * About one percent of a job -- the early worry that it would dominate is dead.
 */
export const CONVERT_S = 11.2;

/** Solar-MACH is a live network query, and the box does have outbound access. */
export const EPHEMERIS_S = 6;

/** Opening the 257 KB template .blend and pointing it at the new volume. */
export const SCENE_S = 8;

/**
 * The two presets the professor was offered.
 *
 * 256 vs 512 spp came out at PSNR 52 dB -- visually identical with OpenImage-
 * Denoise on -- and 4096 -> 256 was a measured 15.9x speedup on sample cost.
 * The `scale` here is lower than 1/15.9 would suggest because part of a frame
 * is fixed overhead that no sample count can remove; see SAMPLE_FLOOR below.
 * Anchored against the one matched measurement we have: a near-peak frame at
 * 256 spp took 264 s on the A30.
 */
export const QUALITY = {
  preview: {
    id: 'preview', spp: 256, label: 'Preview',
    scale: 0.42,
    note: 'Denoised. Measured identical to 512 spp at 52 dB PSNR.',
  },
  publication: {
    id: 'publication', spp: 4096, label: 'Publication',
    scale: 1,
    note: 'The sample count the approved videos were rendered at.',
  },
};

/** Resolution is the strongest lever there is -- stronger than the machine. */
export const RESOLUTION = {
  full: { id: 'full', w: 4096, h: 2048, label: '4096 × 2048', note: 'Native. What the VR build uses.' },
  half: { id: 'half', w: 2048, h: 1024, label: '2048 × 1024', note: 'A quarter of the pixels, a quarter of the cost.' },
};

/** The Mac parachute is 2.0x slower than the A30 at matched settings. */
export const MACHINE = {
  a30: { id: 'a30', label: 'A30 · lab box', factor: 1 },
  mac: { id: 'mac', label: 'M3 · fallback', factor: 2.0 },
};

/**
 * The part of a frame that samples cannot buy back: opening the scene, loading
 * the volume, and denoising. Subtracted before the sample count is scaled and
 * added again after, so dropping to 256 spp does not predict an impossible
 * four-second frame.
 */
const SAMPLE_FLOOR = 9;

/** Seconds for one viewpoint at 4096 spp and full resolution, at index `n`. */
export function baseSeconds(n) {
  if (n == null || !Number.isFinite(n)) return RUN_AVERAGE_S;
  const idx = Math.max(0, Math.min(200, n));
  const a = COST_ANCHORS;
  if (idx <= a[0].n) return a[0].s;
  if (idx >= a[a.length - 1].n) return a[a.length - 1].s;
  for (let i = 1; i < a.length; i++) {
    if (idx <= a[i].n) {
      const lo = a[i - 1], hi = a[i];
      const k = (idx - lo.n) / (hi.n - lo.n);
      // Log space, because the anchors span fifty to one. Linear interpolation
      // between 14 s and 636 s puts a wildly wrong number in the middle.
      return Math.exp(Math.log(lo.s) + (Math.log(hi.s) - Math.log(lo.s)) * k);
    }
  }
  return RUN_AVERAGE_S;
}

/** Seconds for one viewpoint under a full set of job settings. */
export function viewpointSeconds({ index, quality = 'preview', resolution = 'full', machine = 'a30' }) {
  const base = baseSeconds(index);
  const q = QUALITY[quality] ?? QUALITY.preview;
  const r = RESOLUTION[resolution] ?? RESOLUTION.full;
  const m = MACHINE[machine] ?? MACHINE.a30;

  const samples = Math.max(0, base - SAMPLE_FLOOR) * q.scale;
  const mpx = (r.w * r.h) / 1e6;
  return (SAMPLE_FLOOR + samples) * (mpx / FULL_MPX) * m.factor;
}

/**
 * The whole job, stage by stage.
 *
 * Renders are serialized deliberately -- the A30 is shared and has already
 * OOM'd once from another user holding 22.6 GB, so four at a time is the one
 * thing guaranteed to fail in front of an examiner.
 */
export function estimate(settings) {
  const bodies = settings.bodies ?? [];
  const per = viewpointSeconds(settings);
  const stages = [
    { id: 'upload',    label: 'Upload',            seconds: settings.uploadSeconds ?? 0 },
    { id: 'convert',   label: 'VTK → VDB',         seconds: CONVERT_S },
    { id: 'ephemeris', label: 'Camera placement',  seconds: EPHEMERIS_S },
    { id: 'scene',     label: 'Scene assembly',    seconds: SCENE_S },
    { id: 'render',    label: 'Render',            seconds: per * bodies.length },
  ];
  const total = stages.reduce((s, x) => s + x.seconds, 0);
  return { stages, perViewpoint: per, total };
}

/** "4 min 20 s", "48 s", "1 h 06 m" -- the readout format. */
export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${String(r).padStart(2, '0')} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} m`;
}

/**
 * How much CME is in shot, 0 to 1.
 *
 * A proxy, not a measurement: it is the cost curve above read backwards, so 1
 * means "as expensive as the worst frame in the run" rather than "every cell
 * has tracer in it". The real statistic -- the fraction of cells with
 * `tr1 > 0.1` -- is computed during the conversion step while the file is
 * already in memory, which costs nothing extra, and replaces this the moment
 * the worker reports it.
 */
export const occupancyFor = (n) => {
  const s = baseSeconds(n);
  return Math.min(1, Math.max(0, (Math.log(s) - Math.log(12)) / (Math.log(636) - Math.log(12))));
};
