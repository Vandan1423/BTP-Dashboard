/**
 * Vandan's project page.
 *
 * The shared factory in ui/ProjectPage.js builds the chrome from this project's
 * `sections` in src/lib/projects.js -- back control, wordmark, and the dock of
 * circular buttons along the bottom. Everything below is about what goes inside
 * one of those sections.
 *
 * `viewer` opens the 360 section: an overview with the orbital map, and the
 * immersive player behind whichever planet you pick.
 *
 * `pipeline` opens feature two: upload one `.vtk` timestep and get a frame per
 * viewpoint back, with the conversion, the camera placement and the render
 * drawn as one continuous scene while it runs.
 *
 * Both are returned as `{ element, dispose }` and not as bare elements, because
 * both own things the browser keeps running on its own -- a video decoding a
 * 4096x2048 stream, a scene borrowed from the shared Stage, a job being polled.
 * All of it has to be handed back the moment the visitor clicks a different
 * section button, not merely hidden.
 */
import { createProjectPage } from '../../ui/ProjectPage.js';
import { createViewerSection } from './viewer/ViewerSection.js';
import { createPipelineSection } from './pipeline/PipelineSection.js';

const SECTIONS = {
  viewer: createViewerSection,
  pipeline: createPipelineSection,
};

export default createProjectPage({
  // Both sections resume where the visitor left them, so the page should too:
  // a reload in the middle of a render lands back on the render.
  rememberSection: true,
  renderSection(section, { stage }) {
    const build = SECTIONS[section.id];
    if (!build) return null;
    const s = build({ stage });
    return { element: s.element, dispose: () => s.destroy() };
  },
});
