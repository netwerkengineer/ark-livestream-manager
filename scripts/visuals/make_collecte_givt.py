#!/usr/bin/env python3
"""Maakt de FreeShow-show "Collecte Givt" in de stijl van Welkom en Bedankt: Ark-achtergrond, het Ark Church-logo, tekst die zelf past
("verkleinen tot het past"), de livestream op de volledigscherm-stijl, en de QR-code van Givt scherp opnieuw gemaakt (zelfde inhoud).

Gebruik: make_collecte_givt.py <uitvoermap> [--client-path /Users/jeffreygo/Documents/FreeShow] [--livestream-output-id ID]
                              [--preview voorbeeld.png --still-dir map-met-ark.jpg-en-logo]
Schrijft <uitvoermap>/Collecte Givt.show en <uitvoermap>/givt-qr.png (die komt in <FreeShow>/Media/Ark Collecte/givt-qr.png).
De gegevens (naam, rekeningnummer, QR-inhoud) zijn overgenomen uit de bestaande afbeelding "New Givt Half" en staan hieronder in een
blok, zodat ze op een plek te controleren zijn. Het show-id blijft gelijk, zodat het sjabloon en projecten ernaar blijven verwijzen.
"""
import argparse, json, os, random, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_welkom_bedankt import item, run, logo_item, stijl_actie, rid, VIDEO_DIR, LOGO, VIDEO_STIJL_ID  # noqa: E402

# ---- gegevens (uit de bestaande afbeelding gehaald en gecontroleerd; IBAN-controlegetal klopt) ----------------------------
NAAM = "Evangelische Gemeente De Ark"
IBAN = "NL05INGB0000298205"
IBAN_WEERGAVE = " ".join(IBAN[i:i + 4] for i in range(0, len(IBAN), 4))
QR_DATA = "https://www.givtapp.net/download?code=NjFmN2VkMDE0ZTRjMDYxN2MwMDAuYzAwMDAwMDAwMDAx"
SHOW_ID, LAYOUT_ID = "e423f4fc7b1", "be423f4fc7b"
BINDINGS = ["895a7f65204", "6f4f4e5ab4c"]  # staan op de eerste dia van de oude show; blijven zo
QR_BESTAND = "Media/Ark Collecte/givt-qr.png"

TEAL = "#8ce8dc"
DONKER = "#0b2b33"


def vlak(left, top, w, h, kleur, radius):
    return {"style": f"left:{left}px;top:{top}px;width:{w}px;height:{h}px;background-color:{kleur};border-radius:{radius}px;",
            "type": "text", "align": "align-items:center;",
            "lines": [{"align": "text-align:center;", "text": [{"value": "", "style": ""}]}], "bindings": []}


def tekst(left, top, w, h, regels, align="left", valign="center"):
    """regels = [(tekst, grootte, gewicht, kleur, extra css)]"""
    t = item(left, top, w, h, [(run(x, g, wt, k, e), align) for x, g, wt, k, e in regels], align=align, valign=valign)
    return t


def maak_qr_png(pad):
    import qrcode
    from PIL import Image
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=24, border=4)
    qr.add_data(QR_DATA); qr.make(fit=True)
    img = qr.make_image(fill_color=DONKER, back_color="white").convert("RGB").resize((960, 960), Image.NEAREST)
    img.save(pad)


def dias(client):
    qr = f"{client}/{QR_BESTAND}"; logo = f"{client}/{LOGO}"
    d1 = [
        tekst(130, 120, 1000, 70, [("COLLECTE", 40, "bold", TEAL, "letter-spacing:10px;")]),
        tekst(130, 195, 1060, 150, [("Wilt u ons steunen?", 112, "bold", "#ffffff", "letter-spacing:-1px;")]),
        tekst(130, 350, 1060, 80, [("Dat kan op de volgende manieren.", 48, "300", "#ffffff", "opacity:0.92;")]),
        {"style": "left:135px;top:470px;width:120px;height:8px;background-color:#4db6ac;border-radius:4px;", "type": "text", "align": "align-items:center;",
         "lines": [{"align": "text-align:center;", "text": [{"value": "", "style": ""}]}], "bindings": []},
        tekst(130, 515, 1060, 70, [("Via een bankoverschrijving op rekeningnummer:", 42, "300", "#ffffff", "opacity:0.92;")]),
        tekst(130, 595, 1060, 90, [(NAAM, 62, "bold", "#ffffff", "")]),
        tekst(130, 690, 1060, 110, [(IBAN_WEERGAVE, 76, "bold", TEAL, "letter-spacing:2px;")]),
        vlak(1230, 200, 560, 680, "rgb(255 255 255 / 0.97)", 36),
        tekst(1250, 225, 520, 90, [("Of geef met de Givt-app", 38, "bold", DONKER, "text-shadow:none;")], align="center"),
        logo_item(1280, 320, 460, 460, qr),
        tekst(1250, 790, 520, 60, [("Scan de QR-code", 32, "300", "#36505a", "text-shadow:none;")], align="center"),
        logo_item(130, 905, 100, 101, logo),
    ]
    d2 = [
        tekst(160, 70, 1600, 150, [("Geef via de Givt-app", 104, "bold", "#ffffff", "letter-spacing:-1px;")], align="center"),
        vlak(640, 235, 640, 640, "rgb(255 255 255 / 0.97)", 40),
        logo_item(675, 270, 570, 570, qr),
        tekst(160, 905, 1600, 100, [("Scan de QR-code met de Givt-app en blijf gewoon geven", 44, "300", "#ffffff", "opacity:0.92;")], align="center"),
    ]
    return [("Collecte", d1), ("Givt-app", d2)]


