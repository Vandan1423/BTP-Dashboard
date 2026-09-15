/**
 * ONE OBJECT HOLDS EVERYTHING THE VIEWER KNOWS
 * ============================================
 * Which frame, whether it is playing, how fast, which planet, which render
 * set, where you are looking. Nothing reads that from the video element or the
 * camera; they read it from here, and here is what changes when a control is
 * used.
 *
 * The reason this exists rather than the buttons simply calling `video.play()`
 * is the headset. A DOM overlay is invisible inside a WebXR session, so the
 * same controls have to be drawn a second time as a panel floating in the
 * scene. With the state separated out, that second version is another
 * subscriber -- a new way to look at the same numbers. Wire the buttons
 * directly to the video and it becomes a rewrite instead.
 *
 *   const stop = state.subscribe((s, changed) => { if (changed.frame) ... });
 *   state.patch({ playing: false });
 */

export class ViewerState {
  constructor(initial = {}) {
    this.value = {
      body: 'Earth',        // which planet you are standing on
      layer: 'cme',         // 'cme' or 'field'
      frame: 0,             // 0 .. 200, the VTK index
      playing: false,
      speed: 1,
      yaw: 0,               // radians, left/right
      pitch: 0,             // radians, up/down
      fov: 70,              // degrees, ignored inside a headset
      ready: false,         // enough video decoded to show something
      buffering: false,
      error: null,
      xr: false,            // a headset session is running
      ...initial,
    };
    this._subs = new Set();
  }

  /** @returns {() => void} unsubscribe. */
  subscribe(fn) {
    this._subs.add(fn);
    // Paint once immediately so there is no gap before the first change, and
    // report every key as changed. Passing the state itself as the change map
    // looks equivalent and is not: `frame` starts at 0, so a subscriber
    // guarding on `changed.frame` would skip it and the clock would sit on its
    // placeholder until the video moved.
    const all = {};
    for (const k in this.value) all[k] = true;
    fn(this.value, all);
    return () => this._subs.delete(fn);
  }

  /**
   * Merge in a change and tell everyone what actually moved.
   *
   * Silent when nothing differs. That matters more than it looks: `frame` is
   * patched twenty times a second while the video plays, and without this every
   * subscriber would rewrite its DOM on every one of those calls.
   */
  patch(partial) {
    const changed = {};
    let any = false;
    for (const k in partial) {
      if (!Object.is(this.value[k], partial[k])) {
        this.value[k] = partial[k];
        changed[k] = true;
        any = true;
      }
    }
    if (!any) return;
    for (const fn of this._subs) fn(this.value, changed);
  }

  destroy() { this._subs.clear(); }
}
