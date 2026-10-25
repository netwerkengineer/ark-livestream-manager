#!/usr/bin/env python3
"""Een lichtstreep (glans) die schuin over het tekstvlak veegt, als WebM-loop met transparantie (voor over de tekst, met mix-blend-mode screen).
Gebruik: make_glans_loop.py <uitvoer.webm> [--seconden 12] [--fps 25]   Resolutie 960x540; twee vegen per loop, naadloos.
"""
import argparse, math, subprocess
import numpy as np

W, H = 960, 540


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("uit"); ap.add_argument("--seconden", type=float, default=12.0); ap.add_argument("--fps", type=int, default=25); a = ap.parse_args()
    n = int(a.seconden * a.fps); yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    hoek = math.radians(20); u = xx * math.cos(hoek) + yy * math.sin(hoek)
    venster = np.exp(-(((yy - H * .5) / (H * .27)) ** 4))  # alleen rond het tekstvlak
    umin, umax = float(u.min()) - 120, float(u.max()) + 120
    pr = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(a.fps), "-i", "-",
                           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0", a.uit], stdin=subprocess.PIPE)
    for f in range(n):
        t = (f / n * 2) % 1.0                      # twee vegen per loop
        pos = umin + (umax - umin) * min(1.0, t / .55)  # veeg in de eerste 55% van elke helft, daarna rust
        streep = np.exp(-(((u - pos) ** 2) / (2 * 38 ** 2))) * (1.0 if t < .6 else 0.0) * venster
        alpha = np.clip(streep * .55, 0, 1)
        rgb = np.dstack([np.full((H, W), 235, np.float32), np.full((H, W), 255, np.float32), np.full((H, W), 250, np.float32)])
        pr.stdin.write(np.dstack([rgb, alpha * 255]).astype(np.uint8).tobytes())
    pr.stdin.close(); pr.wait(); print("klaar:", a.uit)


if __name__ == "__main__":
    main()
