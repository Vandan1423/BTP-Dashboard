/**
 * The landing screen.
 *
 *   begin   a single BEGIN button on near-black
 *   bloom   the galaxy blooms out of that point as the camera falls toward it
 *   select  three planets on tilted orbits, each labelled, waiting to be picked
 *   dive    the camera drops through the disc and hands off to a project page
 *
 * The particle field lives on the stage, not here, so the dive can start on this
 * page and finish on the next one without the screen ever cutting to black.
 */
import * as THREE from 'three';
import './entry.css';
import { PROJECTS, MAX_ORBIT } from '../../lib/projects.js';
import { VIEW } from '../../lib/viewConfig.js';
import { Planets } from './Planets.js';
import { Timeline } from '../../lib/tween.js';
import { easeInCubic, easeOutCubic, easeInOutCubic, prefersReducedMotion } from '../../lib/math.js';

const SEEN_KEY = 'btp.introPlayed';

const seen = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = (v) => {
  try { v ? sessionStorage.setItem(SEEN_KEY, '1') : sessionStorage.removeItem(SEEN_KEY); } catch {}
};

function nodeMarkup(p) {
  return `
    <button class="node" type="button" data-id="${p.id}" style="--accent:${p.accent}"
            aria-label="Open ${p.name} by ${p.owner}">
      <span class="node__owner">${p.owner}</span>
      <span class="node__name">${p.name}</span>
      <span class="node__rule"></span>
    </button>`;
}

