# Coastal banner

Original artwork generated with the built-in OpenAI image generation tool on 25 October 2026. The user's reference supplied the mood only; no third-party artwork is embedded in the site.

`coastal-banner.webp` is the full panorama (2172 × 724); `coastal-banner-small.webp` is the mobile variant (960 × 320). Both are served locally with responsive image selection.

## Generation prompt

Use case: stylized-concept. Asset type: original panoramic background banner for the top 18% of a minimal developer portfolio. Create a beautiful hand-painted Mediterranean coastal landscape, inspired by traditional gouache animation background paintings. Turquoise bay, distant layered blue mountains, warm ivory and terracotta coastal village, olive-green headlands, luminous blue sky with sculptural cream summer clouds. Original composition, not a copy of the supplied reference: a sweeping crescent bay with a small lighthouse on a low rocky headland near center-right, clustered sunlit homes and cypress trees toward the far right, open blue water left and center. Sophisticated visible brush texture, atmospheric perspective, calm expansive summer mood. Very wide horizontal panorama, 3:1 aspect ratio at high resolution. IMPORTANT: compose a broad low horizon, all important landforms and village in the central horizontal band so it remains beautiful cropped into a very shallow 8:1 website strip. Keep the sky to about 40% and water and coast to about 60%. No text, no logos, no people, no border, no UI. Warm paper-like highlights, natural azure and sea-green tones, avoid neon oversaturation.

## Scene layers

`scene/` draws the banner with WebGL2 instead of the `<img>`, so parts of the painting can later move on their own. Until something moves it looks identical to the `<img>`, which stays underneath as the fallback. `build_scene.py` derives the layers below from `coastal-banner.webp`, which it never changes; run it again whenever the painting changes. It needs numpy, pillow, scipy, scikit-image, scikit-learn and opencv-python-headless.

| File | What it holds |
| --- | --- |
| `scene/mattes.png` | Soft mattes, full size: R water, G sky, B foliage |
| `scene/fields.png` | Half size: R distance from shore, G cloud density, B how freely foliage moves |
| `scene/groups.png` | Half size: which tree or bush each foliage pixel belongs to |
| `scene/leaves.png` | The foliage alone, premultiplied by its matte |
| `scene/plate.webp` | The painting with the foliage removed and the background filled in |
| `scene/water-under.webp`, `scene/sky-under.webp` | Sea and sky continued under the land, for motion near their edges |

Add `?scene=mattes` (or `water`, `sky`, `foliage`, `groups`, `flex`, `shore`, `clouds`, `plate`) to the address to see one layer, `?scene=probe` to shift each region by a few pixels, `?scene=composite` for every layer on and still, and `?scene=off` for the plain `<img>`.
