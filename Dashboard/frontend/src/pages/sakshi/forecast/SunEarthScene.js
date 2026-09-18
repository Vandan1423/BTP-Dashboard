/**
 * THE SUN-TO-EARTH SCENE, factored out of what was ForecastSection.js so both
 * the fixed 2003 replay (ForecastSection.js) and the Explorer's own
 * date-range/model choice (explorer/ExplorerSection.js) can drive the same
 * visualization from different data sources.
 *
 * Takes already-loaded data (no fetching in here) in the shape:
 *   { label, pt_minutes, ln10_threshold, cadence_minutes,
 *     rows: [{ t, e, eh, p, pred }, ...] }
 * where e/eh are ln(electron / high-energy electron flux), p is ln(actual
 * proton flux), and pred is the model's prediction for p (or null/undefined
 * for rows the caller only wants shown as context, e.g. Explorer's input-
 * buffer window before the requested start time -- no prediction is claimed
 * there, matching forecast_plot_external.py's convention).
 *
 * Follows the pattern in pages/vandan/viewer/Viewer360.js: its own scene and
 * camera, borrowed from the Stage via setView, everything released in destroy().
 */
import * as THREE from 'three';
import { damp, remap, clamp } from '../../../lib/math.js';
import './forecast.css';

/** Real event duration compressed into this many seconds of one loop. */
const PLAY_SECONDS = 75;

const SUN_X = -5.2;
const EARTH_X = 5.2;
// The HUD card sits centered in the page body (CSS pushes it toward the
// bottom, see forecast.css), so the Sun-Earth path is raised well above the
// vertical center to keep the particle stream from ever running behind it.
const SCENE_Y = 3.1;

