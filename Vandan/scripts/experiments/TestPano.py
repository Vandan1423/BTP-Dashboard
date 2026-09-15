import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "experiments", "_panotest")

CAMERA_NAMES = ["Earth"]
FRAME_START = 18
FRAME_END = 18

# 360 output must be 2:1 - that ratio is what makes the equirectangular unwrap
# correct. 4096x2048 is about the minimum that looks sharp in a headset (you only
# ever see ~a quarter of it at once); 2048x1024 is a fast shape-check preview.
RESOLUTION_X = 4096
RESOLUTION_Y = 2048

# The one knob that actually trades quality for time. With Adaptive Sampling on
# (Cycles default) this is a ceiling, not a fixed count - quiet frames converge
# early and barely touch it, noisy CME frames genuinely spend the whole budget.
SAMPLES = 4096
DEVICE = 'GPU'

# Cycles names its GPU backend differently per platform, and the enum genuinely
# rejects the wrong value - assigning 'CUDA' on macOS raises TypeError, because
# there the enum is only ('NONE', 'METAL'). Worse, if it didn't raise, the device
# loop below would match nothing, disable every device, and Cycles would silently
# fall back to CPU. Pick by platform so one file runs on the Mac and the A30 box.
COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'

scene = bpy.context.scene
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)

# Preferences never persist out of a --background run, so this has to be re-set
# every launch - and printed, so the log proves which device actually ran.
enabled = [(d.name, d.type) for d in prefs.devices if d.use]
print("DEVICES ENABLED ->", enabled)
if not enabled:
    print(f"WARNING: no {COMPUTE_TYPE} device enabled - Cycles will fall back to CPU")

scene.render.engine = 'CYCLES'
scene.cycles.device = DEVICE
scene.cycles.samples = SAMPLES
scene.cycles.volume_bounces = 4
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_x = RESOLUTION_X
scene.render.resolution_y = RESOLUTION_Y
scene.render.resolution_percentage = 100
scene.frame_start = FRAME_START
scene.frame_end = FRAME_END

print(
    f"CONFIRMED SETTINGS -> engine={scene.render.engine}, device={scene.cycles.device}, "
    f"samples={scene.cycles.samples}, res={scene.render.resolution_x}x{scene.render.resolution_y}"
)

# Equirectangular = capture the whole 360x180 sphere around the camera and unwrap
# it into one 2:1 image, which is exactly what a VR headset expects. Applied per
# camera in CAMERA_NAMES rather than hardcoded, so rendering a different subset of
# planets doesn't leave some cameras still flat.
for cam_name in CAMERA_NAMES:
    cam_obj = bpy.data.objects.get(cam_name)
    if cam_obj is None or cam_obj.type != 'CAMERA':
        continue
    cam_obj.data.type = 'PANO'
    cam_obj.data.panorama_type = 'EQUIRECTANGULAR'
    print(f"  {cam_name}: type={cam_obj.data.type}, panorama={cam_obj.data.panorama_type}")

os.makedirs(OUTPUT_DIR, exist_ok=True)

total_frames = len(CAMERA_NAMES) * (FRAME_END - FRAME_START + 1)
done = 0
batch_start = time.time()

for cam_name in CAMERA_NAMES:
    cam_obj = bpy.data.objects.get(cam_name)
    if cam_obj is None or cam_obj.type != 'CAMERA':
        print(f"WARNING: camera '{cam_name}' not found in this scene - skipping")
        continue
    scene.camera = cam_obj

    # Each camera sits at its planet's exact position, so that planet's sphere
    # would enclose the camera and fill the frame with its own interior. Hide
    # the body you are standing on; show all the others.
    for body in ("Mercury", "Venus", "Earth", "Mars"):
        planet = bpy.data.objects.get(f"Planet_{body}")
        if planet is not None:
            planet.hide_render = (body == cam_name)

    cam_dir = os.path.join(OUTPUT_DIR, cam_name)
    os.makedirs(cam_dir, exist_ok=True)

    for frame in range(FRAME_START, FRAME_END + 1):
        out_path = os.path.join(cam_dir, f"frame_{frame:04d}.png")
        done += 1

        # Resumable: a crash/interrupt partway through doesn't lose finished frames,
        # and rerunning the script skips straight to what's still missing. On a
        # shared GPU this doubles as the strategy for surviving OOM interruptions.
        if os.path.exists(out_path):
            print(f"[{done}/{total_frames}] {cam_name} frame {frame}: already exists, skipping")
            continue

        scene.frame_set(frame)
        scene.render.filepath = out_path

        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        elapsed = time.time() - t0

        remaining = total_frames - done
        eta_min = remaining * elapsed / 60
        print(f"[{done}/{total_frames}] {cam_name} frame {frame}: {elapsed:.1f}s  |  ETA for remaining {remaining}: {eta_min:.1f} min")

print(f"Done. Total time: {(time.time() - batch_start)/60:.1f} min. Output: {OUTPUT_DIR}")
