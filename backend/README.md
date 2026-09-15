# Render service

The backend for VTK → Frames. It takes one `.vtk` timestep and returns one
equirectangular frame per viewpoint, by running the real pipeline: VTK → VDB on
the pinned grid, camera placement from Solar-MACH, the template scene in
Blender, and Cycles. It also serves the built dashboard and the archived renders,
so on the GPU box it is the only process to start.

```bash
cd backend
python3 serve.py --check     # can this machine render? exits 0 if yes
python3 serve.py             # http://localhost:8000
```

**Standard library only.** There is nothing to `pip install`. The box has no
sudo and no curl, and FastAPI was not installed on either machine, so the
service uses `http.server`, `sqlite3` and `subprocess`. The API is the one from
`SOLAR_WIND_CME_GUIDE.md` §10, so swapping in FastAPI later would change only
`btp_render/api.py`. It runs on Python 3.9 and later; the box has 3.10.

The dashboard finds the service by itself. Under `npm run dev`, Vite forwards
`/api` to `127.0.0.1:8000`. If nothing answers, VTK → Frames falls back to its
simulator and says so on the intake panel. Reload the page after starting the
service.

---

## Running it

### On the Mac

```bash
python3 serve.py
```

Then either open `http://localhost:8000` (the built dashboard), or run
`npm run dev` in `frontend/` as usual. `--check` should list every
item as `ok`.

### On the GPU box

1. Copy `config.example.json` to `config.json` and fix the paths. The box still
   uses the old `~/BTP_SolarWindCME/` layout, and its Blender and Python
   environments are in different places from the Mac's. The paths in the
   example are placeholders, not checked on the box; `python3 serve.py --check`
   marks every one that is wrong.
2. Give `renders_dir` the Mac's folder layout. The 360 viewer asks for
   `cme_360/<Body>.mp4`, `cme_360_proxy/`, `cme_360_thumb/`, `cme_360_still/`
   and `fieldlines_360/`. The box's `Renders360/` uses other names, so copy the
   Mac's `Vandan/output/renders` over (about 10 GB) or symlink the box's folders
   to those names. This only affects the 360 viewer; VTK → Frames does not need it.
3. Pin the grid on the box too. It must match the archived volumes there:
   ```bash
   <python with openvdb> tools/pin_grid.py --vtk <...>/data.0000.vtk \
                                           --vdb <...>/data.0000.vdb --out grid.json
   ```
4. Build the dashboard (`npm run build` in `frontend/`), or copy
   `frontend/dist` over.
5. Start it under tmux, so a dropped SSH session does not stop a render:
   ```bash
   tmux new -s btp 'python3 serve.py'
   ```
6. Open `http://10.206.2.253:8000/?token=<token>` once. The token is kept for
   the rest of that browser tab.

Before a demo, run a real job end to end:

```bash
python3 tools/smoke_test.py --url http://10.206.2.253:8000 --token <token>
```

---

## What a job does

| stage | runs | where |
|---|---|---|
| convert | `stages/convert_vtk.py` | the Python with openvdb |
| ephemeris | `camera_positions.csv`, or `stages/solarmach_positions.py` | the Python with solarmach |
| scene, render | `stages/render_viewpoints.py` | Blender, one process for all viewpoints |
| finish | ffmpeg thumbnails and 2048 px stills | ffmpeg |

- **The voxel grid is pinned.** `grid.json` holds the bounds, voxel size and
  origin derived from `data.0000.vtk`. `tools/pin_grid.py` refuses to write it
  unless they match the archived `data.0000.vdb`. An uploaded file is resampled
  onto that grid, never its own bounds, so the volume lands where the Sun,
  planets and cameras are. Converting `data.0170.vtk` this way reproduces the
  archived volume to within float rounding.
- **The template is corrected, not trusted.** `render_viewpoints.py` opens
  `SolarWindCME_space.blend` and then:
  - switches the volume from a 201-file sequence with `frame_offset = -1` to one
    static file;
  - clears the camera and planet keyframes and places them for this date;
  - rebuilds the volume material from the constants in `BuildSpaceScene.py`;
  - sets the Standard view transform.

  The Mac's copy of the template still has density 15.0, emission 4.0 and AgX.
  With the correction, its render matches the approved frame.
- **Timesteps use the CSV; other dates query Solar-MACH.** A date within a
  minute of one of the 201 timesteps uses `camera_positions.csv`, which is
  Solar-MACH's output for exactly that date. Any other date is queried live. If
  that fails inside the run's window, the nearest timestep is used, and the job
  carries a warning the dashboard shows.
- **An archived timestep without a `.vtk` uses its `.vdb`.** The Mac has only
  the step-10 `.vtk` files but all 201 converted volumes. Those volumes were made
  on the same pinned grid, so using one does not bypass the grid rule.
