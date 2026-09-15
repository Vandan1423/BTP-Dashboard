import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# output/renders/cme_360, not Renders: the old flat 1920x1080 PNGs use the SAME frame_NNNN.png
# names, and the skip-if-exists resume check would silently keep them, mixing flat
# frames into the 360 sequence.
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "renders", "cme_360")

CAMERA_NAMES = ["Mercury", "Venus", "Earth", "Mars"]
# FRAME_END = None takes the range from the .blend itself, which BuildScene.py
# already set from the number of VDB files. Set an integer to render a subrange.
FRAME_START = 1
FRAME_END = None

# MEASURED, not guessed. On Mercury frame 170 (near-peak CME) on the A30:
#   4096 spp / bounces=4 / step=1.0 -> 69.7 min   (the original settings)
#    512 spp / bounces=2 / step=2.0 -> 12.0 min   5.8x
#    256 spp / bounces=1 / step=3.0 ->  4.4 min  15.9x   <- chosen
# Crucially, 256 spp vs 512 spp at the same bounces came out at PSNR 52 dB - i.e.
# visually identical. Samples were never the thing limiting quality; with
# OpenImageDenoise on, everything above ~256 was wasted compute. What DOES change
# the image is volume_bounces (see VOLUME_EMISSION note in BuildSpaceScene.py).
# SET BACK TO 4096 BY EXPLICIT USER DECISION 2026-08-26, aware this reverts most
# of the measured 15.9x speedup and likely means this run does NOT finish
# overnight - bounces=1/step=3.0 below are kept, samples alone is the ask.
SAMPLES = 4096
VOLUME_BOUNCES = 1      # single-scattering approximation
VOLUME_STEP_RATE = 3.0  # coarser marching through the voxel grid
ADAPTIVE_THRESHOLD = 0.02
DEVICE = 'GPU'

scene = bpy.context.scene
if FRAME_END is None:
    FRAME_END = scene.frame_end
print(f"Rendering frames {FRAME_START}..{FRAME_END} for {len(CAMERA_NAMES)} cameras")
# METAL on the Mac, CUDA on the A30 - assigning the wrong one raises TypeError,
# and a non-matching device loop silently disables everything and falls back to CPU.
COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)
print('DEVICES ENABLED ->', [(d.name, d.type) for d in prefs.devices if d.use])
scene.render.engine = 'CYCLES'
scene.cycles.device = DEVICE
scene.cycles.samples = SAMPLES
print(f"CONFIRMED SETTINGS -> engine={scene.render.engine}, device={scene.cycles.device}, samples={scene.cycles.samples}")
scene.cycles.volume_bounces = VOLUME_BOUNCES
scene.cycles.volume_step_rate = VOLUME_STEP_RATE
scene.cycles.adaptive_threshold = ADAPTIVE_THRESHOLD
# Standard, not AgX (Blender's default). Measured 2026-08-26 (TestFinal.py):
# at matched density, Standard's IQR beat AgX's every time (53 vs 50 at d=15,
# 75 vs 59 at d=8) with no added clipping - AgX's photographic rolloff was
# working against reading the CME's actual structure.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0.0
# Denoising was already enabled but running on the CPU, adding wall-clock to every
# frame while the GPU sat idle waiting for it.
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
try:
    scene.cycles.denoising_use_gpu = True
except Exception as _e:
    print("  NOTE: denoising_use_gpu unavailable:", _e)
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = 100
scene.frame_start = FRAME_START
scene.frame_end = FRAME_END

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
    for body in CAMERA_NAMES:
        planet = bpy.data.objects.get(f"Planet_{body}")
        if planet is not None:
            planet.hide_render = (body == cam_name)

    cam_dir = os.path.join(OUTPUT_DIR, cam_name)
    os.makedirs(cam_dir, exist_ok=True)

    for frame in range(FRAME_START, FRAME_END + 1):
        out_path = os.path.join(cam_dir, f"frame_{frame:04d}.png")
        done += 1

        # Resumable: a crash/interrupt partway through doesn't lose finished frames,
        # and rerunning the script skips straight to what's still missing.
        if os.path.exists(out_path):
            print(f"[{done}/{total_frames}] {cam_name} frame {frame}: already exists, skipping", flush=True)
            continue

        scene.frame_set(frame)
        scene.render.filepath = out_path

        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        elapsed = time.time() - t0

        remaining = total_frames - done
        eta_min = remaining * elapsed / 60
        print(f"[{done}/{total_frames}] {cam_name} frame {frame}: {elapsed:.1f}s  |  ETA for remaining {remaining}: {eta_min:.1f} min", flush=True)

print(f"Done. Total time: {(time.time() - batch_start)/60:.1f} min. Output: {OUTPUT_DIR}")
