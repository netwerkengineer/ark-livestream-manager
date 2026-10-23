#!/usr/bin/env python3
"""Nieuwe ontwerpen voor de afbeeldingen die OBS tijdens de livestream gebruikt, in de stijl van Welkom/Bedankt/Collecte (Ark-teal):

  - "New Givt" als HALVE BREEDTE (linkerhelft transparant voor de video, rechterhelft het ontwerp)
  - "New Givt" als LOWER THIRD (alleen een balk onderin, de rest transparant)
  - "YouTube end screen" gecentreerd, en een variant met de rechterkant vrij voor de video's/knoppen die YouTube er overheen zet

Gebruik: make_obs_afbeeldingen.py <oud-New-Givt.png> <ark-still.jpg> <logo-wit.png> <uitvoermap>
Het Givt-logo, de uitleg en de winkelknoppen komen uit de bestaande afbeelding (op 1:1, daar is het 1920 breed); de QR-code wordt
scherp opnieuw gemaakt met dezelfde inhoud. De gegevens staan in het blok hieronder.
"""
import os, sys
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 1920, 1080
NAAM = "Ark Church"
IBAN = "NL05INGB0000298205"
IBAN_WEERGAVE = " ".join(IBAN[i:i + 4] for i in range(0, len(IBAN), 4))
QR_DATA = "https://www.givtapp.net/download?code=NjFmN2VkMDE0ZTRjMDYxN2MwMDAuYzAwMDAwMDAwMDAx"
TEAL, TEAL_LICHT, DONKER = "#4db6ac", "#8ce8dc", "#0b2b33"
FONT = {"zwaar": ("/System/Library/Fonts/Avenir Next.ttc", 8), "medium": ("/System/Library/Fonts/Avenir Next.ttc", 5), "licht": ("/System/Library/Fonts/Avenir Next.ttc", 7)}


def f(naam, size):
    p, i = FONT[naam]; return ImageFont.truetype(p, size, index=i)


def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def breedte(t, fnt, sp):
    return sum(fnt.getlength(c) for c in t) + sp * max(0, len(t) - 1)


def passend(t, naam, size, maxw, sp_em=0.0):
    while size > 20:
        fnt = f(naam, size)
        if breedte(t, fnt, sp_em * size) <= maxw: return fnt, sp_em * size
        size -= 2
    return f(naam, 20), sp_em * 20


def tekst(img, t, fnt, sp, x, y, kleur, uitlijning="links", schaduw=0.5, alpha=255):
    """Tekst per teken (letterafstand). uitlijning: links (x = begin), midden (x = midden)."""
    w = breedte(t, fnt, sp); x0 = x if uitlijning == "links" else x - w / 2
    laag = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(laag); cx = x0
    for c in t:
        d.text((cx, y), c, font=fnt, fill=rgb(kleur) + (alpha,)); cx += fnt.getlength(c) + sp
    if schaduw:
        s = Image.new("RGBA", img.size, (0, 0, 0, 0))
        s.putalpha(laag.getchannel("A").filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v * schaduw)))
        img.alpha_composite(s, (0, 8))
    img.alpha_composite(laag)


def rrect(img, box, radius, fill):
    """Afgeronde rechthoek met gladde randen (4x supersampling)."""
    x0, y0, x1, y1 = box; w, h = int(x1 - x0), int(y1 - y0)
    m = Image.new("L", (w * 4, h * 4), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1), radius=radius * 4, fill=255)
    m = m.resize((w, h), Image.LANCZOS); laag = Image.new("RGBA", (w, h), fill); laag.putalpha(m.point(lambda v: int(v * (fill[3] / 255 if len(fill) > 3 else 1))))
    img.alpha_composite(laag, (int(x0), int(y0)))


def qr_afbeelding(box_size):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box_size, border=4)
    qr.add_data(QR_DATA); qr.make(fit=True)
    return qr.make_image(fill_color=DONKER, back_color="white").convert("RGBA")


def givt_kolom(oud):
    """Givt-logo, uitleg en winkelknoppen uit de bestaande afbeelding, op wit (1:1, scherp)."""
    wit = Image.new("RGBA", oud.size, (255, 255, 255, 255)); wit.alpha_composite(oud)
    return wit.crop((1415, 690, 1765, 932))


def achtergrond(still):
    bg = Image.open(still).convert("RGB").resize((W, H), Image.LANCZOS).convert("RGBA")
    # lichte vignet voor diepte
    v = Image.new("L", (W, H), 0); d = ImageDraw.Draw(v); d.ellipse((-300, -200, W + 300, H + 200), fill=255)
    v = v.filter(ImageFilter.GaussianBlur(180)); donker = Image.new("RGBA", (W, H), (0, 8, 10, 255))
    return Image.composite(bg, donker, v.point(lambda p: int(110 + p * 0.57)))


