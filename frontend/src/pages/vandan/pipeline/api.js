/**
 * TALKING TO THE RENDER SERVICE
 * =============================
 * The contract is the one settled in SOLAR_WIND_CME_GUIDE.md section 10, and it
 * is deliberately never a blocking POST. A render is thirty seconds to ten
 * minutes and the link to the box has dropped repeatedly across sessions, so a
 * submission returns a job id immediately and everything after that is polling.
 * A dropped connection then costs a reconnect, not a lost render.
 *
 *     POST   /api/jobs                    -> { job_id }
 *     GET    /api/jobs/{id}               -> { status, stage, viewpoints, log, eta_s, ... }
 *     DELETE /api/jobs/{id}
 *     GET    /api/health                  -> { can_render, machine_label, queue_depth, gpu }
 *
 * The service is Dashboard/backend (see its README). `connect()` probes it and
 * falls back to the simulator below when nothing answers, or when it is up but
 * reports that this machine cannot render. The simulator walks the same stage
 * list, paces itself from the measured cost model in cost.js, and hands back
 * this pipeline's own archived render of the timestep -- it never reads an
 * uploaded file. The UI says plainly which of the two it is talking to.
 */
import { BODIES, frameUrl, thumbUrl, stillUrl } from '../../../lib/media.js';
import { estimate, CONVERT_S, occupancyFor } from './cost.js';

export const API_BASE = import.meta.env.VITE_RENDER_API ?? '/api';

/**
 * How much faster than real time each stage is played, and the least wall time
 * it is given whatever the model says.
 *
 * One flat multiplier does not work. Fast enough to make a ten-minute render
 * watchable is fast enough to make the eleven-second conversion a single
 * frame, and the conversion is the step worth watching -- it is where the
 * resample onto the pinned grid happens. So the setup runs at a few times real
 * speed and only the render is heavily compressed. Every number the UI quotes
 * is still the real measured one.
 */
const SIM_RATE = { convert: 3, ephemeris: 2.5, scene: 2.5, render: 40 };
const SIM_FLOOR = { convert: 3, ephemeris: 1.8, scene: 2.2, render: 5 };

/** Roughly how compressed the render step is. Used only in the banner copy. */
export const SIM_SPEED = SIM_RATE.render;

/**
 * Is a render service actually there?
 *
 * Two seconds, then give up. A demo that hangs on a dead tunnel is worse than
 * a demo that says the box is offline and carries on.
 */
let connection = null;
let sim = null;
let remote = null;

/** The one simulator for this tab. Its jobs live in memory, so there must be one. */
export function simulator() {
  if (!sim) sim = new LocalRenderService();
  return sim;
}

/**
 * The real service, whether or not it answered the last health check. A job it
 * already accepted is still polled through this while it is unreachable; the
 * render carries on over there regardless.
 */
export function remoteService(health = null) {
  if (!remote) remote = new HttpRenderService(health);
  else if (health) remote.health = health;
  return remote;
}

/**
 * One probe per tab, shared by every mount of the section.
 *
 * The simulator holds its jobs in memory, so a second instance created on the
 * way back from the 360 viewer would not know about the job that is running.
 */
export function connectOnce() {
  if (!connection) connection = connect();
  return connection;
}

