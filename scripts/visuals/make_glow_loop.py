#!/usr/bin/env python3
"""Zachte bewegende lichtlaag (lichtvlekken en glinsters) als naadloze WebM-loop met transparantie, om over een achtergrondvideo te leggen.

Gebruik: make_glow_loop.py <uitvoer.webm> [--palet ark|neon|goud] [--seconden 12] [--fps 25]
Resolutie 960x540 (FreeShow rekt hem schermvullend op; zachte vlekken verliezen daar niets). Alle bewegingen zijn periodiek in de looptijd, dus de loop is naadloos.
"""
import argparse, math, subprocess, sys
import numpy as np

W, H = 960, 540
PALETTEN = {
    "ark": [(77, 182, 172), (140, 232, 220), (60, 150, 200), (200, 170, 90)],
    "neon": [(80, 240, 255), (255, 100, 220), (120, 120, 255), (60, 255, 200)],
    "goud": [(255, 190, 70), (255, 125, 15), (255, 230, 160), (220, 120, 60)],
}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("uit"); ap.add_argument("--palet", default="ark", choices=PALETTEN)
    ap.add_argument("--seconden", type=float, default=12.0); ap.add_argument("--fps", type=int, default=25); a = ap.parse_args()
    rng = np.random.default_rng(7); kleuren = PALETTEN[a.palet]; n_frames = int(a.seconden * a.fps)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    blobs = [dict(cx=rng.uniform(.1, .9), cy=rng.uniform(.15, .85), ax=rng.uniform(.06, .18), ay=rng.uniform(.05, .14), fx=int(rng.integers(1, 3)), fy=int(rng.integers(1, 3)),
                  p=rng.uniform(0, 6.28), r=rng.uniform(150, 300), kleur=kleuren[i % len(kleuren)], sterkte=rng.uniform(.10, .20)) for i in range(7)]
    deeltjes = [dict(x=rng.uniform(0, 1), y=rng.uniform(0, 1), snelh=int(rng.integers(1, 3)), r=rng.uniform(1.2, 3.2), p=rng.uniform(0, 6.28), kleur=kleuren[int(rng.integers(0, len(kleuren)))]) for _ in range(46)]
    pr = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(a.fps), "-i", "-",
                           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0", "-row-mt", "1", a.uit], stdin=subprocess.PIPE)
    for f in range(n_frames):
        t = f / n_frames * 2 * math.pi
        rgb = np.zeros((H, W, 3), np.float32); alpha = np.zeros((H, W), np.float32)
        for b in blobs:
            cx = (b["cx"] + b["ax"] * math.sin(b["fx"] * t + b["p"])) * W; cy = (b["cy"] + b["ay"] * math.cos(b["fy"] * t + b["p"])) * H
            r = b["r"] * (1 + .12 * math.sin(t + b["p"]))
            g = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * (r / 2.2) ** 2))) * b["sterkte"]
            rgb += g[..., None] * np.array(b["kleur"], np.float32); alpha += g
        for d in deeltjes:  # glinsters: stijgen langzaam en flonkeren
            y = (d["y"] - d["snelh"] * t / (2 * math.pi) * .5) % 1.0; x = (d["x"] + .02 * math.sin(t * d["snelh"] + d["p"])) % 1.0
            flonker = .5 + .5 * math.sin(3 * t + d["p"])
            g = np.exp(-(((xx - x * W) ** 2 + (yy - y * H) ** 2) / (2 * d["r"] ** 2))) * (.25 + .6 * flonker) * (.4 + .6 * math.sin(math.pi * y))
            rgb += g[..., None] * np.array(d["kleur"], np.float32) * 1.4; alpha += g
        a_ = np.clip(alpha, 0, .55)
        kleur = np.clip(rgb / np.maximum(alpha[..., None], 1e-4), 0, 255)
        out = np.dstack([kleur, a_ * 255]).astype(np.uint8)
        pr.stdin.write(out.tobytes())
    pr.stdin.close(); pr.wait(); print("klaar:", a.uit)


if __name__ == "__main__":
    main()
