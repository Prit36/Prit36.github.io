"""Prepare the coastal banner painting for selective animation.

The painting is one flattened image. This splits it, without touching it, into
the layers a renderer needs to move parts of it on their own:

    assets/scene/mattes.png   R water, G sky, B foliage. Soft alpha at the
                              painting's full size, edges snapped to the brushwork.
    assets/scene/fields.png   R how shallow the water looks, G cloud density
                              inside the sky, B how freely each bit of
                              foliage may move (0 at the trunk). Half size;
                              these only change slowly.
    assets/scene/water.png    R distance to the shore in metres on the water
                              (square-rooted, to keep detail close in), G the
                              painted foam along the shore, B where the
                              painting has light on the water.
    assets/scene/groups.png   Which tree or bush each foliage pixel belongs to,
                              so neighbouring trees can sway out of step. Half
                              size, sampled without filtering.
    assets/scene/plate.webp   The painting with its foliage taken out and the
                              walls, hills and sky behind filled in, for what a
                              swaying tree uncovers.
    assets/scene/water-under.webp, sky-under.webp
                              The sea and the sky carried on under the land
                              beside them, so water or cloud drifting a little
                              way past a rock or a cypress still has water or
                              sky to show. Half size; they are smooth fills.
    assets/scene/leaves.png   The foliage itself, premultiplied by its matte:
                              paint - (1 - a) * plate. Filtered on the GPU it
                              stays exact between pixels, which paint, plate
                              and matte filtered separately would not.
    scene/manifest.js         Describes all of the above for the renderer.

Each region starts from a hand-traced outline in painting pixels (the SHORE,
SKYLINE and ZONES below), which only says roughly where things are. The exact
edges come from the paint itself: a classifier trained on the pixels the
outlines are sure about labels the uncertain band along each edge, and a
guided filter turns that into a soft matte that follows the brushwork.

Needs numpy, pillow, scipy, scikit-image, scikit-learn and
opencv-python-headless. Run from this folder:

    python build_scene.py               # write the assets
    python build_scene.py --preview DIR # also write overlays to check them
"""

import argparse
import io
import json
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import color, feature, segmentation
from sklearn.ensemble import HistGradientBoostingClassifier

ROOT = Path(__file__).parent
SOURCE = ROOT / "assets" / "coastal-banner.webp"
OUT = ROOT / "assets" / "scene"
MANIFEST = ROOT / "scene" / "manifest.js"

# Hand-traced, in pixels of the 2172 x 724 painting. Rough on purpose: the
# classifier decides the last BAND pixels on either side.
BAND = 20

# Foliage: how far past a crown's hard edge its soft edge may reach, and
# how far past it its motion fields carry, in pixels.
EDGE = 3
REACH = 16

# The right-hand coast, land to the right, from the inner beach down past
# the boulders to the bottom edge.
SHORE = [(1440, 404), (1470, 412), (1510, 418), (1545, 428), (1557, 442), (1590, 446), (1629, 448),
         (1680, 451), (1721, 456), (1760, 460), (1807, 467), (1845, 474), (1879, 482), (1910, 492),
         (1936, 502), (1950, 512), (1935, 520), (1905, 524), (1880, 532), (1850, 538), (1820, 542),
         (1793, 545), (1760, 554), (1738, 568), (1718, 590), (1707, 607), (1712, 625), (1740, 632),
         (1790, 628), (1821, 626), (1845, 640), (1850, 664), (1821, 671), (1850, 684), (1879, 693),
         (1893, 724)]
LAND = SHORE + [(2172, 724), (2172, 360), (1440, 360)]

# Below the lighthouse headland and the inner beach there is only sea, with
# the headland's reflection in it.
SEA_BELOW = (1000, 1480, 426)

# The far edge of the sea. The far coast, the islands and the open horizon
# all meet the water close to this row; each column finds its own.
HORIZON = 376

# The skyline: the open horizon, the islands, the hills and the mountains,
# with the bell tower poking above them. The cypresses that rise into the sky
# are cut out of it by the foliage matte instead.
SKYLINE = [(0, 374), (95, 374), (105, 369), (118, 374), (140, 373), (160, 355), (175, 347), (195, 352),
           (235, 372), (250, 366), (285, 362), (300, 356), (320, 364), (345, 350), (375, 343), (400, 326),
           (440, 315), (470, 318), (520, 300), (575, 284), (610, 293), (638, 297), (665, 282), (710, 280),
           (798, 282), (847, 271), (902, 242), (935, 244), (979, 235), (1023, 244), (1060, 236), (1100, 224),
           (1162, 214), (1218, 229), (1291, 252), (1347, 246), (1397, 232), (1442, 246), (1498, 241),
           (1538, 224), (1582, 221), (1638, 224), (1694, 213), (1779, 204), (1857, 183), (1902, 176),
           (1947, 187), (1990, 193), (2003, 178), (2012, 192), (2050, 196), (2095, 190), (2172, 182)]

