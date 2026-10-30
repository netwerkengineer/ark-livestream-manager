#!/usr/bin/env python3
"""Woorden-visual voor een lied: de kernwoorden van de liedtekst (de woorden die in de dynamische lyrics een eigen kleur krijgen) vliegen van alle kanten
door het beeld, ongeveer op het moment dat ze gezongen worden; bij de heftige delen komt af en toe een zin groot in beeld of zoomt het beeld er doorheen.
Het resultaat is een WebM met transparantie (VP9), bedoeld als overlay ONDER de dia (de liedtekst staat dan als gewone tekst in het bovenste derde, zie
make_dynamische_song.py --varianten woorden). De bovenste 420 px blijven vrijwel leeg: daar staat de liedtekst.

De tijden komen uit een tijdlijn-JSON met events (t + lines) zoals washed_tijdlijn.json; 0 s = het begin van de opname (`start` in die JSON).
Eigen ontwerp in de kleuren van de Ark-paletten (rustig = ark, heftig = goud); lettertype Montserrat Bold (OFL, public/fonts/montserrat).

Gebruik:
  make_woorden_visual.py --tijdlijn washed_tijdlijn.json --cues-uit cues.json --alleen-cues        (alleen de cues bekijken)
  make_woorden_visual.py --tijdlijn washed_tijdlijn.json --stilstaand 12,41,116 --map beelden      (losse beelden op een donkere achtergrond)
  make_woorden_visual.py --tijdlijn washed_tijdlijn.json --uit woorden-washed.webm [--preview voorbeeld.mp4]
Handmatig bijsturen: --cues-in cues.json (eigen aangepaste cues i.p.v. de automatische).
"""
import argparse, json, math, os, random, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageChops
from make_dynamische_lyrics import KERN

HIER = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HIER, "..", "..", "public", "fonts", "montserrat")
# lettertypen: (bestand, index in het .ttc) voor gewoon en cursief; schaal = vergroting t.o.v. de px in de cues (smalle letters hebben meer px nodig voor dezelfde hoogte); cap = grootste px van een zin
LETTERS = {
    "din": {"n": ("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", 0), "i": ("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", 0), "schaal": 1.3, "cap": 420},   # strak en smal; geen cursief
    "avenir": {"n": ("/System/Library/Fonts/Avenir Next Condensed.ttc", 8), "i": ("/System/Library/Fonts/Avenir Next Condensed.ttc", 9), "schaal": 1.25, "cap": 380},
    "montserrat": {"n": (os.path.join(FONTS, "montserrat-latin-700-normal.woff2"), 0), "i": (os.path.join(FONTS, "montserrat-latin-700-italic.woff2"), 0), "schaal": 1.0, "cap": 300},   # OFL, in public/fonts
}
LETTER = LETTERS["din"]


def laad(cursief, px):
    pad, index = LETTER["i" if cursief else "n"]
    return ImageFont.truetype(pad, px, index=index)
W, H = 1920, 1080
BOVEN = 420   # hierboven staat de liedtekst; de woorden verdwijnen er zacht in
HEFTIG = r"washed in the water|as good as new|all because of you|here i come|took away my shame|nailed it to the cross"
ACCENT = {"clean", "shame", "calvary", "ransomed", "redeemed", "mercy", "tree", "overcome", "supreme", "dancing", "stained"}   # zacht en wit, geen kernwoorden
PAL = {"rustig": ((216, 255, 248), (79, 209, 197), (77, 182, 172)), "heftig": ((255, 241, 201), (255, 179, 71), (255, 170, 60)), "accent": ((255, 255, 255), (190, 225, 225), None)}
# zin (regex) -> hoe hij groot in beeld komt; elke 2e keer, afwisselend zoom / doorzoom
ZINNEN = [(r"washed in the blood", "Washed in the blood"), (r"as good as new", "As good as new"), (r"all because of you", "All because of You"),
          (r"took away my shame", "You took away my shame"), (r"nailed it to the cross", "Nailed to the cross"), (r"hallelujah here i come", "Here I come!")]


def secs(t):
    m, _, x = t.partition(":"); return int(m) * 60 + float(x)


def woorden_van(regel):
    return re.findall(r"[\w'’]+", regel)


