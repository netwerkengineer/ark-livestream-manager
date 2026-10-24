#!/usr/bin/env python3
""""Volg ons"-afbeeldingen voor OBS: lower third (transparant) en schermvullend, in de Ark-teal stijl van make_obs_afbeeldingen.py.

Gebruik: make_social_afbeelding.py <ark-still.jpg> <logo-wit.png> <uitvoermap> [--naam @arkchurch] [--youtube X] [--facebook X] [--instagram X] [--tiktok X]
Zonder opties staat overal --naam (een gezamenlijke naam). Per platform kan een eigen naam worden opgegeven.
"""
import argparse, math, os, subprocess
from PIL import Image, ImageDraw
from make_obs_afbeeldingen import W, H, TEAL, TEAL_LICHT, f, rgb, tekst, rrect, passend, achtergrond

SS = 4


def tegel(maat, kleur, tekenen):
    """Afgeronde tegel (kleur of (boven, onder)-verloop) met glyph; tekenen(draw, s) tekent op 4x schaal."""
    s = maat * SS
    if isinstance(kleur[0], tuple):
        t = Image.new("RGBA", (s, s)); d = ImageDraw.Draw(t)
        for y in range(s):
            k = y / s; d.line((0, y, s, y), fill=tuple(int(kleur[0][i] * (1 - k) + kleur[1][i] * k) for i in range(3)) + (255,))
    else:
        t = Image.new("RGBA", (s, s), kleur)
    laag = Image.new("RGBA", (s, s), (0, 0, 0, 0)); tekenen(ImageDraw.Draw(laag), s); t.alpha_composite(laag)
    m = Image.new("L", (s, s), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.23), fill=255); t.putalpha(m)
    return t.resize((maat, maat), Image.LANCZOS)


def g_youtube(d, s):
    d.rounded_rectangle((s * .17, s * .27, s * .83, s * .73), radius=s * .13, fill="white")
    d.polygon([(s * .43, s * .38), (s * .43, s * .62), (s * .64, s * .5)], fill=(255, 0, 0))


def g_facebook(d, s):
    fnt = f("zwaar", int(s * .95)); d.text((s * .56, s * .98), "f", font=fnt, fill="white", anchor="ms")


def g_instagram(d, s):
    w = int(s * .07)
    d.rounded_rectangle((s * .2, s * .2, s * .8, s * .8), radius=s * .18, outline="white", width=w)
    d.ellipse((s * .35, s * .35, s * .65, s * .65), outline="white", width=w)
    d.ellipse((s * .66, s * .26, s * .74, s * .34), fill="white")


def g_tiktok(d, s):
    def noot(dx, dy, kleur):
        x, y = s * .5 + dx, s * .5 + dy
        d.ellipse((x - s * .22, y + s * .05, x, y + s * .27), fill=kleur)
        d.rectangle((x - s * .075, y - s * .26, x - s * .005, y + s * .16), fill=kleur)
        d.pieslice((x - s * .075 - s * .22, y - s * .26 - s * .05, x - s * .075 + s * .22, y - s * .26 + s * .39), -90, 20, fill=kleur)
    noot(-s * .03, 0, (37, 244, 238)); noot(s * .03, 0, (254, 44, 85)); noot(0, 0, "white")


PLATFORMS = [("YouTube", ((255, 0, 0), (200, 0, 0)), g_youtube, "youtube"), ("Facebook", (24, 119, 242), g_facebook, "facebook"),
             ("Instagram", ((253, 160, 60), (190, 40, 150)), g_instagram, "instagram"), ("TikTok", (10, 10, 12), g_tiktok, "tiktok")]