# Where foliage near enough to move grows. The distant hills are covered in
# trees too, but at that distance they hold still, so they are left out.
ZONES = {
    # The village, its cypresses and the olive and scrub over the rocks.
    "village": [(1440, 340), (1560, 318), (1650, 300), (1760, 286), (1840, 280), (1905, 255),
                (1935, 205), (1945, 110), (2172, 100), (2172, 724), (1893, 724), (1880, 693),
                (1900, 600), (1950, 512), (1810, 470), (1620, 448), (1440, 420)],
    # The umbrella pines on the lighthouse headland, and the cypress and
    # trees by the houses at its far end.
    "headland": [(1090, 312), (1340, 312), (1440, 330), (1440, 396), (1380, 396), (1340, 356),
                 (1090, 356)],
}

# Points of the painting the scene is arranged around.
LANDMARKS = {"lamp": [1164, 329], "horizon": HORIZON}

# The sea is a flat plane seen from a little above it: a pixel of it near the
# bottom of the painting is a couple of centimetres across, one near the
# horizon metres. Distances along the water, and the waves on it, are
# measured on that plane, not on the picture. In painting pixels, except the
# eye's height, which is in metres. The renderer uses the same numbers.
#
# True perspective squashes the far water into the view by focal / d, d the
# rows below the horizon: thirty times over at the headland. The painter
# didn't: the foam at the headland's foot is a few pixels tall. So the squash
# stops growing at `stretch`, beyond which a row of far water is `stretch`
# times as deep as it is wide.
SEA_VIEW = {"horizon": 374, "centre": 1086, "focal": 800, "eye": 6, "stretch": 3}
# How far out from the shore its distance is kept, in metres.
SHORE_REACH = 24


def load():
    img = Image.open(SOURCE).convert("RGB")
    return np.asarray(img).astype(np.float32) / 255


def polygon(shape, pts):
    m = Image.new("L", shape[::-1], 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in pts], fill=1)
    return np.asarray(m).astype(bool)


def distance_to_line(shape, pts):
    m = Image.new("L", shape[::-1], 0)
    ImageDraw.Draw(m).line([tuple(p) for p in pts], fill=1, width=1)
    return ndi.distance_transform_edt(~np.asarray(m).astype(bool))


def below_line(shape, pts):
    """True below a polyline that spans the full width."""
    h, w = shape
    xs = np.arange(w)
    ys = np.interp(xs, [p[0] for p in pts], [p[1] for p in pts])
    return np.arange(h)[:, None] > ys[None, :]


class Painting:
    def __init__(self, rgb):
        self.rgb = rgb
        self.shape = rgb.shape[:2]
        h, w = self.shape
        self.yy, self.xx = np.mgrid[0:h, 0:w]
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        self.r, self.g, self.b = r, g, b
        self.v = rgb.max(-1)
        self.s = (self.v - rgb.min(-1)) / (self.v + 1e-6)
        # Colour, the colour around it at three scales, and how busy it is:
        # enough for a pixel to be told apart by its surroundings, the way
        # sand seen through shallow water is.
        lab = color.rgb2lab(rgb).astype(np.float32)
        feats = [lab]
        for sigma in (2, 6, 16):
            feats.append(np.stack([ndi.gaussian_filter(lab[..., c], sigma) for c in range(3)], -1))
        light = lab[..., 0]
        mean = ndi.gaussian_filter(light, 3)
        spread = np.sqrt(np.maximum(ndi.gaussian_filter(light * light, 3) - mean * mean, 0))
        feats.append(spread[..., None])
        self.features = np.concatenate(feats, -1).reshape(h * w, -1)

    def classify(self, yes, no, where, n=150_000, seed=1):
        """Probability that each pixel in `where` belongs with `yes`."""
        rng = np.random.default_rng(seed)
        pos = np.flatnonzero((yes & ~no).ravel())
        neg = np.flatnonzero((no & ~yes).ravel())
        pos = rng.choice(pos, min(len(pos), n), replace=False)
        neg = rng.choice(neg, min(len(neg), n), replace=False)
        clf = HistGradientBoostingClassifier(max_iter=200, max_leaf_nodes=31, random_state=seed)
        clf.fit(self.features[np.r_[pos, neg]], np.r_[np.ones(len(pos)), np.zeros(len(neg))])
        out = np.zeros(self.shape[0] * self.shape[1], np.float32)
        idx = np.flatnonzero(where.ravel())
        out[idx] = clf.predict_proba(self.features[idx])[:, 1]
        return out.reshape(self.shape)


