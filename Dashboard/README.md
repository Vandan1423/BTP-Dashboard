# Dashboard

One site, three BTP projects. A circular BEGIN button on near-black opens into a
galaxy; three planets orbit it, one per project. Click one and the camera dives
through the disc onto that project's page.

```bash
cd Dashboard/frontend
npm install
npm run dev        # http://localhost:5173
```

Set `PORT` to run a second copy alongside the first.

## What your part needs

Nothing outside this folder. Clone the BTP repository, `npm install`,
`npm run dev`, and build your page. Vandan's sections read from `../Vandan`
in the same repository: the 360 viewer plays the videos committed there, and
the render service runs his pipeline. The raw simulation data is not in the
repository; see `Vandan/DATA.md`.

**Everything else is documented in [`frontend/README.md`](frontend/README.md)** --
how to claim your planet, how to write your page, how to draw in 3D, and how the
particle field works. That file sits next to the code it describes, so it is the
one that stays true. This one exists only to point at it.

`backend/` is the render service behind Vandan's VTK → Frames section: it runs
the real conversion, camera placement and Blender render for an uploaded
timestep, and it also serves the built site. Standard-library Python, nothing to
install:

```bash
cd Dashboard/backend
python3 serve.py            # http://localhost:8000
```

With it stopped, VTK → Frames falls back to a simulator and says so on screen.
Everything else is a pure frontend. See [`backend/README.md`](backend/README.md).
