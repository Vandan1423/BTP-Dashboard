/**
 * Sakshi's project page.
 *
 * The shared factory builds the whole page from this project's `sections` in
 * src/lib/projects.js -- back control, wordmark, text, and the bottom dock with
 * one button per section. Adding a section there adds a button here.
 *
 * When a section needs to render something richer than text -- a viewer, an
 * upload form, a chart -- pass `renderSection` and return an element for that
 * section's id. Returning null keeps the default title and body.
 *
 *     export default createProjectPage({
 *       renderSection(section, { project, stage, navigate }) {
 *         if (section.id !== 'viewer') return null;
 *         const el = document.createElement('div');
 *         el.textContent = 'my viewer';
 *         return el;
 *       },
 *       onLeave() { ... },     // dispose anything you created
 *     });
 */
import { createProjectPage } from '../../ui/ProjectPage.js';

export default createProjectPage();