def event_cues(lines, ts, span, st, extra=True, forceer_zoom=False):
    """De cues van één stuk liedtekst (regels) dat op ts begint en ongeveer `span` seconden duurt. st = {"richting": 0, "teller": {}, "zoomsoort": 0} houdt bij wat er al geweest is."""
    cues = []; tekst = " ".join(lines); heftig = bool(re.search(HEFTIG, tekst, re.I)); alle = [(w, li) for li, l in enumerate(lines) for w in woorden_van(l)]
    for k, (w, li) in enumerate(alle):
        moment = ts + span * (k + 0.5) / max(1, len(alle)); laag = w.lower().strip("'’")
        if laag in KERN:
            cues.append({"t": round(moment, 2), "soort": "vlieger", "tekst": w, "stijl": "heftig" if heftig else "rustig", "van": "lrbo"[st["richting"] % 4], "dur": 3.0 if heftig else 5.5, "px": 210 if heftig else 150, "cursief": True}); st["richting"] += 1
        elif extra and not heftig and laag in ACCENT:
            cues.append({"t": round(moment, 2), "soort": "vlieger", "tekst": w, "stijl": "accent", "van": "lrbo"[(st["richting"] + 2) % 4], "dur": 7.0, "px": 90, "cursief": False}); st["richting"] += 1
    gelezen = False
    for rx, zin in ZINNEN:
        if re.search(rx, tekst, re.I) and heftig:
            n = st["teller"].get(zin, 0); st["teller"][zin] = n + 1; gelezen = True
            if n % 2 == 0 or forceer_zoom:
                regel = next((li for li, l in enumerate(lines) if re.search(rx, l, re.I)), 0); moment = ts + span * regel / max(1, len(lines))
                cues.append({"t": round(moment, 2), "soort": ("zoom", "doorzoom")[st["zoomsoort"] % 2], "tekst": zin, "stijl": "heftig", "dur": 2.6, "px": 0, "cursief": False}); st["zoomsoort"] += 1
            break
    if not gelezen and not heftig and re.fullmatch(r"oh hallelujah", tekst, re.I):
        n = st["teller"].get("oh", 0); st["teller"]["oh"] = n + 1
        if n % 2 == 1: cues.append({"t": round(ts + 0.4, 2), "soort": "zoom", "tekst": "Hallelujah", "stijl": "rustig", "dur": 3.0, "px": 0, "cursief": True})
    return cues


def plekken(cues, rng):
    """Vaste plekken (y voor links/rechts, x voor boven/onder), zo botsen vliegers niet; en een kleine draaiing per woord."""
    gebruikt = {}
    for c in cues:
        if c["soort"] != "vlieger": continue
        lijst = [480, 610, 740, 870, 990] if c["van"] in "lr" else [330, 700, 1050, 1400, 1700]
        sleutel = c["van"] in "lr"; vrij = sorted((gebruikt.get((sleutel, p), -99), rng.random(), p) for p in lijst); p = vrij[0][2]; gebruikt[(sleutel, p)] = c["t"] + c["dur"] * 0.5; c["pos"] = p
        c["hoek"] = round(rng.uniform(-6, 6), 1)


def cues_maken(tl, extra=True, seed=7):
    """Cues uit de tijdlijn: kernwoorden als vliegers (van links, rechts, boven en onder), accentwoorden zacht, heftige zinnen groot."""
    rng = random.Random(seed); t0 = secs(tl["start"]); ev = tl["events"]; cues = []; st = {"richting": 0, "teller": {}, "zoomsoort": 0}
    for i, e in enumerate(ev):
        if not e["lines"]: continue
        ts = secs(e["t"]) - t0; te = (secs(ev[i + 1]["t"]) - t0) if i + 1 < len(ev) else ts + 6; span = max(2.0, (te - ts) * 0.85)
        cues += event_cues(e["lines"], ts, span, st, extra, forceer_zoom=i + 1 >= len(ev) - 2)
    cues.sort(key=lambda c: c["t"])
    laatste = -99   # grote zinnen niet te dicht op elkaar: dat zou onrustig worden
    for c in list(cues):
        if c["soort"] == "vlieger": continue
        if c["t"] - laatste < 7: cues.remove(c)
        else: laatste = c["t"]
    plekken(cues, rng)
    return cues


_sprites = {}