def guided(guide, src, radius, eps):
    """He et al.'s colour guided filter: smooths `src` without crossing the
    edges in `guide`."""
    box = lambda a: cv2.boxFilter(a, -1, (2 * radius + 1, 2 * radius + 1), borderType=cv2.BORDER_REFLECT)
    I = guide.astype(np.float64)
    p = src.astype(np.float64)
    mean_i = np.stack([box(I[..., c]) for c in range(3)], -1)
    mean_p = box(p)
    cov_ip = np.stack([box(I[..., c] * p) for c in range(3)], -1) - mean_i * mean_p[..., None]
    var = np.empty(I.shape[:2] + (3, 3))
    for a in range(3):
        for b in range(3):
            var[..., a, b] = box(I[..., a] * I[..., b]) - mean_i[..., a] * mean_i[..., b]
    var += eps * np.eye(3)
    a = np.linalg.solve(var, cov_ip[..., None])[..., 0]
    bias = mean_p - (a * mean_i).sum(-1)
    mean_a = np.stack([box(a[..., c]) for c in range(3)], -1)
    return (mean_a * I).sum(-1) + box(bias)


def matte(p, hard, radius=2, eps=2e-3):
    """A soft matte from a hard mask: the guided filter decides the few
    pixels along the edge, everything else stays exactly 0 or 1."""
    soft = np.clip(guided(p.rgb, hard.astype(np.float32), radius, eps), 0, 1)
    edge = ndi.binary_dilation(hard, iterations=radius + 1) & ~ndi.binary_erosion(hard, iterations=radius + 1)
    out = hard.astype(np.float32)
    out[edge] = soft[edge]
    return out


def drop_small(mask, size, keep=None):
    lab, n = ndi.label(mask)
    sizes = ndi.sum(np.ones_like(lab), lab, np.arange(n + 1))
    small = sizes < size
    small[0] = False
    if keep is not None:
        small[np.unique(lab[keep])] = False
    out = mask.copy()
    out[small[lab]] = False
    return out


def waterline(p):
    """Per column, the first row of open water below the far coast or the
    sky: the last pale or hazy row before a run of saturated blue."""
    h, w = p.shape
    blue = (p.b - p.r > 0.15) & (p.s > 0.3)
    # A run of four blue rows in a row starts the water.
    run = blue.copy()
    for k in range(1, 4):
        run[:-k] &= blue[k:]
    top = np.full(w, HORIZON, np.float32)
    lo, hi = HORIZON - 10, HORIZON + 8
    for x in range(w):
        rows = np.flatnonzero(~blue[lo:hi, x])
        if len(rows):
            y = lo + rows[-1] + 1
            if run[min(y, h - 1), x]:
                top[x] = y
    return ndi.median_filter(top, 9)


def build_water(p):
    h, w = p.shape
    r, g, b, v, s, yy, xx = p.r, p.g, p.b, p.v, p.s, p.yy, p.xx
    land = polygon(p.shape, LAND)
    shore = distance_to_line(p.shape, SHORE)
    band = shore < BAND
    top = waterline(p)
    allowed = yy >= top[None, :]

    foam = (v > 0.78) & (s < 0.22) & (b >= r - 0.01)
    bluish = ((b - r > 0.02) & ((v > 0.55) | (s > 0.35))) | foam
    # Rock, sand and the shadows on them are warm or neutral; even pale
    # water leans blue or green.
    warm = (r >= g - 0.02) & (r >= b + 0.02) & ~foam

    sure_water = ndi.binary_erosion((b - r > 0.12) & (s > 0.25) & allowed, iterations=3) & ~band & ~land
    sure_land = (land & ~band) | (yy < top[None, :] - 4) & (yy > 300) | (warm & allowed & ~bluish & (s > 0.2))
    prob = p.classify(sure_water, sure_land, allowed)
    water = (prob > 0.5) & allowed

    # Along the right-hand coast, and anywhere out in the bay, rock is what
    # is warm; foam, shallows and sand seen through the water are sea.
    right = (xx >= 1440) & ~land & allowed
    water[right] = ~warm[right]
    water[band & land] = (bluish | (prob > 0.5))[band & land] & ~warm[band & land] & allowed[band & land]
    water[land & ~band] = False
    x0, x1, y0 = SEA_BELOW
    water[(xx >= x0) & (xx < x1) & (yy >= y0)] = True

    # Anything not water and not joined to the land is a rock standing in
    # the sea if it is warm, and sea otherwise.
    mainland = ~water & ((yy < top[None, :]) | (land & ~band))
    lab, _ = ndi.label(~water)
    joined = np.zeros(lab.max() + 1, bool)
    joined[np.unique(lab[mainland])] = True
    joined[0] = False
    island = ~water & ~joined[lab]
    water[island] = ~warm[island]

    # Specks: foam flecks read as rock, glints of blue read as sea.
    rock = drop_small(~water, 30, keep=mainland)
    water = ~rock
    water = drop_small(water, 80) & allowed
    water = ndi.binary_closing(water, iterations=1) & allowed | water
    return water, top


