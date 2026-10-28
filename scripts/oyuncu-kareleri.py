# Builds the player mouth frames gorseller/oyuncu-1..4.png (closed -> open) from
# gorseller/referans/siclamentpacman.jpeg:
#   1. keys out the black background (the eye stays: it isn't connected to the border),
#   2. closes the mouth with a polar warp around the jaw hinge,
#   3. enlarges the head a little (bulge warp) so the mouth reads at phone size,
#   4. adds a white sticker outline with a thin plum rim (contrast on pink walls),
#   5. crops so the mouth corner sits at the image center: the game eats pellets
#      at the sprite center and rotates around it, exactly like Pac-Man.
# Usage: python scripts/oyuncu-kareleri.py gorseller/referans/siclamentpacman.jpeg gorseller
# Needs: pip install numpy scipy opencv-python pillow
import sys
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = rgb.shape
m = rgb.max(2)

# --- background key: dark pixels connected to the border (the mouth opens to it; the eye doesn't)
lab, _ = ndimage.label(m < 60)
bg = lab == lab[0, 0]
# The eye is taken out (filled with the surrounding petal) and redrawn as a clean
# circle after the warps, so it never gets stretched into an ellipse.
eye = (m < 60) & ~bg
core = (ndimage.distance_transform_edt(~bg) > 3) & ~ndimage.binary_dilation(eye, iterations=4)
d_core, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
ref = rgb[iy, ix]
alpha = np.where(core, 1.0, np.clip(m / np.maximum(ref.max(2), 1), 0, 1))
alpha[d_core > 5] = 0
alpha[ndimage.binary_dilation(eye, iterations=4)] = 1
color = np.where(core[..., None], rgb, ref)
pm = np.dstack([color * alpha[..., None], alpha * 255]).astype(np.float32)  # premultiplied RGBA
P = 64  # transparent padding so the outline never touches the image edge
pm = np.pad(pm, ((P, P), (P, P), (0, 0)))
eye_m = np.pad(eye.astype(np.float32), P)
EYE_R = np.sqrt(eye.sum() / np.pi) * 1.08
H, W = H + 2 * P, W + 2 * P

# --- mouth geometry (measured on the 1254px source, shifted by the padding)
VX, VY = 747.0 + P, 659.0 + P  # hinge (mouth vertex)
TU, TL = -33.5, 30.0           # upper / lower lip angles, degrees (y down)
TC = TU + 0.4 * (TL - TU)      # where the lips meet when closed (lower jaw does more of the work)
AU, AL = 75.0, 70.0            # angular span over which each jaw bends back to rest
R1, R2 = 470.0, 640.0          # full warp inside R1, fading out by R2

# --- head bulge
BX, BY, BR, BA = 830.0 + P, 620.0 + P, 380.0, 0.18  # center, radius, strength (center magnified 1/(1-BA))

# --- outline (source pixels) and output
WHITE, RIM = 26.0, 12.0
OUT = 256

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def lerp_map(t, a0, a1, b0, b1):
    return b0 + (t - a0) * (b1 - b0) / (a1 - a0)


def mouth_maps(f):
    dx, dy = xx - VX, yy - VY
    r = np.hypot(dx, dy)
    th = np.degrees(np.arctan2(dy, dx))
    w = np.clip((R2 - r) / (R2 - R1), 0, 1)
    w = w * w * (3 - 2 * w)
    tu = TU + (1 - f) * (TC - TU)
    tl = TL + (1 - f) * (TC - TL)
    s = th.copy()
    # When the lips overlap, split the overlap so each jaw keeps its opaque inside at the seam.
    cut = (tu + tl) / 2 if tl < tu else None
    up = (th >= TU - AU) & (th < (cut if cut is not None else tu))
    s[up] = lerp_map(th[up], TU - AU, tu, TU - AU, TU)
    if tl > tu:
        gap = (th >= tu) & (th < tl)
        s[gap] = lerp_map(th[gap], tu, tl, TU, TL)
    lo = (th >= (cut if cut is not None else tl)) & (th <= TL + AL)
    s[lo] = lerp_map(th[lo], tl, TL + AL, TL, TL + AL)
    s = th + w * (s - th)
    rad = np.radians(s)
    return (VX + r * np.cos(rad)).astype(np.float32), (VY + r * np.sin(rad)).astype(np.float32)