def sprite(tekst, px, stijl, cursief, hoek=0.0):
    sl = (tekst, px, stijl, cursief, hoek)
    if sl in _sprites: return _sprites[sl]
    font = laad(cursief, px)
    l, t, r, b = font.getbbox(tekst); pad = int(px * 0.7); w, h = r - l + 2 * pad, b - t + 2 * pad
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).text((pad - l, pad - t), tekst, font=font, fill=255)
    van, naar, gloed = PAL[stijl]
    kleur = ImageOps.colorize(Image.linear_gradient("L").transpose(Image.Transpose.ROTATE_90).resize((w, h)), van, naar)
    sp = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    schaduw = mask.filter(ImageFilter.GaussianBlur(px * 0.10)).point(lambda v: int(v * 0.6)); sp.paste(Image.new("RGBA", (w, h), (0, 0, 0, 255)), mask=schaduw)
    if gloed:
        g = mask.filter(ImageFilter.GaussianBlur(px * 0.20)).point(lambda v: min(255, int(v * 1.7))); sp.paste(Image.new("RGBA", (w, h), gloed + (255,)), mask=g)
    sp.paste(kleur.convert("RGBA"), mask=mask)
    if stijl == "accent": sp.putalpha(sp.getchannel("A").point(lambda v: int(v * 0.62)))
    if hoek: sp = sp.rotate(hoek, expand=True, resample=Image.Resampling.BICUBIC)
    _sprites[sl] = sp
    return sp


def zin_px(tekst, cursief, breed=1500):
    return min(LETTER["cap"], int(100 * breed / laad(cursief, 100).getlength(tekst)))


def plak(laag, sp, cx, cy, alpha=1.0):
    if alpha <= 0.01 or sp.width < 2 or sp.height < 2: return
    x, y = int(cx - sp.width / 2), int(cy - sp.height / 2); x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + sp.width), min(H, y + sp.height)
    if x1 <= x0 or y1 <= y0: return
    stuk = sp.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    if alpha < 0.99: stuk.putalpha(stuk.getchannel("A").point(lambda v: int(v * alpha)))
    laag.alpha_composite(stuk, (x0, y0))


def schaal(sp, s):
    if abs(s - 1) < 0.01: return sp
    return sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.Resampling.BILINEAR)


def vlieger_pos(c, sp, u):
    lin = u; zacht = 0.5 - 0.5 * math.cos(math.pi * u); v = 0.65 * lin + 0.35 * zacht
    golf = 16 * math.sin(2 * math.pi * (u * 1.4) + c["pos"] * 0.01)
    if c["van"] == "l": return -sp.width / 2 + (W + sp.width) * v, c["pos"] + golf
    if c["van"] == "r": return W + sp.width / 2 - (W + sp.width) * v, c["pos"] + golf
    if c["van"] == "b": return c["pos"] + golf, H + sp.height / 2 - (H + sp.height / 2 - 120) * v
    return c["pos"] + golf, 300 - sp.height / 2 + (H + sp.height - 300) * v


def beeld(cues, t, laag_v, laag_z):
    for c in cues:
        u = (t - c["t"]) / c["dur"] if c["soort"] == "vlieger" else (t - (c["t"] - 0.15)) / c["dur"]
        if c["soort"] == "vlieger": u = (t - (c["t"] - c["dur"] * 0.4)) / c["dur"]
        if not 0 <= u <= 1: continue
        if c["soort"] == "vlieger":
            sp = sprite(c["tekst"], int(c["px"] * LETTER["schaal"]), c["stijl"], c["cursief"], c.get("hoek", 0)); a = min(1, u / 0.1, (1 - u) / 0.1)
            s = 0.92 + 0.16 * u if c["stijl"] == "heftig" else 1.0
            x, y = vlieger_pos(c, sp, u); plak(laag_v, schaal(sp, s), x, y, a)
            if c["stijl"] == "heftig":   # korte spoor bij de snelle woorden
                for k, f in ((1, 0.35), (2, 0.18)):
                    uu = u - 0.022 * k
                    if uu >= 0: x2, y2 = vlieger_pos(c, sp, uu); plak(laag_v, schaal(sp, s), x2, y2, a * f)
        else:
            px = zin_px(c["tekst"], c["cursief"]); sp = sprite(c["tekst"], px, c["stijl"], c["cursief"])
            if c["soort"] == "zoom":   # van klein naar groot met een kleine overshoot, dan langzaam groter en weg
                s = (0.55 + 0.51 * (u / 0.13)) if u < 0.13 else (1.06 - 0.06 * ((u - 0.13) / 0.1) if u < 0.23 else 1.0 + 0.10 * ((u - 0.23) / 0.77))
                a = min(1, u / 0.08, (1 - u) / 0.22); y = 720
            else:                      # het beeld vliegt door de zin heen
                s = 0.75 + 2.3 * (u ** 2.1); a = min(1, u / 0.15, (1 - u) / 0.4); y = 640
            plak(laag_z, schaal(sp, s), W / 2, y, a)