export function createSunEarthScene({ stage, data, subtitle, onBack }) {
  const element = document.createElement('div');
  element.className = 'fsec';
  element.innerHTML = `
    <div class="fsec__hud">
      <div class="fsec__head">
        ${onBack ? `<button class="fsec__back" type="button">&larr; New forecast</button>` : ''}
        ${subtitle ? `<p class="fsec__subtitle">${subtitle}</p>` : ''}
      </div>
      <div class="fsec__badges">
        <span class="badge badge--pred"><i></i>Predicted warning</span>
        <span class="badge badge--actual"><i></i>Actual SEP event</span>
      </div>
      <svg class="fsec__chart" viewBox="0 0 340 108" preserveAspectRatio="none">
        <line class="chart__grid" x1="0" y1="27" x2="340" y2="27" />
        <line class="chart__grid" x1="0" y1="54" x2="340" y2="54" />
        <line class="chart__grid" x1="0" y1="81" x2="340" y2="81" />
        <line class="chart__threshold" x1="0" x2="340" y1="0" y2="0" />
        <polyline class="chart__line chart__line--electron" points="" />
        <polyline class="chart__line chart__line--actual" points="" />
        <polyline class="chart__line chart__line--pred" points="" />
        <line class="chart__playhead" x1="0" y1="0" x2="0" y2="108" />
      </svg>
      <div class="fsec__legend">
        <span><i class="dot dot--electron"></i>Electron (&gt;0.25 MeV)</span>
        <span><i class="dot dot--actual"></i>Proton, actual</span>
        <span><i class="dot dot--pred"></i>Proton, predicted (+${data.pt_minutes ?? 30} min)</span>
      </div>
      <div class="fsec__controls">
        <button class="fsec__play" type="button" aria-label="Play / pause">⏸</button>
        <input class="fsec__scrub" type="range" min="0" max="1000" value="0" />
        <span class="fsec__clock">--:--</span>
      </div>
      <p class="fsec__readout"></p>
    </div>`;

  const playBtn = element.querySelector('.fsec__play');
  const scrub = element.querySelector('.fsec__scrub');
  const clockEl = element.querySelector('.fsec__clock');
  const readoutEl = element.querySelector('.fsec__readout');
  const lineElectron = element.querySelector('.chart__line--electron');
  const lineActual = element.querySelector('.chart__line--actual');
  const linePred = element.querySelector('.chart__line--pred');
  const playhead = element.querySelector('.chart__playhead');
  const thresholdLine = element.querySelector('.chart__threshold');
  const badgePred = element.querySelector('.badge--pred');
  const badgeActual = element.querySelector('.badge--actual');

  /* ------------------------------------------------------------- scene */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  // Camera and scene both sit at SCENE_Y, so simply raising SCENE_Y moves
  // both together and never changes where the Sun-Earth path lands in the
  // rendered frame. What actually pushes it toward the top of the frame is
  // tilting the camera steeply downward -- aiming well below the path's own
  // height so the path itself renders high, leaving clear space below it
  // (over the HUD card) for the particle stream to be visible in transit.
  camera.position.set(0, SCENE_Y + 1.0, 12.5);
  camera.lookAt(0, SCENE_Y - 1.9, 0);

  scene.add(new THREE.AmbientLight(0x3a3f66, 0.9));

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 48, 32),
    new THREE.MeshBasicMaterial({ map: makeSunTexture() }),
  );
  sun.position.set(SUN_X, SCENE_Y, 0);
  scene.add(sun);
  const sunLight = new THREE.PointLight(0xffb15e, 40, 30);
  sunLight.position.copy(sun.position);
  scene.add(sunLight);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('#ffb15e'), color: 0xffb15e, transparent: true,
    opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sunGlow.scale.setScalar(4.2);
  sunGlow.position.copy(sun.position);
  scene.add(sunGlow);
  // A second, tighter corona layer so the disc has a bright inner halo as
  // well as the wide outer glow -- a single sprite reads as a flat blob.
  const sunCorona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('#fff3d6'), color: 0xfff3d6, transparent: true,
    opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sunCorona.scale.setScalar(2.15);
  sunCorona.position.copy(sun.position);
  scene.add(sunCorona);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 48, 32),
    new THREE.MeshStandardMaterial({
      map: makeEarthTexture(), roughness: 0.8, metalness: 0.05,
      emissive: 0x0a1530, emissiveIntensity: 0.25,
    }),
  );
  earth.position.set(EARTH_X, SCENE_Y, 0);
  scene.add(earth);
  const earthClouds = new THREE.Mesh(
    new THREE.SphereGeometry(0.412, 48, 32),
    new THREE.MeshStandardMaterial({
      map: makeCloudTexture(), transparent: true, opacity: 0.55,
      depthWrite: false, roughness: 1,
    }),
  );
  earthClouds.position.copy(earth.position);
  scene.add(earthClouds);
  // Thin blue rim so the planet doesn't cut a hard edge against space --
  // the same cheap sprite-glow trick as the sun, just tighter and cooler.
  const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('#5fb2ff'), color: 0x5fb2ff, transparent: true,
    opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  earthGlow.scale.setScalar(1.15);
  earthGlow.position.copy(earth.position);
  scene.add(earthGlow);

  // The shield: brightens on the model's early warning, flares solid on the
  // real event arrival -- the two moments this whole project is about.
  const shield = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.98, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffcf6b, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  shield.position.copy(earth.position);
  scene.add(shield);

  const path = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([sun.position, earth.position]),
    new THREE.LineBasicMaterial({ color: 0x2a3260, transparent: true, opacity: 0.5 }),
  );
  scene.add(path);

  /* --------------------------------------------------------- particles */
  const streams = {
    electron: makeStream({ count: 420, color: 0x7fe0ff, size: 0.2, travel: 1.35 }),
    proton: makeStream({ count: 260, color: 0xff5d5d, size: 0.26, travel: 4.1 }),
  };
  scene.add(streams.electron.points, streams.proton.points);

  function makeStream({ count, color, size, travel }) {
    const positions = new Float32Array(count * 3);
    const progress = new Float32Array(count).fill(-1); // -1 = inactive
    const lane = new Float32Array(count * 2); // small random y/z offset per particle
    for (let i = 0; i < count; i++) {
      lane[i * 2] = (Math.random() - 0.5) * 0.55;
      lane[i * 2 + 1] = (Math.random() - 0.5) * 0.55;
      positions[i * 3] = SUN_X;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(geom, mat);
    // Positions are rewritten every frame on the CPU; three.js would otherwise
    // frustum-cull against a bounding sphere computed once from the initial
    // (mostly parked-at-zero) buffer and never updated, silently hiding every
    // particle as soon as it moved past that stale sphere.
    points.frustumCulled = false;
    return { points, positions, progress, lane, travel, count, cursor: 0 };
  }

  // Procedural surfaces, in the same spirit as the rest of the dashboard
  // (Planets.js, Starfield.js): no image assets, everything painted onto a
  // canvas at runtime. A blotchy warm turbulence for the sun's photosphere,
  // and painted oceans/continents/ice caps for Earth.
  function makeSunTexture() {
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8a1f';
    ctx.fillRect(0, 0, w, h);
    const warm = ['#ff5a1f', '#ff7a1f', '#ff9d3f', '#ffc766', '#ffe9a8'];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = 10 + Math.random() * 42;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const color = warm[(Math.random() * warm.length) | 0];
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.28 + Math.random() * 0.3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Soft limb darkening so the edge of the disc reads as a sphere.
    const limb = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.58);
    limb.addColorStop(0, 'transparent');
    limb.addColorStop(1, 'rgba(120, 30, 0, 0.55)');
    ctx.fillStyle = limb;
    ctx.fillRect(0, 0, w, h);
    return new THREE.CanvasTexture(c);
  }

  function makeEarthTexture() {
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const ocean = ctx.createLinearGradient(0, 0, 0, h);
    ocean.addColorStop(0, '#0a2f6e');
    ocean.addColorStop(0.5, '#125fb0');
    ocean.addColorStop(1, '#0a2f6e');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, w, h);

    const land = ['#3d7a3a', '#5a8f3f', '#7a6a3a', '#4a6b2f'];
    const blob = (cx, cy, scale) => {
      ctx.fillStyle = land[(Math.random() * land.length) | 0];
      ctx.beginPath();
      const n = 9 + ((Math.random() * 5) | 0);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = scale * (0.6 + Math.random() * 0.6);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    };
    // A handful of continent-scale blobs, each built from several overlapping
    // splotches so the coastline doesn't read as a single perfect polygon.
    const continents = 7 + ((Math.random() * 4) | 0);
    for (let i = 0; i < continents; i++) {
      const cx = Math.random() * w, cy = h * 0.18 + Math.random() * h * 0.64;
      const scale = 18 + Math.random() * 34;
      for (let j = 0; j < 4; j++) {
        blob(cx + (Math.random() - 0.5) * scale, cy + (Math.random() - 0.5) * scale * 0.6, scale * 0.7);
      }
    }
    // Ice caps.
    const capH = h * 0.09;
    let g = ctx.createLinearGradient(0, 0, 0, capH);
    g.addColorStop(0, 'rgba(235,245,255,0.95)'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, capH);
    g = ctx.createLinearGradient(0, h - capH, 0, h);
    g.addColorStop(0, 'transparent'); g.addColorStop(1, 'rgba(235,245,255,0.95)');
    ctx.fillStyle = g; ctx.fillRect(0, h - capH, w, capH);
    return new THREE.CanvasTexture(c);
  }

  function makeCloudTexture() {
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 46; i++) {
      const cx = Math.random() * w, cy = h * 0.12 + Math.random() * h * 0.76;
      const r = 14 + Math.random() * 30;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  function radialTexture(hex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, hex); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function emit(stream) {
    const i = stream.cursor;
    stream.cursor = (stream.cursor + 1) % stream.count;
    stream.progress[i] = 0;
  }

  function stepStream(stream, dt) {
    const { positions, progress, lane, travel, count } = stream;
    const dy = earth.position.y - sun.position.y;
    const dx = EARTH_X - SUN_X;
    for (let i = 0; i < count; i++) {
      if (progress[i] < 0) { positions[i * 3] = SUN_X - 100; continue; } // parked off-scene
      progress[i] += dt / travel;
      if (progress[i] >= 1) { progress[i] = -1; positions[i * 3] = SUN_X - 100; continue; }
      const k = progress[i];
      const arc = Math.sin(k * Math.PI) * 0.9; // gentle arc toward the viewer
      positions[i * 3] = SUN_X + dx * k;
      positions[i * 3 + 1] = SCENE_Y + dy * k + lane[i * 2] * (1 - Math.abs(k - 0.5) * 1.4);
      positions[i * 3 + 2] = arc + lane[i * 2 + 1] * 0.4;
    }
    stream.points.geometry.attributes.position.needsUpdate = true;
  }

  const restoreView = stage.setView(scene, camera);

  /* -------------------------------------------------------------- data */
  // Rows with no prediction (e.g. Explorer's context buffer, before the
  // requested start time) are real -- just not scored -- so electron/proton
  // emission still reacts to them; only the predicted-line/threshold-crossing
  // logic skips rows where `pred` is null/undefined.
  const range = computeRange(data.rows);
  buildChart(data, range);
  thresholdLine.setAttribute('y1', String(yFor(data.ln10_threshold, range.pMin, range.pMax)));
  thresholdLine.setAttribute('y2', String(yFor(data.ln10_threshold, range.pMin, range.pMax)));

  let playing = true;
  let elapsed = 0;      // seconds into the compressed playback
  let scrubbing = false;
  let shieldTarget = 0;
  let shieldColor = new THREE.Color(0xffcf6b);

  function computeRange(rows) {
    let eMin = Infinity, eMax = -Infinity, pMin = Infinity, pMax = -Infinity;
    for (const r of rows) {
      if (r.e < eMin) eMin = r.e; if (r.e > eMax) eMax = r.e;
      if (r.p < pMin) pMin = r.p; if (r.p > pMax) pMax = r.p;
      if (r.pred != null) { if (r.pred < pMin) pMin = r.pred; if (r.pred > pMax) pMax = r.pred; }
    }
    return { eMin, eMax, pMin, pMax };
  }

  function yFor(v, lo, hi) { return 104 - clamp(remap(v, lo, hi, 0, 100), 0, 100); }

  function buildChart(json, range) {
    const n = json.rows.length;
    const step = 340 / Math.max(1, n - 1);
    const ePts = [], aPts = [], pPts = [];
    for (let i = 0; i < n; i++) {
      const row = json.rows[i];
      const x = (i * step).toFixed(1);
      ePts.push(`${x},${yFor(row.e, range.eMin, range.eMax)}`);
      aPts.push(`${x},${yFor(row.p, range.pMin, range.pMax)}`);
      if (row.pred != null) pPts.push(`${x},${yFor(row.pred, range.pMin, range.pMax)}`);
    }
    lineElectron.setAttribute('points', ePts.join(' '));
    lineActual.setAttribute('points', aPts.join(' '));
    linePred.setAttribute('points', pPts.join(' '));
  }

  function sampleAt(frac) {
    // frac in [0,1) across the whole event -> linearly interpolated row.
    const n = data.rows.length;
    const pos = clamp(frac, 0, 0.999999) * (n - 1);
    const i0 = Math.floor(pos), i1 = Math.min(n - 1, i0 + 1), k = pos - i0;
    const a = data.rows[i0], b = data.rows[i1];
    const lerp = (u, v) => u + (v - u) * k;
    const pred = (a.pred != null && b.pred != null) ? lerp(a.pred, b.pred) : (a.pred ?? b.pred ?? null);
    return { t: a.t, e: lerp(a.e, b.e), eh: lerp(a.eh ?? 0, b.eh ?? 0), p: lerp(a.p, b.p), pred };
  }

  function setScrubUI(frac) {
    scrub.value = String(Math.round(frac * 1000));
    playhead.setAttribute('x1', String(frac * 340));
    playhead.setAttribute('x2', String(frac * 340));
  }

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸' : '▶';
  });
  element.querySelector('.fsec__back')?.addEventListener('click', () => onBack?.());
  scrub.addEventListener('pointerdown', () => { scrubbing = true; playing = false; playBtn.textContent = '▶'; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  scrub.addEventListener('input', () => {
    elapsed = (Number(scrub.value) / 1000) * PLAY_SECONDS;
  });

  /* -------------------------------------------------------------- frame */
  const stopFrame = stage.onFrame((dt) => {
    sun.rotation.y += dt * 0.05;
    earth.rotation.y += dt * 0.3;
    earthClouds.rotation.y += dt * 0.34; // drifts slightly faster than the surface
    sunGlow.material.opacity = 0.45 + Math.sin(stage.elapsed * 0.6) * 0.08;
    sunCorona.material.opacity = 0.42 + Math.sin(stage.elapsed * 0.9 + 1.3) * 0.1;

    if (playing && !scrubbing) {
      elapsed = (elapsed + dt) % PLAY_SECONDS;
    }
    const frac = elapsed / PLAY_SECONDS;
    const row = sampleAt(frac);
    setScrubUI(frac);

    const eRate = remap(row.e, range.eMin, range.eMax, 0.4, 26);
    const pRate = remap(row.p, range.pMin, range.pMax, 0.05, 14);
    if (Math.random() < eRate * dt) emit(streams.electron);
    if (Math.random() < pRate * dt) emit(streams.proton);

    const predCrossed = row.pred != null && row.pred >= data.ln10_threshold;
    const actualCrossed = row.p >= data.ln10_threshold;
    badgePred.classList.toggle('is-live', predCrossed);
    badgeActual.classList.toggle('is-live', actualCrossed);
    shieldTarget = actualCrossed ? 0.85 : (predCrossed ? 0.4 : 0);
    shieldColor = actualCrossed ? new THREE.Color(0xff5d5d) : new THREE.Color(0xffcf6b);

    // row.t is already "YYYY-MM-DDTHH:MM:SS.sss" in UTC (matching the training
    // data's own convention) -- sliced directly, never round-tripped through
    // `new Date()`, which would parse a timezone-less string as the browser's
    // LOCAL time and silently shift the displayed clock by the viewer's offset.
    clockEl.textContent = `${row.t.slice(5, 16).replace('T', ' ')} UTC`;
    readoutEl.textContent =
      `electron ${row.e.toFixed(2)}  ·  proton actual ${row.p.toFixed(2)}  ·  ` +
      `predicted ${row.pred != null ? row.pred.toFixed(2) : 'n/a'}  (ln flux)`;

    shield.material.opacity = damp(shield.material.opacity, shieldTarget, 4, dt);
    shield.material.color.lerp(shieldColor, Math.min(1, dt * 4));
    shield.lookAt(camera.position);
    shield.scale.setScalar(1 + Math.sin(stage.elapsed * 3) * 0.03 * (shieldTarget > 0 ? 1 : 0));

    stepStream(streams.electron, dt);
    stepStream(streams.proton, dt);
  });

  return {
    element,
    destroy() {
      stopFrame();
      restoreView();
      for (const s of Object.values(streams)) {
        s.points.geometry.dispose();
        s.points.material.dispose();
      }
      sun.geometry.dispose(); sun.material.map.dispose(); sun.material.dispose();
      earth.geometry.dispose(); earth.material.map.dispose(); earth.material.dispose();
      earthClouds.geometry.dispose(); earthClouds.material.map.dispose(); earthClouds.material.dispose();
      shield.geometry.dispose(); shield.material.dispose();
      sunGlow.material.map.dispose(); sunGlow.material.dispose();
      sunCorona.material.map.dispose(); sunCorona.material.dispose();
      earthGlow.material.map.dispose(); earthGlow.material.dispose();
      path.geometry.dispose(); path.material.dispose();
    },
  };
}
