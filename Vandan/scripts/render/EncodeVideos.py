import os
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RENDERS_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "renders", "cme_360")

CAMERA_NAMES = ["Mercury", "Venus", "Earth", "Mars"]
FRAMERATE = 20  # 201 frames at 20fps = ~10s per camera; matches the earlier Mercury_full.mp4 precedent

for cam_name in CAMERA_NAMES:
    cam_dir = os.path.join(RENDERS_DIR, cam_name)
    frame_pattern = os.path.join(cam_dir, "frame_%04d.png")
    out_path = os.path.join(RENDERS_DIR, f"{cam_name}.mp4")

    first_frame = os.path.join(cam_dir, "frame_0001.png")
    if not os.path.isfile(first_frame):
        print(f"WARNING: no frames for {cam_name} yet, skipping")
        continue

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FRAMERATE),
        "-i", frame_pattern,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    print(f"Encoding {cam_name}...")
    subprocess.run(cmd, check=True)
    print(f"Wrote {out_path}")

print("Done.")
