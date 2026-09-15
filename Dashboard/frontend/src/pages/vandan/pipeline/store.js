/**
 * WHAT THE SECTION REMEMBERS
 * ==========================
 * The section's DOM and its three.js scene are torn down every time the
 * visitor clicks over to the 360 viewer, because the page contract says a
 * section hands everything back when it is left. What must NOT be torn down is
 * the job: a render keeps going on the box whether anyone is watching the
 * progress ring or not, and coming back to find the results gone reads as the
 * render having failed.
 *
 * So the state lives here, at module level, outside any one mount. The module
 * is loaded once per tab, which means it survives section switches and leaving
 * the project page. It is also mirrored to sessionStorage, so a reload in the
 * middle of a ten-minute job does not lose it either. The File object of an
 * upload cannot be stored and is not needed once a job is submitted; before
 * that, a reload asks for the file again, which is the honest outcome.
 */

const KEY = 'btp:pipeline:v1';

export const DEFAULT_TOOLS = Object.freeze({
  wind: true, cme: true, grid: 'raw', slice: 'off', slicePos: 0, threshold: 0.10,
});

function fresh() {
  return {
    /** intake | configure | running | done | failed */
    state: 'intake',
    /** The timestep being previewed on the intake. */
    preview: 169,
    /**
     * The form before submission.
     * { fileName, fileSize, archived, index, bodies, quality, resolution, datetime }
     */
    draft: null,
    /** In memory only -- a File cannot be serialised. */
    file: null,
    /** The settings a job was submitted with, minus the File. */
    job: null,
    jobId: null,
    /** Whether the job is on the real service or the simulator. */
    live: false,
    /** Where it is rendering ("this Mac · Metal"), or why it is simulated. */
    label: null,
    reason: null,
    /** { error, log } for a job that failed. */
    failure: null,
    /** For the simulator: when the job started, in epoch ms. */
    startedAt: null,
    /** The last poll response, so results show before the next poll lands. */
    snapshot: null,
    /** { mode: 'single'|'compare', body } while the frame explorer is open. */
    explorer: null,
    tools: { ...DEFAULT_TOOLS },
    inspectorCollapsed: false,
  };
}

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return fresh();
    const saved = JSON.parse(raw);
    const s = { ...fresh(), ...saved, file: null };
    s.tools = { ...DEFAULT_TOOLS, ...(saved.tools || {}) };
    // A draft for an uploaded file cannot come back without its bytes.
    if (s.state === 'configure' && s.draft && !s.draft.archived) {
      s.state = 'intake';
      s.draft = null;
    }
    return s;
  } catch {
    return fresh();
  }
}

export const store = load();

/** Write the serialisable parts. Cheap enough to call on every change. */
export function save() {
  try {
    const { file, ...rest } = store;
    // The log can run to a couple of hundred lines; keep the tail.
    if (rest.snapshot?.log?.length > 160) {
      rest.snapshot = { ...rest.snapshot, log: rest.snapshot.log.slice(-160) };
    }
    sessionStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* Private windows and blocked storage: the in-memory copy still works. */
  }
}

/** Merge a change and persist it. */
export function update(patch) {
  Object.assign(store, patch);
  save();
}

/** Forget the current job and draft, keeping the visitor's tool settings. */
export function clearJob() {
  const { tools, inspectorCollapsed, preview } = store;
  Object.assign(store, fresh(), { tools, inspectorCollapsed, preview });
  save();
}
