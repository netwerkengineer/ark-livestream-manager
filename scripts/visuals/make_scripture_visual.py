#!/usr/bin/env python3
"""Maakt een rustige, naadloos lopende achtergrond voor bijbelteksten (mp4 + optioneel still).

Gebruik: make_scripture_visual.py <stijl> <uitvoer.mp4> [--still still.jpg] [--secs 24]
Stijlen: goud (warm perkament/kaarslicht), nacht (diep blauw, koel licht), ochtend (leisteen met gouden lichtbundel),
licht (lichte crème/perkament met zonnebundel, voor donkere tekst)

Bewust anders van de sfeer-visuals bij de liederen (make_visual.py): geen kleurvlekken maar een
stille, donkere ruimte met een zachte lichtbundel en langzaam zwevend stof. Zo voelt "het Woord"
als een eigen moment in de dienst, en blijft tekst in wit/crème altijd goed leesbaar (donker en
met vignet, niets dat tegen de tekst in beweegt).
"""
import sys, subprocess, math
import numpy as np

W, H, FPS = 1280, 720, 24

STIJLEN = {
    #            achtergrond boven    onder         licht           stof
    "goud":    dict(top="1b120a", bot="3a2410", licht="ffd9a0", stof="ffe7bf", hoek=-0.22, sterkte=0.62, breedte=0.40, bron=(0.78, -0.25)),
    "nacht":   dict(top="060c1e", bot="14264f", licht="a9c8ff", stof="d6e4ff", hoek=0.10, sterkte=0.62, breedte=0.46, bron=(0.30, -0.30)),
    # lichte variant: crème/perkament met een zachte zonnebundel; donkere tekst (zie src/lib/bijbelstijlen.ts)
    "licht":   dict(top="f7efe0", bot="e3cba2", licht="fffaf0", stof="ffffff", hoek=-0.30, sterkte=0.55, breedte=0.42, bron=(0.85, -0.25), vign=0.9),
    "ochtend": dict(top="12161b", bot="25303a", licht="ffe2a8", stof="fff0cf", hoek=-0.40, sterkte=0.66, breedte=0.34, bron=(0.92, -0.20)),
}


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def build(stijl, seed=7):
    s = STIJLEN[stijl]
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xx /= W
    yy /= H
    top, bot = hexrgb(s["top"]), hexrgb(s["bot"])
    grad = top[None, None] * (1 - yy[..., None]) + bot[None, None] * yy[..., None]
    # hoek van elke pixel t.o.v. de lichtbron (bron staat boven/naast het beeld)
    bx, by = s["bron"]
    dx = (xx - bx) * (W / H)
    dy = yy - by
    ang = np.arctan2(dx, dy)            # 0 = recht naar beneden
    dist = np.sqrt(dx ** 2 + dy ** 2)
    stof = [dict(x=rng.uniform(), y=rng.uniform(), r=rng.uniform(0.0012, 0.0035), a=rng.uniform(0.5, 1.4),
                 ph=rng.uniform(0, 6.283), fx=int(rng.integers(1, 3)), fy=int(rng.integers(1, 3)),
                 ax=rng.uniform(0.01, 0.04), ay=rng.uniform(0.015, 0.05)) for _ in range(90)]
    vign = 1.0 - 0.75 * (((xx - 0.5) ** 2 + (yy - 0.5) ** 2) * 2.2)
    vign = np.clip(vign, s.get("vign", 0.45), 1.0)[..., None]
    return s, grad, ang, dist, stof, vign, xx, yy


def frame(t, st):
    s, grad, ang, dist, stof, vign, xx, yy = st
    ph = 2 * math.pi * t
    img = grad.copy()
    licht, stofc = hexrgb(s["licht"]), hexrgb(s["stof"])
    # twee overlappende bundels die heel langzaam in sterkte en hoek schommelen (geheel aantal perioden = naadloze lus)
    bundel = np.zeros_like(xx)
    for k, (dh, br, snel, fase) in enumerate([(0.0, 1.0, 1, 0.0), (0.16, 0.55, 2, 1.7), (-0.20, 0.45, 1, 3.1)]):
        a0 = s["hoek"] + dh + 0.025 * math.sin(ph * snel + fase)
        w = s["breedte"] * br * 0.5
        g = np.exp(-((ang - a0) / w) ** 2)
        g *= (0.80 + 0.20 * math.sin(ph * snel + fase * 2.0))
        bundel += g * (0.55 if k else 1.0)
    bundel *= np.exp(-dist * 0.55)       # zachte uitdoving met de afstand
    bundel *= (0.35 + 0.65 * yy)         # onderkant iets sterker, bovenkant blijft rustig
    img += bundel[..., None] * licht[None, None] * s["sterkte"]
    # stof: kleine lichtpuntjes, alleen zichtbaar waar de bundel is
    gloed = np.clip(bundel * 1.6, 0.05, 1.0)
    for p in stof:
        px = (p["x"] + p["ax"] * math.sin(ph * p["fx"] + p["ph"])) % 1.0
        py = (p["y"] + p["ay"] * math.sin(ph * p["fy"] + p["ph"] * 1.3)) % 1.0
        tw = 0.55 + 0.45 * math.sin(2 * ph + p["ph"] * 3)
        x0, y0 = int(px * W), int(py * H)
        r = max(2, int(p["r"] * W * 4))
        ys, ye, xs, xe = max(0, y0 - r), min(H, y0 + r + 1), max(0, x0 - r), min(W, x0 + r + 1)
        if ys >= ye or xs >= xe:
            continue
        d2 = ((xx[ys:ye, xs:xe] - px) ** 2 * (W / H) ** 2 + (yy[ys:ye, xs:xe] - py) ** 2) / (p["r"] ** 2)
        img[ys:ye, xs:xe] += (np.exp(-d2) * p["a"] * tw * gloed[ys:ye, xs:xe] * 0.9)[..., None] * stofc[None, None]
    img = np.clip(img * vign, 0, 1)
    return (img * 255).astype(np.uint8)


def main():
    argv = sys.argv[1:]
    still, secs = None, 24
    if '--still' in argv:
        i = argv.index('--still'); still = argv[i + 1]; del argv[i:i + 2]
    if '--secs' in argv:
        i = argv.index('--secs'); secs = int(argv[i + 1]); del argv[i:i + 2]
    stijl, out = argv[0], argv[1]
    st = build(stijl)
    if still:
        from PIL import Image
        Image.fromarray(frame(0.3, st)).resize((1920, 1080), Image.LANCZOS).save(still, quality=92)
    if out == '-':
        return
    n = FPS * secs
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-vf', 'scale=1920:1080:flags=bicubic,noise=alls=3:allf=t', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        pr.stdin.write(frame(i / n, st).tobytes())
    pr.stdin.close()
    pr.wait()


if __name__ == '__main__':
    main()
