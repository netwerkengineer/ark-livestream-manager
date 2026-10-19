#!/usr/bin/env python3
"""Maakt een naadloos lus-achtergrondvideo (mp4) uit een kleurenschema.

Gebruik: make_visual.py <uitvoer.mp4> <seed> <kleur1> <kleur2> [kleur3] [--still still.jpg]
Kleuren zijn hex (bijv. ff9a2e). Eerste kleur = hoofdkleur (ook voor het licht), tweede = accent.
Rustig bewegende lichtvlekken op een donkere verloop, zodat tekst goed leesbaar blijft.
"""
import sys, subprocess, math
import numpy as np

W, H, FPS, SECS = 1280, 720, 24, 24
N = FPS * SECS

def hexrgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0

def build(colors, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xx /= W; yy /= H
    base_top = colors[0] * 0.10
    base_bot = colors[min(1, len(colors)-1)] * 0.28
    blobs = []
    for i in range(7):
        c = colors[i % len(colors)]
        blobs.append(dict(
            c=c, r=rng.uniform(0.18, 0.38), a=rng.uniform(0.35, 0.65),
            cx=rng.uniform(0.15, 0.85), cy=rng.uniform(0.2, 0.9),
            ax=rng.uniform(0.05, 0.18), ay=rng.uniform(0.04, 0.12),
            fx=int(rng.integers(1, 3)), fy=int(rng.integers(1, 3)),
            px=rng.uniform(0, 6.283), py=rng.uniform(0, 6.283)))
    parts = [dict(x=rng.uniform(), y=rng.uniform(), s=rng.uniform(0.002, 0.006), a=rng.uniform(0.25, 0.8),
                  ph=rng.uniform(0, 6.283), c=colors[int(rng.integers(0, len(colors)))] * 0.5 + 0.5) for _ in range(60)]
    vign = 1.0 - 0.55 * (((xx - 0.5) ** 2 + (yy - 0.5) ** 2) * 2.0)
    vign = np.clip(vign, 0.35, 1.0)[..., None]
    grad = (base_top[None, None] * (1 - yy[..., None]) + base_bot[None, None] * yy[..., None])
    return blobs, parts, grad, vign, xx, yy

def frame(t, blobs, parts, grad, vign, xx, yy):
    img = grad.copy()
    ph = 2 * math.pi * t
    for b in blobs:
        cx = b['cx'] + b['ax'] * math.sin(ph * b['fx'] + b['px'])
        cy = b['cy'] + b['ay'] * math.sin(ph * b['fy'] + b['py'])
        d2 = ((xx - cx) ** 2 * (W / H) ** 2 + (yy - cy) ** 2) / (b['r'] ** 2)
        g = np.exp(-d2 * 1.8) * b['a'] * (0.85 + 0.15 * math.sin(ph + b['px']))
        img += g[..., None] * b['c'][None, None]
    for p in parts:
        px = (p['x'] + 0.02 * math.sin(ph + p['ph'])) % 1.0
        py = (p['y'] - t * 0.0 + 0.03 * math.sin(2 * ph + p['ph'])) % 1.0
        tw = 0.5 + 0.5 * math.sin(2 * ph + p['ph'] * 3)
        d2 = ((xx - px) ** 2 * (W / H) ** 2 + (yy - py) ** 2) / (p['s'] ** 2)
        img += (np.exp(-d2) * p['a'] * tw * 0.6)[..., None] * p['c'][None, None]
    img = np.clip(img * vign, 0, 1)
    return (img * 255).astype(np.uint8)

def main():
    argv = sys.argv[1:]
    stills = None
    if '--still' in argv:
        i = argv.index('--still'); stills = argv[i + 1]; del argv[i:i + 2]
    out, seed, cols = argv[0], int(argv[1]), [hexrgb(c) for c in argv[2:]]
    blobs, parts, grad, vign, xx, yy = build(cols, seed)
    if stills:
        from PIL import Image
        Image.fromarray(frame(0.3, blobs, parts, grad, vign, xx, yy)).save(stills, quality=90)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-vf', 'scale=1920:1080:flags=bicubic,noise=alls=3:allf=t', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(N):
        pr.stdin.write(frame(i / N, blobs, parts, grad, vign, xx, yy).tobytes())
    pr.stdin.close(); pr.wait()

if __name__ == '__main__':
    main()
