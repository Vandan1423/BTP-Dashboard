/**
 * Sakshi's project page: SEP proton-flux forecasting from relativistic
 * electron measurements.
 *
 * `overview` uses the shared factory's default title/body panel (from the
 * `sakshi` entry in src/lib/projects.js). `forecast` is a form (date range +
 * model) that, on submit, swaps itself out for the Sun-to-Earth scene built
 * by forecast/SunEarthScene.js -- see forecast/ForecastSection.js for the
 * two-step flow. It owns its own three.js scene once a result is showing
 * (borrowed from the Stage via setView) and is torn down via `dispose` on
 * every section switch and page leave.
 */
import { createProjectPage } from '../../ui/ProjectPage.js';
import { createForecastSection } from './forecast/ForecastSection.js';

const SECTIONS = {
  forecast: createForecastSection,
};

export default createProjectPage({
  renderSection(section, { stage }) {
    const build = SECTIONS[section.id];
    if (!build) return null;
    const s = build({ stage });
    return { element: s.element, dispose: () => s.destroy() };
  },
});