def lower_third(namen, uit, dekkend=False):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rrect(img, (60, 800, 1860, 1030), 30, (4, 24, 29, 255 if dekkend else 232)); rrect(img, (60, 800, 72, 1030), 6, rgb(TEAL) + (255,))
    tekst(img, "VOLG ONS", f("zwaar", 30), 9, 120, 830, TEAL_LICHT)
    tekst(img, "Mis geen dienst", f("zwaar", 62), -1, 120, 870, "#ffffff")
    if len(set(namen.values())) == 1:  # overal dezelfde naam: vier pictogrammen en de naam één keer groot
        naam = next(iter(namen.values())); x = 740
        for i, (titel, kl, gl, sl) in enumerate(PLATFORMS): img.alpha_composite(tegel(110, kl, gl), (x + i * 135, 860))
        tekst(img, naam, passend(naam, "zwaar", 74, 1780 - (x + 4 * 135 + 20))[0], 0, x + 4 * 135 + 20, 875, TEAL_LICHT, schaduw=0)
        img.save(uit); return
    x = 700; kol = 540  # 2x2-raster: elke naam krijgt genoeg ruimte om leesbaar te blijven
    for i, (titel, kl, gl, sl) in enumerate(PLATFORMS):
        cx, cy = x + (i % 2) * kol, 822 + (i // 2) * 100
        img.alpha_composite(tegel(84, kl, gl), (cx, cy))
        tekst(img, namen[sl], passend(namen[sl], "zwaar", 40, kol - 120)[0], 0, cx + 100, cy + 2, "#ffffff", schaduw=0)
        tekst(img, titel, f("licht", 28), 0, cx + 100, cy + 48, TEAL_LICHT, schaduw=0)
    img.save(uit)


def schermvullend(still, logo, namen, uit):
    img = achtergrond(still); lg = Image.open(logo).convert("RGBA")
    l = lg.resize((240, int(240 * lg.height / lg.width)), Image.LANCZOS); img.alpha_composite(l, ((W - l.width) // 2, 90))
    tekst(img, "Volg ons", f("zwaar", 118), -1, W / 2, 380, "#ffffff", "midden", 0.55)
    rrect(img, (W // 2 - 70, 548, W // 2 + 70, 556), 4, rgb(TEAL) + (255,))
    kol = 400; x0 = (W - 4 * kol) // 2
    for i, (titel, kl, gl, sl) in enumerate(PLATFORMS):
        cx = x0 + i * kol + kol // 2
        img.alpha_composite(tegel(150, kl, gl), (cx - 75, 600))
        tekst(img, titel, f("zwaar", 40), 0, cx, 775, "#ffffff", "midden")
        tekst(img, namen[sl], passend(namen[sl], "licht", 34, kol - 30)[0], 0, cx, 835, TEAL_LICHT, "midden")
    img.convert("RGB").save(uit, quality=94, subsampling=0)


def animatie(png, uitmap, fps=30, in_s=0.7, houd_s=10.0, uit_s=0.6, suffix="", prefix="Volg ons - lower third animatie", y0=780, y1=1050, mov=True):
    """Lower third als video met transparantie: schuift van onder in, blijft staan, schuift weer weg. Schrijft MOV (ProRes 4444) en WebM (VP9)."""
    import numpy as np
    stil = Image.open(png).convert("RGBA"); balk = stil.crop((0, y0, W, y1)); schuif = 330

    def frame(k, alpha):
        """k = 0 (weg, onder beeld) .. 1 (op zijn plek)"""
        c = Image.new("RGBA", (W, H), (0, 0, 0, 0)); b = balk.copy()
        if alpha < 1: b.putalpha(b.getchannel("A").point(lambda v: int(v * alpha)))
        c.alpha_composite(b, (0, int(y0 + (1 - k) * schuif))); return np.asarray(c).tobytes()
    ease = lambda t: 1 - (1 - t) ** 3
    n_in, n_uit, n_houd = round(in_s * fps), round(uit_s * fps), round(houd_s * fps)
    frames = [frame(ease((i + 1) / n_in), min(1, (i + 1) / n_in * 1.6)) for i in range(n_in)]
    hou = frame(1, 1); uit = [frame(1 - ease((i + 1) / n_uit), 1 - (i + 1) / n_uit * .6) for i in range(n_uit)]
    for naam, opties in (([(f"{prefix}{suffix}.mov", ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"])] if mov else []) + [
                         (f"{prefix}{suffix}.webm", ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "24", "-auto-alt-ref", "0"])]):
        pr = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"] + opties + [os.path.join(uitmap, naam)],
                              stdin=subprocess.PIPE)
        for fr in frames: pr.stdin.write(fr)
        for _ in range(n_houd): pr.stdin.write(hou)
        for fr in uit: pr.stdin.write(fr)
        pr.stdin.close(); pr.wait()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("still"); ap.add_argument("logo"); ap.add_argument("uit")
    ap.add_argument("--naam", default="@arkchurchnl"); ap.add_argument("--animatie", action="store_true", help="ook de lower third als video (MOV en WebM met transparantie)"); ap.add_argument("--dekkend", action="store_true", help="ook een variant met een niet-doorzichtige balk (png, MOV en WebM met 'dekkend' in de naam)")
    for _, _, _, s in PLATFORMS: ap.add_argument("--" + s)
    a = ap.parse_args(); namen = {s: getattr(a, s) or a.naam for _, _, _, s in PLATFORMS}
    os.makedirs(a.uit, exist_ok=True)
    lower_third(namen, os.path.join(a.uit, "Volg ons - lower third.png"))
    schermvullend(a.still, a.logo, namen, os.path.join(a.uit, "Volg ons - schermvullend.jpg"))
    if a.animatie: animatie(os.path.join(a.uit, "Volg ons - lower third.png"), a.uit)
    if a.dekkend:
        lower_third(namen, os.path.join(a.uit, "Volg ons - lower third dekkend.png"), dekkend=True)
        if a.animatie: animatie(os.path.join(a.uit, "Volg ons - lower third dekkend.png"), a.uit, suffix=" dekkend")
    print("klaar")

