/**
 * THE 360 VIEWER SECTION
 * ======================
 * Two stages, and this owns the door between them.
 *
 *   overview -- what these renders are, and four cards to choose from
 *   viewer   -- inside the sphere at the planet you chose, with the timeline
 *   compare  -- all four viewpoints at once, locked to one timestep
 *
 * The first visit arrives at the overview. Dropping straight inside a sphere
 * gives no idea what you are looking at or that there are three other places to
 * look from, so the map comes first and the choice is yours. Every visit after
 * that returns to exactly where the visitor left -- the stage, the planet, the
 * timestep, the speed and the direction they were looking. See memory.js.
 *
 * Only one stage exists at a time. Leaving the viewer destroys it outright,
 * which releases a video decoding a 4096x2048 stream -- worth the reload on the
 * way back in, and the browser caches the bytes anyway.
 */
import { createOverview } from './Overview.js';
import { Viewer360 } from './Viewer360.js';
import { CompareGrid } from './CompareGrid.js';
import { viewerMemory as mem, rememberViewer } from './memory.js';
import { LAST_FRAME } from '../data/timing.js';
import './viewer.css';

export function createViewerSection({ stage }) {
  const element = document.createElement('div');
  element.className = 'vsec';

  let overview = null;
  let viewer = null;
  let compare = null;
  let stageName = null;

  const showOverview = () => {
    if (stageName === 'overview') return;
    teardown();
    stageName = 'overview';
    mem.stage = 'overview';
    rememberViewer(true);
    overview = createOverview({ onSelect: (b) => showViewer(b), onCompare: showCompare });
    overview.setSelected(mem.body);
    element.appendChild(overview.element);
    // Read a layout property to force the browser to commit the starting
    // state, then flip the class. Without the read, both states land in one
    // style recalculation and the transition never happens. Deliberately not
    // requestAnimationFrame: that never fires in a hidden tab or an editor
    // preview pane, which left the whole overview stuck at opacity zero.
    void overview.element.offsetWidth;
    overview.element.classList.add('is-in');
  };

  /**
   * @param {string} [body]   a planet chosen from the overview
   * @param {boolean} [resume] restore the timeline and look direction as well
   */
  const showViewer = (body, resume = false) => {
    // Choosing a different planet from the map keeps the timestep -- the point
    // of switching is usually to see the same moment from somewhere else.
    if (body && body !== mem.body) { mem.yaw = 0; mem.pitch = 0; }
    mem.body = body || mem.body;
    teardown();
    stageName = 'viewer';
    mem.stage = 'viewer';
    viewer = new Viewer360({
      stage, body: mem.body, layer: mem.layer,
      initial: {
        frame: mem.frame,
        speed: mem.speed,
        // A run parked on its last frame would restart from zero if it resumed
        // playing, which is not where anyone left it.
        playing: mem.frame >= LAST_FRAME ? false : (resume ? mem.playing : true),
        yaw: mem.yaw,
        pitch: mem.pitch,
        fov: resume ? mem.fov : null,
      },
      onBackToMap: showOverview,
      onCompare: showCompare,
    });
    element.appendChild(viewer.element);
  };

  const showCompare = () => {
    teardown();
    stageName = 'compare';
    mem.stage = 'compare';
    compare = new CompareGrid({ stage, layer: mem.layer, initial: { ...mem.compare, frame: mem.frame }, onExit: showOverview });
    element.appendChild(compare.element);
  };

  function teardown() {
    overview?.destroy();
    overview = null;
    viewer?.destroy();
    viewer = null;
    compare?.destroy();
    compare = null;
    stageName = null;
  }

  const stopFrame = stage.onFrame(() => {
    // Viewer360 and CompareGrid drive themselves from their own subscriptions
    // to the same loop; all this does is write down where the visitor is.
    if (viewer) {
      const v = viewer.state.value;
      Object.assign(mem, {
        body: v.body, layer: v.layer, frame: v.frame, speed: v.speed,
        playing: v.playing, yaw: v.yaw, pitch: v.pitch, fov: v.fov,
      });
      rememberViewer();
    } else if (compare?.views) {
      const s = compare.state.value;
      mem.compare = {
        frame: s.frame, speed: s.speed, playing: s.playing, locked: compare.locked,
        looks: Object.fromEntries(compare.views.map((view) => [view.body, {
          yaw: view.controls.yaw, pitch: view.controls.pitch, fov: view.controls.fov,
        }])),
      };
      // The single viewer picks up the grid's timestep, and the other way round.
      mem.frame = s.frame;
      rememberViewer();
    }
  });

  if (mem.stage === 'viewer') showViewer(mem.body, true);
  else if (mem.stage === 'compare') showCompare();
  else showOverview();

  return {
    element,
    destroy() {
      stopFrame();
      rememberViewer(true);
      // teardown() is about to null the stage; keep the name it had.
      const was = stageName;
      teardown();
      mem.stage = was ?? mem.stage;
      rememberViewer(true);
      element.remove();
    },
  };
}