- **One job at a time, one viewpoint at a time.** The A30 is shared and has
  already run out of memory once because of another user. Jobs queue in SQLite.
- **Jobs survive restarts.** Ctrl-C stops Blender and puts the running job back
  in the queue. On the next start it resumes: a converted volume is not
  converted again, and a finished viewpoint is not rendered again.
- **Progress is Cycles' own.** A `render_stats` handler forwards Cycles' sample
  count and remaining time, so the ring and ETA come from the render rather than
  a guess. Before rendering starts, the ETA comes from `btp_render/cost.py`,
  which is a port of the frontend's `cost.js`. Change the two together.

---

## API

| method | path | |
|---|---|---|
| GET | `/api/health` | readiness checks, queue depth, free GPU memory where `nvidia-smi` exists |
| POST | `/api/jobs` | submit; returns `202 {job_id}` straight away |
| GET | `/api/jobs/{id}` | the job, in the shape the dashboard polls |
| GET | `/api/jobs/{id}/log` | the full log as text |
| GET | `/api/jobs/{id}/artifacts` | the frames |
| GET | `/api/jobs/{id}/artifacts/{Body}.png` | a frame; also `_thumb.jpg`, `_still.jpg` |
| DELETE | `/api/jobs/{id}` | cancel if running, then delete its files |
| GET | `/media/...` | the archived renders, with HTTP Range |
| GET | `/` | the built dashboard |

There are three ways to submit:

```bash
# an uploaded file: the raw body, settings in the query string
curl -X POST --data-binary @data.0184.vtk -H 'Content-Type: application/octet-stream' \
  'localhost:8000/api/jobs?filename=data.0184.vtk&viewpoints=Earth,Mars&quality=preview&resolution=full'

# an archived timestep
curl -X POST -H 'Content-Type: application/json' localhost:8000/api/jobs \
  -d '{"archived_index": 169, "viewpoints": "Earth", "quality": "preview", "resolution": "half"}'

# the volume an earlier job converted, e.g. again at 4096 spp
curl -X POST -H 'Content-Type: application/json' localhost:8000/api/jobs \
  -d '{"reuse_job": "<id>", "viewpoints": "Earth", "quality": "publication", "resolution": "full"}'
```

Settings in all three:
- **`viewpoints`**: any of Mercury, Venus, Earth, Mars.
- **`quality`**: `preview` (256 spp) or `publication` (4096).
- **`resolution`**: `full` (4096×2048) or `half` (2048×1024).
- **`datetime`**: UTC, `YYYY-MM-DD HH:MM`. Optional when the filename or
  `archived_index` names a timestep.

An upload is the raw body rather than multipart. It streams to disk in 1 MB
pieces, and it is refused before it is written if the first bytes are not a
legacy VTK header.

---

## Security

Every file the service serves is resolved and checked to be inside its one
directory: `frontend/dist`, the renders folder, or a job's own results folder.
Paths that escape get 403. This rule comes from the day a test server started
in `~` exposed the whole home directory to the campus network.

On the box, set `token` in `config.json`. Submitting and cancelling then need
`Authorization: Bearer <token>`. The service warns at startup if it listens on
every interface without one. It defaults to `127.0.0.1`, which only this
machine can reach.

---

## Layout

```
backend/
├── serve.py                 entry point
├── grid.json                the pinned voxel grid
├── config.example.json      paths for the GPU box
├── btp_render/
│   ├── api.py               HTTP routes, uploads, static files with Range
│   ├── worker.py            the queue and the stages
│   ├── jobs.py              SQLite job table
│   ├── runner.py            child processes, cancellation, @@ markers
│   ├── cost.py              ETA model (port of frontend cost.js)
│   ├── ephemeris.py         timestep dates, CSV lookup
│   ├── health.py            readiness checks, nvidia-smi
│   └── config.py            defaults and config.json
├── stages/                  run inside other interpreters
│   ├── convert_vtk.py       openvdb Python
│   ├── solarmach_positions.py   solarmach Python
│   └── render_viewpoints.py     Blender
├── tools/
│   ├── pin_grid.py
│   └── smoke_test.py
└── storage/                 uploads/, results/, jobs.sqlite (the last 40 jobs)
```

## Troubleshooting

- **`--check` says `convert_env` or `ephemeris_env` timed out, but the
  interpreter works in a terminal.** macOS may be blocking the process from
  reading `~/Documents`. This happens when something other than Terminal starts
  it, for example an app's launcher. Start it from Terminal, or grant that app
  access to the Documents folder in System Settings › Privacy & Security.
- **The dashboard still says "Simulated".** It checks for the service once per
  tab. Reload the page after starting the service.
- **A job fails with "no CUDA device" on the box.** Another process may be
  holding the GPU. `/api/health` reports free memory per card.