def build_sky(p, foliage_hard, top):
    h, w = p.shape
    yy = p.yy
    ridge = distance_to_line(p.shape, SKYLINE)
    under = below_line(p.shape, SKYLINE)
    band = ridge < BAND
    sure_sky = ~under & ~band & ~ndi.binary_dilation(foliage_hard, iterations=3)
    # Only the hills and mountains right under the skyline: whitewashed walls
    # further down would teach it that pale haze is land.
    sure_land = under & ~band & (ridge < 3 * BAND)
    prob = p.classify(sure_sky, sure_land, band, seed=2)
    sky = sure_sky | (band & (prob > 0.5))
    # Pale haze over the skyline, where the classifier is swayed by the dark
    # cypresses beside it. The bell tower, as pale, is under the skyline.
    haze = (p.v > 0.78) & (p.s < 0.3)
    sky |= band & ~under & haze
    # The sea starts where the sky stops.
    sky &= (yy < top[None, :]) & ~foliage_hard
    # Sky is one piece, open to the top of the painting.
    lab, _ = ndi.label(sky)
    top_ids = np.unique(lab[0][lab[0] > 0])
    sky = np.isin(lab, top_ids)
    sky = ~drop_small(~sky, 40, keep=under & ~band)
    return sky


def build_foliage(p):
    r, g, b, v, s = p.r, p.g, p.b, p.v, p.s
    zone = np.zeros(p.shape, bool)
    for pts in ZONES.values():
        zone |= polygon(p.shape, pts)
    # Leaves here are olive: green and red close, blue well below both. In
    # deep shade they go nearly black.
    leafy = ((r - g < 0.06) & (g - b > 0.14) & (v < 0.82)) | ((v < 0.26) & (b < g + 0.02))
    # Walls, roofs, rock and sand are warmer; sky, sea and distant hills bluer.
    not_leafy = (r - g > 0.12) | (b > g + 0.01) | ((v > 0.86) & (s < 0.25))
    prob = p.classify(leafy & zone, not_leafy & zone, zone, seed=3)
    raw = (prob > 0.5) & zone
    # Opening drops stray specks, but also the thin tips of the cypresses;
    # growing back into whatever of the raw mask touches what is left
    # restores the tips without the specks.
    leaf = ndi.binary_propagation(ndi.binary_opening(raw, iterations=1), mask=raw)
    leaf = drop_small(leaf, 120)
    leaf = ~drop_small(~leaf, 25) & zone
    return leaf


def build_groups(leaf):
    """Split the foliage into trees and bushes: connected pieces, with the
    large ones cut along the narrowest places between their crowns."""
    dist = ndi.distance_transform_edt(leaf)
    smooth = ndi.gaussian_filter(dist, 3)
    peaks = feature.peak_local_max(smooth, min_distance=22, threshold_abs=3, labels=ndi.label(leaf)[0])
    markers = np.zeros(leaf.shape, np.int32)
    markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    groups = segmentation.watershed(-smooth, markers, mask=leaf)
    # Pieces too small to have found a peak keep their own id.
    lab, n = ndi.label(leaf & (groups == 0))
    groups[lab > 0] = lab[lab > 0] + groups.max()
    # Each tree's id reaches a little past its leaves, so leaves blown out
    # past their old edge still know which tree they belong to.
    dist, (iy, ix) = ndi.distance_transform_edt(groups == 0, return_indices=True)
    grown = groups[iy, ix]
    grown[dist > REACH] = 0
    return grown


