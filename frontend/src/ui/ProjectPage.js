/**
 * The standard project page.
 *
 * Layout mirrors the mission-select screen's calm: a back control top-left, the
 * wordmark top-centre, the section's text in the middle, and a bar of circular
 * buttons along the bottom -- one per section in your registry entry.
 *
 * Most projects need no more than:
 *
 *     import { createProjectPage } from '../../ui/ProjectPage.js';
 *     export default createProjectPage();
 *
 * To render something richer than text for a section -- a viewer, an upload
 * form -- pass `renderSection`. Return an element and it is placed in the
 * content area; return nothing and the default title/body is used.
 *
 *     export default createProjectPage({
 *       renderSection(section, ctx) {
 *         if (section.id !== 'viewer') return null;
 *         const el = document.createElement('div');
 *         ...
 *         return el;
 *       },
 *       onLeave() { ... }   // optional cleanup for whatever you built
 *     });
 *
 * If what you build owns something the browser keeps running on its own -- a
 * playing video, a WebGL scene, a timer, a fetch -- return `{ element, dispose }`
 * instead. `dispose` is called when the visitor clicks a different section
 * button and again when they leave the page, so it runs exactly once either
 * way. Removing the element is not enough: a detached <video> keeps decoding.
 *
 *     return { element: el, dispose: () => viewer.destroy() };
 *
 * Pass `rememberSection: true` to reopen whichever section the visitor was on
 * last, for the rest of the tab's life -- including across a reload. Off by
 * default, so a page that expects to open on its first section still does.
 */
import './page.css';
import { Timeline } from '../lib/tween.js';
import { easeOutCubic, easeInCubic } from '../lib/math.js';

/** Where the camera sits to look along the dust wave. */
export const WAVE_VIEW = { x: 0, y: 2.5, z: 20, lookAt: [0, -4.5, -6] };

const BACK_ARROW = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M6.5 3.5 2.5 8l4 4.5M2.5 8h11" stroke="currentColor" stroke-width="1.3"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SECTION_KEY = (id) => `btp:section:${id}`;

