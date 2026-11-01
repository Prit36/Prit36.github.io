// Starts the landscape renderer once the page has loaded and gone quiet, so
// it never competes with the first paint. Until it is ready, and for good if
// it can't start, the banner is the plain <img>.
//
// The sea and the trees move; the rest of the painting holds still for now.
//
// ?scene=... in the address picks a view for checking the layers:
//   off       the plain <img>, no renderer
//   composite every system on, holding still (must look like "off")
//   probe     every region shifted sideways by a few pixels, alone
//   mattes, water, sky, foliage, trees, flex, shore, clouds, plate,
//   depth, foam, light, exposure
//             one layer of the scene preparation

import manifest from "./manifest.js";
import { LandscapeScene } from "./scene.js";
import { SYSTEMS } from "./systems.js";
import { DEBUG_VIEWS } from "./shaders.js";

const root = document.querySelector(".landscape");
const view = new URLSearchParams(location.search).get("scene");

const LIVING = ["water", "foliage"];

const options = () => {
  const all = Object.keys(SYSTEMS);
  if (view === "composite") return { systems: all, still: true };
  if (view === "probe") return { systems: all, still: true, probe: [10, 10, 8] };
  const debugView = DEBUG_VIEWS.indexOf(view) + 1;
  return debugView ? { debugView } : { systems: LIVING };
};

const begin = async () => {
  const scene = new LandscapeScene(root, manifest, options());
  if (await scene.start()) {
    root.scene = scene;
    if (view) window.landscapeScene = scene;
  }
};

if (root && view !== "off" && "createImageBitmap" in window) {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
  const go = () => idle(begin, { timeout: 1500 });
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
