// The parts of the painting that can move on their own. Each is a region of
// the painting, found by build_scene.py, with the layers it needs to move
// without disturbing its neighbours:
//
//   water    moves only inside its matte, so rocks, sand and the headland
//            never ripple; where it is drawn from a little past the shore,
//            the sea carried on under the land (waterUnder) is what shows.
//            Shore distance says where the sea meets land.
//   sky      the same, behind the mountains, the bell tower and the
//            cypresses (skyUnder); cloud density says where there is cloud.
//   foliage  is lifted off (leaves, premultiplied) and moved over what was
//            behind it, so a tree that sways uncovers the wall or the sky
//            from the clean plate, not itself; flex says how freely each part
//            moves and group which tree it belongs to.
//
// A system costs nothing until it has motion: its textures are not loaded
// and its branch is not compiled into the shader. Birds and haze will draw
// over the painting in their own passes, using the same mattes to pass
// behind the cypresses and the hills.

export const SYSTEMS = {
  water: { define: "WATER", textures: ["mattes", "fields", "waterUnder"] },
  sky: { define: "SKY", textures: ["mattes", "fields", "skyUnder"] },
  foliage: { define: "FOLIAGE", textures: ["mattes", "fields", "groups", "plate", "leaves"] },
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
