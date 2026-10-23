#!/usr/bin/env python3
"""Complete kerkdia's (1920x1080 jpg) met tekst, op de tien Ark-achtergronden uit make_kerk_achtergronden.py.

Per onderwerp een submap, met Nederlandse en Engelse versies waar dat past:
  Welkom - Welcome       welkom-NN-<achtergrond>.jpg, welcome-NN-<achtergrond>.jpg
  Bedankt - Thanks       bedankt-NN-..., thanks-NN-...
  Gebed - Prayer, Aanbidding - Worship, Preek - Message, Collecte - Giving   (Nederlands woord, Engelse regel eronder)

Gebruik: make_kerk_dias.py <achtergrondmap> <uitvoermap> [--preview overzicht.jpg]
Elke achtergrond heeft een vaste lettertype-stijl (blok, schrijfletters, kader of licht), zodat de dia's per achtergrond bij
elkaar passen. Lettertypen zijn die van macOS (Avenir Next, Snell Roundhand, Savoye LET).
"""
import argparse, glob, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FONTS = {
    'blok': ('/System/Library/Fonts/Avenir Next.ttc', 8),         # Avenir Next Heavy
    'licht': ('/System/Library/Fonts/Avenir Next.ttc', 5),        # Avenir Next Medium
    'script': ('/System/Library/Fonts/Supplemental/SnellRoundhand.ttc', 2),  # Snell Roundhand Black
    'savoye': ('/System/Library/Fonts/Supplemental/Savoye LET.ttc', 0),
    'klein': ('/System/Library/Fonts/Avenir Next.ttc', 5),
}

# achtergrond-volgnummer -> (stijl, hoofdkleur, kleur regel, kaderkleur)
STIJLEN = {
    1: ('blok', '#ffffff', '#9ff3e6'), 2: ('script', '#ffffff', '#ffe3f1'), 3: ('kader', '#ffffff', '#f0be50'),
    4: ('script', '#ffffff', '#ffd0dc'), 5: ('licht', '#ffffff', '#cfe0ff'), 6: ('savoye', '#f7dc8c', '#fff1c9'),
    7: ('blok', '#ffffff', '#ffffff'), 8: ('script', '#ffffff', '#e4fffb'), 9: ('script', '#ffffff', '#fff0c9'),
    10: ('blok', '#ffffff', '#ffd27a'),
}

# verticale verschuiving (px) per achtergrond, om fel licht in de achtergrond te ontwijken
VERSCHUIVING = {9: -150}

ONDERWERPEN = {  # map: [(bestandsvoorvoegsel, woord, regel eronder)]
    'Welkom - Welcome': [('welkom', 'Welkom', 'Fijn dat je er bent'), ('welcome', 'Welcome', "We're glad you're here")],
    'Bedankt - Thanks': [('bedankt', 'Bedankt', 'Een gezegende week gewenst'), ('thanks', 'Thanks', 'Have a blessed week')],
    'Gebed - Prayer': [('gebed-prayer', 'Gebed', 'Prayer')],
    'Aanbidding - Worship': [('aanbidding-worship', 'Aanbidding', 'Worship')],
    'Preek - Message': [('preek-message', 'Preek', 'Message')],
    'Collecte - Giving': [('collecte-giving', 'Collecte', 'Giving')],
}


def font(naam, size):
    path, idx = FONTS[naam]
    return ImageFont.truetype(path, size, index=idx)


def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def breedte(tekst, f, spacing):
    return sum(f.getlength(c) for c in tekst) + spacing * max(0, len(tekst) - 1)


def passend(tekst, naam, size, spacing_em, max_w):
    """Verklein het lettertype tot de tekst in max_w past."""
    while size > 40:
        f = font(naam, size)
        if breedte(tekst, f, spacing_em * size) <= max_w: return f, spacing_em * size
        size -= 6
    f = font(naam, 40); return f, spacing_em * 40


def schrijf(img, tekst, f, spacing, cx, top, kleur, schaduw=0.55, gloed=None):
    """Tekst per teken (met letterafstand) gecentreerd op cx; met zachte schaduw en optioneel een gloed."""
    w = breedte(tekst, f, spacing); x = cx - w / 2
    laag = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(laag)
    for c in tekst:
        d.text((x, top), c, font=f, fill=rgb(kleur) + (255,)); x += f.getlength(c) + spacing
    if schaduw:
        s = Image.new('RGBA', (W, H), (0, 0, 0, 0)); s.putalpha(laag.getchannel('A').filter(ImageFilter.GaussianBlur(16)).point(lambda v: int(v * schaduw)))
        img.alpha_composite(s, (0, 10))
    if gloed:
        g = Image.new('RGBA', (W, H), rgb(gloed) + (0,)); g.putalpha(laag.getchannel('A').filter(ImageFilter.GaussianBlur(26)).point(lambda v: int(v * 0.55)))
        img.alpha_composite(g)
    img.alpha_composite(laag)
    return f.getbbox(tekst)