def masker(vloer):
    m = Image.new("L", (W, BOVEN), 255); d = ImageDraw.Draw(m)
    for y in range(BOVEN):
        v = max(0, min(1, (y - 280) / 140)); d.line([(0, y), (W, y)], fill=int(255 * max(vloer, v)))
    return m


MASK_V, MASK_Z = masker(0.0), masker(0.35)


def frame(cues, t):
    v = Image.new("RGBA", (W, H), (0, 0, 0, 0)); z = Image.new("RGBA", (W, H), (0, 0, 0, 0)); beeld(cues, t, v, z)
    for laag, m in ((v, MASK_V), (z, MASK_Z)):
        top = laag.crop((0, 0, W, BOVEN)); top.putalpha(ImageChops.multiply(top.getchannel("A"), m)); laag.paste(top, (0, 0))
    v.alpha_composite(z)
    return v


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--tijdlijn", required=True); ap.add_argument("--uit"); ap.add_argument("--preview", help="mp4 op een donkere achtergrond (halve resolutie)")
    ap.add_argument("--cues-uit"); ap.add_argument("--cues-in"); ap.add_argument("--alleen-cues", action="store_true"); ap.add_argument("--zonder-extra", action="store_true", help="geen zachte accentwoorden, alleen de kernwoorden")
    ap.add_argument("--stilstaand", help="tijden (s, komma's): losse beelden op donker, in --map"); ap.add_argument("--map", default="."); ap.add_argument("--fps", type=int, default=30); ap.add_argument("--duur", type=float, help="seconden (standaard: tot het laatste event + 6)"); ap.add_argument("--seed", type=int, default=7); ap.add_argument("--vanaf", type=float, default=0.0, help="begin de video op dit moment van de opname (s): de video start dan op de eerste liedtekstdia i.p.v. op de startdia (bij Washed 8)"); ap.add_argument("--letter", default="din", choices=LETTERS, help="lettertype van de woorden (din = strak en smal, standaard)")
    a = ap.parse_args(); LETTER.update(LETTERS[a.letter]); tl = json.load(open(a.tijdlijn, encoding="utf-8"))
    cues = json.load(open(a.cues_in, encoding="utf-8")) if a.cues_in else cues_maken(tl, not a.zonder_extra, a.seed)
    if a.cues_uit: json.dump(cues, open(a.cues_uit, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    soorten = {}
    for c in cues: soorten[c["soort"]] = soorten.get(c["soort"], 0) + 1
    print(f"{len(cues)} cues: {soorten}")
    if a.alleen_cues:
        for c in cues: print(f"{c['t']:7.1f}s {c['soort']:9} {c['stijl']:7} {c.get('van', ''):1} {c['tekst']}")
        return
    if a.stilstaand:
        os.makedirs(a.map, exist_ok=True)
        for t in (float(x) for x in a.stilstaand.split(",")):
            bg = Image.new("RGBA", (W, H), (11, 18, 32, 255)); bg.alpha_composite(frame(cues, t)); p = os.path.join(a.map, f"beeld-{t:06.1f}.png"); bg.convert("RGB").resize((960, 540)).save(p); print(p)
        return
    t0 = secs(tl["start"]); duur = (a.duur or (secs(tl["events"][-1]["t"]) - t0 + 6)) - a.vanaf; n = int(duur * a.fps)
    pr = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(a.fps), "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                           "-b:v", "0", "-crf", "32", "-auto-alt-ref", "0", "-row-mt", "1", "-cpu-used", "4", a.uit], stdin=subprocess.PIPE)
    for f in range(n):
        pr.stdin.write(frame(cues, a.vanaf + f / a.fps).tobytes())
        if f % 300 == 0: print(f"{f}/{n}", flush=True)
    pr.stdin.close(); pr.wait(); print("klaar:", a.uit)
    if a.preview:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x0b1220:s={W}x{H}:r={a.fps}", "-c:v", "libvpx-vp9", "-i", a.uit, "-filter_complex", "[0][1]overlay=shortest=1,scale=960:540",
                        "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", a.preview]); print("voorbeeld:", a.preview)


if __name__ == "__main__":
    main()