def build_flex(leaf, groups):
    """0 where a plant is rooted, rising to 1 at the top of its crown, and
    carried REACH pixels past the leaves, fading out, so that leaves moved
    beyond their old edge are moved there too."""
    flex = np.zeros(leaf.shape, np.float32)
    ys = np.arange(leaf.shape[0])[:, None] * np.ones((1, leaf.shape[1]))
    inside = groups * leaf
    for gid, sl in enumerate(ndi.find_objects(inside), start=1):
        if sl is None:
            continue
        m = inside[sl] == gid
        y = ys[sl][m]
        y0, y1 = y.min(), y.max()
        height = max(8.0, y1 - y0)
        flex[sl][m] = np.clip((y1 - y) / height, 0, 1) ** 1.3
    w = leaf.astype(np.float32)
    near = ndi.gaussian_filter(flex * w, 2) / np.maximum(ndi.gaussian_filter(w, 2), 1e-3)
    far = ndi.gaussian_filter(flex * w, 6) / np.maximum(ndi.gaussian_filter(w, 6), 1e-3)
    out_dist = ndi.distance_transform_edt(~leaf)
    fade = np.clip(1 - out_dist / REACH, 0, 1) ** 2
    return np.clip(np.where(leaf, near, far * fade), 0, 1)


def build_clouds(p, sky):
    """How far each sky pixel is from the clear blue around it."""
    lab = color.rgb2lab(p.rgb)
    clear = sky & (p.b - p.r > 0.18) & (p.s > 0.3)
    weight = ndi.gaussian_filter(clear.astype(np.float32), 40)
    bg = np.stack([ndi.gaussian_filter(lab[..., c] * clear, 40) for c in range(3)], -1) / np.maximum(weight, 1e-4)[..., None]
    diff = np.sqrt(((lab - bg) ** 2).sum(-1))
    return np.clip((diff - 6) / 30, 0, 1) * sky


def spread(a, region, sigma):
    """`a` averaged over `region` only, and carried out past its edge."""
    m = region.astype(np.float32)
    return ndi.gaussian_filter(a * m, sigma) / np.maximum(ndi.gaussian_filter(m, sigma), 1e-4)


def build_shore_distance(p, water, top, leaf):
    """How far each bit of sea is from the nearest rock or beach, in metres
    on the water. A metre across the view is d / eye pixels and a metre into
    it (stretch) times fewer (see SEA_VIEW), so the distance is taken with the
    rows stretched to match: done for a ladder of stretches, each row reading
    the one that fits it. The edges of the picture and the open horizon are
    not shore, and nor are trees in front of the water: the sea carries on
    behind them, so a glimpse of it between two pines gets no surf."""
    h, w = p.shape
    horizon, focal, eye = SEA_VIEW["horizon"], SEA_VIEW["focal"], SEA_VIEW["eye"]
    land = ~water & ~leaf & (p.yy > top[None, :] + 1)
    rows = np.arange(h)
    d = np.maximum(rows - horizon, 1.0)
    stretch = np.log(np.minimum(focal / d, SEA_VIEW["stretch"]))
    ladder = np.log(np.geomspace(focal / (h - horizon), SEA_VIEW["stretch"], 9))
    out = np.zeros((h, w), np.float32)
    for i, k in enumerate(ladder):
        dist = ndi.distance_transform_edt(~land, sampling=(np.exp(k), 1.0)).astype(np.float32)
        lo = ladder[i - 1] if i else -np.inf
        hi = ladder[i + 1] if i + 1 < len(ladder) else np.inf
        # A tent over the log stretch: each row blends the two nearest rungs.
        if i == 0:
            wgt = np.where(stretch <= k, 1, np.clip((hi - stretch) / (hi - k), 0, 1))
        elif i + 1 == len(ladder):
            wgt = np.where(stretch >= k, 1, np.clip((stretch - lo) / (k - lo), 0, 1))
        else:
            wgt = np.clip(np.minimum((stretch - lo) / (k - lo), (hi - stretch) / (hi - k)), 0, 1)
        out += dist * wgt[:, None]
    metres = out * (eye / d)[:, None]
    return np.where(land, 0, np.minimum(metres, SHORE_REACH))


def build_depth(p, water):
    """How shallow the water looks, 0 deep blue to 1 turquoise: sand seen
    through a little water turns the blue green. Smooth, since it says how
    the water moves, not what colour it is; the haze along the horizon is
    deep water whatever its colour."""
    tint = spread(p.g / (p.b + 1e-3), water, 16)
    shallow = np.clip((tint - 0.66) / 0.26, 0, 1)
    far = np.clip((p.yy - SEA_VIEW["horizon"] - 6) / 24, 0, 1)
    return shallow * far


