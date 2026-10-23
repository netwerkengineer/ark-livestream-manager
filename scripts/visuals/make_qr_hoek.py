#!/usr/bin/env python3
"""Givt-QR als compacte kaart voor in de hoek van het beeld (OBS), passend bij de lower thirds uit FreeShow (lichte balk met teal lijn).
Schermvullende transparante PNG, 1920x1080: in OBS gewoon over het hele beeld plaatsen.

Gebruik: make_qr_hoek.py <oud-New-Givt.png> <uitvoermap>
Schrijft twee varianten: boven de lower third (rechts uitgelijnd met de tekstbalk) en rechtsonder (zonder lower third).
"""
import os, sys
from PIL import Image, ImageChops
from make_obs_afbeeldingen import W, H, DONKER, TEAL, f, rgb, tekst, rrect, qr_afbeelding, givt_kolom

KAART_B, KAART_H = 320, 372
SCHAAL = 0.75  # compact: de kaart blijft een hoekje van het beeld, de QR is dan ~213 px (scant nog prima)


def wordmark(oud):
    """Givt-woordmerk uit de bestaande afbeelding (bovenste rij van de Givt-kolom), bijgesneden."""
    k = givt_kolom(oud).crop((0, 0, 350, 80)).convert("RGB")
    bb = ImageChops.difference(k, Image.new("RGB", k.size, (255, 255, 255))).getbbox()
    return k.crop(bb).convert("RGBA")


def kaart(oud):
    c = Image.new("RGBA", (KAART_B, KAART_H), (0, 0, 0, 0))
    rrect(c, (0, 0, KAART_B, KAART_H), 26, (246, 248, 248, 250))
    rrect(c, (0, KAART_H - 8, KAART_B, KAART_H), 4, rgb(TEAL) + (255,))
    rrect(c, (26, KAART_H - 8, KAART_B - 26, KAART_H), 0, rgb(TEAL) + (255,))
    tekst(c, "Geef via", f("zwaar", 30), 0, 24, 18, DONKER, schaduw=0)
    wm = wordmark(oud); h = 40; wm = wm.resize((int(wm.width * h / wm.height), h), Image.LANCZOS)
    c.alpha_composite(wm, (24 + int(f("zwaar", 30).getlength("Geef via")) + 16, 17))
    qr = qr_afbeelding(6)  # 6 px per punt, rand 4 -> verkleind naar de kaartbreedte
    qr = qr.resize((284, 284), Image.LANCZOS)
    c.alpha_composite(qr, ((KAART_B - 284) // 2, 66))
    return c.resize((int(KAART_B * SCHAAL), int(KAART_H * SCHAAL)), Image.LANCZOS)


def zet(oud, uit, rechts, onder):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); k = kaart(oud); img.alpha_composite(k, (rechts - k.width, onder - k.height)); img.save(uit)


if __name__ == "__main__":
    oud = Image.open(sys.argv[1]).convert("RGBA"); uit = sys.argv[2]; os.makedirs(uit, exist_ok=True)
    zet(oud, os.path.join(uit, "QR Givt - boven lower third.png"), 1860, 822)
    zet(oud, os.path.join(uit, "QR Givt - rechtsonder.png"), 1860, 1030)
    print("klaar")
