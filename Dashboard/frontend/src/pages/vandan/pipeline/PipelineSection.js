/**
 * VTK → FRAMES
 * ============
 * The whole of feature two behind one section button, and one door between its
 * four states:
 *
 *   intake     drop a .vtk, or take an archived timestep
 *   configure  viewpoints, samples, resolution, the date the cameras use
 *   running    the job, stage by stage, against measured costs
 *   done       the frames, the receipt, and the explorer to look inside them
 *
 * The three.js world underneath is continuous across all four -- see
 * PipelineScene.js. Only the panels are swapped.
 *
 * Nothing about the job lives in this function's closure. It lives in store.js,
 * because this function is torn down whenever the visitor clicks over to the
 * 360 viewer, and a render does not stop because nobody is watching it. Every
 * mount reads the store and picks up exactly where the last one left off: the
 * form with its settings, the job still counting down, the results, even the
 * explorer in whichever mode it was in.
 *
 * Polling runs off the shared frame loop rather than a `setInterval`. One
 * clock, nothing to leak, and it stops the moment the section is torn down.
 */
import { PipelineScene } from './PipelineScene.js';
import { createStepRail } from './StepRail.js';
import { createIntake } from './Intake.js';
import { createJobForm, archivedName } from './JobForm.js';
import { createJobMonitor, createJobFailure } from './JobMonitor.js';
import { createResults } from './Results.js';
import { createVolumeInspector } from './VolumeInspector.js';
import { FrameExplorer } from './FrameExplorer.js';
import { connectOnce, indexFromName, simulator, remoteService } from './api.js';
import { occupancyFor, estimate } from './cost.js';
import { store, update, save, clearJob } from './store.js';
import { loadEphemeris } from '../data/ephemeris.js';
import { clampFrame } from '../data/timing.js';
import './pipeline.css';

/**
 * How often a running job is polled, in seconds. The simulator is in the same
 * tab and costs nothing to ask. The real service is a request over the network
 * to a machine that is busy rendering, and nothing it reports changes faster
 * than about once a second anyway.
 */
const POLL_SIM = 0.2;
const POLL_LIVE = 1.0;

/** Job stage -> what the world should be doing. */
const SCENE_FOR = {
  queued: 'configure', upload: 'ingest', convert: 'convert', ephemeris: 'place',
  scene: 'place', render: 'render', done: 'done',
};

