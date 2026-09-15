"""
Can this machine actually run a job?

Every piece of the pipeline lives in a different place -- Blender, an
environment with openvdb, an environment with solarmach, a template scene, a
pinned grid -- and any one of them missing turns into a job that fails four
minutes in. So they are all checked once at startup, and the answer is what
/api/health reports and what `python3 serve.py --check` prints.

The GPU is checked too where it can be. The A30 is shared and has already been
filled by someone else once, so free memory is worth showing before a job is
queued behind a card that has none.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time


def _run(cmd, timeout=60):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                             cwd=tempfile.gettempdir(), stdin=subprocess.DEVNULL)
        return out.returncode, (out.stdout or "") + (out.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, f"{type(e).__name__}: {e}"


def probe(cfg: dict) -> dict:
    checks = {}

    def check(name, ok, detail):
        checks[name] = {"ok": bool(ok), "detail": detail}

    # The three interpreters are started together: each can take several seconds
    # to import on a cold machine, and there is no reason to wait for them in turn.
    probes = {
        "blender": [cfg["blender"], "--version"],
        "convert_env": [cfg["convert_python"], "-c",
                        "import openvdb, pyvista, numpy; print(pyvista.__version__)"],
        "ephemeris_env": [cfg["ephemeris_python"], "-c", "import solarmach; print('ok')"],
    }
    results = {}
    threads = [threading.Thread(target=lambda k=k, c=c: results.__setitem__(k, _run(c, timeout=90)))
               for k, c in probes.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    code, out = results["blender"]
    m = re.search(r"Blender (\d+\.\d+\.\d+)", out)
    check("blender", code == 0 and m, m.group(0) if m else out.strip()[:200] or "not found")
    code, out = results["convert_env"]
    check("convert_env", code == 0, f"pyvista {out.strip()}" if code == 0 else out.strip()[-300:])
    code, out = results["ephemeris_env"]
    check("ephemeris_env", code == 0, cfg["ephemeris_python"] if code == 0 else out.strip()[-300:])

    for key in ("template_blend", "scene_script", "grid", "ephemeris_csv"):
        path = cfg[key]
        check(key, os.path.isfile(path), path)

    check("frontend_dist", os.path.isfile(os.path.join(cfg["frontend_dist"], "index.html")), cfg["frontend_dist"])
    check("renders_dir", os.path.isdir(cfg["renders_dir"]), cfg["renders_dir"])
    check("ffmpeg", cfg.get("ffmpeg") and shutil.which(cfg["ffmpeg"]) or (cfg.get("ffmpeg") and os.path.isfile(cfg["ffmpeg"])),
          cfg.get("ffmpeg") or "not found; results will have no thumbnails")

    template = cfg["template_blend"]
    return {
        "checked_at": time.time(),
        "checks": checks,
        # What a job strictly needs. ffmpeg and the built frontend are nice to have.
        "can_render": all(checks[k]["ok"] for k in
                          ("blender", "convert_env", "ephemeris_env", "template_blend", "scene_script", "grid", "ephemeris_csv")),
        "template_modified": os.path.getmtime(template) if os.path.isfile(template) else None,
    }


def gpu() -> dict | None:
    """Free memory on NVIDIA cards, when nvidia-smi exists. None on the Mac."""
    if not shutil.which("nvidia-smi"):
        return None
    code, out = _run(["nvidia-smi", "--query-gpu=name,memory.free,memory.total,utilization.gpu",
                      "--format=csv,noheader,nounits"], timeout=10)
    if code != 0:
        return None
    cards = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 4:
            cards.append({"name": parts[0], "free_mb": int(parts[1]), "total_mb": int(parts[2]),
                          "utilization": int(parts[3])})
    return {"cards": cards} if cards else None
