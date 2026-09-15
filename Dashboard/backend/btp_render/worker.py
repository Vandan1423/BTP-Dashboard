"""
The worker: one job at a time, stage by stage.

    convert    VTK -> VDB on the pinned grid          stages/convert_vtk.py
    ephemeris  camera positions for the date          camera_positions.csv, or
                                                      stages/solarmach_positions.py
    scene      open the template, correct it          stages/render_viewpoints.py
    render     one equirectangular frame per viewpoint   (same Blender process)
    finish     thumbnails and 2048 px stills          ffmpeg

Exactly one job runs at a time, and the viewpoints inside it run one after
another. That is not a shortcut. The A30 is shared and has already been filled
by another user holding 22.6 GB; two Cycles processes at once is the one thing
guaranteed to fail in front of an examiner.

Every stage checks for its own output before doing any work, so a job that was
interrupted -- the service restarted, the laptop lid closed -- resumes where it
stopped: a converted volume is not converted again, and a viewpoint already on
disk is not rendered again.
"""
from __future__ import annotations

import collections
import json
import os
import shutil
import subprocess
import threading
import time
import traceback

from . import cost, ephemeris
from .runner import Cancelled, StageError, parse_marker, run

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGES_DIR = os.path.join(HERE, "stages")
PIPELINE = ["convert", "ephemeris", "scene", "render"]
LOG_TAIL = 200

# Blender is chatty. The full output always goes to job.log; the log shown in
# the dashboard keeps only the lines a person watching a render cares about.
_KEEP = ("[", "Error", "ERROR", "Warning", "Traceback", "Saved:", "Read blend")


