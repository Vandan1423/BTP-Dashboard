"""Full-quality confirmation render, 2 frames, before committing to the real
804-frame job. Same settings as RenderCameras.py (256 spp, bounces=1, step=3.0)
so what we look at here is exactly what the real render will produce - a cheap
sweep at reduced resolution/samples answered the exposure and field questions,
but a material graph error, wrong grid name, or a linking mistake could still
only show up at real settings.

Frame 170 = fully engulfed under the OLD material (flat grey wall, IQR 8) - the
test of whether the new rho*r^2 branch fixes it.
Frame 185 = already good under the OLD material (IQR 143) - the test of whether
switching materials broke something that used to work.

    ~/blender-5.2.0-linux-x64/blender --background \
        ~/BTP_SolarWindCME/BlenderOutputs/SolarWindCME_space.blend \
        --python ~/BTP_SolarWindCME/scripts/analysis/ConfirmMaterial.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "experiments", "_confirm")
CAM = "Mercury"
FRAMES = [170, 185]

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
scene.cycles.samples = 256
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
try:
    scene.cycles.denoising_use_gpu = True
except Exception as e:
    print("  NOTE: denoising_use_gpu unavailable:", e)
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = 100

cam_obj = bpy.data.objects[CAM]
scene.camera = cam_obj
for body in ("Mercury", "Venus", "Earth", "Mars"):
    p = bpy.data.objects.get(f"Planet_{body}")
    if p is not None:
        p.hide_render = (body == CAM)

os.makedirs(OUT_DIR, exist_ok=True)
for frame in FRAMES:
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(OUT_DIR, f"frame_{frame:04d}.png")
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"frame {frame}: {time.time() - t0:.1f}s -> {scene.render.filepath}", flush=True)

print("Done.", flush=True)