export async function connect({ timeout = 2000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: ctrl.signal, headers: authHeaders() });
    if (!r.ok) throw new Error(`health ${r.status}`);
    // Without the proxy, a dev server answers any path with the page itself,
    // and that is not a render service however politely it says 200.
    const health = await r.json();
    if (!health || health.ok !== true) throw new Error('not the render service');
    if (health.can_render === false) {
      const failing = Object.entries(health.checks || {})
        .filter(([, c]) => !c.ok).map(([name]) => name.replace(/_/g, ' '));
      return {
        live: false, health, service: simulator(),
        reason: `the render service on ${health.machine_label} is up but cannot render (${failing.join(', ')})`,
      };
    }
    return { live: true, health, service: remoteService(health) };
  } catch {
    return { live: false, health: null, service: simulator(), reason: 'no render service answered' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ auth */

/**
 * The service can require a shared token for submitting and cancelling. Open
 * the dashboard once as `http://host:8000/?token=...` and it is kept for the
 * rest of the tab's life.
 */
function token() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) sessionStorage.setItem('btp:token', fromUrl);
    return fromUrl || sessionStorage.getItem('btp:token');
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const t = token();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

async function readError(r) {
  const body = await r.json().catch(() => null);
  return body?.error || `the service answered ${r.status}`;
}

/* ------------------------------------------------------------------ live */

class HttpRenderService {
  constructor(health) { this.health = health; }

  get live() { return true; }

  /** "this Mac · Metal", "the lab box · A30" -- where the frames are coming from. */
  get label() { return this.health?.machine_label ?? 'the render service'; }

  /**
   * An upload goes as the raw file body with the settings in the query string,
   * which the service streams straight to disk. An archived timestep, or a
   * re-render of a volume the service already converted, is JSON.
   */
  async submit({ file, bodies, quality, resolution, datetime, index, archived, reuseJob }, onUploadProgress) {
    const common = {
      viewpoints: bodies.join(','), quality, resolution, datetime,
      vtk_index: index == null ? '' : String(index),
    };

    if (file) {
      const qs = new URLSearchParams({ ...common, filename: file.name });
      // XHR rather than fetch, only because a 102 MB upload with no progress
      // bar on campus wifi is indistinguishable from a hang.
      const body = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/jobs?${qs}`);
        for (const [k, v] of Object.entries(authHeaders({ 'Content-Type': 'application/octet-stream' }))) {
          xhr.setRequestHeader(k, v);
        }
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUploadProgress?.(e.loaded / e.total); };
        xhr.onload = () => {
          let reply = null;
          try { reply = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
          if (xhr.status < 400 && reply?.job_id) resolve(reply);
          else reject(new Error(reply?.error || `the upload was refused (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('the upload did not reach the render service'));
        xhr.send(file);
      });
      return body.job_id;
    }

    let payload;
    if (reuseJob) payload = { ...common, reuse_job: reuseJob };
    else if (archived) payload = { ...common, archived_index: index };
    else throw new Error('the uploaded file is no longer in memory; choose it again');

    onUploadProgress?.(1);
    const r = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await readError(r));
    return (await r.json()).job_id;
  }

  async poll(id) {
    const r = await fetch(`${API_BASE}/jobs/${id}`, { headers: authHeaders() });
    // Deleted elsewhere, or pruned after the service kept its last forty.
    if (r.status === 404) return { id, status: 'missing' };
    if (!r.ok) throw new Error(`poll ${r.status}`);
    return r.json();
  }

  async cancel(id) {
    await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  }
}

/* ------------------------------------------------------- local simulator */

/**
 * The lines the pipeline scripts genuinely print, in the order they print
 * them. Keeping the log truthful is what makes it useful during the demo --
 * anyone who has watched a real run recognises it.
 */
const SCRIPT = {
  upload: (j) => [
    `POST /jobs  ${j.filename}  ${(j.size / 1048576).toFixed(1)} MB`,
    `queued as ${j.id}`,
  ],
  convert: (j) => [
    `[vtk2vdb] reading ${j.filename}`,
    `[vtk2vdb] cell_data_to_point_data: rho, prs, tr1`,
    `[vtk2vdb] resampling to 256^3 on the PINNED grid from data.0000.vtk`,
    `[vtk2vdb] bounds and voxel size reused, not recomputed  <- the silent-failure trap`,
    `[vtk2vdb] tr1 > 0.1 in ${j.tracerCells.toLocaleString('en-US')} of 16,777,216 cells`
      + ` (${((j.tracerCells / 16777216) * 100).toFixed(2)}%)`,
    `[vtk2vdb] wrote volume.vdb in ${CONVERT_S.toFixed(1)}s`,
  ],
  ephemeris: (j) => [
    `[solar-mach] querying positions for ${j.datetime}`,
    ...j.bodies.map((b) => `[solar-mach] ${b}: ${j.positions?.[b] ?? 'resolving'}`),
  ],
  scene: () => [
    `[blender] opening SolarWindCME_space.blend (template, not rebuilt)`,
    `[blender] volume -> volume.vdb, static frame, frame_offset not applied`,
    `[blender] density 8.0  emission 4.2  step 3.0  bounces 1`,
  ],
  render: (j, body) => [
    `[cycles] ${body}: EQUIRECTANGULAR ${j.width}x${j.height}, ${j.spp} spp`,
  ],
};

