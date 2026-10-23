#!/usr/bin/env python3
"""Tien achtergrondafbeeldingen (1920x1080, zonder tekst) voor kerkdia's in de stijl van moderne welkomstdia's: vloeiende
linten, verf, geometrie, nevel, glas, zijde, lichtlijnen, water, horizon en stralen, elk in een eigen kleurstelling.
Bedoeld als media voor o.a. Welkom en Bedankt (de tekst komt er in FreeShow overheen).

Gebruik: make_kerk_achtergronden.py <uitvoermap> [--preview overzicht.jpg]
Donker en rustig gehouden, zodat witte tekst er goed op leest. Alles is zelf getekend met ruis en verlopen (geen foto's).
"""
import argparse, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080


def hexrgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def grid():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return xx / W, yy / H


def noise(rng, cells, octaves=5, persistence=0.55):
    """Vloeiende ruis 0..1 (som van opgeschaalde willekeurige velden)."""
    total = np.zeros((H, W), np.float32); amp = 1.0; norm = 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        small = rng.random((max(2, int(c * H / W)) + 2, int(c) + 2)).astype(np.float32)
        img = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
        total += np.asarray(img, np.float32) / 255.0 * amp; norm += amp; amp *= persistence
    return total / norm


def warp(rng, cells, strength=0.4, octaves=5):
    """Ruis met domeinvervorming: geeft stromende, wolk- en zijdeachtige vormen."""
    n1, n2 = noise(rng, cells, octaves), noise(rng, cells, octaves)
    sx = ((n1 - 0.5) * strength * W).astype(np.int32); sy = ((n2 - 0.5) * strength * H).astype(np.int32)
    base = noise(rng, cells * 1.3, octaves)
    yy, xx = np.mgrid[0:H, 0:W]
    return base[np.clip(yy + sy, 0, H - 1), np.clip(xx + sx, 0, W - 1)]


