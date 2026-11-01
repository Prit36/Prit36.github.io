// The parts of the painting that can move on their own. Each is a region of
// the painting, found by build_scene.py, with the layers it needs to move
// without disturbing its neighbours:
//
//   water    moves only inside its matte, so rocks, sand and the headland
//            never ripple; where it is drawn from a little past the shore,
//            the sea carried on under the land (waterUnder) is what shows.
//            How shallow it looks sets how it moves; the distance to the
//            shore, in metres on the water, brings small waves in to the
//            rocks and the beach and leaves foam where they break.
//   sky      the same, behind the mountains, the bell tower and the
//            cypresses (skyUnder); cloud density says where there is cloud.
//   foliage  is lifted off (leaves, premultiplied) and moved over what was
//            behind it, so a tree that sways uncovers the wall or the sky
//            from the clean plate, not itself. The tree map says which tree
//            each leaf belongs to, how far out along it it is (so trunks hold
//            still and tips move most, and nothing slides out over a roof in
//            front of it) and how exposed it is.
//
// A system costs nothing until it is switched on: its textures are not
// loaded and its branch is not compiled into the shader. One that moves has
// a Motion: stepped with the shared environment while the scene animates,
// and asked for its uniforms each frame. Birds and haze will draw over the
// painting in their own passes, using the same mattes to pass behind the
// cypresses and the hills.

import { Sea } from "./water.js";
import { Foliage } from "./foliage.js";

export const SYSTEMS = {
  water: { define: "WATER", textures: ["mattes", "fields", "waterUnder", "water"], Motion: Sea },
  sky: { define: "SKY", textures: ["mattes", "fields", "skyUnder"] },
  foliage: { define: "FOLIAGE", textures: ["mattes", "trees", "plate", "leaves"], Motion: Foliage },
};

// What the shader needs for a set of switched-on systems.
export function requirements(active) {
  const textures = new Set(), defines = [];
  for (const id of active) {
    const sys = SYSTEMS[id];
    defines.push(sys.define);
    sys.textures.forEach((t) => textures.add(t));
  }
  return { textures: [...textures], defines };
}
