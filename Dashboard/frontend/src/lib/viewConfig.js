/**
 * HOW THE GALAXY IS FRAMED
 * ========================
 * Every number that controls the camera and the angle of the disc lives here,
 * and nothing else defines them. Change a value, save, and Vite reloads.
 *
 * The particle field, the planets and the orbit ring all read these live, so
 * they cannot fall out of agreement with each other.
 */
export const VIEW = {
  /**
   * Inclination of the disc, in radians.
   * This is the one you want. The disc is drawn as an ellipse whose height is
   * `sin(discTilt)` times its width:
   *
   *   0.00  edge-on, a flat line
   *   0.30  a very shallow ellipse, seen almost from the side
   *   0.52  half as tall as it is wide
   *   0.79  current -- about seven tenths as tall as wide
   *   1.00  nearly circular, looking straight down onto the disc
   *   1.57  exactly face-on
   *
   * Negative tips the far side of the disc away from you, which is what puts
   * the near edge along the bottom of frame. Flip the sign to look from below.
   */
  discTilt: 0.79,

  /** How far back the camera sits on the select screen. Smaller = galaxy fills more frame. */
  camDistance: 20.5,

  /** Camera height. Positive lifts the camera, so you look down on the disc more. */
  camHeight: -6,

  /** Where the camera points. Positive moves the galaxy down in frame. */
  lookAtY: -2.25,

  /** Rotation speed of the disc once it has settled. */
  spin: 0.67,
};
