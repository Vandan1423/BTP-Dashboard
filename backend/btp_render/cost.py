"""
What a job will cost, before it has run.

A line-for-line port of frontend/src/pages/vandan/pipeline/cost.js, so the ETA
the service reports before rendering starts is the same number the form quoted.
Every anchor is measured on this scene -- SOLAR_WIND_CME_GUIDE.md §10 has the
derivation -- and the two files must be changed together.

Once a job is actually rendering, this stops being the source: the worker uses
Cycles' own remaining-time estimate for the viewpoint on the GPU, and the
measured time of the viewpoints already finished for the ones still queued.
"""
from __future__ import annotations

import math

FULL_MPX = (4096 * 2048) / 1e6

# Seconds per frame, 4096 spp, 4096x2048, A30 -- from render5.log.
COST_ANCHORS = [(0, 12.0), (155, 14.0), (169, 636.0), (184, 64.0), (200, 29.0)]
RUN_AVERAGE_S = 30.2

CONVERT_S = 11.2
EPHEMERIS_S = 6.0
SCENE_S = 8.0
SAMPLE_FLOOR = 9.0

SAMPLE_SCALE = {"preview": 0.42, "publication": 1.0}
MACHINE_FACTOR = {"a30": 1.0, "mac": 2.0}


def base_seconds(index: int | None) -> float:
    if index is None:
        return RUN_AVERAGE_S
    n = max(0, min(200, int(index)))
    if n <= COST_ANCHORS[0][0]:
        return COST_ANCHORS[0][1]
    for (n0, s0), (n1, s1) in zip(COST_ANCHORS, COST_ANCHORS[1:]):
        if n <= n1:
            k = (n - n0) / (n1 - n0)
            return math.exp(math.log(s0) + (math.log(s1) - math.log(s0)) * k)
    return COST_ANCHORS[-1][1]


def viewpoint_seconds(index, quality, width, height, machine) -> float:
    samples = max(0.0, base_seconds(index) - SAMPLE_FLOOR) * SAMPLE_SCALE.get(quality, 1.0)
    mpx = (width * height) / 1e6
    return (SAMPLE_FLOOR + samples) * (mpx / FULL_MPX) * MACHINE_FACTOR.get(machine, 1.0)


def plan(index, quality, width, height, machine, bodies) -> dict:
    per = viewpoint_seconds(index, quality, width, height, machine)
    return {
        "per_viewpoint": per,
        "stages": [
            {"id": "upload", "seconds": 0.0},
            {"id": "convert", "seconds": CONVERT_S},
            {"id": "ephemeris", "seconds": EPHEMERIS_S},
            {"id": "scene", "seconds": SCENE_S},
            {"id": "render", "seconds": per * len(bodies)},
        ],
    }
