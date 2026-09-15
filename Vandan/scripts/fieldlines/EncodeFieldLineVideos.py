"""
Encodes the field-line PNG sequences into one .mp4 per planet.

    python3 EncodeFieldLineVideos.py

stdlib + ffmpeg only, no venv/conda needed. Same settings as the verified tr1
encoder (../../scripts/fieldlines/EncodeVideos.py) so the two video sets are directly
comparable; reads from and writes into output/renders/fieldlines_360/, which is a
separate tree from the tr1 output/renders/cme_360/ - nothing existing is overwritten.

The -vf pad below is the one real difference from the tr1 encoder, and it is a
fix, not a preference: 4096x2048 is already even, but if the render resolution is
ever changed to something odd, libx264 with yuv420p fails outright rather than
rounding. Padding to even dimensions makes the encode robust to that.
"""

import os
import glob
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
RENDERS_DIR = os.path.join(BASE_DIR, "output", "renders", "fieldlines_360")

CAMERA_NAMES = ["Mercury", "Venus", "Earth", "Mars"]
FRAMERATE = 20   # 201 frames at 20fps = ~10s, matching the tr1 videos
CRF = 18         # visually lossless-ish; the default 23 smears the thin lines

for cam_name in CAMERA_NAMES:
    cam_dir = os.path.join(RENDERS_DIR, cam_name)
    out_path = os.path.join(RENDERS_DIR, f"{cam_name}_fieldlines.mp4")

    frames = sorted(glob.glob(os.path.join(cam_dir, "frame_*.png")))
    if not frames:
        print(f"WARNING: no frames for {cam_name} yet, skipping")
        continue

    # Start the pattern at whatever the first rendered frame actually is, instead
    # of assuming frame_0001. A partial/resumed render that begins at, say, 0051
    # would otherwise silently encode nothing.
    start = int(os.path.basename(frames[0]).split("_")[1].split(".")[0])
    print(f"Encoding {cam_name}: {len(frames)} frames from {start:04d}")

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FRAMERATE),
        "-start_number", str(start),
        "-i", os.path.join(cam_dir, "frame_%04d.png"),
        "-c:v", "libx264",
        "-crf", str(CRF),
        "-pix_fmt", "yuv420p",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        out_path,
    ]
    subprocess.run(cmd, check=True)
    print(f"Wrote {out_path}")

print("Done.")