def dia(bg_path, woord, regel, nr):
    stijl, kleur, kleur2 = STIJLEN[nr]
    img = Image.open(bg_path).convert('RGBA')
    cx = W / 2; dy = VERSCHUIVING.get(nr, 0)
    if stijl == 'blok':
        tekst = woord.upper(); f, sp = passend(tekst, 'blok', 250, 0.06, 1560)
        top = 330 - f.size * 0.18 + dy
        schrijf(img, tekst, f, sp, cx, top, kleur)
        sub_top = top + f.size * 1.18
    elif stijl == 'licht':
        tekst = woord.upper(); f, sp = passend(tekst, 'licht', 220, 0.22, 1560)
        top = 340 - f.size * 0.18 + dy
        schrijf(img, tekst, f, sp, cx, top, kleur, 0.4)
        sub_top = top + f.size * 1.25
    elif stijl == 'kader':
        tekst = woord.upper(); f, sp = passend(tekst, 'licht', 190, 0.16, 1320)
        w = breedte(tekst, f, sp); top = 400 - f.size * 0.15 + dy
        d = ImageDraw.Draw(img)
        d.rectangle((cx - w / 2 - 70, top - 40, cx + w / 2 + 70, top + f.size * 1.02 + 20), outline=rgb(kleur2) + (255,), width=4)
        schrijf(img, tekst, f, sp, cx, top, kleur, 0.4)
        sub_top = top + f.size * 1.02 + 70
    else:  # script / savoye
        naam = 'script' if stijl == 'script' else 'savoye'
        f, sp = passend(woord, naam, 420 if naam == 'script' else 380, 0.0, 1500)
        top = 270 - f.size * 0.2 + dy
        schrijf(img, woord, f, sp, cx, top, kleur, 0.6, gloed=kleur2)
        sub_top = top + f.size * 1.12
    # regel eronder: kleine hoofdletters met veel letterafstand
    r = regel.upper(); fk, spk = passend(r, 'klein', 54, 0.22, 1500)
    schrijf(img, r, fk, spk, cx, sub_top, kleur2, 0.85)
    return img.convert('RGB')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('bgdir'); ap.add_argument('outdir'); ap.add_argument('--preview')
    a = ap.parse_args()
    bgs = sorted(glob.glob(os.path.join(a.bgdir, 'ark-achtergrond-*.jpg')))
    assert len(bgs) == 10, f'10 achtergronden verwacht, gevonden {len(bgs)}'
    gemaakt = {}
    for map_naam, items in ONDERWERPEN.items():
        os.makedirs(os.path.join(a.outdir, map_naam), exist_ok=True)
        for voorvoegsel, woord, regel in items:
            for bg in bgs:
                nr = int(os.path.basename(bg).split('-')[2]); slug = os.path.basename(bg)[len('ark-achtergrond-'):-4]
                out = os.path.join(a.outdir, map_naam, f'{voorvoegsel}-{slug}.jpg')
                dia(bg, woord, regel, nr).save(out, quality=88, subsampling=0)
                gemaakt.setdefault((map_naam, voorvoegsel), []).append(out)
        print('klaar:', map_naam, sum(len(v) for (m, _), v in gemaakt.items() if m == map_naam), 'bestanden')
    if a.preview:
        keuze = [gemaakt[('Welkom - Welcome', 'welkom')], gemaakt[('Bedankt - Thanks', 'thanks')]]
        tw, th = 400, 225; rij = 5
        sheet = Image.new('RGB', (rij * (tw + 8) + 8, 4 * (th + 8) + 8), (16, 18, 22))
        for g, lijst in enumerate(keuze):
            for i, p in enumerate(lijst):
                sheet.paste(Image.open(p).resize((tw, th), Image.LANCZOS), (8 + (i % rij) * (tw + 8), 8 + (g * 2 + i // rij) * (th + 8)))
        sheet.save(a.preview, quality=90)


if __name__ == '__main__':
    main()