class Worker(threading.Thread):
    def __init__(self, cfg: dict, store):
        super().__init__(name="render-worker", daemon=True)
        self.cfg = cfg
        self.store = store
        self.wake = threading.Event()
        self.stopping = threading.Event()
        self.current: dict | None = None      # the running job, with live state
        self.cancel_event = threading.Event()
        self._logs: dict[str, collections.deque] = {}
        self._lock = threading.RLock()
        self._last_persist = 0.0

    # ------------------------------------------------------------------ paths

    def job_dir(self, job_id: str) -> str:
        return os.path.join(self.cfg["results_dir"], job_id)

    def upload_path(self, job_id: str) -> str:
        return os.path.join(self.cfg["uploads_dir"], job_id, "input.vtk")

    # -------------------------------------------------------------------- log

    def log(self, job_id: str, text: str, keep: bool = True) -> None:
        stamp = time.strftime("%H:%M:%S")
        os.makedirs(self.job_dir(job_id), exist_ok=True)
        with open(os.path.join(self.job_dir(job_id), "job.log"), "a") as f:
            f.write(f"{stamp} {text}\n")
        if keep:
            with self._lock:
                self._logs.setdefault(job_id, collections.deque(maxlen=LOG_TAIL)).append(text)

    def log_tail(self, job_id: str) -> list[str]:
        with self._lock:
            if job_id in self._logs:
                return list(self._logs[job_id])
        path = os.path.join(self.job_dir(job_id), "job.log")
        if not os.path.exists(path):
            return []
        with open(path, errors="replace") as f:
            lines = [ln.rstrip("\n")[9:] for ln in f]
        kept = [ln for ln in lines if ln.startswith(_KEEP) or ln.startswith(("job ", "POST", "queued"))]
        return kept[-LOG_TAIL:]

    # ------------------------------------------------------------------ state

    def _set(self, **changes) -> None:
        """Change the running job's state, persisting at most twice a second."""
        job = self.current
        if job is None:
            return
        with self._lock:
            job["state"].update(changes)
        now = time.time()
        if now - self._last_persist > 0.5 or "stage" in changes:
            self._last_persist = now
            self.store.update(job["id"], state=job["state"])

    def _stage(self, name: str) -> None:
        state = self.current["state"]
        prev = state.get("stage")
        done = list(state.get("done_stages", []))
        if prev in PIPELINE and prev != name and prev not in done:
            done.append(prev)
            state.setdefault("stage_seconds", {})[prev] = round(time.time() - state.get("stage_started_at", time.time()), 1)
        self._set(stage=name, stage_progress=0.0, stage_started_at=time.time(), done_stages=done)

    def _viewpoint(self, body: str, **changes) -> None:
        vps = self.current["state"]["viewpoints"]
        vps[body] = {**vps.get(body, {}), **changes}
        self._set(viewpoints=vps)

    # ------------------------------------------------------------------- loop

    def run(self) -> None:
        interrupted = self.store.requeue_interrupted()
        for job_id in interrupted:
            self.log(job_id, "job resumed after the service restarted")
        while not self.stopping.is_set():
            job = self.store.next_queued()
            if job is None:
                self.wake.wait(1.0)
                self.wake.clear()
                continue
            self._run_job(job)
            self._prune()

    def stop(self) -> None:
        self.stopping.set()
        self.cancel_event.set()
        self.wake.set()

    def cancel(self, job_id: str) -> bool:
        """True if the job was running and has been told to stop."""
        if self.current and self.current["id"] == job_id:
            self.cancel_event.set()
            return True
        return False

    def _run_job(self, job: dict) -> None:
        job_id = job["id"]
        self.cancel_event.clear()
        now = time.time()
        self.store.update(job_id, status="running", started_at=job.get("started_at") or now)
        job = self.store.get(job_id)
        self.current = job
        os.makedirs(self.job_dir(job_id), exist_ok=True)
        s = job["settings"]
        self.log(job_id, f"job {job_id} started on {self.cfg['machine_label']}")
        self.log(job_id, f"[job] {','.join(s['bodies'])} at {s['width']}x{s['height']}, {s['samples']} spp")

        try:
            self._convert(job)
            self._ephemeris(job)
            self._render(job)
            self._finish(job)
            self._stage("done")
            self.store.update(job_id, status="done", finished_at=time.time(), state=job["state"])
            total = time.time() - job["started_at"]
            self.log(job_id, f"job {job_id} complete in {total:.1f}s")
        except Cancelled:
            if self.stopping.is_set():
                # The service is shutting down, which is not the visitor asking
                # for the job to stop. Put it back in the queue; it resumes from
                # whatever it had finished the next time the service starts.
                self.log(job_id, "service stopping; the job will resume when it starts again")
                self.store.update(job_id, status="queued", state=job["state"])
            else:
                self.log(job_id, f"job {job_id} cancelled")
                self.store.update(job_id, status="cancelled", finished_at=time.time(), state=job["state"])
        except StageError as e:
            self._fail(job, str(e))
        except Exception as e:  # a bug here must still end the job, not hang it
            self.log(job_id, traceback.format_exc(), keep=False)
            self._fail(job, f"{type(e).__name__}: {e}")
        finally:
            self.current = None
            upload = self.upload_path(job_id)
            after = self.store.get(job_id)          # None if it was deleted while cancelling
            if os.path.exists(upload) and (after is None or after["status"] in ("done", "cancelled")):
                shutil.rmtree(os.path.dirname(upload), ignore_errors=True)

    def _fail(self, job: dict, message: str) -> None:
        job["state"]["error"] = message
        self.log(job["id"], f"[error] {message}")
        self.store.update(job["id"], status="failed", finished_at=time.time(), state=job["state"])

    # ---------------------------------------------------------------- convert

    def _convert(self, job: dict) -> None:
        job_id = job["id"]
        s, state = job["settings"], job["state"]
        src = s["source"]
        target = os.path.join(self.job_dir(job_id), "volume.vdb")
        self._stage("convert")

        if os.path.exists(target) and state.get("occupancy") is not None:
            self.log(job_id, "[vtk2vdb] volume.vdb already converted; reusing it")
            return

        if src["kind"] == "reuse":
            other = os.path.join(self.job_dir(src["job"]), "volume.vdb")
            if not os.path.exists(other):
                raise StageError(f"job {src['job']} no longer has its volume; upload the file again")
            _link_or_copy(other, target)
            prior = self.store.get(src["job"])
            occ = (prior or {}).get("state", {}).get("occupancy")
            self._set(occupancy=occ, tracer_voxels=(prior or {}).get("state", {}).get("tracer_voxels"),
                      volume_source=f"reused from job {src['job']}")
            self.log(job_id, f"[vtk2vdb] reusing the volume converted by job {src['job']}")
            if occ is None:
                self._measure(job, target)
            return

        if src["kind"] == "upload":
            vtk = self.upload_path(job_id)
            if not os.path.exists(vtk):
                raise StageError("the uploaded file is missing; it may have been cleaned up after a restart")
            label = f"{src['filename']} (uploaded)"
        else:
            n = int(src["index"])
            vtk = os.path.join(self.cfg["vtk_dir"], f"data.{n:04d}.vtk")
            label = f"{os.path.basename(vtk)} (archived)"
            if not os.path.exists(vtk):
                # Only the step-10 files are on the Mac; the converted volumes for
                # all 201 are. They were made on this exact grid, so using one is
                # not a shortcut around the pinned-grid rule -- it IS the rule.
                vdb = os.path.join(self.cfg["vdb_dir"], f"data.{n:04d}.vdb")
                if not os.path.exists(vdb):
                    raise StageError(f"timestep {n} is not on this machine, as .vtk or .vdb")
                _link_or_copy(vdb, target)
                self.log(job_id, f"[vtk2vdb] data.{n:04d}.vtk is not on this machine; using the archived "
                                 f"data.{n:04d}.vdb, converted on the same pinned grid")
                self._set(volume_source=f"archived data.{n:04d}.vdb")
                self._measure(job, target)
                return

        self.log(job_id, f"[job] source: {label}")
        partial = os.path.join(self.job_dir(job_id), "volume.converting.vdb")

        def on_line(line):
            tag, f = parse_marker(line)
            if tag == "progress":
                self._set(stage_progress=float(f["value"]))
            elif tag == "occupancy":
                self._set(occupancy=float(f["fraction"]), tracer_voxels=int(f["voxels"]),
                          rho_max=float(f["rho_max"]))
            elif tag == "warn":
                self._warn(job, f["message"])
            elif tag == "error":
                self._set(error=f["message"])
            elif tag is None:
                self.log(job_id, line)

        code = run([self.cfg["convert_python"], os.path.join(STAGES_DIR, "convert_vtk.py"),
                    "--input", vtk, "--output", partial, "--grid", self.cfg["grid"]],
                   on_line, self.cancel_event, timeout=self.cfg["timeouts"]["convert"])
        if code != 0 or not os.path.exists(partial):
            raise StageError(state.get("error") or f"conversion failed (exit {code})")
        os.replace(partial, target)
        self._set(volume_source=f"converted {label}")
        if src["kind"] == "upload":
            # 102 MB each, and the volume is all anything downstream needs.
            shutil.rmtree(os.path.dirname(vtk), ignore_errors=True)

    def _measure(self, job: dict, vdb: str) -> None:
        """Tracer occupancy of a volume that was not converted here."""
        code = run([self.cfg["convert_python"], os.path.join(STAGES_DIR, "convert_vtk.py"),
                    "--measure", vdb, "--grid", self.cfg["grid"], "--input", "-", "--output", "-"],
                   lambda line: self._measure_line(job, line), self.cancel_event, timeout=120)
        if code != 0:
            self._warn(job, "could not measure tracer occupancy of the volume")

    def _measure_line(self, job, line):
        tag, f = parse_marker(line)
        if tag == "occupancy":
            self._set(occupancy=float(f["fraction"]), tracer_voxels=int(f["voxels"]), rho_max=float(f["rho_max"]))
        elif tag is None:
            self.log(job["id"], line)

    # -------------------------------------------------------------- ephemeris

    def _ephemeris(self, job: dict) -> None:
        job_id = job["id"]
        s = job["settings"]
        out = os.path.join(self.job_dir(job_id), "positions.json")
        self._stage("ephemeris")
        if os.path.exists(out) and job["state"].get("positions"):
            return

        when = ephemeris.parse(s["datetime"])
        n = ephemeris.matching_index(when)
        positions = None

        if n is not None:
            positions = ephemeris.from_csv(self.cfg["ephemeris_csv"], n)
            if positions:
                when = ephemeris.datetime_for(n)
                source = f"camera_positions.csv, index {n} (Solar-MACH output for that date)"
                self.log(job_id, f"[solar-mach] {ephemeris.label(when)} is timestep {n}; "
                                 f"using camera_positions.csv, the same numbers the approved renders used")

        if positions is None:
            tmp = out + ".partial"
            error = []

            def on_line(line):
                tag, f = parse_marker(line)
                if tag == "error":
                    error.append(f["message"])
                elif tag is None and not line.startswith(("WARNING", "  warnings", "/")):
                    self.log(job_id, line)

            try:
                code = run([self.cfg["ephemeris_python"], os.path.join(STAGES_DIR, "solarmach_positions.py"),
                            "--datetime", ephemeris.label(when), "--output", tmp],
                           on_line, self.cancel_event, timeout=self.cfg["timeouts"]["ephemeris"])
            except StageError as e:
                code, error = -1, [str(e)]
            if code == 0 and os.path.exists(tmp):
                with open(tmp) as f:
                    positions = json.load(f)
                os.remove(tmp)
                source = f"Solar-MACH, live query for {ephemeris.label(when)}"
            else:
                # Placing the cameras for a different date is exactly the kind of
                # quiet error this pipeline has been bitten by, so it only
                # happens inside the run's window, and it is said out loud.
                near = round((when - ephemeris.EPOCH).total_seconds() / ephemeris.STEP_SECONDS)
                if 0 <= near <= ephemeris.LAST_INDEX:
                    positions = ephemeris.from_csv(self.cfg["ephemeris_csv"], near)
                if not positions:
                    raise StageError(error[0] if error else "Solar-MACH failed and the date is outside the run")
                source = f"camera_positions.csv, nearest timestep {near}"
                self._warn(job, f"Solar-MACH was unreachable ({error[0] if error else 'no output'}); "
                                f"cameras placed for the nearest timestep, {near}, instead of {ephemeris.label(when)}")

        with open(out, "w") as f:
            json.dump(positions, f, indent=2)
        if not source.startswith("Solar-MACH"):
            # A live query already printed its own positions.
            for body in s["bodies"]:
                p = positions[body]
                self.log(job_id, f"[solar-mach] {body}: x={p['x']:.3f} y={p['y']:.3f} z={p['z']:.3f} AU")
        self._set(positions=positions, positions_source=source, datetime=ephemeris.label(when), stage_progress=1.0)

    # ----------------------------------------------------------------- render

    def _render(self, job: dict) -> None:
        job_id = job["id"]
        s = job["settings"]
        jd = self.job_dir(job_id)
        todo = [b for b in s["bodies"] if not os.path.exists(os.path.join(jd, f"{b}.png"))]
        for body in s["bodies"]:
            if body not in todo:
                self._viewpoint(body, status="done", progress=1.0)
        self._stage("scene")
        if not todo:
            self._stage("render")
            return

        active = [None]
        error = []

        def on_line(line):
            tag, f = parse_marker(line)
            if tag == "scene" and f.get("state") == "done":
                self._stage("render")
            elif tag == "render" and f.get("state") == "start":
                active[0] = f["body"]
                self._viewpoint(f["body"], status="rendering", progress=0.0, started_at=time.time(), remaining=None)
                self.log(job_id, f"[cycles] {f['body']}: EQUIRECTANGULAR {s['width']}x{s['height']}, {s['samples']} spp")
            elif tag == "render" and f.get("state") == "done":
                active[0] = None
                self._viewpoint(f["body"], status="done", progress=1.0, seconds=float(f["seconds"]), remaining=0)
                self.log(job_id, f"[cycles] {f['body']} frame saved: {float(f['seconds']):.1f}s")
            elif tag == "stats" and active[0]:
                self._stats(active[0], f["text"])
            elif tag == "error":
                error.append(f["message"])
            elif tag is None:
                self.log(job_id, line, keep=line.startswith(_KEEP))

        code = run([self.cfg["blender"], "--background", self.cfg["template_blend"],
                    "--python", os.path.join(STAGES_DIR, "render_viewpoints.py"), "--",
                    "--volume", os.path.join(jd, "volume.vdb"),
                    "--positions", os.path.join(jd, "positions.json"),
                    "--bodies", ",".join(todo),
                    "--samples", str(s["samples"]),
                    "--width", str(s["width"]), "--height", str(s["height"]),
                    "--outdir", jd,
                    "--scene-script", self.cfg["scene_script"]],
                   on_line, self.cancel_event)
        missing = [b for b in todo if not os.path.exists(os.path.join(jd, f"{b}.png"))]
        if error or code != 0 or missing:
            raise StageError(error[0] if error else f"Blender exited with {code}; missing {', '.join(missing) or 'nothing'}")

    def _stats(self, body: str, text: str) -> None:
        """`Remaining: 00:24.73 | Mem: 3805M | Sample 32/128` -> progress and time left."""
        import re
        m = re.search(r"Sample (\d+)/(\d+)", text)
        if not m:
            return
        done, total = int(m.group(1)), int(m.group(2))
        frac = done / total if total else 0.0
        remaining = None
        r = re.search(r"Remaining:\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)", text)
        # Cycles' estimate at the first samples includes compiling GPU kernels,
        # and wildly overstates the rest. It is only believed after a tenth.
        if r and frac >= 0.1:
            h = int(r.group(1) or 0)
            remaining = h * 3600 + int(r.group(2)) * 60 + float(r.group(3))
        mem = re.search(r"Mem:\s*([\d.]+[KMG])", text)
        self._viewpoint(body, progress=round(min(frac * 0.97, 0.97), 3), remaining=remaining,
                        memory=mem.group(1) if mem else None)
        vps = self.current["state"]["viewpoints"]
        bodies = self.current["settings"]["bodies"]
        finished = sum(1 for b in bodies if vps.get(b, {}).get("status") == "done")
        self._set(stage_progress=(finished + frac * 0.97) / len(bodies))

    # ----------------------------------------------------------------- finish

    def _finish(self, job: dict) -> None:
        """Card-sized and explorer-sized copies, the way the archive has them."""
        ffmpeg = self.cfg.get("ffmpeg")
        jd = self.job_dir(job["id"])
        if not ffmpeg:
            self._warn(job, "ffmpeg not found; the results have no thumbnails or 2048 px stills")
            return
        for body in job["settings"]["bodies"]:
            src = os.path.join(jd, f"{body}.png")
            for suffix, size in (("thumb", "512:256"), ("still", "2048:1024")):
                dst = os.path.join(jd, f"{body}_{suffix}.jpg")
                if os.path.exists(dst):
                    continue
                subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-i", src, "-vf", f"scale={size}",
                                "-q:v", "4", dst], check=False, timeout=60)

    def _warn(self, job: dict, message: str) -> None:
        warnings = list(job["state"].get("warnings", []))
        if message not in warnings:
            warnings.append(message)
        self._set(warnings=warnings)
        self.log(job["id"], f"[warning] {message}")

    # ------------------------------------------------------------ retention

    def _prune(self) -> None:
        for job_id in self.store.finished_beyond(self.cfg["keep_jobs"]):
            self.remove_files(job_id)
            self.store.delete(job_id)

    def remove_files(self, job_id: str) -> None:
        shutil.rmtree(self.job_dir(job_id), ignore_errors=True)
        shutil.rmtree(os.path.join(self.cfg["uploads_dir"], job_id), ignore_errors=True)
        with self._lock:
            self._logs.pop(job_id, None)

    # --------------------------------------------------------------- snapshot

    def snapshot(self, job_id: str, base_url: str = "/api") -> dict | None:
        """The job, in the shape the dashboard's poll expects."""
        job = self.current if self.current and self.current["id"] == job_id else self.store.get(job_id)
        if job is None:
            return None
        with self._lock:
            state = json.loads(json.dumps(job["state"]))
        s = job["settings"]
        status = job["status"] if not (self.current and self.current["id"] == job_id) else "running"
        now = time.time()
        jd = self.job_dir(job_id)

        stage = "queued" if status == "queued" else state.get("stage", "convert")
        if status == "running" and stage == "queued":
            stage = "convert"          # picked up, first stage not yet announced
        if status == "done":
            stage = "done"

        viewpoints = []
        render_left = 0.0
        measured = [v["seconds"] for v in state.get("viewpoints", {}).values() if v.get("seconds")]
        per = sum(measured) / len(measured) if measured else state["plan"]["per_viewpoint"]
        for body in s["bodies"]:
            v = state.get("viewpoints", {}).get(body, {})
            png = os.path.join(jd, f"{body}.png")
            done = v.get("status") == "done" and os.path.exists(png)
            item = {
                "body": body,
                "status": "done" if done else v.get("status", "queued"),
                "progress": 1.0 if done else float(v.get("progress", 0.0)),
                "seconds": v.get("seconds") or per,
                "url": None, "thumb": None, "still": None,
            }
            if done:
                art = f"{base_url}/jobs/{job_id}/artifacts"
                item["url"] = f"{art}/{body}.png"
                if os.path.exists(os.path.join(jd, f"{body}_thumb.jpg")):
                    item["thumb"] = f"{art}/{body}_thumb.jpg"
                if os.path.exists(os.path.join(jd, f"{body}_still.jpg")):
                    item["still"] = f"{art}/{body}_still.jpg"
            elif item["status"] == "rendering":
                spent = now - (v.get("started_at") or now)
                frac = float(v.get("progress", 0.0))
                if v.get("remaining") is not None:
                    render_left += v["remaining"] + 3            # Cycles' own estimate
                elif frac >= 0.03:
                    render_left += spent * (1 / frac - 1) + 3    # the rate so far
                else:
                    # Nothing measured yet. Never let the model run down to zero
                    # just because the first samples are slow to arrive.
                    render_left += max(per - spent, per * 0.3)
            else:
                render_left += per
            viewpoints.append(item)

        est = {st["id"]: st["seconds"] for st in state["plan"]["stages"]}
        done_stages = list(state.get("done_stages", []))
        eta = 0.0
        if status in ("queued", "running"):
            for st in PIPELINE:
                if st in done_stages:
                    continue
                if st == "render":
                    eta += render_left
                elif st == stage and status == "running":
                    eta += max(1.0, est[st] - (now - state.get("stage_started_at", now)))
                else:
                    eta += est[st]
        elapsed = (now - job["started_at"]) if job.get("started_at") else 0.0
        if job.get("finished_at") and job.get("started_at"):
            elapsed = job["finished_at"] - job["started_at"]

        stage_progress = float(state.get("stage_progress", 0.0))
        if stage in ("ephemeris", "scene") and status == "running" and stage_progress < 1:
            stage_progress = min(0.95, (now - state.get("stage_started_at", now)) / max(est[stage], 1))

        return {
            "id": job_id,
            "status": status,
            "stage": stage,
            "stageProgress": round(stage_progress, 3),
            "done": ["upload", *done_stages] + (["frames"] if status == "done" else []),
            "viewpoints": viewpoints,
            "elapsed": round(elapsed, 1),
            "eta_s": round(eta, 1),
            "plan": {"total": round(elapsed + eta, 1), "stages": state["plan"]["stages"]},
            "queue_position": self.store.queue_position(job_id) if status == "queued" else 0,
            "log": [{"text": t} for t in self.log_tail(job_id)],
            "occupancy": state.get("occupancy"),
            "tracer_voxels": state.get("tracer_voxels"),
            "positions_source": state.get("positions_source"),
            "positions": state.get("positions"),
            "volume_source": state.get("volume_source"),
            "datetime": state.get("datetime") or s["datetime"],
            "warnings": state.get("warnings", []),
            "error": state.get("error") if status == "failed" else None,
            "machine": self.cfg["machine_label"],
            "settings": {k: s[k] for k in ("bodies", "quality", "resolution", "samples", "width", "height", "index")},
        }


def _link_or_copy(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)