function readSection(project) {
  try {
    const id = sessionStorage.getItem(SECTION_KEY(project.id));
    return project.sections.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}

export function createProjectPage({ renderSection, onLeave, rememberSection = false } = {}) {
  return {
    mount({ root, stage, navigate, project }) {
      const field = stage.ambient.field;
      const tl = new Timeline();
      let leaving = false;
      let active = (rememberSection && readSection(project)) || project.sections[0];

      /* ---------------------------------------------------------- markup */
      const el = document.createElement('div');
      el.className = 'page';
      el.style.setProperty('--accent', project.accent);
      el.innerHTML = `
        <header class="page__top">
          <button class="back" type="button">
            <span class="back__ring">${BACK_ARROW}</span>
            <span class="back__label">All missions</span>
          </button>
          <span class="wordmark">B.TECH<br>PROJECT</span>
          <span class="page__owner">${project.owner}</span>
        </header>

        <main class="page__body"><div class="panel"></div></main>

        <nav class="dock" aria-label="${project.name} sections">
          ${project.sections.map((s) => `
            <button class="dock__btn${s.id === active.id ? ' is-active' : ''}" type="button"
                    data-id="${s.id}" aria-label="${s.label}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true">${s.icon}</svg>
              <span class="dock__tip">${s.label}</span>
            </button>`).join('')}
        </nav>`;
      root.appendChild(el);

      const panel = el.querySelector('.panel');
      const backBtn = el.querySelector('.back');
      const dockBtns = [...el.querySelectorAll('.dock__btn')];

      /* --------------------------------------------------------- content */
      // Whatever the last custom section handed back, so it can be torn down
      // before the next one is built. Without this, switching away from the
      // 360 viewer leaves a 4096x2048 video decoding behind an invisible panel.
      let disposeSection = null;

      const render = (section) => {
        disposeSection?.();
        disposeSection = null;

        const result = renderSection?.(section, { project, stage, navigate });
        // Accept a bare element (the common case) or { element, dispose }.
        const custom = result instanceof Node ? result : result?.element;
        if (result && !(result instanceof Node)) disposeSection = result.dispose ?? null;

        panel.replaceChildren();

        if (custom) {
          panel.appendChild(custom);
        } else {
          const wrap = document.createElement('div');
          wrap.className = 'copy';
          wrap.innerHTML = `
            <span class="copy__eyebrow">${project.name}</span>
            <h1 class="copy__title">${section.title}</h1>
            <p class="copy__body">${section.body}</p>`;
          panel.appendChild(wrap);
        }
        // Force a reflow so the entrance transition restarts on a swap.
        void panel.offsetWidth;
        panel.classList.add('is-in');
      };

      /** Slides the current section out, swaps, slides the next one in. */
      const paint = (section, animate = true) => {
        field.setTint(section.tint || project.accent, 0.32);
        if (!animate) { render(section); return; }
        panel.classList.remove('is-in');
        panel.classList.add('is-out');
        tl.at(0.28, () => {
          panel.classList.remove('is-out');
          render(section);
        });
      };

      /* ------------------------------------------------- arrive from dive */
      // The entry screen leaves the field dim and half-morphed. Pick it up from
      // wherever it is, so a direct URL load and a dive both land correctly.
      stage.camera.position.set(WAVE_VIEW.x, WAVE_VIEW.y, WAVE_VIEW.z);

      const fromOpacity = field.uniforms.uOpacity.value;
      const fromMorph = field.uniforms.uMorph.value;
      tl.add({ from: fromMorph, to: 1, dur: 1.15, ease: easeOutCubic,
               onUpdate: v => field.uniforms.uMorph.value = v });
      tl.add({ from: Math.min(fromOpacity, 0.35), to: 1, dur: 1.0, ease: easeOutCubic,
               onUpdate: v => field.uniforms.uOpacity.value = v });
      tl.at(0.12, () => el.classList.add('is-in'));
      paint(active, false);

      /* ---------------------------------------------------------- leaving */
      const leave = () => {
        if (leaving) return;
        leaving = true;
        el.classList.remove('is-in');
        tl.clear();
        tl.add({ from: field.uniforms.uOpacity.value, to: 0.12, dur: 0.6, ease: easeInCubic,
                 onUpdate: v => field.uniforms.uOpacity.value = v });
        tl.add({ from: 1, to: 0.4, dur: 0.7, ease: easeInCubic,
                 onUpdate: v => field.uniforms.uMorph.value = v });
        tl.add({ from: stage.camera.position.z, to: 46, dur: 0.7, ease: easeInCubic,
                 onUpdate: v => stage.camera.position.z = v });
        tl.at(0.72, () => navigate(null));
      };

      /* ----------------------------------------------------- interactions */
      const onDock = (e) => {
        const id = e.currentTarget.dataset.id;
        if (id === active.id) return;
        active = project.sections.find((s) => s.id === id);
        if (rememberSection) {
          try { sessionStorage.setItem(SECTION_KEY(project.id), id); } catch { /* storage blocked */ }
        }
        for (const b of dockBtns) b.classList.toggle('is-active', b.dataset.id === id);
        paint(active);
      };
      backBtn.addEventListener('click', leave);
      for (const b of dockBtns) b.addEventListener('click', onDock);

      const onKey = (e) => { if (e.key === 'Escape') leave(); };
      window.addEventListener('keydown', onKey);

      /* -------------------------------------------------------- per frame */
      const stopFrame = stage.onFrame((dt) => {
        tl.update(dt);
        const c = stage.camera;
        c.position.x += (stage.pointerSmooth.x * 1.5 - c.position.x) * Math.min(1, dt * 2);
        c.position.y += (WAVE_VIEW.y + stage.pointerSmooth.y * 0.9 - c.position.y) * Math.min(1, dt * 2);
        c.lookAt(...WAVE_VIEW.lookAt);
      });

      this._teardown = () => {
        stopFrame();
        backBtn.removeEventListener('click', leave);
        for (const b of dockBtns) b.removeEventListener('click', onDock);
        window.removeEventListener('keydown', onKey);
        disposeSection?.();
        disposeSection = null;
        onLeave?.();
        el.remove();
      };
    },

    unmount() {
      this._teardown?.();
      this._teardown = null;
    },
  };
}
