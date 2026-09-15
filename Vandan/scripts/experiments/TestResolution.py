"""
Diagnostic-only. Real wall-clock scaling of render time vs resolution, on the
same CME-active worst-case frame, at the newly-chosen density=8/Standard
settings. Absolute times are Mac M3 numbers (not the A30), but the RATIO
between resolutions is what matters for extrapolating the overnight GPU-box
job honestly instead of assuming "4x pixels = 4x time".

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        output/scenes/SolarWindCME_space.blend --python scripts/experiments/TestResolution.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUT_DIR = os.path.join(BASE_DIR, "output", "experiments", "_restest")
os.makedirs(OUT_DIR, exist_ok=True)

sys.path.insert(0, SCRIPT_DIR)
from _volmat import build_volume_material

VOLUME_RAMP = [
    (0.000, (0.0001, 0.0000, 0.0011, 1.0)),
    (0.167, (0.0323, 0.0030, 0.1112, 1.0)),
    (0.333, (0.1893, 0.0117, 0.1536, 1.0)),
    (0.500, (0.5005, 0.0383, 0.0891, 1.0)),
    (0.667, (0.8474, 0.1411, 0.0186, 1.0)),
    (0.833, (0.9688, 0.4669, 0.0106, 1.0)),
    (1.000, (0.9737, 0.9963, 0.3735, 1.0)),
]

scene = bpy.context.scene
scene.camera = bpy.data.objects.get("Earth")
scene.frame_set(171)

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

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 256
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0.0

volume_obj = next((o for o in bpy.data.objects if o.type == 'VOLUME'), None)
volume_obj.data.frame_offset = -1
volume_obj.data.grids.load()
build_volume_material(volume_obj, "tr1", 0.0, 1.0, 8.0, 4.2, VOLUME_RAMP)

RESOLUTIONS = [(4096, 2048), (6144, 3072), (8192, 4096)]

for w, h in RESOLUTIONS:
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    name = f"{w}x{h}"
    out_path = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.filepath = out_path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    elapsed = time.time() - t0
    print(f"{name}: {elapsed:.1f}s  ({w*h} px)", flush=True)

print("Done:", OUT_DIR)