export default {
  mount({ root, stage, navigate }) {
    const field = stage.ambient.field;
    const straightToSelect = seen() || prefersReducedMotion();

    /* ------------------------------------------------------------------ DOM */
    const el = document.createElement('div');
    el.className = 'entry';
    el.innerHTML = `
      <header class="hud">
        <span class="wordmark">B.TECH<br>PROJECT</span>
        <span class="hud__meta">Scientific visualisation · 2026</span>
      </header>
      <div class="begin">
        <button class="begin__btn" type="button">
          <svg class="begin__ring" viewBox="0 0 128 128" aria-hidden="true">
            <circle class="begin__track" cx="64" cy="64" r="61"/>
            <circle class="begin__sweep" cx="64" cy="64" r="61"/>
          </svg>
          <span class="begin__label">Begin</span>
        </button>
      </div>
      <div class="select"><span class="select__eyebrow">Select a mission</span></div>
      <div class="nodes">${PROJECTS.map(nodeMarkup).join('')}</div>`;
    root.appendChild(el);

    const beginWrap = el.querySelector('.begin');
    const beginBtn = el.querySelector('.begin__btn');
    const nodeEls = [...el.querySelectorAll('.node')];

    /* ------------------------------------------------------------------- 3D */
    const planets = new Planets();
    stage.scene.add(...planets.objects);
    planets.setOpacity(0);

    const tl = new Timeline();
    let phase = 'begin';
    let nodesVisible = 0;
    let leaving = false;
    let hoveredId = null;

    // Arriving back from a project leaves the field dim, morphed toward the wave
    // and the camera pulled well back. Detect that and fly in, rather than
    // snapping, so the round trip feels continuous.
    const returning = straightToSelect && field.uniforms.uOpacity.value < 0.9;
    const cameFromZ = stage.camera.position.z;

    field.setTint('#4da3ff', 0);
    field.uniforms.uSpin.value = VIEW.spin;
    stage.camera.position.set(0, 0, returning ? Math.max(cameFromZ, 34) : (straightToSelect ? VIEW.camDistance : 52));
    if (!returning) {
      field.uniforms.uMorph.value = 0;
      field.uniforms.uOpacity.value = straightToSelect ? 1 : 0;
    }

    /* --------------------------------------------------------------- bloom */
    const bloom = () => {
      if (phase !== 'begin') return;
      phase = 'bloom';
      el.classList.add('is-begun');
      markSeen(true);

      // Spin fast and settle. The disc appears to wind itself up out of a point
      // rather than simply fading in.
      field.uniforms.uSpin.value = 2.6;
      tl.add({ from: 2.6, to: VIEW.spin, dur: 3.4, ease: easeOutCubic,
               onUpdate: v => field.uniforms.uSpin.value = v });
      tl.add({ from: 0, to: 1, dur: 1.9, ease: easeOutCubic,
               onUpdate: v => field.uniforms.uOpacity.value = v });
      tl.add({ from: 52, to: VIEW.camDistance, dur: 2.6, ease: easeInOutCubic,
               onUpdate: v => stage.camera.position.z = v,
               onDone: () => { phase = 'select'; } });
      tl.add({ from: 0, to: 1, dur: 1.1, delay: 1.5, ease: easeOutCubic,
               onUpdate: v => { nodesVisible = v; planets.setOpacity(v); } });
      tl.at(1.9, () => el.classList.add('is-select'));
    };

    if (straightToSelect) {
      phase = 'select';
      el.classList.add('is-begun', 'is-select');

      if (returning) {
        tl.add({ from: field.uniforms.uMorph.value, to: 0, dur: 1.05, ease: easeOutCubic,
                 onUpdate: v => field.uniforms.uMorph.value = v });
        tl.add({ from: field.uniforms.uOpacity.value, to: 1, dur: 0.95, ease: easeOutCubic,
                 onUpdate: v => field.uniforms.uOpacity.value = v });
        tl.add({ from: stage.camera.position.z, to: VIEW.camDistance, dur: 1.35, ease: easeOutCubic,
                 onUpdate: v => stage.camera.position.z = v });
        tl.add({ from: 0, to: 1, dur: 0.85, delay: 0.4, ease: easeOutCubic,
                 onUpdate: v => { nodesVisible = v; planets.setOpacity(v); } });
      } else {
        nodesVisible = 1;
        planets.setOpacity(1);
      }
    }

    /* ---------------------------------------------------------------- dive */
    const dive = (id) => {
      if (leaving || phase !== 'select') return;
      leaving = true;
      phase = 'dive';
      el.classList.add('is-leaving');
      hoveredId = null;
      field.setFocus(null);
      const project = PROJECTS.find((p) => p.id === id);

      tl.clear();
      tl.add({ from: 1, to: 0, dur: 0.45, ease: easeOutCubic,
               onUpdate: v => { nodesVisible = v; planets.setOpacity(v); } });
      // Accelerate into the core: ease-in, so it starts as a drift and ends fast.
      tl.add({ from: stage.camera.position.z, to: -3, dur: 1.15, ease: easeInCubic,
               onUpdate: v => stage.camera.position.z = v });
      tl.add({ from: 0, to: 0.55, dur: 1.15, ease: easeInCubic,
               onUpdate: v => field.uniforms.uMorph.value = v });
      // Dimming through the middle is what lets the camera be repositioned for
      // the next screen without the cut being visible.
      tl.add({ from: 1, to: 0.12, dur: 1.0, delay: 0.15, ease: easeInCubic,
               onUpdate: v => field.uniforms.uOpacity.value = v });
      tl.at(1.18, () => {
        field.setTint(project.accent, 0.32);
        navigate(id);
      });
    };

    /* -------------------------------------------------------- interactions */
    const focusVec = new THREE.Vector3();
    const onEnter = (e) => {
      const id = e.currentTarget.dataset.id;
      planets.setHover(id, true);
      hoveredId = id;
      if (planets.worldPosition(id, focusVec)) field.setFocus(focusVec);
      el.classList.add('is-focused');
    };
    const onLeave = (e) => {
      planets.setHover(e.currentTarget.dataset.id, false);
      hoveredId = null;
      field.setFocus(null);
      el.classList.remove('is-focused');
    };
    const onClick = (e) => dive(e.currentTarget.dataset.id);
    for (const n of nodeEls) {
      n.addEventListener('pointerenter', onEnter);
      n.addEventListener('pointerleave', onLeave);
      n.addEventListener('click', onClick);
    }
    beginBtn.addEventListener('click', bloom);

    /* ----------------------------------------------------------- per frame */
    const stopFrame = stage.onFrame((dt, elapsed) => {
      tl.update(dt);
      planets.update(dt, elapsed);

      // Parallax. Held back until the galaxy is up, so the begin screen is still.
      const par = phase === 'begin' ? 0 : 1;
      const k = Math.min(1, dt * 2.4);
      const cam = stage.camera;
      cam.position.x += (stage.pointerSmooth.x * 0.85 * par - cam.position.x) * k;
      cam.position.y += (VIEW.camHeight + stage.pointerSmooth.y * 0.55 * par - cam.position.y) * k;
      // Once settled, follow the configured distance, so editing viewConfig.js or
      // dragging the dev tuner moves the camera without a reload.
      if (phase === 'select') {
        cam.position.z += (VIEW.camDistance - cam.position.z) * k;
        field.uniforms.uSpin.value += (VIEW.spin - field.uniforms.uSpin.value) * k;
      }
      cam.lookAt(0, VIEW.lookAtY, 0);

      // Shrink the orbits until the widest one clears the frame edge with room
      // for its label. Without this a planet drifts off screen on a narrow window.
      const halfW = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov) / 2)
                  * Math.abs(stage.camera.position.z) * stage.camera.aspect;
      planets.group.scale.setScalar(Math.min(1, Math.max(0.35, (halfW - 2.4) / MAX_ORBIT)));

      // The planet keeps orbiting under the cursor, so the focus point has to
      // follow it or the halo drifts off the planet it belongs to.
      if (hoveredId && planets.worldPosition(hoveredId, focusVec)) field.setFocus(focusVec);

      // Pin each label to its planet.
      const w = window.innerWidth, h = window.innerHeight;
      for (let i = 0; i < nodeEls.length; i++) {
        const s = planets.screenPosition(i, stage.camera, w, h);
        const n = nodeEls[i];
        n.style.transform = `translate(-50%, -100%) translate(${s.x.toFixed(1)}px, ${(s.y - 34).toFixed(1)}px)`;
        n.style.opacity = s.visible ? nodesVisible.toFixed(3) : '0';
        n.style.pointerEvents = s.visible && nodesVisible > 0.6 ? 'auto' : 'none';
      }
    });

    this._teardown = () => {
      stopFrame();
      for (const n of nodeEls) {
        n.removeEventListener('pointerenter', onEnter);
        n.removeEventListener('pointerleave', onLeave);
        n.removeEventListener('click', onClick);
      }
      beginBtn.removeEventListener('click', bloom);
      field.setFocus(null);
      planets.dispose();
      el.remove();
    };
  },

  unmount() {
    this._teardown?.();
    this._teardown = null;
  },
};