def build_foam(p, water, shore):
    """The foam the painter put along the beach and round the rocks: pale,
    colourless water within a few metres of the shore. Pale strokes further
    out are the sun on the water, not foam."""
    pale = water & (p.v > 0.78) & (p.s < 0.25) & (shore < 3)
    return np.clip(ndi.gaussian_filter(pale.astype(np.float32), 0.7) * 1.6, 0, 1)


def build_sea_light(p, water):
    """Where the painter put light on the water: how many strokes stand out
    brighter than the water around them, smoothed into regions. Glints only
    come where the painting already has light to give them."""
    light = p.rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    lift = np.clip((light - spread(light, water, 12) - 0.02) / 0.15, 0, 1) * water
    return np.clip(spread(lift, water, 20) / 0.3, 0, 1)


def build_plate(p, leaf):
    """The painting with the foliage taken out, filled in from around it.
    Returned as the browser will see it: encoded and decoded again, since
    the foliage matte is solved against exactly these colours."""
    hole = ndi.binary_dilation(leaf, iterations=EDGE + 3)
    img = p.rgb
    # Behind a cypress the scenery changes with height (cloud, then
    # mountain, then hillside) far more than across it, so each row of a
    # gap is filled from the paint either side of it in that row, not from
    # all round as ordinary inpainting would, which drags cloud down into the
    # mountains.
    out = img.copy()
    w = img.shape[1]
    side = lambda y, a, b: img[y, max(a, 0):min(b, w)].mean(0)
    for y in range(img.shape[0]):
        row = hole[y]
        if not row.any():
            continue
        edges = np.flatnonzero(np.diff(np.r_[0, row.astype(np.int8), 0]))
        for x0, x1 in zip(edges[::2], edges[1::2]):
            left = side(y, x0 - 3, x0) if x0 > 0 else None
            right = side(y, x1, x1 + 3) if x1 < w else None
            left = right if left is None else left
            right = left if right is None else right
            t = (np.arange(x0, x1) - x0 + 0.5)[:, None] / (x1 - x0)
            out[y, x0:x1] = left * (1 - t) + right * t
    # Rows filled on their own leave streaks; soften them up and down, inside
    # the gap only.
    weight = hole.astype(np.float32)
    soft = np.stack([ndi.gaussian_filter(out[..., c] * weight, (2.5, 0.8)) for c in range(3)], -1)
    soft /= np.maximum(ndi.gaussian_filter(weight, (2.5, 0.8)), 1e-4)[..., None]
    out[hole] = soft[hole]
    out = (np.clip(out, 0, 1) * 255).round().astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, "WEBP", quality=92, method=6)
    data = buf.getvalue()
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB")), data


