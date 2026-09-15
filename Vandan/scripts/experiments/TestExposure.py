"""
Diagnostic-only, run locally on the Mac against the real SolarWindCME_space.blend.
Renders the same CME-active frame (Earth camera, vtk idx 170 -> frame 171 in the
new step-1 cadence) under a few view_transform/exposure combinations, to check
whether the "flat-wall" AgX compression found earlier (2026-08-26) is actually
fixable with an exposure/look tweak, before touching the production render
settings. Small resolution (1024x512) on purpose - this is about the tone-curve
shape, not final quality, so it should run in well under a minute per config on
the M3.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        output/scenes/SolarWindCME_space.blend --python scripts/experiments/TestExposure.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUT_DIR = os.path.join(BASE_DIR, "output", "experiments", "_exposuretest")
os.makedirs(OUT_DIR, exist_ok=True)

scene = bpy.context.scene
scene.camera = bpy.data.objects.get("Earth")
scene.frame_set(171)  # vtk idx 170 (0-indexed, step-1 cadence): near-peak tr1 at Earth

for body in ["Mercury", "Venus", "Earth", "Mars"]:
    p = bpy.data.objects.get(f"Planet_{body}")
    if p is not None:
        p.hide_render = (body == "Earth")

COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)
print('DEVICES ENABLED ->', [(d.name, d.type) for d in prefs.devices if d.use])

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 256
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.render.resolution_x = 1024
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'

CONFIGS = [
    ("agx_exp0",     'AgX',      0.0, None),
    ("agx_expneg2",  'AgX',     -2.0, None),
    ("agx_expneg3",  'AgX',     -3.0, None),
    ("standard_exp0",'Standard', 0.0, None),
]

for name, vt, exposure, look in CONFIGS:
    scene.view_settings.view_transform = vt
    scene.view_settings.exposure = exposure
    if look:
        scene.view_settings.look = look
    out_path = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.filepath = out_path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"{name}: view_transform={vt} exposure={exposure} -> {time.time()-t0:.1f}s -> {out_path}", flush=True)

print("Done:", OUT_DIR)
