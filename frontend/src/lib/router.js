/**
 * Hash router over the project registry.
 *
 *   #/            -> the entry screen
 *   #/<id>        -> that project's page
 *
 * A page is an object with `mount(ctx)` and `unmount()`. The router guarantees
 * the previous page is fully unmounted before the next one mounts, so pages
 * never have to clean up after each other.
 */
import { getProject } from './projects.js';

export class Router {
  constructor({ root, stage, entry }) {
    this.root = root;
    this.stage = stage;
    this.entry = entry;          // the entry screen module
    this.current = null;
    this.currentId = null;
    // Distinct from currentId, which is legitimately null on the entry screen.
    // Without this the first resolve() would see "already there" and mount nothing.
    this._mounted = false;
    this._onHash = () => this.resolve();
  }

  start() {
    window.addEventListener('hashchange', this._onHash);
    this.resolve();
  }

  static go(id) {
    window.location.hash = id ? `#/${id}` : '#/';
  }

  parse() {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    return raw === '' ? null : raw;
  }

  async resolve() {
    const id = this.parse();
    if (this._mounted && id === this.currentId) return;
    this._mounted = true;

    if (this.current) {
      try { this.current.unmount?.(); }
      catch (err) { console.error('[router] unmount failed', err); }
      this.current = null;
    }
    this.root.replaceChildren();

    const ctx = { root: this.root, stage: this.stage, navigate: Router.go };

    if (id === null) {
      this.current = this.entry;
      this.currentId = null;
      this.entry.mount({ ...ctx, project: null });
      return;
    }

    const project = getProject(id);
    if (!project) { Router.go(null); return; }

    this.currentId = id;
    try {
      const mod = await project.load();
      const page = mod.default ?? mod;
      // Guard against a fast second navigation while the import was in flight.
      if (this.currentId !== id) return;
      this.current = page;
      page.mount({ ...ctx, project });
    } catch (err) {
      console.error(`[router] failed to load project "${id}"`, err);
      this.root.innerHTML =
        `<div style="display:grid;place-items:center;height:100%;font-family:var(--font-mono);color:var(--ink-soft)">
           Could not load “${id}”. Check the console.
         </div>`;
    }
  }
}