def build_underlay(p, region):
    """The region's paint, carried outward under whatever borders it: each
    gap pixel takes the average of the region around it at the smallest
    scale that has enough of the region in reach."""
    known = ndi.binary_erosion(region, iterations=2)
    out = np.where(known[..., None], p.rgb, 0).astype(np.float32)
    have = known.copy()
    k = known.astype(np.float32)
    for sigma in (2, 4, 8, 16, 32, 64, 128):
        den = ndi.gaussian_filter(k, sigma)
        fill = np.stack([ndi.gaussian_filter(p.rgb[..., c] * k, sigma) for c in range(3)], -1) / np.maximum(den, 1e-6)[..., None]
        take = ~have & (den > 0.08)
        out[take] = fill[take]
        have |= take
    out[~have] = fill[~have]
    small = Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8))
    small = small.resize((p.shape[1] // 2, p.shape[0] // 2), Image.BOX)
    buf = io.BytesIO()
    small.save(buf, "WEBP", quality=90, method=6)
    return buf.getvalue()


def grow_tips(p, leaf, plate):
    """The last few pixels of a cypress's tip, or a twig, are often a single
    dark stroke too thin for the classifier. Taken as leaf: anything just
    outside the foliage, joined to it, that is clearly darker than what the
    plate says is behind it. Left out, it would stay put while the tree
    moved."""
    light = lambda a: a @ np.array([0.299, 0.587, 0.114], np.float32)
    darker = light(p.rgb) < light(plate.astype(np.float32) / 255) - 0.06
    near = ndi.distance_transform_edt(~leaf) <= EDGE + 2
    return ndi.binary_propagation(leaf, mask=leaf | (darker & near))


def foliage_matte(p, leaf, plate):
    """How much of each pixel is leaf, against the plate behind it.

    Along a crown's edge a pixel is a mix, paint = a * leaf + (1 - a) * plate.
    The leaf colour there is taken from just inside the crown, and a is
    solved from the mix. Then lifting the leaves off (paint - (1 - a) plate)
    leaves no ghost of them behind and takes none of the plate with them."""
    P = p.rgb
    B = plate.astype(np.float32) / 255
    inner = ndi.binary_erosion(leaf, iterations=2)
    wgt = inner.astype(np.float32) + 0.25 * leaf
    blur = lambda a: ndi.gaussian_filter(a, 2.5)
    den = np.maximum(blur(wgt), 1e-4)
    fg = np.stack([blur(P[..., c] * wgt) / den for c in range(3)], -1)
    d = fg - B
    dd = (d * d).sum(-1)
    solved = np.clip(((P - B) * d).sum(-1) / np.maximum(dd, 1e-6), 0, 1)
    # Where leaf and plate are nearly one colour the mix says little, and
    # the guided filter's edge is used instead.
    sure = np.clip((np.sqrt(dd) - 0.04) / 0.08, 0, 1)
    soft = matte(p, leaf)
    band = ndi.binary_dilation(leaf, iterations=EDGE) & ~ndi.binary_erosion(leaf, iterations=2)
    a = leaf.astype(np.float32)
    a[band] = (sure * solved + (1 - sure) * soft)[band]
    # The lifted leaves must be a colour that exists: 0 <= paint - (1 - a)
    # plate <= a in every channel. Where they would not be, a is too small.
    with np.errstate(divide="ignore", invalid="ignore"):
        low = np.where(B > 1e-3, 1 - P / B, 0)
        high = np.where(B < 1 - 1e-3, (P - B) / (1 - B), 0)
    need = np.clip(np.maximum(low, high).max(-1), 0, 1)
    a[band] = np.maximum(a[band], need[band])
    # Stored in 8 bits, rounded up so the guarantee survives.
    return np.ceil(a * 255 - 1e-4) / 255


def save_assets(rgb, water, sky, foliage, fields, sea, groups, plate, plate_webp, unders, top):
    OUT.mkdir(parents=True, exist_ok=True)
    q = lambda a: (np.clip(a, 0, 1) * 255).round().astype(np.uint8)
    Image.fromarray(np.stack([q(water), q(sky), q(foliage)], -1)).save(OUT / "mattes.png", optimize=True)
    h, w = water.shape
    half = (w // 2, h // 2)
    f = np.stack([q(c) for c in fields], -1)
    Image.fromarray(f).resize(half, Image.BOX).save(OUT / "fields.png", optimize=True)
    shore, foam, light = sea
    shore = np.sqrt(shore / SHORE_REACH)
    Image.fromarray(np.stack([q(shore), q(foam), q(light)], -1)).save(OUT / "water.png", optimize=True)
    ids = groups[::2, ::2].astype(np.int32)
    if ids.max() > 255:
        raise SystemExit(f"{ids.max()} foliage groups; ids are stored in 8 bits")
    Image.fromarray(ids.astype(np.uint8), "L").save(OUT / "groups.png", optimize=True)
    (OUT / "plate.webp").write_bytes(plate_webp)
    for name, data in unders.items():
        (OUT / f"{name}-under.webp").write_bytes(data)
    a = q(foliage).astype(np.float32)[..., None] / 255
    leaves = np.clip(rgb - (1 - a) * plate.astype(np.float32) / 255, 0, a)
    Image.fromarray(q(leaves)).save(OUT / "leaves.png", optimize=True)

    manifest = {
        "source": {"width": w, "height": h},
        "landmarks": {**LANDMARKS, "waterline": [int(v) for v in np.round(top[::8])], "waterlineStep": 8},
        "sea": {**SEA_VIEW, "shoreReach": SHORE_REACH},
        "textures": {
            "mattes": {"url": "assets/scene/mattes.png", "width": w, "height": h,
                       "format": "rgb", "channels": ["water", "sky", "foliage"], "filter": "linear"},
            "fields": {"url": "assets/scene/fields.png", "width": half[0], "height": half[1],
                       "format": "rgb", "channels": ["waterShallow", "cloudDensity", "foliageFlex"], "filter": "linear",
                       "foliageReach": REACH},
            "water": {"url": "assets/scene/water.png", "width": w, "height": h,
                      "format": "rgb", "channels": ["shoreDistance", "foam", "light"], "filter": "linear",
                      "shoreDistance": "sqrt(metres / sea.shoreReach)"},
            "groups": {"url": "assets/scene/groups.png", "width": half[0], "height": half[1],
                       "format": "r", "channels": ["foliageGroup"], "filter": "nearest", "count": int(ids.max())},
            "plate": {"url": "assets/scene/plate.webp", "width": w, "height": h,
                      "format": "rgb", "channels": ["red", "green", "blue"], "filter": "linear", "removes": ["foliage"]},
            "waterUnder": {"url": "assets/scene/water-under.webp", "width": half[0], "height": half[1],
                           "format": "rgb", "channels": ["red", "green", "blue"], "filter": "linear", "extends": "mattes.water"},
            "skyUnder": {"url": "assets/scene/sky-under.webp", "width": half[0], "height": half[1],
                         "format": "rgb", "channels": ["red", "green", "blue"], "filter": "linear", "extends": "mattes.sky"},
            "leaves": {"url": "assets/scene/leaves.png", "width": w, "height": h,
                       "format": "rgb", "channels": ["red", "green", "blue"], "filter": "linear", "premultipliedBy": "mattes.foliage"},
        },
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(manifest, indent=2)
    # Lists of numbers and short lists of names, one line each.
    text = re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text)
    MANIFEST.write_text(
        "// Generated by build_scene.py from assets/coastal-banner.webp. Do not edit.\n"
        f"export default {text};\n",
        encoding="utf-8",
    )


def preview(dirpath, rgb, water, sky, foliage, groups, plate, fields, sea):
    d = Path(dirpath)
    d.mkdir(parents=True, exist_ok=True)
    base = (rgb * 255).astype(np.float32)

    def tint(m, c, name):
        out = base * (1 - 0.55 * m[..., None]) + np.array(c, np.float32) * 0.55 * m[..., None]
        Image.fromarray(out.astype(np.uint8)).save(d / name)

    tint(water, (255, 0, 80), "water.png")
    tint(sky, (255, 140, 0), "sky.png")
    tint(foliage, (255, 0, 255), "foliage.png")
    rng = np.random.default_rng(0)
    pal = rng.integers(40, 255, (groups.max() + 1, 3)).astype(np.float32)
    pal[0] = 0
    g = pal[groups] * 0.7 + base * 0.3
    g[groups == 0] = base[groups == 0]
    Image.fromarray(g.astype(np.uint8)).save(d / "groups.png")
    Image.fromarray(plate).save(d / "plate.png")
    for name, f in zip(("depth", "clouds", "flex"), fields):
        Image.fromarray((f * 255).astype(np.uint8)).save(d / f"{name}.png")
    shore, foam, light = sea
    Image.fromarray((shore / SHORE_REACH * 255).astype(np.uint8)).save(d / "shore.png")
    tint(foam, (255, 0, 80), "foam.png")
    tint(light, (255, 200, 0), "light.png")
    # Every pixel accounted for once: water, sky, foliage, and the rest.
    rest = np.clip(1 - water - sky - foliage, 0, 1)
    over = np.clip(water + sky + foliage - 1, 0, 1)
    print(f"overlap between mattes: max {over.max():.3f}, mean {over.mean():.5f}; static share {rest.mean():.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="also write overlays of each layer here")
    args = ap.parse_args()

    rgb = load()
    p = Painting(rgb)
    leaf = build_foliage(p)
    water_hard, top = build_water(p)
    leaf &= ~water_hard
    sky_hard = build_sky(p, leaf, top)
    leaf &= ~ndi.binary_erosion(sky_hard, iterations=2)

    leaf = grow_tips(p, leaf, build_plate(p, leaf)[0])
    plate, plate_webp = build_plate(p, leaf)
    water = matte(p, water_hard)
    sky = matte(p, sky_hard)
    foliage = foliage_matte(p, leaf, plate)
    # The mattes share edges with each other; where two meet, neither may
    # claim more than is left over by the other.
    sky = np.minimum(sky, 1 - foliage)
    water = np.minimum(water, 1 - foliage)

    groups = build_groups(leaf)
    flex = build_flex(leaf, groups)
    fields = (build_depth(p, water_hard), build_clouds(p, sky_hard), flex)
    shore = build_shore_distance(p, water_hard, top, leaf)
    sea = (shore, build_foam(p, water_hard, shore), build_sea_light(p, water_hard))
    unders = {"water": build_underlay(p, water_hard), "sky": build_underlay(p, sky_hard)}
    save_assets(rgb, water, sky, foliage, fields, sea, groups, plate, plate_webp, unders, top)
    if args.preview:
        preview(args.preview, rgb, water, sky, foliage, groups, plate, fields, sea)
    print(f"water {water.mean():.3f}, sky {sky.mean():.3f}, foliage {foliage.mean():.3f}, groups {groups.max()}")


if __name__ == "__main__":
    main()