def maak_show(client, output_id):
    random.seed("collecte-givt")
    slides, layout_slides, media = {}, [], {}
    vid_id = "arkark" + rid(5)
    media[vid_id] = {"name": "ark.mp4", "path": f"{client}/{VIDEO_DIR}/ark.mp4", "type": "video", "muted": True, "loop": True}
    media[rid()] = {"name": "givt-qr.png", "path": f"{client}/{QR_BESTAND}", "type": "image"}
    media[rid()] = {"name": os.path.basename(LOGO), "path": f"{client}/{LOGO}", "type": "image"}
    for i, (groep, items) in enumerate(dias(client)):
        sid = rid()
        slides[sid] = {"group": groep, "color": None, "settings": {}, "notes": "", "items": items}
        ls = {"id": sid, "background": vid_id}
        if i == 0:
            ls["bindings"] = BINDINGS
        if output_id:
            ls["actions"] = stijl_actie(output_id, VIDEO_STIJL_ID)
        layout_slides.append(ls)
    now = int(time.time() * 1000)
    content = {
        "name": "Collecte Givt", "private": False, "category": "presentation",
        "settings": {"activeLayout": LAYOUT_ID, "template": None},
        "timestamps": {"created": now, "modified": now, "used": now}, "quickAccess": {}, "meta": {},
        "slides": slides, "layouts": {LAYOUT_ID: {"name": "Default", "notes": "", "slides": layout_slides}}, "media": media,
    }
    return [SHOW_ID, content]


def preview_html(show, still_dir):
    import html
    css = """body{margin:0;background:#101216;color:#e8eaf0;font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px}
.row{display:flex;gap:14px;flex-wrap:wrap}.box{width:640px;height:360px;overflow:hidden;border-radius:6px;position:relative;border:1px solid #2a2f3a}
.slide{position:relative;width:1920px;height:1080px;transform:scale(0.3333);transform-origin:top left;overflow:hidden;background-size:cover;background-position:center}
.it{position:absolute;display:flex;box-sizing:border-box}.ln{width:100%}"""
    c = show[1]; lay = list(c["layouts"].values())[0]["slides"]
    out = [f"<!doctype html><meta charset=utf-8><title>Collecte Givt</title><style>{css}</style><div class=row>"]
    for x in lay:
        s = c["slides"][x["id"]]
        out.append(f"<div class=box><div class=slide style=\"background-image:url('{os.path.join(still_dir, 'ark.jpg')}')\">")
        for it in s["items"]:
            if it["type"] == "media":
                out.append(f"<div class=it style=\"{it['style']}\"><img src=\"{os.path.join(still_dir, os.path.basename(it['src']))}\" style='width:100%;height:100%;object-fit:contain'></div>")
                continue
            lines = ''.join(f"<div class=ln style=\"{l['align']}\">" + ''.join(f"<span style=\"{t['style']}\">{html.escape(t['value'])}</span>" for t in l['text']) + "</div>" for l in it["lines"])
            out.append(f"<div class=it style=\"{it['style']}{it['align']}\"><div style='width:100%'>{lines}</div></div>")
        out.append("</div></div>")
    out.append("</div>")
    return ''.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir"); ap.add_argument("--client-path", default="/Users/jeffreygo/Documents/FreeShow")
    ap.add_argument("--livestream-output-id"); ap.add_argument("--preview"); ap.add_argument("--still-dir")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    show = maak_show(a.client_path.rstrip("/"), a.livestream_output_id)
    with open(os.path.join(a.outdir, "Collecte Givt.show"), "w", encoding="utf-8") as f:
        json.dump(show, f, ensure_ascii=False)
    maak_qr_png(os.path.join(a.outdir, "givt-qr.png"))
    print("geschreven: Collecte Givt.show en givt-qr.png")
    if a.preview:
        with open(a.preview, "w", encoding="utf-8") as f:
            f.write(preview_html(show, a.still_dir or "."))


if __name__ == "__main__":
    main()
