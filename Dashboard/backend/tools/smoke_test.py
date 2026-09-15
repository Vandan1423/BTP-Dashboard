#!/usr/bin/env python3
"""
Does the render service work end to end on this machine? Run it before a demo.

    python3 tools/smoke_test.py                       archived timestep, quick
    python3 tools/smoke_test.py --upload data.0170.vtk --bodies Venus
    python3 tools/smoke_test.py --url http://10.206.2.253:8000 --token SECRET

Submits a real job -- by default the archived timestep 0 from Earth at half
resolution, which is the cheapest frame the run has -- polls it to the end the
way the dashboard does, and prints each stage as it changes. Exits 0 only if
frames came back. Standard library only, like the service.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def request(method, url, token=None, data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--token")
    ap.add_argument("--index", type=int, default=0, help="archived timestep (ignored with --upload)")
    ap.add_argument("--upload", help="a .vtk file to send instead")
    ap.add_argument("--bodies", default="Earth")
    ap.add_argument("--quality", default="preview")
    ap.add_argument("--resolution", default="half")
    ap.add_argument("--datetime", help="UTC; defaults to the timestep's own date")
    args = ap.parse_args()
    api = args.url.rstrip("/") + "/api"

    status, health = request("GET", f"{api}/health")
    if status != 200:
        print(f"health: HTTP {status}")
        return 1
    while health.get("can_render") is None:          # startup checks still running
        time.sleep(1)
        _, health = request("GET", f"{api}/health")
    print(f"service on {health['machine_label']}: can_render={health['can_render']}")
    for name, c in health["checks"].items():
        if not c["ok"]:
            print(f"  -- {name}: {c['detail']}")
    if not health["can_render"]:
        return 1

    settings = {"viewpoints": args.bodies, "quality": args.quality, "resolution": args.resolution}
    if args.datetime:
        settings["datetime"] = args.datetime

    t0 = time.time()
    if args.upload:
        query = {**settings, "filename": os.path.basename(args.upload)}
        with open(args.upload, "rb") as f:
            body = f.read()
        print(f"uploading {args.upload} ({len(body) / 1048576:.1f} MB)")
        status, reply = request("POST", f"{api}/jobs?{urllib.parse.urlencode(query)}", args.token, body,
                                {"Content-Type": "application/octet-stream"})
    else:
        settings.update(archived_index=args.index, vtk_index=args.index)
        status, reply = request("POST", f"{api}/jobs", args.token, json.dumps(settings).encode(),
                                {"Content-Type": "application/json"})
    if status != 202:
        print(f"submit: HTTP {status} {reply}")
        return 1
    job = reply["job_id"]
    print(f"job {job} accepted in {time.time() - t0:.1f}s")

    last = None
    while True:
        _, snap = request("GET", f"{api}/jobs/{job}")
        line = f"{snap['status']:9} {snap['stage']:9} " + " ".join(
            f"{v['body']}:{v['status']}:{int(v['progress'] * 100)}%" for v in snap["viewpoints"])
        if line != last:
            print(f"  {time.time() - t0:6.1f}s  {line}  eta {snap['eta_s']:.0f}s")
            last = line
        if snap["status"] in ("done", "failed", "cancelled"):
            break
        time.sleep(1)

    if snap["status"] != "done":
        print(f"job {snap['status']}: {snap.get('error')}")
        print("\n".join(l["text"] for l in snap["log"][-15:]))
        return 1
    for w in snap["warnings"]:
        print(f"  warning: {w}")
    print(f"positions: {snap['positions_source']}")
    print(f"volume:    {snap['volume_source']}, tracer in {snap['tracer_voxels']} voxels")
    for v in snap["viewpoints"]:
        code = urllib.request.urlopen(args.url.rstrip("/") + v["url"]).status
        print(f"  {v['body']}: {v['seconds']:.1f}s  {v['url']}  HTTP {code}")
    print(f"ok in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
