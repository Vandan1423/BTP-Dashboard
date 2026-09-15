# Data not in the repository

Everything needed to view the results and run a render is committed. What is left
out is either larger than GitHub accepts or can be rebuilt from what is here.

| Folder | Size | Why it is left out | What needs it |
|---|---|---|---|
| `input/vtk/` | 2.1 GB, 21 files | Each file is 102 MB, over GitHub's 100 MB limit | Re-running the pipeline; uploading a real `.vtk` to VTK → Frames |
| `input/vdb/` (all but 4) | 5.3 GB, 201 files | Too large; rebuilt from the `.vtk` | Archived renders at timesteps other than 0, 10, 169, 170 |
| `input/ply/` | 723 MB | Rebuilt by `scripts/fieldlines/TraceFieldLines.py` | The field-line scene |
| `output/renders/cme_360/<Body>/`, `fieldlines_360/<Body>/` | 7.8 GB | 804 PNGs at 4096×2048 each | The "Download PNG" button and full-resolution views in VTK → Frames |
| `output/experiments/` | 2 GB | Lighting and density test renders; nothing reads them | Nothing |
| `output/renders/cme_flat/` | 61 MB | The old flat 1920×1080 set, kept for reference | Nothing |
| `unity/*/Library/` and `Logs/` | 6.7 GB | Unity rebuilds them when the project opens | Nothing |

**Committed and enough to run:**
- **Renders the dashboard plays:** the eight videos, `cme_360_proxy/`,
  `cme_360_thumb/` and `cme_360_still/`.
- **Pipeline:** every script, the Blender scenes, the Solar-MACH ephemeris CSV,
  and four converted volumes (timesteps 0, 10, 169 and 170).
- **Unity:** both projects' `Assets/`, `Packages/` and `ProjectSettings/`.
- **Environments:** the Python environment specs in `environment/`.

## Getting the full data

Ask Vandan for a copy of the folders above, and put them at the same paths inside
`Vandan/`. The scripts find everything by path relative to themselves, so nothing
needs configuring.

The GPU box (`10.206.2.253`) has the complete set under the old
`~/BTP_SolarWindCME/` layout, including all 201 `.vtk` files.

To rebuild instead of copying, see `docs/PIPELINE_COMMANDS.md`. The volumes come
from the `.vtk` files, so those are the one thing that has to be copied.
