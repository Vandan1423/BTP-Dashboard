"""
The HTTP side.

    GET    /api/health                        can this machine render, and is it busy
    GET    /api/jobs                          recent jobs
    POST   /api/jobs                          submit; returns at once with a job id
    GET    /api/jobs/{id}                     the job, in the shape the dashboard polls
    GET    /api/jobs/{id}/log                 the full log, as text
    GET    /api/jobs/{id}/artifacts           the frames
    GET    /api/jobs/{id}/artifacts/{name}    one frame
    DELETE /api/jobs/{id}                     cancel if running, then remove its files

    GET    /media/...                         the archived renders, with Range
    GET    /...                               the built dashboard

Submission is never a blocking request. A render is thirty seconds to forty
minutes and the link to the box has dropped repeatedly, so POST returns a job id
straight away and everything after that is polling. A dropped connection costs a
reconnect, not a render.

An upload is the raw file as the request body, with the settings in the query
string -- not multipart. It streams straight to disk in 1 MB pieces, never held
in memory, and needs no form parser (the standard library's was removed in 3.13).
An archived timestep, or a re-render of an earlier job's volume, is JSON.

Every file this serves is resolved and checked to be inside the one directory it
belongs to. That rule comes from the day a test server started in ~ published
the whole home directory to the campus network; it is not negotiable.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse

from . import cost, ephemeris, health

BODIES = ["Mercury", "Venus", "Earth", "Mars"]
ARTIFACT = re.compile(r"^(Mercury|Venus|Earth|Mars)(_thumb|_still)?\.(png|jpg)$")
JOB_ID = re.compile(r"^[0-9a-f]{10}$")
CHUNK = 1024 * 1024

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("video/mp4", ".mp4")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def make_handler(app):
    """Bind the handler class to one running service."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "btp-render/1.0"
        protocol_version = "HTTP/1.1"

        # ------------------------------------------------------------ plumbing

        def log_message(self, fmt, *args):
            # Polling a job five times a second would bury everything else.
            if self.command == "GET" and self.path.startswith(("/api/jobs/", "/media/", "/assets/")) \
                    and str(args[1]).startswith(("2", "3")):
                return
            print(f"{time.strftime('%H:%M:%S')} {self.address_string()} {fmt % args}", flush=True)

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin and origin in app.cfg["cors_origins"]:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")

        def _json(self, status: int, payload, headers=None):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self._cors()
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _error(self, status: int, message: str):
            # Whatever of the request body is still unread would otherwise be
            # parsed as the next request on this connection.
            self.close_connection = True
            self._json(status, {"error": message})

        def _authorised(self) -> bool:
            token = app.cfg.get("token")
            if not token:
                return True
            return self.headers.get("Authorization", "") == f"Bearer {token}"

        def _dispatch(self, method):
            try:
                url = urlparse(self.path)
                path = unquote(url.path)
                query = {k: v[-1] for k, v in parse_qs(url.query).items()}
                if path.startswith("/api/"):
                    if method in ("POST", "DELETE") and not self._authorised():
                        raise ApiError(401, "this service needs its token")
                    return self._api(method, path, query)
                if method not in ("GET", "HEAD"):
                    raise ApiError(405, "method not allowed")
                if path.startswith("/media/"):
                    return self._file(app.cfg["renders_dir"], path[len("/media/"):], cache="public, max-age=3600")
                return self._frontend(path)
            except ApiError as e:
                self._error(e.status, e.message)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                traceback.print_exc()
                self._error(500, f"{type(e).__name__}: {e}")

        def do_GET(self):
            self._dispatch("GET")

        def do_HEAD(self):
            self._dispatch("HEAD")

        def do_POST(self):
            self._dispatch("POST")

        def do_DELETE(self):
            self._dispatch("DELETE")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        # ----------------------------------------------------------------- api

        def _api(self, method, path, query):
            parts = [p for p in path.split("/") if p][1:]      # drop "api"

            if parts == ["health"] and method in ("GET", "HEAD"):
                return self._json(200, app.health(refresh=query.get("refresh") == "1"))

            if parts == ["jobs"] and method == "GET":
                jobs = app.store.list(limit=min(int(query.get("limit", 20)), 100))
                return self._json(200, [app.summary(j) for j in jobs])

            if parts == ["jobs"] and method == "POST":
                return self._submit(query)

            if len(parts) >= 2 and parts[0] == "jobs":
                job_id = parts[1]
                if not JOB_ID.match(job_id):
                    raise ApiError(404, "no such job")
                job = app.store.get(job_id)
                if job is None:
                    raise ApiError(404, "no such job")

                if len(parts) == 2 and method in ("GET", "HEAD"):
                    return self._json(200, app.worker.snapshot(job_id))

                if len(parts) == 2 and method == "DELETE":
                    return self._json(200, app.remove(job_id))

                if parts[2:] == ["log"] and method == "GET":
                    log = os.path.join(app.worker.job_dir(job_id), "job.log")
                    return self._file(os.path.dirname(log), "job.log", content_type="text/plain; charset=utf-8")

                if parts[2:] == ["artifacts"] and method == "GET":
                    snap = app.worker.snapshot(job_id)
                    return self._json(200, [{k: v[k] for k in ("body", "url", "thumb", "still")}
                                            for v in snap["viewpoints"] if v["url"]])

                if len(parts) == 4 and parts[2] == "artifacts" and method in ("GET", "HEAD"):
                    if not ARTIFACT.match(parts[3]):
                        raise ApiError(404, "no such artifact")
                    return self._file(app.worker.job_dir(job_id), parts[3], cache="private, max-age=86400")

            raise ApiError(404, "not found")

        def _submit(self, query):
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            if ctype == "application/json":
                length = int(self.headers.get("Content-Length") or 0)
                if length > 64 * 1024:
                    raise ApiError(413, "settings too large")
                try:
                    body = json.loads(self.rfile.read(length) or b"{}")
                except json.JSONDecodeError:
                    raise ApiError(400, "body is not JSON")
                settings = app.validate(body)
                job = app.create(settings)
                return self._json(202, app.accepted(job))

            # Otherwise the body is the .vtk itself.
            settings = app.validate(query, upload=True)
            length = self.headers.get("Content-Length")
            if length is None:
                raise ApiError(411, "an upload needs a Content-Length")
            length = int(length)
            limit = app.cfg["max_upload_mb"] * 1024 * 1024
            if length > limit:
                raise ApiError(413, f"the file is larger than {app.cfg['max_upload_mb']} MB")
            if length < 64:
                raise ApiError(400, "the file is empty")

            settings["source"]["size"] = length
            job = app.create(settings, pending=True)
            dest = app.worker.upload_path(job["id"])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            partial = dest + ".partial"
            received = 0
            try:
                with open(partial, "wb") as out:
                    first = True
                    while received < length:
                        chunk = self.rfile.read(min(CHUNK, length - received))
                        if not chunk:
                            raise ApiError(400, "the upload ended early")
                        if first:
                            first = False
                            # Legacy VTK, which is what PLUTO writes, starts with a
                            # fixed header. Anything else is refused before 100 MB
                            # of it has been written to disk.
                            if b"vtk DataFile" not in chunk[:256]:
                                raise ApiError(400, "that is not a legacy .vtk file (no '# vtk DataFile' header)")
                        out.write(chunk)
                        received += len(chunk)
                os.replace(partial, dest)
            except BaseException:
                # A refused or broken upload leaves nothing behind: no row, no
                # partial file, no results folder.
                app.store.delete(job["id"])
                app.worker.remove_files(job["id"])
                raise
            app.release(job)
            return self._json(202, app.accepted(job))

        # --------------------------------------------------------------- files

        def _file(self, root, rel, cache="no-cache", content_type=None):
            root = os.path.realpath(root)
            target = os.path.realpath(os.path.join(root, rel.lstrip("/")))
            if os.path.commonpath([root, target]) != root:
                raise ApiError(403, "forbidden")
            if not os.path.isfile(target):
                raise ApiError(404, "not found")

            size = os.path.getsize(target)
            ctype = content_type or mimetypes.guess_type(target)[0] or "application/octet-stream"
            start, end = 0, size - 1
            status = 200
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
                if not m or (not m.group(1) and not m.group(2)):
                    raise ApiError(416, "bad range")
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:                                   # suffix: the last N bytes
                    start = max(0, size - int(m.group(2)))
                if start >= size or end >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206

            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", cache)
            self.send_header("Content-Length", str(end - start + 1))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self._cors()
            self.end_headers()
            if self.command == "HEAD":
                return
            with open(target, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def _frontend(self, path):
            dist = app.cfg["frontend_dist"]
            rel = path.lstrip("/") or "index.html"
            candidate = os.path.realpath(os.path.join(dist, rel))
            if os.path.isfile(candidate) and os.path.commonpath([os.path.realpath(dist), candidate]) == os.path.realpath(dist):
                cache = "public, max-age=31536000, immutable" if rel.startswith("assets/") else "no-cache"
                return self._file(dist, rel, cache=cache)
            if not os.path.isfile(os.path.join(dist, "index.html")):
                raise ApiError(404, "the dashboard is not built; run `npm run build` in Dashboard/frontend")
            # The site routes on the hash, so any other path is the app itself.
            return self._file(dist, "index.html")

    return Handler


class App:
    """What the handler needs, in one place: config, store, worker."""

    def __init__(self, cfg, store, worker):
        self.cfg = cfg
        self.store = store
        self.worker = worker
        self._health = None
        self._health_at = 0.0

    def health(self, refresh=False) -> dict:
        if refresh:
            self._health = health.probe(self.cfg)
        counts = self.store.counts()
        current = self.worker.current
        probed = self._health
        return {
            "ok": True,
            "machine": self.cfg["machine"],
            "machine_label": self.cfg["machine_label"],
            # None while the startup checks are still running, rather than making
            # the first request wait for Blender and two interpreters to answer.
            "can_render": probed["can_render"] if probed else None,
            "checks": probed["checks"] if probed else {},
            "queue_depth": counts.get("queued", 0),
            "running": current["id"] if current else None,
            "gpu": health.gpu(),
            "token_required": bool(self.cfg.get("token")),
            "server_time": time.time(),
        }

    def validate(self, raw: dict, upload: bool = False) -> dict:
        def get(key, default=None):
            v = raw.get(key, default)
            return v.strip() if isinstance(v, str) else v

        bodies = get("viewpoints") or get("bodies") or ""
        if isinstance(bodies, str):
            bodies = [b for b in bodies.split(",") if b]
        bodies = [b for b in BODIES if b in bodies]         # orbital order, no junk
        if not bodies:
            raise ApiError(400, "choose at least one of Mercury, Venus, Earth, Mars")

        quality = get("quality", "preview")
        if quality not in self.cfg["samples"]:
            raise ApiError(400, f"quality must be one of {', '.join(self.cfg['samples'])}")
        resolution = get("resolution", "full")
        if resolution not in self.cfg["resolution"]:
            raise ApiError(400, f"resolution must be one of {', '.join(self.cfg['resolution'])}")
        width, height = self.cfg["resolution"][resolution]

        index = get("vtk_index")
        index = int(index) if index not in (None, "", "null") else None
        if index is not None and not 0 <= index <= ephemeris.LAST_INDEX:
            index = None

        # Where the volume comes from, first: an archived timestep names its own
        # date, and an upload's name can too, so the date is worked out after.
        if upload:
            name = os.path.basename(get("filename") or "upload.vtk")
            if not name.lower().endswith(".vtk"):
                raise ApiError(400, "only .vtk files are accepted")
            source = {"kind": "upload", "filename": name, "size": None}
            m = re.search(r"(?:^|[^0-9])(\d{3,5})(?=\.vtk$)", name, re.I)
            if index is None and m and 0 <= int(m.group(1)) <= ephemeris.LAST_INDEX:
                index = int(m.group(1))
        elif get("reuse_job"):
            other = str(get("reuse_job"))
            prior = self.store.get(other) if JOB_ID.match(other) else None
            if prior is None:
                raise ApiError(404, "the job to re-render no longer exists")
            source = {"kind": "reuse", "job": other}
            if index is None:
                index = prior["settings"].get("index")
        elif get("archived_index") not in (None, ""):
            try:
                n = int(get("archived_index"))
            except (TypeError, ValueError):
                raise ApiError(400, "archived_index must be a number")
            if not 0 <= n <= ephemeris.LAST_INDEX:
                raise ApiError(400, "archived_index must be 0..200")
            vtk = os.path.join(self.cfg["vtk_dir"], f"data.{n:04d}.vtk")
            vdb = os.path.join(self.cfg["vdb_dir"], f"data.{n:04d}.vdb")
            if not (os.path.exists(vtk) or os.path.exists(vdb)):
                raise ApiError(404, f"timestep {n} is not on this machine")
            source = {"kind": "archived", "index": n}
            index = n
        else:
            raise ApiError(400, "send a .vtk as the request body, or JSON with archived_index or reuse_job")

        when = get("datetime")
        if not when:
            if index is None:
                raise ApiError(400, "a datetime is needed: the file name has no timestep index in it")
            when = ephemeris.label(ephemeris.datetime_for(index))
        try:
            parsed = ephemeris.parse(when)
        except (ValueError, TypeError) as e:
            raise ApiError(400, f"datetime: {e}")
        # The cost model is keyed on the timestep. A date that is one names it
        # even when the caller did not say so, and an ETA built on the wrong
        # timestep can be out by a factor of fifty.
        matched = ephemeris.matching_index(parsed)
        if matched is not None:
            index = matched

        return {
            "bodies": bodies, "quality": quality, "resolution": resolution,
            "samples": int(self.cfg["samples"][quality]), "width": width, "height": height,
            "datetime": when, "index": index, "source": source, "machine": self.cfg["machine"],
        }

    def create(self, settings: dict, pending: bool = False) -> dict:
        state = {
            "stage": "queued", "stage_progress": 0.0, "done_stages": [],
            "viewpoints": {b: {"status": "queued", "progress": 0.0} for b in settings["bodies"]},
            "plan": cost.plan(settings["index"], settings["quality"], settings["width"], settings["height"],
                              settings["machine"], settings["bodies"]),
            "warnings": [],
        }
        # An upload is created as 'uploading', which the worker never picks up,
        # and only becomes 'queued' once every byte has arrived. Creating it as
        # queued and changing it afterwards would leave a window in which the
        # worker could start converting a file that is still being written.
        job = self.store.create(settings, state, status="uploading" if pending else "queued")
        if not pending:
            self.worker.log(job["id"], f"queued as {job['id']}")
            self.worker.wake.set()
        return self.store.get(job["id"])

    def release(self, job: dict) -> None:
        self.store.update(job["id"], status="queued")
        self.worker.log(job["id"], f"queued as {job['id']}")
        self.worker.wake.set()

    def accepted(self, job: dict) -> dict:
        return {"job_id": job["id"], "queue_position": self.store.queue_position(job["id"])}

    def summary(self, job: dict) -> dict:
        s = job["settings"]
        return {"id": job["id"], "status": job["status"], "created_at": job["created_at"],
                "bodies": s["bodies"], "quality": s["quality"], "resolution": s["resolution"],
                "index": s["index"], "source": s["source"]}

    def remove(self, job_id: str) -> dict:
        job = self.store.get(job_id)
        if job["status"] in ("queued", "uploading"):
            self.store.update(job_id, status="cancelled", finished_at=time.time())
        elif job["status"] == "running" and self.worker.cancel(job_id):
            # The worker records the cancellation once Blender is down; the
            # files go after that, not from underneath a running process.
            deadline = time.time() + 15
            while time.time() < deadline and self.store.get(job_id)["status"] == "running":
                time.sleep(0.2)
        if self.store.get(job_id)["status"] != "running":
            self.worker.remove_files(job_id)
            self.store.delete(job_id)
            return {"deleted": job_id}
        return {"cancelling": job_id}