def bulge_src(x, y):
    """Destination -> source position for the head bulge."""
    dx, dy = x - BX, y - BY
    k = np.clip(np.hypot(dx, dy) / BR, 0, 1)
    f = 1 - BA * (1 - k * k)
    return BX + dx * f, BY + dy * f


BMX, BMY = (a.astype(np.float32) for a in bulge_src(xx, yy))

# Where the hinge lands after the bulge (invert the radial map by fixed-point iteration).
hx, hy = VX, VY
for _ in range(50):
    sx, sy = bulge_src(hx, hy)
    hx, hy = hx + (VX - sx), hy + (VY - sy)


CLOSE_K = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))


def close_gaps(p):
    """Fills hairline cracks (where the lips meet) with the nearest petal colour."""
    a = p[..., 3] / 255
    ac = cv2.morphologyEx(a, cv2.MORPH_CLOSE, CLOSE_K)
    grow = ac > a + 0.02
    if not grow.any():
        return p
    _, (iy, ix) = ndimage.distance_transform_edt(a < 0.9, return_indices=True)
    straight = p[iy, ix, :3] / np.maximum(a[iy, ix], 1e-6)[..., None]
    q = p.copy()
    q[grow, :3] = straight[grow] * ac[grow, None]
    q[grow, 3] = ac[grow] * 255
    return q


def warp(img, mx, my):
    return cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def frame(f):
    mx, my = mouth_maps(f)
    p = close_gaps(warp(pm, mx, my))
    p = warp(p, BMX, BMY)
    e = warp(warp(eye_m, mx, my), BMX, BMY)
    ey, ex = np.average(yy, weights=e), np.average(xx, weights=e)
    ea = np.clip(EYE_R - np.hypot(xx - ex, yy - ey) + 0.5, 0, 1)[..., None]
    p = p * (1 - ea) + np.dstack([np.zeros_like(xx)[..., None].repeat(3, 2), np.full_like(xx, 255)[..., None]]) * ea
    a = p[..., 3] / 255
    d = ndimage.distance_transform_edt(a < 0.5)
    white = np.clip(WHITE - d + 0.5, 0, 1)
    rim = np.clip(WHITE + RIM - d + 0.5, 0, 1) * 0.85
    # Stack: plum rim, white band, flower (premultiplied "over").
    base = np.zeros_like(p)
    base[..., :3] = np.array([92, 22, 64], np.float32) * rim[..., None]
    base[..., 3] = rim * 255
    wl = np.dstack([np.full_like(white, 255)[..., None].repeat(3, 2) * white[..., None], white * 255])
    base = wl + base * (1 - white[..., None])
    return p + base * (1 - a[..., None])


# Square crop centered on the (bulged) hinge, large enough for the whole outlined flower.
probe = frame(1.0)
ys, xs = np.where(probe[..., 3] > 3)
half = int(max(hx - xs.min(), xs.max() - hx, hy - ys.min(), ys.max() - hy) * 1.02) + 2
side = 2 * half
x0, y0 = int(round(hx)) - half, int(round(hy)) - half

for i, f in enumerate([-0.16, 1 / 3, 2 / 3, 1.0]):  # closed frame overlaps the lips slightly: no seam
    p = frame(f)
    canvas = np.zeros((side, side, 4), np.float32)
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + side, W), min(y0 + side, H)
    canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = p[sy0:sy1, sx0:sx1]
    small = cv2.resize(canvas, (OUT, OUT), interpolation=cv2.INTER_AREA)
    a = small[..., 3:4] / 255
    c = np.where(a > 0, small[..., :3] / np.maximum(a, 1e-6), 0)
    img = np.dstack([np.clip(c, 0, 255), small[..., 3]]).round().astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(f'{out}/oyuncu-{i + 1}.png', optimize=True)
print(f'hinge ({hx:.0f},{hy:.0f}) crop {side}px')
