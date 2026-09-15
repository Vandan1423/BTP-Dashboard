"""
Where everything is, on whichever machine the service is running.

Defaults are worked out from this file's position in the BTP tree, which is
right for the Mac. The GPU box still uses the old `~/BTP_SolarWindCME/` layout
and has different interpreters, so it needs a `config.json` next to serve.py
(or at $BTP_CONFIG) overriding the paths -- see config.example.json. Relative
paths in that file are resolved against the file's own directory.

Nothing here imports a third-party package. The service runs on the standard
library alone so that `python3 serve.py` works on the box, which has no sudo
and no curl, without installing anything first.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent.parent          # BTP/


def _first_existing(*candidates):
    for c in candidates:
        if c and Path(c).exists():
            return str(c)
    return None


def _defaults() -> dict:
    mac = sys.platform == "darwin"
    vandan = REPO_DIR / "Vandan"
    return {
        "host": "127.0.0.1",
        "port": 8000,
        "machine": "mac" if mac else "a30",
        "machine_label": "this Mac · Metal" if mac else "the lab box · A30",

        "vandan_dir": str(vandan),
        "blender": _first_existing(
            "/Applications/Blender.app/Contents/MacOS/Blender",
            shutil.which("blender"),
        ) or "blender",
        # openvdb + pyvista. On the Mac these live in the conda env, not .venv.
        "convert_python": _first_existing(
            "/opt/homebrew/Caskroom/miniforge/base/envs/vdb-convert/bin/python",
            str(Path.home() / "miniforge3/envs/vdb-convert/bin/python"),
            str(Path.home() / "miniconda3/envs/vdb-convert/bin/python"),
        ) or "python3",
        # solarmach. On the Mac, the project .venv.
        "ephemeris_python": _first_existing(str(REPO_DIR / ".venv/bin/python")) or "python3",
        "ffmpeg": shutil.which("ffmpeg"),

        "frontend_dist": str(BACKEND_DIR.parent / "frontend" / "dist"),
        "storage_dir": str(BACKEND_DIR / "storage"),
        "grid": str(BACKEND_DIR / "grid.json"),

        # Filled from vandan_dir below unless set explicitly.
        "template_blend": None,
        "scene_script": None,
        "renders_dir": None,
        "ephemeris_csv": None,
        "vtk_dir": None,
        "vdb_dir": None,

        # A shared secret for POST and DELETE. Off by default; set it on the box,
        # which sits on a campus network with other people on it.
        "token": os.environ.get("BTP_TOKEN") or None,
        "max_upload_mb": 512,
        "keep_jobs": 40,
        "samples": {"preview": 256, "publication": 4096},
        "resolution": {"full": [4096, 2048], "half": [2048, 1024]},
        "timeouts": {"convert": 900, "ephemeris": 150},
        # Origins allowed to call the API from another port. Empty means same
        # origin only, which is the case both behind the Vite proxy and on the box.
        "cors_origins": [],
    }


def load(path: str | None = None) -> dict:
    cfg = _defaults()
    path = path or os.environ.get("BTP_CONFIG") or str(BACKEND_DIR / "config.json")
    base = BACKEND_DIR
    if Path(path).exists():
        with open(path) as f:
            user = json.load(f)
        base = Path(path).resolve().parent
        for k, v in user.items():
            if k.startswith("_"):
                continue
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k] = {**cfg[k], **v}
            else:
                cfg[k] = v
        cfg["_config_file"] = str(Path(path).resolve())
    else:
        cfg["_config_file"] = None

    def resolve(value):
        if value is None:
            return None
        p = Path(os.path.expanduser(str(value)))
        return str(p if p.is_absolute() else (base / p).resolve())

    for key in ("vandan_dir", "frontend_dist", "storage_dir", "grid",
                "template_blend", "scene_script", "renders_dir", "ephemeris_csv",
                "vtk_dir", "vdb_dir"):
        cfg[key] = resolve(cfg[key])
    for key in ("blender", "convert_python", "ephemeris_python", "ffmpeg"):
        v = cfg.get(key)
        if v and ("/" in v or v.startswith("~")):
            cfg[key] = resolve(v)

    vandan = Path(cfg["vandan_dir"])
    cfg["template_blend"] = cfg["template_blend"] or str(vandan / "output/scenes/SolarWindCME_space.blend")
    cfg["scene_script"] = cfg["scene_script"] or str(vandan / "scripts/scene/BuildSpaceScene.py")
    cfg["renders_dir"] = cfg["renders_dir"] or str(vandan / "output/renders")
    cfg["ephemeris_csv"] = cfg["ephemeris_csv"] or str(vandan / "input/ephemeris/camera_positions.csv")
    cfg["vtk_dir"] = cfg["vtk_dir"] or str(vandan / "input/vtk")
    cfg["vdb_dir"] = cfg["vdb_dir"] or str(vandan / "input/vdb")

    storage = Path(cfg["storage_dir"])
    cfg["uploads_dir"] = str(storage / "uploads")
    cfg["results_dir"] = str(storage / "results")
    cfg["database"] = str(storage / "jobs.sqlite")
    for d in (cfg["uploads_dir"], cfg["results_dir"]):
        os.makedirs(d, exist_ok=True)
    return cfg
