"""
Render one timestep from the chosen viewpoints, inside Blender.

    blender --background SolarWindCME_space.blend --python render_viewpoints.py -- \
        --volume volume.vdb --positions positions.json --bodies Earth,Mars \
        --samples 256 --width 4096 --height 2048 --outdir results/<job> \
        --scene-script <Vandan>/scripts/scene/BuildSpaceScene.py

The .blend is opened as a TEMPLATE and corrected, never rebuilt. Four things
in it are wrong for a one-frame job, and each is put right here explicitly:

  1. The volume is a 201-file SEQUENCE with frame_offset = -1. A single upload
     is one static file, so the sequence is switched off and the offset goes
     back to 0. Inheriting -1 would be harmless on a static volume, but only by
     accident, so it is not inherited.
  2. The cameras and planets are KEYFRAMED across the whole run. Their animation
     is cleared and they are placed at this timestep's positions instead. The
     Track To constraints aimed at the domain centre are kept.
  3. The volume MATERIAL is rebuilt from the constants in BuildSpaceScene.py,
     read out of that file rather than copied here. The template on disk may
     predate the tuning -- the Mac's copy does: density 15.0 and emission 4.0
     where the approved renders used 8.0 and 4.2 -- and one source of truth is
     the only way the two cannot drift apart.
  4. The view transform is set to Standard, as RenderCameras.py does.

Lines starting with @@ are for the service. Cycles' own status lines, which
carry the sample count, pass straight through and are parsed there.
"""
import argparse
import ast
import json
import os
import sys
import time

import bpy

BODIES = ["Mercury", "Venus", "Earth", "Mars"]
MATERIAL_CONSTANTS = [
    "VOLUME_GRID", "VOLUME_FROM_MIN", "VOLUME_FROM_MAX",
    "VOLUME_DENSITY", "VOLUME_EMISSION", "VOLUME_RAMP",
]


def emit(tag, **kw):
    body = " ".join(f"{k}={v}" for k, v in kw.items())
    print(f"@@{tag} {body}".rstrip(), flush=True)


def fail(message):
    emit("error", message=message)
    sys.stdout.flush()
    # os._exit, not sys.exit: Blender catches SystemExit from a --python script
    # and carries on to a clean exit code of 0, which would read as success.
    os._exit(3)


def read_constants(path):
    """Pull the volume constants out of BuildSpaceScene.py without running it."""
    with open(path) as f:
        tree = ast.parse(f.read(), filename=path)
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in MATERIAL_CONSTANTS:
                found[target.id] = ast.literal_eval(node.value)
    missing = [k for k in MATERIAL_CONSTANTS if k not in found]
    if missing:
        fail(f"{os.path.basename(path)} no longer defines {', '.join(missing)}")
    return found


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--volume", required=True)
    ap.add_argument("--positions", required=True)
    ap.add_argument("--bodies", required=True)
    ap.add_argument("--samples", type=int, required=True)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--scene-script", required=True)
    return ap.parse_args(argv)


