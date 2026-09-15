"""Build input/vdb_sequence/ as contiguously-numbered hard links into input/vdb/.

Blender's volume-sequence mechanism increments a filename's digit run by exactly
1 per frame. Real timestep numbering does not have to cooperate - the step-10
dataset was data.0000, 0010, ... 0200, which Blender cannot follow. This makes a
parallel directory of contiguous names pointing at the same bytes.

HARD links, not symlinks: Blender resolves a symlink to its target's real
directory before working out sibling filenames, which silently breaks the
sequence. Hard links cost no extra disk - both names refer to one set of blocks.

Safe to re-run; it rebuilds the link set from scratch each time.

    python scripts/pipeline/MakeVdbSequence.py
"""

import glob
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
SRC_DIR = os.path.join(BASE_DIR, "input", "vdb")
DST_DIR = os.path.join(BASE_DIR, "input", "vdb_sequence")

files = glob.glob(os.path.join(SRC_DIR, "data.*.vdb"))
if not files:
    raise SystemExit(f"No data.*.vdb found in {SRC_DIR} - run VtkToVdbPipeline.py first")

indices = sorted(int(re.search(r"data\.(\d+)\.vdb$", f).group(1)) for f in files)
print(f"{len(indices)} VDB files, timesteps {indices[0]}..{indices[-1]}")

os.makedirs(DST_DIR, exist_ok=True)
for stale in glob.glob(os.path.join(DST_DIR, "data.*.vdb")):
    os.remove(stale)

for position, idx in enumerate(indices):
    src = os.path.join(SRC_DIR, f"data.{idx:04d}.vdb")
    dst = os.path.join(DST_DIR, f"data.{position:04d}.vdb")
    os.link(src, dst)

print(f"Linked -> {DST_DIR}/data.0000.vdb .. data.{len(indices)-1:04d}.vdb")
print("Reminder: BuildScene.py sets frame_offset = -1 because these start at 0000, "
      "while Blender numbers sequence frames from 1.")
