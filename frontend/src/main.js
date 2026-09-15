/**
 * Application entry point.
 *
 * Owns everything that outlives a single page: the WebGL stage, the faint
 * starfield, and the particle field that is the galaxy on the mission-select
 * screen and the dust wave behind a project. Pages drive that field rather than
 * building their own, which is why navigating never cuts to black.
 */
import './styles/base.css';
import { Stage } from './core/Stage.js';
import { Starfield } from './core/Starfield.js';
import { ParticleField } from './core/ParticleField.js';
import { Router } from './lib/router.js';
import entryPage from './pages/entry/index.js';

const stage = new Stage(document.querySelector('#stage'));

const starfield = new Starfield({ pixelRatio: stage.pixelRatio });
const field = new ParticleField({ pixelRatio: stage.pixelRatio });
stage.scene.add(starfield.group, field.object);

// Pages reach these through `stage.ambient`.
stage.ambient = { starfield, field };

stage.onFrame((dt, elapsed) => {
  starfield.update(dt, elapsed, stage.pointerSmooth);
  field.setPointer(stage.pointer, stage.pointerActive);
  field.update(dt, elapsed, stage.camera);
});

window.addEventListener('resize', () => {
  const r = stage.pixelRatio;
  starfield.setPixelRatio(r);
  field.setPixelRatio(r);
});

new Router({ root: document.querySelector('#app'), stage, entry: entryPage }).start();
stage.start();

if (import.meta.env.DEV) window.__stage = stage;
