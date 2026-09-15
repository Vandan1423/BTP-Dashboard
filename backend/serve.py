#!/usr/bin/env python3
"""
The BTP render service.

    python3 serve.py                 serve on 127.0.0.1:8000
    python3 serve.py --check         say whether this machine can render, and exit
    python3 serve.py --host 0.0.0.0  listen on the network (the GPU box)

Standard library only. On the box, run it under tmux so a dropped SSH session
does not take a render down with it:

    tmux new -s btp 'python3 serve.py --host 0.0.0.0'

One process holds the HTTP server and the worker thread. Stopping it (Ctrl-C)
stops Blender too; the job goes back in the queue and resumes from whatever it
had already finished the next time the service starts.
"""
from __future__ import annotations

import argparse
import signal
import sys
import threading
from http.server import ThreadingHTTPServer

from btp_render import config, health
from btp_render.api import App, make_handler
from btp_render.jobs import JobStore
from btp_render.worker import Worker


def print_checks(result: dict) -> None:
    width = max(len(k) for k in result["checks"])
    for name, c in result["checks"].items():
        mark = "ok " if c["ok"] else "-- "
        print(f"  {mark} {name.ljust(width)}  {c['detail']}")
    print()
    print("  can render" if result["can_render"] else "  CANNOT render: fix the items marked -- above")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="path to config.json (default: next to this file, or $BTP_CONFIG)")
    ap.add_argument("--host")
    ap.add_argument("--port", type=int)
    ap.add_argument("--check", action="store_true", help="report readiness and exit")
    args = ap.parse_args()

    cfg = config.load(args.config)
    if args.host:
        cfg["host"] = args.host
    if args.port:
        cfg["port"] = args.port

    print(f"btp-render on {cfg['machine_label']}")
    print(f"  config  {cfg['_config_file'] or '(defaults)'}")
    if args.check:
        result = health.probe(cfg)
        print_checks(result)
        return 0 if result["can_render"] else 1

    store = JobStore(cfg["database"])
    worker = Worker(cfg, store)
    app = App(cfg, store, worker)

    # Listen straight away and check the machine in the background. A cold
    # Blender can take a while to report its version, and the dashboard's probe
    # gives up after two seconds and falls back to the simulator.
    def startup_checks():
        app._health = health.probe(cfg)
        print()
        print_checks(app._health)
        print(flush=True)

    threading.Thread(target=startup_checks, name="startup-checks", daemon=True).start()

    server = ThreadingHTTPServer((cfg["host"], cfg["port"]), make_handler(app))
    server.daemon_threads = True
    worker.start()

    def shutdown(*_):
        print("\nstopping: a running render is stopped and resumes when the service starts again")
        worker.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    where = f"http://{'localhost' if cfg['host'] in ('127.0.0.1', '0.0.0.0') else cfg['host']}:{cfg['port']}"
    print(f"\n  listening on {cfg['host']}:{cfg['port']}  ->  {where}")
    if cfg["host"] == "0.0.0.0" and not cfg.get("token"):
        print("  NOTE: listening on every interface with no token; anyone on the network can submit jobs")
    server.serve_forever()
    worker.join(timeout=20)
    return 0


if __name__ == "__main__":
    sys.exit(main())