def main():
    args = parse_args()
    bodies = [b for b in args.bodies.split(",") if b]
    scene = bpy.context.scene
    emit("scene", state="start")
    t_scene = time.time()

    # ---- 1. the volume ------------------------------------------------------
    volume = next((o for o in bpy.data.objects if o.type == "VOLUME"), None)
    if volume is None:
        fail("the template has no volume object")
    volume.data.filepath = os.path.abspath(args.volume)
    volume.data.is_sequence = False
    volume.data.frame_offset = 0
    volume.data.grids.load()
    grid_names = [g.name for g in volume.data.grids]
    print(f"[blender] volume -> {os.path.basename(args.volume)}, static, grids {grid_names}", flush=True)

    # ---- 3. the material, from BuildSpaceScene.py -----------------------------
    consts = read_constants(args.scene_script)
    if consts["VOLUME_GRID"] not in grid_names:
        fail(f"the volume has no '{consts['VOLUME_GRID']}' grid (found {grid_names})")
    sys.path.insert(0, os.path.dirname(os.path.abspath(args.scene_script)))
    from _volmat import build_volume_material
    build_volume_material(
        volume, consts["VOLUME_GRID"], consts["VOLUME_FROM_MIN"], consts["VOLUME_FROM_MAX"],
        consts["VOLUME_DENSITY"], consts["VOLUME_EMISSION"], consts["VOLUME_RAMP"],
    )
    print(f"[blender] material from BuildSpaceScene.py: grid {consts['VOLUME_GRID']}, "
          f"density {consts['VOLUME_DENSITY']}, emission {consts['VOLUME_EMISSION']}", flush=True)

    # ---- 2. cameras and planets ---------------------------------------------
    with open(args.positions) as f:
        positions = json.load(f)
    for body in BODIES:
        p = positions.get(body)
        for name in (body, f"Planet_{body}"):
            obj = bpy.data.objects.get(name)
            if obj is None:
                continue
            obj.animation_data_clear()
            if p is not None:
                obj.location = (p["x"], p["y"], p["z"])
        if p is not None:
            print(f"[blender] {body}: camera and planet at ({p['x']:.3f}, {p['y']:.3f}, {p['z']:.3f}) AU", flush=True)

    # ---- 4. render settings, as RenderCameras.py ---------------------------------
    compute = "METAL" if sys.platform == "darwin" else "CUDA"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = compute
    prefs.get_devices()
    for d in prefs.devices:
        d.use = (d.type == compute)
    enabled = [d.name for d in prefs.devices if d.use]
    if not enabled:
        fail(f"no {compute} device available to Cycles")
    print(f"[blender] devices: {', '.join(enabled)}", flush=True)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = args.samples
    scene.cycles.volume_bounces = 1
    scene.cycles.volume_step_rate = 3.0
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    try:
        scene.cycles.denoising_use_gpu = True
    except Exception:
        pass
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.frame_start = scene.frame_end = 1
    scene.frame_set(1)

    for body in BODIES:
        cam = bpy.data.objects.get(body)
        if cam is not None and cam.type == "CAMERA":
            cam.data.type = "PANO"
            cam.data.panorama_type = "EQUIRECTANGULAR"

    print(f"[blender] EQUIRECTANGULAR {args.width}x{args.height}, {args.samples} spp, "
          f"bounces 1, step 3.0, Standard", flush=True)
    emit("scene", state="done", seconds=f"{time.time() - t_scene:.1f}")

    # ---- progress -------------------------------------------------------------
    # Cycles prints nothing per sample in background mode. The render_stats
    # handler still fires, with the same status line the UI shows -- "Remaining:
    # 00:24.73 | Mem: 3805M | Sample 32/128" -- so it is forwarded, throttled to
    # a few lines a second. That is where the service's progress ring and the
    # remaining time for a viewpoint come from.
    last = [0.0]

    def on_stats(stats):
        now = time.time()
        if now - last[0] >= 0.5 and "Sample" in stats:
            last[0] = now
            print(f"@@stats {stats}", flush=True)

    bpy.app.handlers.render_stats.append(on_stats)

    # ---- render --------------------------------------------------------------
    os.makedirs(args.outdir, exist_ok=True)
    for body in bodies:
        cam = bpy.data.objects.get(body)
        if cam is None or cam.type != "CAMERA":
            fail(f"the template has no camera named {body}")
        scene.camera = cam
        # Each camera sits inside its own planet's sphere; hide that one.
        for other in BODIES:
            planet = bpy.data.objects.get(f"Planet_{other}")
            if planet is not None:
                planet.hide_render = (other == body)

        out = os.path.join(os.path.abspath(args.outdir), f"{body}.png")
        scene.render.filepath = out
        emit("render", state="start", body=body)
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        if not os.path.exists(out):
            fail(f"Cycles finished {body} but wrote no file")
        emit("render", state="done", body=body, seconds=f"{time.time() - t0:.1f}")

    emit("complete")
    sys.stdout.flush()


try:
    main()
except SystemExit:
    raise
except Exception as e:  # anything unexpected still reaches the service as an error
    fail(f"{type(e).__name__}: {e}")