export function createPipelineSection({ stage }) {
  const element = document.createElement('div');
  element.className = 'psec';

  const panel = document.createElement('aside');
  panel.className = 'psec__panel';

  /* ------------------------------------------------------------- pieces */
  const scene = new PipelineScene({
    stage,
    onPick: (body) => openBody(body),
    getPanelRect: () => (element.classList.contains('is-peeking') ? null : panel.getBoundingClientRect()),
  });
  const rail = createStepRail();
  const railWrap = document.createElement('div');
  railWrap.className = 'psec__rail';
  railWrap.appendChild(rail.element);

  const inspector = createVolumeInspector({
    tools: store.tools,
    index: store.preview,
    collapsed: store.inspectorCollapsed || window.innerWidth < 1100,
    onIndex: (n) => onScrub(n),
    onTools: (t) => { scene.setTools(t); update({ tools: t }); },
    onReset: () => scene.resetFraming(),
    onCollapse: (collapsed) => update({ inspectorCollapsed: collapsed }),
  });
  scene.setTools(store.tools);

  element.append(scene.element, railWrap, inspector.element, panel);

  /* -------------------------------------------------------------- local */
  let current = null;         // the panel object on screen
  let explorer = null;
  let service = null;
  let ephemeris = null;
  let pollTimer = 0;
  let polling = false;
  let destroyed = false;

  let reason = null;
  let serviceInfo = null;
  let machine = 'a30';
  const ready = connectOnce().then((c) => {
    if (destroyed) return c;
    service = c.service;
    reason = c.reason ?? null;
    serviceInfo = { live: c.live, label: c.service.label, reason };
    // Estimates are quoted for the machine that will do the work. The
    // simulator has no machine, so it keeps quoting the A30 the numbers came from.
    machine = c.live ? (c.health?.machine ?? 'a30') : 'a30';
    current?.setMachine?.(machine);
    element.dataset.live = String(c.live);
    current?.setService?.({ live: c.live, label: c.service.label, reason });
    // A simulated job survives a reload only if the simulator is told about it.
    if (store.jobId && !store.live && store.startedAt && store.job) {
      simulator().restore({ id: store.jobId, settings: store.job, startedAt: store.startedAt });
      sendPositions();
    }
    return c;
  });

  /**
   * The service a job already belongs to. Not necessarily the one answering
   * now: a job the real service accepted is still polled there while it is
   * unreachable, and a simulated job stays simulated when the service appears.
   */
  const jobService = () => (store.live ? remoteService() : simulator());

  loadEphemeris().then((e) => {
    if (destroyed) return;
    ephemeris = e;
    scene.setPositions(e.byBody, currentIndex());
    current?.setDistances?.(e.byBody);
    explorer?.setDistances(e.byBody, currentIndex());
    sendPositions();
    paintMarkers();
  }).catch(() => { /* the map simply stays unlabelled */ });

  function currentIndex() {
    return clampFrame(store.job?.index ?? store.draft?.index ?? store.preview ?? 169);
  }

  /* ------------------------------------------------------------- panels */

  const swap = (next) => {
    current?.destroy?.();
    current = next;
    panel.replaceChildren(next.element);
    panel.scrollTop = 0;
    // Commit the starting state before flipping the class. Not rAF, which
    // never fires in a hidden tab.
    void panel.offsetWidth;
    panel.classList.add('is-in');
  };

  const setState = (name) => {
    element.dataset.state = name;
    const inspecting = name === 'intake' || name === 'configure';
    inspector.setVisible(inspecting);
    scene.setInspectorActive(inspecting);
    update({ state: name });
  };

  /* --------------------------------------------------------------- intake */

  function toIntake() {
    closeExplorer(true);
    clearJob();
    rail.reset();
    setState('intake');
    scene.setPhase('idle');
    scene.setSelected([]);
    scene.setActive(null);
    inspector.setLocked(false);
    inspector.setIndex(store.preview);
    scene.setStrength(occupancyFor(store.preview));
    swap(createIntake({
      index: store.preview,
      service: serviceInfo,
      onFile: (file, index) => toConfigure({ file, index, archived: false }),
      onSample: (index) => toConfigure({ file: null, index, archived: true }),
    }));
  }

  /** The inspector's timestep moved. */
  function onScrub(n) {
    scene.setStrength(occupancyFor(n));
    if (element.dataset.state === 'intake') {
      update({ preview: n });
      current?.setIndex?.(n);
    } else if (element.dataset.state === 'configure' && store.draft?.archived) {
      update({ preview: n });
      current?.setIndex?.(n);
    }
  }

  /* ------------------------------------------------------------ configure */

  function toConfigure({ file, index, archived, restoring = false }) {
    setState('configure');
    const idx = index ?? (file ? indexFromName(file.name) : null);

    if (!restoring) {
      update({
        file,
        draft: {
          archived,
          fileName: file?.name ?? archivedName(idx ?? 0),
          fileSize: file?.size ?? null,
          index: idx,
        },
      });
      scene.setPhase('ingest');
      scene.pulse();
      setTimeout(() => {
        if (!destroyed && element.dataset.state === 'configure') scene.setPhase('configure');
      }, 900);
    } else {
      scene.setPhase('configure');
    }

    scene.setStrength(idx != null ? occupancyFor(idx) : 0.5);
    inspector.setLocked(!archived, 'The timestep comes from the uploaded file');
    if (idx != null) inspector.setIndex(idx);

    const d = store.draft;
    // Declared before it is built: the form reports its settings once while it
    // is being constructed, and that callback reaches back for it.
    let form = null;
    form = createJobForm({
      file: store.file,
      index: idx,
      archived,
      initial: restoring ? d : {},
      fileName: d?.fileName,
      fileSize: d?.fileSize,
      machine,
      onChange: (s) => {
        const { plan, ...settings } = s;
        update({ draft: { ...store.draft, ...settings } });
        scene.setSelected(s.bodies);
        if (s.index != null) {
          scene.setStrength(occupancyFor(s.index));
          inspector.setIndex(s.index);
          if (ephemeris) scene.setPositions(ephemeris.byBody, clampFrame(s.index));
          form?.setDistances?.(ephemeris?.byBody);
        }
        rail.setCosts(plan.stages);
      },
      onSubmit: (s) => start(s),
      onReset: toIntake,
    });
    swap(form);
    if (ephemeris) form.setDistances(ephemeris.byBody);
  }

  /* -------------------------------------------------------------- running */

  async function start(settings) {
    await ready;
    if (destroyed || !service) return;

    const { file, plan, reuseJob, ...rest } = settings;
    const job = {
      ...rest,
      archived: rest.archived ?? store.draft?.archived ?? !file,
      fileName: file?.name ?? store.draft?.fileName ?? archivedName(rest.index ?? 0),
      fileSize: file?.size ?? store.draft?.fileSize ?? null,
      plan: plan ?? estimate(rest),
    };
    update({
      job, jobId: null, snapshot: null, explorer: null, failure: null,
      live: service.live, label: service.label, reason,
    });

    showMonitor();
    let jobId;
    try {
      jobId = await service.submit({ ...job, file, reuseJob }, (p) => {
        rail.set('upload', new Set(), p);
        scene.setPhase('ingest');
      });
    } catch (err) {
      if (!destroyed) toFailed(err.message, []);
      else update({ state: 'failed', failure: { error: err.message, log: [] } });
      return;
    }
    if (destroyed) {
      // The job was accepted after the section was left: remember it anyway,
      // so the next mount finds it running.
      update({ jobId, startedAt: service.jobs?.get(jobId)?.startedAt ?? Date.now() });
      return;
    }
    update({ jobId, startedAt: service.jobs?.get(jobId)?.startedAt ?? Date.now() });
    current?.setJobId?.(jobId);
    sendPositions();
    pollTimer = 99;           // poll straight away rather than after a full interval
  }

  function showMonitor() {
    closeExplorer(true);
    setState('running');
    const job = store.job;
    scene.setSelected(job.bodies);
    if (ephemeris) scene.setPositions(ephemeris.byBody, clampFrame(job.index ?? 0));
    rail.setCosts(job.plan.stages);
    swap(createJobMonitor({
      jobId: store.jobId ?? '…',
      bodies: job.bodies,
      live: store.live,
      label: store.label,
      reason: store.reason,
      onCancel: () => { if (store.jobId) jobService().cancel(store.jobId); toIntake(); },
    }));
    if (store.snapshot) applySnapshot(store.snapshot);
  }

  /** The simulator writes the Solar-MACH lines into its log from these. */
  function sendPositions() {
    if (!ephemeris || store.live || !store.jobId || !store.job) return;
    const idx = clampFrame(store.job.index ?? 0);
    simulator().setPositions(store.jobId, Object.fromEntries(store.job.bodies.map((b) => {
      const p = ephemeris.byBody[b]?.[idx];
      return [b, p ? `x=${p.x.toFixed(3)} y=${p.y.toFixed(3)} z=${p.z.toFixed(3)} AU` : 'unavailable'];
    })));
  }

  let pollFailures = 0;

  async function tick() {
    if (polling || !store.jobId || element.dataset.state !== 'running') return;
    polling = true;
    let snap;
    try {
      snap = await jobService().poll(store.jobId);
      pollFailures = 0;
      current?.setOffline?.(false);
    } catch {
      // A dropped link costs a reconnect, not the job. Say so after a few
      // misses rather than on the first, which is usually just a blip.
      pollFailures += 1;
      if (pollFailures >= 3) current?.setOffline?.(true);
      return;
    } finally {
      polling = false;
    }
    if (destroyed || element.dataset.state !== 'running') return;

    if (snap.status === 'missing' || snap.status === 'cancelled') {
      // Cancelled or removed somewhere else -- another tab, or the command line.
      toIntake();
      return;
    }
    if (snap.status === 'failed') {
      update({ snapshot: snap });
      toFailed(snap.error, snap.log ?? []);
      return;
    }
    // The simulator has no reason to send the plan back; the clock needs one.
    if (!snap.plan) snap.plan = store.job?.plan;
    update({ snapshot: snap });
    applySnapshot(snap);
    if (snap.status === 'done') toDone();
  }

  /* --------------------------------------------------------------- failed */

  function toFailed(error, log) {
    closeExplorer(true);
    update({ failure: { error, log: (log ?? []).slice(-20) } });
    setState('failed');
    scene.setPhase('configure');
    scene.setActive(null);
    const job = store.job;
    // Retrying needs something to render: an archived timestep always has one,
    // an upload needs the file still in memory, or a volume the service already
    // converted for the failed job.
    const canRetry = !!job && (job.archived || !!store.file || (store.live && !!store.jobId));
    swap(createJobFailure({
      error,
      log: store.failure.log,
      canRetry,
      onRetry: () => start({
        ...job,
        file: store.file ?? undefined,
        reuseJob: !job.archived && !store.file && store.live ? store.jobId : undefined,
      }),
      onReset: toIntake,
    }));
  }

  function applySnapshot(snap) {
    current?.update?.(snap);

    const done = new Set(snap.done ?? []);
    if (snap.status === 'done') done.add('render').add('frames');
    rail.set(snap.status === 'done' ? null : snap.stage, done, snap.stageProgress ?? 0);

    scene.setPhase(SCENE_FOR[snap.stage] ?? 'render');
    if (snap.stage === 'convert') scene.setScan(snap.stageProgress ?? 0);

    let active = null;
    for (const v of snap.viewpoints ?? []) {
      scene.setProgress(v.body, v.progress);
      if (v.status === 'rendering') active = v.body;
    }
    scene.setActive(active);
    paintMarkers();
  }

  /* ----------------------------------------------------------------- done */

  function toDone() {
    setState('done');
    scene.setPhase('done');
    scene.setActive(null);
    const job = store.job;
    scene.setSelected(job.bodies);
    if (ephemeris) scene.setPositions(ephemeris.byBody, clampFrame(job.index ?? 0));
    rail.setCosts(job.plan.stages);
    rail.set(null, new Set(['upload', 'convert', 'ephemeris', 'scene', 'render', 'frames']), 1);
    paintMarkers();

    const viewpoints = returned();
    swap(createResults({
      job,
      viewpoints,
      byBody: ephemeris?.byBody,
      onOpen: ({ mode, body }) => openExplorer(mode, body),
      snapshot: store.snapshot,
      // At publication quality the converted volume is reused rather than the
      // file sent again -- which for an upload is the only option once the
      // page has been reloaded and the File is gone.
      onAgain: () => start({
        ...job, quality: 'publication', plan: estimate({ ...job, quality: 'publication' }),
        reuseJob: store.live && !job.archived ? store.jobId : undefined,
      }),
      onReset: toIntake,
    }));

    if (store.explorer) openExplorer(store.explorer.mode, store.explorer.body, { restoring: true });
  }

  const returned = () => (store.snapshot?.viewpoints ?? []).filter((v) => v.url);

  /* ------------------------------------------------------------- explorer */

  function openExplorer(mode, body, { restoring = false } = {}) {
    if (explorer) { explorer.setMode(mode, body); return; }
    const viewpoints = returned();
    if (!viewpoints.length) return;

    const idx = clampFrame(store.job?.index ?? 0);
    const distances = Object.fromEntries(viewpoints.map((v) => [v.body, ephemeris?.byBody?.[v.body]?.[idx]]).filter(([, p]) => p));

    explorer = new FrameExplorer({
      stage, host: scene, viewpoints,
      index: store.job?.index ?? null,
      mode, body,
      // Grow out of the cards -- unless this is a restore, when the cards have
      // not been laid out yet and the explorer should simply be there.
      origins: restoring ? {} : current?.cardRects?.() ?? {},
      distances,
      onChange: (s) => update({ explorer: s }),
      onRequestClose: () => closeExplorer(false),
      onClose: () => closeExplorer(true),
    });
    element.appendChild(explorer.element);
    element.classList.add('is-peeking');
    update({ explorer: { mode: explorer.mode, body: explorer.focus } });
  }

  /** `now` skips the animation; otherwise the explorer shrinks back into the cards. */
  function closeExplorer(now = false) {
    if (!explorer) return;
    if (!now && !explorer.closing) {
      element.classList.remove('is-peeking');
      void panel.offsetWidth;
      explorer.close(current?.cardRects?.());
      return;
    }
    explorer.destroy();
    explorer = null;
    element.classList.remove('is-peeking');
    update({ explorer: null });
  }

  /** Clicking a planet on the map opens its frame, once there is one. */
  function openBody(body) {
    if (element.dataset.state !== 'done') return;
    if (returned().some((v) => v.body === body)) openExplorer('single', body);
  }

  /* ------------------------------------------------------------- markers */

  function paintMarkers() {
    const bodies = store.job?.bodies ?? store.draft?.bodies ?? [];
    const chosen = new Set(bodies);
    const idx = currentIndex();
    const snap = store.snapshot;

    for (const body of ['Mercury', 'Venus', 'Earth', 'Mars']) {
      const p = ephemeris?.byBody?.[body]?.[idx];
      const au = p ? `${p.r.toFixed(2)} AU` : '';
      const v = snap?.viewpoints?.find((x) => x.body === body);

      if (!chosen.has(body)) {
        scene.setMarker(body, { state: 'off', text: '' });
      } else if (v?.status === 'done' || (element.dataset.state === 'done' && v?.url)) {
        scene.setMarker(body, { state: 'done', progress: 1, text: `${au} · saved` });
      } else if (v?.status === 'rendering') {
        scene.setMarker(body, { state: 'active', progress: v.progress, text: `${Math.round(v.progress * 100)}% · ${au}` });
      } else {
        scene.setMarker(body, { state: 'on', progress: 0, text: element.dataset.state === 'running' ? `queued · ${au}` : au });
      }
    }
  }

  /* ------------------------------------------------------------ the loop */

  /* On a narrow window the panel becomes a sheet across the bottom and there is
     no room beside it, so the inspector folds down to its header whenever the
     window crosses that line. It still opens on a tap, over the sheet. */
  const narrowQuery = window.matchMedia('(max-width: 1100px)');
  const onNarrow = (e) => { if (e.matches) inspector.setCollapsed(true); };
  narrowQuery.addEventListener('change', onNarrow);

  const stopFrame = stage.onFrame((dt) => {
    inspector.tick(dt);
    pollTimer += dt;
    if (pollTimer >= (store.live ? POLL_LIVE : POLL_SIM)) { pollTimer = 0; tick(); }
  });

  /* ------------------------------------------------------- where to start */

  switch (store.state) {
    case 'configure':
      if (store.draft) {
        toConfigure({ file: store.file, index: store.draft.index, archived: store.draft.archived, restoring: true });
        break;
      }
      toIntake();
      break;
    case 'running':
      if (store.job) {
        // Land straight in the heliosphere rather than replaying the volume:
        // the job has moved on while the visitor was away.
        scene.snapStrength(occupancyFor(store.job.index ?? 0));
        showMonitor();
        break;
      }
      toIntake();
      break;
    case 'failed':
      if (store.job && store.failure) {
        toFailed(store.failure.error, store.failure.log);
        break;
      }
      toIntake();
      break;
    case 'done':
      if (store.job && returned().length) {
        scene.snapStrength(occupancyFor(store.job.index ?? 0));
        toDone();
        break;
      }
      toIntake();
      break;
    default:
      scene.snapStrength(occupancyFor(store.preview));
      toIntake();
  }

  return {
    element,
    destroy() {
      destroyed = true;
      stopFrame();
      narrowQuery.removeEventListener('change', onNarrow);
      save();
      // The explorer is torn down with the section, but the store still says
      // it was open, so coming back reopens it.
      if (explorer) { const s = store.explorer; explorer.destroy(); explorer = null; update({ explorer: s }); }
      current?.destroy?.();
      inspector.destroy();
      scene.destroy();
      element.remove();
      // A running job is deliberately NOT cancelled here. Leaving the section
      // is not the same as abandoning the render.
    },
  };
}
