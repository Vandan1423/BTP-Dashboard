"""
Diagnostic-only. Follows on from TestExposure.py: switching view_transform only
got a ~30% wider IQR (23->30), still visually flat. Testing a different
hypothesis here: VOLUME_DENSITY=15.0 may make the CME optically thick enough
that rays saturate (fully absorbed) almost everywhere tr1 is non-trivial, which
would flatten structure at the radiative-transfer level, before tone-mapping
ever sees it. Sweeps density with Standard view_transform (the better of the
two tested) and emission held constant, same frame/camera as TestExposure.py.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        output/scenes/SolarWindCME_space.blend --python scripts/experiments/TestDensity.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUT_DIR = os.path.join(BASE_DIR, "output", "experiments", "_densitytest")
os.makedirs(OUT_DIR, exist_ok=True)

sys.path.insert(0, SCRIPT_DIR)
from _volmat import build_volume_material

VOLUME_GRID = "tr1"
VOLUME_FROM_MIN = 0.0
VOLUME_FROM_MAX = 1.0
VOLUME_EMISSION = 4.2  # held constant; isolating density's effect alone

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
scene.render.resolution_x = 1024
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0.0

volume_obj = next((o for o in bpy.data.objects if o.type == 'VOLUME'), None)
volume_obj.data.frame_offset = -1
volume_obj.data.grids.load()

DENSITIES = [15.0, 8.0, 4.0, 2.0]

for density in DENSITIES:
    build_volume_material(volume_obj, VOLUME_GRID, VOLUME_FROM_MIN, VOLUME_FROM_MAX,
                           density, VOLUME_EMISSION, VOLUME_RAMP)
    name = f"density_{density}"
    out_path = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.filepath = out_path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"{name}: -> {time.time()-t0:.1f}s -> {out_path}", flush=True)

print("Done:", OUT_DIR)
