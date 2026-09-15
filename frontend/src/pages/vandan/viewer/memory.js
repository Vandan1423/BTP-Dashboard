/**
 * WHERE THE VISITOR WAS
 * =====================
 * The 360 section is torn down whenever the visitor clicks over to VTK →
 * Frames, and it has to be: it owns a video decoding a 4096x2048 stream, and a
 * hidden one keeps decoding. What it must not do is forget. Coming back to the
 * overview after being three minutes into Earth's timeline at 2x, looking at
 * the flux rope, reads as the viewer having crashed.
 *
 * So the section writes where the visitor is into this object every frame, and
 * reads it back when it is built. Module level, so it outlives any one mount;
 * mirrored to sessionStorage, so it outlives a reload too.
 */

const KEY = 'btp:viewer:v1';

const DEFAULTS = {
  /** overview | viewer | compare */
  stage: 'overview',
  body: 'Earth',
  layer: 'cme',
  frame: 0,
  speed: 1,
  playing: true,
  yaw: 0,
  pitch: 0,
  fov: null,
  compare: { frame: 0, speed: 1, playing: false, locked: true, looks: {} },
};

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!saved) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...saved, compare: { ...DEFAULTS.compare, ...(saved.compare || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const viewerMemory = load();

let pending = false;

/**
 * Persist, at most once per second. The section calls this every frame while
 * a video plays, and sessionStorage writes are synchronous.
 */
export function rememberViewer(now = false) {
  if (now) { write(); return; }
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; write(); }, 1000);
}

function write() {
  try { sessionStorage.setItem(KEY, JSON.stringify(viewerMemory)); } catch { /* storage blocked */ }
}