def givt_kaart(img, x, y, qr_box, schaal, oud):
    """Witte afgeronde kaart met de QR-code links en de Givt-kolom rechts. Geeft (breedte, hoogte)."""
    qr = qr_afbeelding(qr_box); kolom = givt_kolom(oud)
    kolom = kolom.resize((int(kolom.width * schaal), int(kolom.height * schaal)), Image.LANCZOS)
    pad = 22; h = max(qr.height, kolom.height) + 2 * pad; w = pad + qr.width + 14 + kolom.width + pad
    rrect(img, (x, y, x + w, y + h), 28, (255, 255, 255, 250))
    img.alpha_composite(qr, (x + pad, y + (h - qr.height) // 2)); img.alpha_composite(kolom, (x + pad + qr.width + 14, y + (h - kolom.height) // 2))
    return w, h


def givt_halve_breedte(oud, still, uit):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    paneel = achtergrond(still).crop((960, 0, W, H)); img.alpha_composite(paneel, (960, 0))
    rrect(img, (960, 0, 968, H), 0, rgb(TEAL) + (255,))  # smalle teal lijn op de scheiding
    x, mw = 1050, 790
    tekst(img, "COLLECTE", f("zwaar", 38), 11, x, 100, TEAL_LICHT)
    fnt, sp = passend("Wilt u ons steunen?", "zwaar", 92, mw, -0.01); tekst(img, "Wilt u ons steunen?", fnt, sp, x, 150, "#ffffff")
    tekst(img, "Dat kan op de volgende manieren.", f("licht", 44), 0, x, 275, "#ffffff", alpha=235)
    rrect(img, (x + 4, 360, x + 124, 368), 4, rgb(TEAL) + (255,))
    tekst(img, "Via een bankoverschrijving op rekeningnummer:", passend("Via een bankoverschrijving op rekeningnummer:", "licht", 36, mw)[0], 0, x, 400, "#ffffff", alpha=235)
    fnt, sp = passend(NAAM, "zwaar", 56, mw); tekst(img, NAAM, fnt, sp, x, 455, "#ffffff")
    fnt, sp = passend(IBAN_WEERGAVE, "zwaar", 72, mw, 0.02); tekst(img, IBAN_WEERGAVE, fnt, sp, x, 535, TEAL_LICHT)
    tekst(img, "Of via de Givt-app op je smartphone:", f("licht", 36), 0, x, 650, "#ffffff", alpha=235)
    givt_kaart(img, x - 6, 720, 5, 0.96, oud)
    img.save(uit)


def givt_lower_third(oud, uit):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rrect(img, (60, 745, 1860, 1030), 30, (4, 24, 29, 232))
    rrect(img, (60, 745, 72, 1030), 6, rgb(TEAL) + (255,))
    x = 120
    tekst(img, "COLLECTE", f("zwaar", 30), 9, x, 775, TEAL_LICHT)
    tekst(img, "Wilt u ons steunen?", f("zwaar", 66), -1, x, 812, "#ffffff")
    tekst(img, "Via bankoverschrijving: " + NAAM, f("licht", 38), 0, x, 905, "#ffffff", alpha=235)
    tekst(img, IBAN_WEERGAVE, f("zwaar", 62), 2, x, 950, TEAL_LICHT)
    givt_kaart(img, 1190, 770, 4, 0.9, oud)
    img.save(uit)


def end_screen(still, logo, uit, variant):
    img = achtergrond(still); lg = Image.open(logo).convert("RGBA")
    if variant == "midden":
        l = lg.resize((330, int(330 * lg.height / lg.width)), Image.LANCZOS); img.alpha_composite(l, ((W - l.width) // 2, 130))
        tekst(img, "Bedankt voor het kijken", f("zwaar", 120), -1, W / 2, 520, "#ffffff", "midden", 0.55)
        rrect(img, (W // 2 - 70, 690, W // 2 + 70, 698), 4, rgb(TEAL) + (255,))
        tekst(img, "Een gezegende week gewenst", f("licht", 62), 0, W / 2, 740, "#ffffff", "midden", 0.5, 235)
    else:  # rechterkant vrij voor de video's en knoppen die YouTube erover zet
        l = lg.resize((260, int(260 * lg.height / lg.width)), Image.LANCZOS); img.alpha_composite(l, (150, 140))
        fnt, sp = passend("Bedankt voor", "zwaar", 112, 900, -0.01); tekst(img, "Bedankt voor", fnt, sp, 150, 470, "#ffffff")
        tekst(img, "het kijken", fnt, sp, 150, 590, "#ffffff")
        rrect(img, (156, 745, 276, 753), 4, rgb(TEAL) + (255,))
        tekst(img, "Een gezegende week gewenst", f("licht", 54), 0, 150, 785, "#ffffff", alpha=235)
    img.convert("RGB").save(uit, quality=94, subsampling=0)


def main():
    oud_pad, still, logo, uit = sys.argv[1:5]
    os.makedirs(uit, exist_ok=True); oud = Image.open(oud_pad).convert("RGBA")
    givt_halve_breedte(oud, still, os.path.join(uit, "New Givt (nieuw) - halve breedte.png"))
    givt_lower_third(oud, os.path.join(uit, "New Givt (nieuw) - lower third.png"))
    end_screen(still, logo, os.path.join(uit, "YouTube end screen (nieuw) - gecentreerd.jpg"), "midden")
    end_screen(still, logo, os.path.join(uit, "YouTube end screen (nieuw) - ruimte voor video's.jpg"), "links")
    print("klaar:", sorted(os.listdir(uit)))


if __name__ == "__main__":
    main()
