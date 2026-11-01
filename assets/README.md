# Coastal banner

Original artwork generated with the built-in OpenAI image generation tool on 25 October 2026. The user's reference supplied the mood only; no third-party artwork is embedded in the site.

`coastal-banner.webp` is the full panorama (2172 × 724); `coastal-banner-small.webp` is the mobile variant (960 × 320). Both are served locally with responsive image selection.

## Generation prompt

Use case: stylized-concept. Asset type: original panoramic background banner for the top 18% of a minimal developer portfolio. Create a beautiful hand-painted Mediterranean coastal landscape, inspired by traditional gouache animation background paintings. Turquoise bay, distant layered blue mountains, warm ivory and terracotta coastal village, olive-green headlands, luminous blue sky with sculptural cream summer clouds. Original composition, not a copy of the supplied reference: a sweeping crescent bay with a small lighthouse on a low rocky headland near center-right, clustered sunlit homes and cypress trees toward the far right, open blue water left and center. Sophisticated visible brush texture, atmospheric perspective, calm expansive summer mood. Very wide horizontal panorama, 3:1 aspect ratio at high resolution. IMPORTANT: compose a broad low horizon, all important landforms and village in the central horizontal band so it remains beautiful cropped into a very shallow 8:1 website strip. Keep the sky to about 40% and water and coast to about 60%. No text, no logos, no people, no border, no UI. Warm paper-like highlights, natural azure and sea-green tones, avoid neon oversaturation.

## Scene layers

`scene/` draws the banner with WebGL2 instead of the `<img>`, so parts of the painting can move on their own. So far the sea and the trees do. The sea has swell and wind ripples, small waves breaking along the rocks and the beach, and a few glints where the painting already has sunlight on the water. The trees and bushes around the village and on the headland answer the same breeze: gusts come in off the sea and reach them a few seconds later, each tree bends from its trunk and its branches follow a moment late, and between gusts they come back to rest exactly where they were painted. Both pause when the banner is hidden or scrolled away and hold still for reduced motion. Held still, it looks exactly like the `<img>`, which stays underneath as the fallback. `build_scene.py` derives the layers below from `coastal-banner.webp`, which it never changes; run it again whenever the painting changes. It needs numpy, pillow, scipy, scikit-image, scikit-learn and opencv-python-headless.

| File | What it holds |
| --- | --- |
| `scene/mattes.png` | Soft mattes, full size: R water, G sky, B foliage |
| `scene/fields.png` | Half size: R how shallow the water looks, G cloud density |
| `scene/water.png` | Full size: R distance to the shore in metres on the sea (square-root encoded, up to 24 m), G painted foam, B painted sunlight on the water |
| `scene/trees.png` | Half size: R which tree or bush each bit of foliage belongs to (the trees are listed in `build_scene.py` by their trunks), G how far out along its tree it is, 0 at the trunk and wherever it goes behind a roof or a wall, B how exposed it is, 1 at the crown's edge |
| `scene/leaves.png` | The foliage alone, premultiplied by its matte |
| `scene/plate.webp` | The painting with the foliage removed and the background filled in |
| `scene/water-under.webp`, `scene/sky-under.webp` | Sea and sky continued under the land, for motion near their edges |

Add `?scene=mattes` (or `water`, `sky`, `foliage`, `trees`, `flex`, `exposure`, `shore`, `clouds`, `plate`, `depth`, `foam`, `light`) to the address to see one layer, `?scene=probe` to shift each region by a few pixels, `?scene=composite` for every layer on and still (the sea and the trees held still), and `?scene=off` for the plain `<img>`.