def ramp(t, stops):
    t = np.clip(t, 0, 1)
    pos = [p for p, _ in stops]; cols = [hexrgb(c) for _, c in stops]
    out = np.zeros(t.shape + (3,), np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(t, pos, [c[ch] for c in cols])
    return out


def vignette(strength=0.5):
    xx, yy = grid()
    return (1.0 - strength * np.clip(((xx - 0.5) ** 2 * 1.2 + (yy - 0.5) ** 2) * 2.0, 0, 1))[..., None]


def glow(cx, cy, r, aspect=1.0):
    xx, yy = grid()
    return np.exp(-(((xx - cx) ** 2 * (W / H) ** 2 / aspect + (yy - cy) ** 2) / (r ** 2)) * 2.2).astype(np.float32)


def stars(rng, count, size=(0.6, 2.2), tint=(1, 1, 1), alpha=(0.3, 1.0)):
    layer = Image.new('RGB', (W, H), (0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(count):
        x, y = rng.integers(0, W), rng.integers(0, H); s = rng.uniform(*size); a = rng.uniform(*alpha)
        d.ellipse((x - s, y - s, x + s, y + s), fill=tuple(int(255 * a * v) for v in tint))
    return np.asarray(layer.filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0


def finish(img, rng, grain=0.018, vig=0.45):
    img = img * vignette(vig) + rng.standard_normal((H, W, 1)).astype(np.float32) * grain
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


# ---- de tien ontwerpen --------------------------------------------------------------------------------------------
def linten_teal(rng):
    n = warp(rng, 1.2, 0.4, 3)
    stripes = 0.5 + 0.5 * np.sin(n * 15)
    col = ramp(n, [(0, '#04101f'), (0.35, '#0b4a6a'), (0.6, '#12a6a0'), (0.8, '#7c3acb'), (1, '#e0409a')])
    img = col * (0.3 + 0.7 * stripes ** 1.2)[..., None] + (stripes ** 10 * 0.16)[..., None]
    return finish(img * 0.88, rng, vig=0.5)


def verf_violet(rng):
    n = warp(rng, 1.5, 0.85, 6)
    img = ramp(n, [(0, '#12042a'), (0.3, '#5b12a8'), (0.55, '#c2208f'), (0.8, '#ff6a3d'), (1, '#ffd166')]) * 0.82
    return finish(img, rng, grain=0.022, vig=0.5)


def chevrons_goud(rng):
    xx, yy = grid()
    img = ramp(np.sqrt(((xx - 0.5) * (W / H)) ** 2 + (yy - 0.5) ** 2), [(0, '#0f1b33'), (0.6, '#070d1c'), (1, '#02050c')])
    layer = Image.new('RGB', (W, H), (0, 0, 0)); d = ImageDraw.Draw(layer)
    for i in range(16):
        off = i * 70 - 80; a = max(0.12, 0.85 - i * 0.045)
        col = tuple(int(v * a) for v in (240, 190, 80))
        d.line([(-40, H * 0.25 + off + 520), (W / 2, H * 0.25 + off - 120), (W + 40, H * 0.25 + off + 520)], fill=col, width=3 if i % 3 else 6, joint='curve')
    layer = layer.filter(ImageFilter.GaussianBlur(1.1))
    img += np.asarray(layer, np.float32) / 255.0 + glow(0.5, 0.2, 0.3)[..., None] * hexrgb('#ffd27a') * 0.2
    return finish(img, rng, vig=0.55)


def nevel_magenta(rng):
    n = warp(rng, 3, 0.45)
    img = ramp(n ** 1.4, [(0, '#05010a'), (0.35, '#2a0630'), (0.6, '#8a0f47'), (0.85, '#e8365d'), (1, '#ffb3c1')]) * 0.85
    img += stars(rng, 500, tint=(1, 0.9, 0.95)) * 0.9 + stars(rng, 40, (1.6, 3.2), (1, 0.8, 0.9)) * 0.7
    return finish(img, rng)


def glas_blauw(rng):
    xx, yy = grid()
    img = np.zeros((H, W, 3), np.float32) + hexrgb('#060a24')
    for cx, cy, r, c, a in [(0.2, 0.3, 0.5, '#3b5bdb', 0.9), (0.8, 0.2, 0.45, '#7c3aed', 0.75), (0.55, 0.9, 0.55, '#06b6d4', 0.7), (0.9, 0.85, 0.35, '#c084fc', 0.5)]:
        img += glow(cx, cy, r)[..., None] * hexrgb(c) * a
    n = warp(rng, 1.6, 0.6, 4)
    frac = (n * 16) % 1.0
    img += (np.exp(-((frac - 0.5) / 0.035) ** 2) * 0.28)[..., None] * hexrgb('#cfe0ff')
    return finish(img * 0.85, rng, grain=0.024, vig=0.4)


def satijn_goud(rng):
    n = warp(rng, 1.0, 0.3, 3)
    sheen = np.abs(np.sin(n * 9)) ** 2.5
    col = ramp(n, [(0, '#050403'), (0.45, '#2a1f08'), (0.75, '#8a6a1c'), (1, '#f0cf6a')])
    return finish(col * (0.3 + 0.7 * sheen)[..., None] * 1.0, rng, vig=0.55)


def lijnen_rood(rng):
    xx, yy = grid()
    img = np.zeros((H, W, 3), np.float32) + hexrgb('#080204')
    ang = math.radians(28)
    u = (xx * W * math.cos(ang) + yy * H * math.sin(ang)); v = (-xx * W * math.sin(ang) + yy * H * math.cos(ang))
    beams = np.zeros_like(u)
    for k in range(9):
        beams += np.maximum(0, np.cos(u / rng.uniform(18, 80) + rng.uniform(0, 6.28))) ** 14 * rng.uniform(0.3, 1)
    mod = 0.35 + 0.65 * noise(rng, 2.5, 3)
    beams = np.clip(beams * mod, 0, 1)
    img += beams[..., None] * ramp(noise(rng, 2.0, 3), [(0, '#b3122a'), (0.6, '#ff3b2f'), (1, '#ff9a3c')]) * 0.8
    img += glow(0.3, 0.6, 0.5, 1.5)[..., None] * hexrgb('#7a0d22') * 0.55
    return finish(img, rng, vig=0.55)


def water_turquoise(rng):
    n = warp(rng, 3, 0.5, 6)
    img = ramp(n ** 1.2, [(0, '#083a47'), (0.45, '#2fa8a6'), (0.75, '#9fe6df'), (1, '#ffffff')]) * 0.78
    return finish(img, rng, vig=0.5)


def horizon_zonsopgang(rng):
    xx, yy = grid()
    sky = ramp(yy / 0.66, [(0, '#150a3a'), (0.35, '#5a1a6e'), (0.62, '#d1467a'), (0.85, '#ff8a3d'), (1, '#ffd27a')])
    sky = np.where((yy < 0.66)[..., None], sky, sky[int(H * 0.66)][None])
    sky += ((noise(rng, 1.4, 4) - 0.5) * 0.18 * np.clip(1 - yy / 0.66, 0, 1))[..., None]
    img = sky + glow(0.5, 0.64, 0.30, 1.8)[..., None] * hexrgb('#fff0c2') * 0.9
    for k, (base_y, col) in enumerate([(0.74, '#3a1647'), (0.82, '#1e0c2c'), (0.91, '#0c0514')]):
        ridge = base_y + 0.05 * (noise(rng, 2.0 + k, 4)[0:1, :] - 0.5) * 2 + 0.03 * np.sin(xx * (5 + 2 * k) + k)
        mask = (yy > ridge).astype(np.float32)[..., None]
        img = img * (1 - mask) + hexrgb(col) * mask
    return finish(img, rng, vig=0.35)


def stralen_goud(rng):
    xx, yy = grid()
    ox, oy = 0.82, -0.12
    ang = np.arctan2(yy - oy, (xx - ox) * (W / H))
    rays = np.zeros_like(ang)
    for k in range(14):
        rays += np.maximum(0, np.cos(ang * rng.uniform(5, 16) + rng.uniform(0, 6.28))) * rng.uniform(0.25, 1.0)
    rays = (rays / rays.max()) ** 2.2
    dist = np.sqrt(((xx - ox) * (W / H)) ** 2 + (yy - oy) ** 2)
    base = ramp(yy * 0.9 + (1 - xx) * 0.25, [(0, '#05122e'), (0.6, '#0a2050'), (1, '#040b1c')])
    img = base + (rays * np.exp(-dist * 1.35))[..., None] * hexrgb('#ffc857') * 0.85 + glow(ox, 0.0, 0.35)[..., None] * hexrgb('#ffd98a') * 0.55
    img += stars(rng, 160, (0.5, 1.5), (1, 0.9, 0.6)) * 0.5
    return finish(img, rng, vig=0.4)


ONTWERPEN = [
    ('linten-teal', linten_teal, 11), ('verf-violet', verf_violet, 12), ('chevrons-goud', chevrons_goud, 13),
    ('nevel-magenta', nevel_magenta, 14), ('glas-blauw', glas_blauw, 15), ('satijn-goud', satijn_goud, 16),
    ('lijnen-rood', lijnen_rood, 17), ('water-turquoise', water_turquoise, 18),
    ('horizon-zonsopgang', horizon_zonsopgang, 19), ('stralen-goud', stralen_goud, 20),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('outdir'); ap.add_argument('--preview')
    a = ap.parse_args(); os.makedirs(a.outdir, exist_ok=True)
    made = []
    for i, (naam, fn, seed) in enumerate(ONTWERPEN, 1):
        path = os.path.join(a.outdir, f'ark-achtergrond-{i:02d}-{naam}.jpg')
        fn(np.random.default_rng(seed)).save(path, quality=92, subsampling=0); made.append(path); print('gemaakt:', os.path.basename(path))
    if a.preview:
        tw, th = 640, 360; sheet = Image.new('RGB', (tw * 2 + 30, (th + 14) * 5 + 14), (16, 18, 22))
        for i, p in enumerate(made):
            sheet.paste(Image.open(p).resize((tw, th), Image.LANCZOS), (10 + (i % 2) * (tw + 10), 14 + (i // 2) * (th + 14)))
        sheet.save(a.preview, quality=90)


if __name__ == '__main__':
    main()
