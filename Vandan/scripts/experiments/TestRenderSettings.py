"""Measure render settings against the known-worst CME frame.

Baseline to beat: Mercury frame 170 took 4183 s (69m43s) at samples=4096,
volume_bounces=4, volume_step_rate=1.0.

Volumetric noise is the one thing Adaptive Sampling cannot converge - it burns the
whole sample budget on every scattering voxel - so the levers that matter are the
sample ceiling and how hard Cycles works inside the volume, not the resolution.

    blender --background output/scenes/SolarWindCME_space.blend \
            --python scripts/experiments/TestRenderSettings.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "experiments", "_settingstest")
CAM = "Mercury"
FRAME = 170
BASELINE_SEC = 4183.0

# (label, samples, volume_bounces, volume_step_rate, adaptive_threshold)
CONFIGS = [
    ("A_s512_b2_r2",  512, 2, 2.0, 0.01),
    ("B_s256_b1_r3",  256, 1, 3.0, 0.02),
    ("C_s512_b1_r2",  512, 1, 2.0, 0.01),
]

scene = bpy.context.scene
COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)
print("DEVICES ENABLED ->", [(d.name, d.type) for d in prefs.devices if d.use], flush=True)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = 100

# Denoising is already on in the .blend, but it was running on the CPU - move it
# to the GPU so it stops adding wall-clock to every frame.
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
try:
    scene.cycles.denoising_use_gpu = True
except Exception as e:
    print("  NOTE: denoising_use_gpu unavailable:", e)

cam_obj = bpy.data.objects[CAM]
scene.camera = cam_obj
for body in ("Mercury", "Venus", "Earth", "Mars"):
    p = bpy.data.objects.get(f"Planet_{body}")
    if p is not None:
        p.hide_render = (body == CAM)

os.makedirs(OUT_DIR, exist_ok=True)
scene.frame_set(FRAME)
print(f"Baseline for {CAM} frame {FRAME}: {BASELINE_SEC/60:.1f} min "
      f"(samples=4096, bounces=4, step=1.0)\n", flush=True)

for label, samples, bounces, step, thresh in CONFIGS:
    scene.cycles.samples = samples
    scene.cycles.volume_bounces = bounces
    scene.cycles.volume_step_rate = step
    scene.cycles.adaptive_threshold = thresh
    scene.render.filepath = os.path.join(OUT_DIR, f"{label}.png")

    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    print(f"{label:16s} samples={samples:<5} bounces={bounces} step={step}  "
          f"-> {dt/60:6.2f} min   speedup {BASELINE_SEC/dt:5.1f}x", flush=True)

print(f"\nCompare the PNGs in {OUT_DIR} for quality before choosing.", flush=True)
