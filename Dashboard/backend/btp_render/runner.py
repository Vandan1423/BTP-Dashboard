"""
Running one pipeline stage as a child process.

Every stage runs in a different interpreter -- openvdb's environment, the
solarmach environment, Blender's own Python -- so each is a subprocess and the
service talks to it through its stdout. Lines beginning with @@ are structured
(`@@render state=done body=Earth seconds=41.2`); everything else is the log a
person reads.

Each child gets its own process group, so cancelling kills Blender and anything
Blender started, instead of leaving an orphaned render holding the GPU while
the next job starts a second one.
"""
from __future__ import annotations

import os
import signal
import subprocess
import tempfile
import threading
import time


class Cancelled(Exception):
    pass


class StageError(Exception):
    pass


def parse_marker(line: str):
    """`@@tag a=1 b=two message=free text` -> ('tag', {'a': '1', ...})."""
    if not line.startswith("@@"):
        return None, None
    head, _, rest = line[2:].partition(" ")
    fields = {}
    if "message=" in rest:
        rest, _, message = rest.partition("message=")
        fields["message"] = message.strip()
    for part in rest.split():
        k, eq, v = part.partition("=")
        if eq:
            fields[k] = v
    if head == "stats":
        fields["text"] = line[len("@@stats "):]
    return head, fields


def run(cmd, on_line, cancel: threading.Event, timeout: float | None = None, cwd=None) -> int:
    # Never the service's own working directory. Nothing in the pipeline needs
    # it -- every path is passed explicitly -- and a directory the child cannot
    # read (a launcher started from a protected folder) made Python's own
    # startup hang looking for modules in it.
    proc = subprocess.Popen(
        cmd, cwd=cwd or tempfile.gettempdir(),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True, bufsize=1, errors="replace",
        start_new_session=True,
    )
    started = time.time()
    reason = []

    def watchdog():
        while proc.poll() is None:
            if cancel.is_set():
                reason.append("cancelled")
                break
            if timeout and time.time() - started > timeout:
                reason.append("timeout")
                break
            time.sleep(0.25)
        else:
            return
        _kill(proc)

    threading.Thread(target=watchdog, daemon=True).start()

    try:
        for raw in proc.stdout:
            on_line(raw.rstrip("\n"))
    finally:
        proc.stdout.close()
        code = proc.wait()

    if "cancelled" in reason:
        raise Cancelled()
    if "timeout" in reason:
        raise StageError(f"{os.path.basename(cmd[0])} did not finish within {int(timeout)} s")
    return code


def _kill(proc):
    try:
        pgid = os.getpgid(proc.pid)
    except ProcessLookupError:
        return
    for sig, wait in ((signal.SIGTERM, 5.0), (signal.SIGKILL, 0)):
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            return
        deadline = time.time() + wait
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.1)
        if proc.poll() is not None:
            return