class LocalRenderService {
  constructor() { this.jobs = new Map(); }

  get live() { return false; }

  get label() { return 'simulated locally'; }

  async submit(settings, onUploadProgress) {
    const { file } = settings;
    // The simulator never reads the file. It paces a progress bar by the
    // file's size and then renders nothing: the frames it returns are the
    // archive's for the index in the filename. Only a real worker converts and
    // renders what was uploaded.
    if (file) await readWithProgress(file, onUploadProgress);
    else onUploadProgress?.(1);

    const job = this._create(settings, {
      id: `sim-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
    });
    return job.id;
  }

  /**
   * Pick a job back up after the section was left, or the tab reloaded.
   *
   * Everything about a simulated job is a function of its settings and the
   * moment it started, so restoring it is re-creating it with the same start
   * time. Wall-clock time, not performance.now(), which restarts from zero on
   * every page load.
   */
  restore({ id, settings, startedAt }) {
    if (!id || this.jobs.has(id)) return;
    this._create(settings, { id, startedAt });
  }

  _create(settings, { id, startedAt }) {
    const { file, bodies, quality, resolution, datetime, index } = settings;
    const plan = estimate(settings);

    /* A wall-clock schedule, fixed at submission. Each stage gets its own rate
       so the parts worth seeing are seen, and the simulated seconds reported
       back are always the real measured ones. */
    const schedule = plan.stages
      .filter((st) => st.id !== 'upload')
      .map((st) => ({
        id: st.id,
        seconds: st.seconds,
        wall: Math.max(SIM_FLOOR[st.id] ?? 1.5, st.seconds / (SIM_RATE[st.id] ?? 4)),
      }));

    const job = {
      id, schedule,
      filename: file?.name ?? settings.fileName ?? 'data.0000.vtk',
      size: file?.size ?? settings.fileSize ?? 102 * 1048576,
      bodies, quality, resolution, datetime, index,
      spp: quality === 'publication' ? 4096 : 256,
      width: resolution === 'half' ? 2048 : 4096,
      height: resolution === 'half' ? 1024 : 2048,
      occupancy: occupancyFor(index),
      // All 21 source timesteps were scanned: tr1 switches on across 595,938
      // cells at the peak. The occupancy proxy is scaled against that measured
      // count rather than being printed as a percentage of everything.
      tracerCells: Math.round(occupancyFor(index) * 595938),
      perViewpoint: plan.perViewpoint,
      plan,
      startedAt,
      log: [],
      artifacts: [],
      status: 'running',
      positions: null,
    };
    this.jobs.set(id, job);
    return job;
  }

  /** Positions come from the ephemeris the viewer already loads. */
  setPositions(id, positions) {
    const job = this.jobs.get(id);
    if (job) job.positions = positions;
  }

  async poll(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`no such job ${id}`);
    if (job.status === 'cancelled') return this._snapshot(job, 'cancelled');

    const wall = (Date.now() - job.startedAt) / 1000;

    /* Walk the wall-clock schedule to find where the job is, then convert that
       position back into measured seconds -- so the clock on screen counts down
       the real cost even though the wait is compressed. */
    let wallSpent = 0;
    let simulated = 0;
    let stageId = 'done';
    let stageProgress = 1;
    let renderFraction = 0;
    const done = new Set(['upload']);

    for (const st of job.schedule) {
      if (wall < wallSpent + st.wall) {
        stageId = st.id;
        stageProgress = st.wall > 0 ? (wall - wallSpent) / st.wall : 1;
        simulated += stageProgress * st.seconds;
        if (st.id === 'render') renderFraction = stageProgress;
        break;
      }
      wallSpent += st.wall;
      simulated += st.seconds;
      done.add(st.id);
      if (st.id === 'render') renderFraction = 1;
    }

    // Inside the render stage the viewpoints run one after another, which is
    // the mitigation for the shared GPU, not an implementation shortcut.
    const n = job.bodies.length;
    const perBody = job.bodies.map((body, i) => {
      const p = renderFraction * n - i;
      return {
        body,
        progress: Math.max(0, Math.min(1, p)),
        status: p >= 1 ? 'done' : p > 0 ? 'rendering' : 'queued',
        url: p >= 1 ? frameUrl(body, job.index ?? 0) : null,
        // The card preview and the artifact are two different files. A real
        // worker returns both for the same reason: nobody needs 8.7 MB to
        // decide which frame to open.
        thumb: p >= 1 ? thumbUrl(body, job.index ?? 0) : null,
        still: p >= 1 ? stillUrl(body, job.index ?? 0) : null,
        seconds: job.perViewpoint,
      };
    });

    this._writeLog(job, stageId, done, perBody);

    if (stageId === 'done') job.status = 'done';
    job.artifacts = perBody.filter((b) => b.url).map((b) => ({ body: b.body, url: b.url }));

    return {
      ...this._snapshot(job, job.status),
      stage: stageId,
      stageProgress: Math.max(0, Math.min(1, stageProgress)),
      done: [...done],
      viewpoints: perBody,
      elapsed: simulated,
      eta_s: Math.max(0, job.plan.total - simulated),
    };
  }

  _snapshot(job, status) {
    return {
      id: job.id, status, log: job.log, artifacts: job.artifacts,
      plan: job.plan, occupancy: job.occupancy,
      stage: status === 'done' ? 'done' : 'upload',
      stageProgress: 1, done: [], viewpoints: [], elapsed: 0, eta_s: 0,
    };
  }

  /** Appends each script line once, the first time its stage is reached. */
  _writeLog(job, stageId, done, perBody) {
    const push = (key, lines) => {
      if (job.log.some((l) => l.key === key)) return;
      for (const text of lines) job.log.push({ key, text, at: Date.now() });
    };
    push('upload', SCRIPT.upload(job));
    if (done.has('convert') || stageId === 'convert') push('convert', SCRIPT.convert(job));
    if (done.has('ephemeris') || stageId === 'ephemeris') push('ephemeris', SCRIPT.ephemeris(job));
    if (done.has('scene') || stageId === 'scene') push('scene', SCRIPT.scene(job));
    for (const v of perBody) {
      if (v.status !== 'queued') push(`render:${v.body}`, SCRIPT.render(job, v.body));
      if (v.status === 'done') {
        push(`done:${v.body}`, [`[cycles] ${v.body} frame saved: ${v.seconds.toFixed(1)}s`]);
      }
    }
    if (stageId === 'done') push('finished', [`job ${job.id} complete`]);
  }

  async cancel(id) {
    const job = this.jobs.get(id);
    if (job) job.status = 'cancelled';
  }
}

/**
 * A stand-in upload bar, stepped 4 MB at a time by the file's size.
 *
 * It does not read the bytes -- there is nowhere to send them without a
 * worker. It exists so the upload stage still has a visible duration that
 * grows with the file, because a hundred-megabyte upload on campus wifi is the
 * one wait the real service will always have.
 */
function readWithProgress(file, onProgress, chunk = 4 * 1048576) {
  return new Promise((resolve) => {
    let offset = 0;
    const step = () => {
      offset = Math.min(file.size, offset + chunk);
      onProgress?.(offset / file.size);
      if (offset < file.size) setTimeout(step, 16);
      else resolve();
    };
    step();
  });
}

/* ------------------------------------------------------------- filenames */

/**
 * `data.0184.vtk` -> 184.
 *
 * The files carry no time metadata of their own, so the index in the name is
 * the only thing that can be turned into a real date for Solar-MACH. That is
 * why the date field in the form is editable rather than derived and locked:
 * an arbitrarily named file still has to work.
 */
export function indexFromName(name = '') {
  const m = /(?:^|[^0-9])(\d{3,5})(?=\.vtk$|[^0-9])/i.exec(name);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export const isVtk = (name = '') => /\.vtk$/i.test(name);

/** Every viewpoint, for the "all four" shortcut. */
export const ALL_BODIES = BODIES;
