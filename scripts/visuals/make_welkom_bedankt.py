#!/usr/bin/env python3
"""Maakt voorstellen voor de FreeShow-shows "Welkom" en "Bedankt": een bewegende Ark-achtergrond met stevige tekst,
meerdere dia's; bij Welkom zit de Thema-dia (thema.jpg, het YouTube-plaatje van de week) er altijd in als laatste.

Gebruik: make_welkom_bedankt.py <uitvoermap-voor-.show-bestanden> [--client-path /Users/jeffreygo/Documents/FreeShow]
                                [--preview voorbeeld.html] [--still-dir map-met-ark.jpg,goud.jpg,nacht.jpg]
De showbestanden krijgen een eigen naam ("Welkom voorstel 1 (strak)"), zodat de bestaande Welkom en Bedankt blijven staan.
Is een voorstel gekozen, dan zet je de inhoud onder het id van de bestaande Welkom/Bedankt-show, zodat sjabloon en projecten blijven werken.
"""
import argparse, html, json, os, random, string, sys, time

FONT = "CMGSans, Avenir, Arial, sans-serif"
VIDEO_DIR = "Media/Motion backgrounds/Ark Visuals"
THEMA = "thema.jpg"


def rid(n=11):
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))


def run(text, size, weight="bold", color="#ffffff", extra=""):
    shadow = "text-shadow:0px 4px 28px rgb(0 0 0 / 0.55);"
    return {"value": text, "style": f"font-family:{FONT};font-size:{size}px;font-weight:{weight};line-height:1.05;color:{color};{shadow}{extra}"}


def item(left, top, width, height, lines, align="center", valign="center", extra=""):
    """lines = lijst van (tekstrun, uitlijning). Uitlijning left/center/right."""
    return {
        "style": f"left:{left}px;top:{top}px;width:{width}px;height:{height}px;padding:0px;{extra}",
        "type": "text",
        "align": f"align-items:{valign};",
        "lines": [{"align": f"text-align:{a};", "text": [r]} for r, a in lines],
        "bindings": [],
    }


def bar(left, top, width, color, height=8):
    return {"style": f"left:{left}px;top:{top}px;width:{width}px;height:{height}px;background-color:{color};border-radius:{height // 2}px;",
            "type": "text", "align": "align-items:center;", "lines": [{"align": "text-align:center;", "text": [{"value": "", "style": ""}]}], "bindings": []}


# ---- ontwerpen -----------------------------------------------------------------------------------------------------
def logo_item(left, top, width, height, src):
    return {"style": f"left:{left}px;top:{top}px;width:{width}px;height:{height}px;", "type": "media", "src": src, "fit": "contain"}


def strak(woord, regel1, regel2, kicker, logo=None, toon_kicker=False):
    teal = "#4db6ac"
    if logo:  # Welkom met het Ark Church-logo: logo boven het woord, klein logo onderaan op de volgende dia
        return [
            [logo_item(810, 100, 300, 304, logo),
             item(0, 430, 1920, 320, [(run(woord, 250, "bold", extra="letter-spacing:-3px;"), "center")]),
             bar(900, 790, 120, teal)] + ([item(0, 830, 1920, 100, [(run(kicker, 54, "300", extra="letter-spacing:10px;text-transform:uppercase;opacity:0.9;"), "center")])] if toon_kicker else []),
            [item(160, 300, 1600, 240, [(run(regel1, 150, "bold"), "center")]),
             bar(900, 570, 120, teal),
             item(160, 610, 1600, 120, [(run(regel2, 56, "300", extra="opacity:0.92;"), "center")]),
             logo_item(910, 870, 100, 101, logo)],
        ]
    return [
        [item(0, 300, 1920, 330, [(run(woord, 250, "bold", extra="letter-spacing:-3px;"), "center")]),
         bar(900, 660, 120, teal),
         item(0, 700, 1920, 120, [(run(kicker, 54, "300", extra="letter-spacing:10px;text-transform:uppercase;opacity:0.9;"), "center")])],
        [item(160, 330, 1600, 240, [(run(regel1, 150, "bold"), "center")]),
         bar(900, 600, 120, teal),
         item(160, 640, 1600, 120, [(run(regel2, 56, "300", extra="opacity:0.92;"), "center")])],
    ]


def warm(woord, regel1, regel2, kicker, logo=None, toon_kicker=False):
    goud = "#ffbe46"
    return [
        [item(150, 300, 1620, 90, [(run(kicker, 44, "bold", goud, "letter-spacing:9px;text-transform:uppercase;"), "left")], valign="flex-end"),
         bar(155, 410, 140, goud, 8),
         item(150, 440, 1620, 420, [(run(regel1, 190, "bold", extra="line-height:0.98;"), "left"), (run(regel2, 190, "bold", goud, "line-height:0.98;"), "left")], valign="flex-start")],
        [item(150, 330, 1620, 420, [(run(woord, 190, "bold", extra="line-height:0.98;"), "left"), (run("gewenst.", 190, "bold", goud, "line-height:0.98;"), "left")], valign="center")],
    ]


def typografisch(woord, regel1, regel2, kicker, logo=None, toon_kicker=False):
    paars = "#b28cff"
    return [
        [item(0, 250, 1920, 480, [(run(woord.upper(), 340, "800", extra="letter-spacing:14px;"), "center")]),
         item(0, 880, 1920, 80, [(run("Ark Church", 40, "300", paars, "letter-spacing:12px;text-transform:uppercase;"), "center")])],
        [item(160, 300, 1600, 480, [(run(regel1, 130, "bold", extra="letter-spacing:2px;"), "center"), (run(regel2, 130, "300", paars, "letter-spacing:2px;"), "center")])],
    ]


VARIANTEN = [
    dict(nr=1, naam="strak", video="ark", build=strak),
    dict(nr=2, naam="warm", video="goud", build=warm),
    dict(nr=3, naam="typografisch", video="nacht", build=typografisch),
]

TEKSTEN = {
    "Welkom": {
        "strak": ("Welkom", "Fijn dat je er bent", "We wensen je een mooie dienst", "bij Ark Church"),
        "warm": ("Een goede dienst", "Fijn dat", "je er bent.", "Welkom bij Ark Church"),
        "typografisch": ("Welkom", "Fijn dat je er bent", "een goede dienst gewenst", "Ark Church"),
    },
    "Bedankt": {
        "strak": ("Bedankt", "Tot de volgende keer", "Een gezegende week gewenst", "voor het komen"),
        "warm": ("Een fijne week", "Bedankt", "voor het komen.", "Tot de volgende keer"),
        "typografisch": ("Bedankt", "Tot de volgende keer", "een fijne week gewenst", "Ark Church"),
    },
}


LOGO = "Media/arkchurch-logo-wit.png"
FINAL_IDS = {"Welkom": "f1592509bbe", "Bedankt": "21266b09d9c"}


def make_show(soort, var, client, final=False):
    random.seed(f"{soort}-{var['nr']}")
    woord, r1, r2, kicker = TEKSTEN[soort][var["naam"]]
    logo_src = f"{client}/{LOGO}"
    dias = var["build"](woord, r1, r2, kicker, logo=logo_src, toon_kicker=(soort == "Bedankt"))
    slides, layout_slides, media = {}, [], {}
    vid_id = "ark" + var["video"][:6] + rid(3)
    if logo_src:
        media[rid()] = {"name": os.path.basename(LOGO), "path": logo_src, "type": "image"}
    media[vid_id] = {"name": f"{var['video']}.mp4", "path": f"{client}/{VIDEO_DIR}/{var['video']}.mp4", "type": "video", "muted": True, "loop": True}
    groepen = {"Welkom": ["Welkom", "Fijn dat je er bent"], "Bedankt": ["Bedankt", "Tot de volgende keer"]}[soort]
    for i, items in enumerate(dias):
        sid = rid()
        slides[sid] = {"group": groepen[i], "color": None, "settings": {}, "notes": "", "items": items}
        layout_slides.append({"id": sid, "nextTimer": 8, "background": vid_id})
    if soort == "Welkom":
        # Thema-dia: altijd als laatste van Welkom, met hetzelfde plaatje (thema.jpg) als de bestaande Welkom-show
        tid = rid()
        slides[tid] = {"group": "Thema", "color": None, "settings": {}, "notes": "",
                       "items": [{"style": "top:0px;left:0px;height:1080px;width:1920px;", "type": "media", "src": f"{client}/{THEMA}"}]}
        layout_slides.append({"id": tid, "nextTimer": 10, "bindings": [], "end": True})
        media[rid()] = {"name": THEMA, "path": f"{client}/{THEMA}", "type": "image"}
    else:
        layout_slides[-1].pop("nextTimer", None)  # Bedankt: de laatste dia blijft staan
    layout_id = rid()
    sid_show = rid()
    now = int(time.time() * 1000)
    content = {
        "name": soort if final else f"{soort} voorstel {var['nr']} ({var['naam']})", "private": False, "category": "presentation",
        "settings": {"activeLayout": layout_id, "template": None},
        "timestamps": {"created": now, "modified": now, "used": now}, "quickAccess": {}, "meta": {},
        "slides": slides, "layouts": {layout_id: {"name": "Default", "notes": "", "slides": layout_slides}}, "media": media,
    }
    if final:
        sid_show = FINAL_IDS[soort]
    return sid_show, content, dias, var["video"]


def preview(shows, stills_dir):
    css = """body{margin:0;background:#101216;color:#e8eaf0;font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px}
h2{font-weight:600;margin:28px 0 8px}h3{font-weight:500;font-size:14px;color:#9aa3b2;margin:18px 0 8px}
.row{display:flex;gap:14px;flex-wrap:wrap}.card{width:480px}.cap{font-size:12px;color:#9aa3b2;margin-top:4px}
.slide{position:relative;width:1920px;height:1080px;transform:scale(0.25);transform-origin:top left;overflow:hidden;background-size:cover;background-position:center}
.box{width:480px;height:270px;overflow:hidden;border-radius:6px;position:relative;border:1px solid #2a2f3a}
.it{position:absolute;display:flex;box-sizing:border-box}.ln{width:100%}"""
    out = [f"<!doctype html><meta charset=utf-8><title>Welkom en Bedankt voorstellen</title><style>{css}</style>"]
    for soort in ("Welkom", "Bedankt"):
        out.append(f"<h2>{soort}</h2>")
        for name, dias, video in shows[soort]:
            out.append(f"<h3>{html.escape(name)}</h3><div class=row>")
            bg = f"url('{os.path.join(stills_dir, video + '.jpg')}')" if stills_dir else "#222"
            for n, items in enumerate(dias, 1):
                out.append(f"<div class=card><div class=box><div class=slide style=\"background-image:{bg}\">")
                for it in items:
                    if it["type"] == "media":  # logo: lokaal bestand uit de still-map (of dezelfde naam)
                        local = os.path.join(stills_dir or ".", os.path.basename(it["src"]))
                        out.append(f"<div class=it style=\"{it['style']}\"><img src=\"{local}\" style=\"width:100%;height:100%;object-fit:contain\"></div>")
                        continue
                    lines = ''.join(f"<div class=ln style=\"{l['align']}\">" + ''.join(f"<span style=\"{t['style']}\">{html.escape(t['value'])}</span>" for t in l['text']) + "</div>" for l in it["lines"])
                    out.append(f"<div class=it style=\"{it['style']}{it['align']}\"><div style='width:100%'>{lines}</div></div>")
                out.append(f"</div></div><div class=cap>dia {n}</div></div>")
            if soort == "Welkom":
                out.append("<div class=card><div class=box><div class=slide style=\"background:#0d1b2a;display:flex;align-items:center;justify-content:center;font:bold 120px Helvetica;color:#fff\">Thema</div></div><div class=cap>laatste dia: Thema (thema.jpg van de week)</div></div>")
            out.append("</div>")
    return ''.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--client-path", default="/Users/jeffreygo/Documents/FreeShow")
    ap.add_argument("--preview")
    ap.add_argument("--still-dir")
    ap.add_argument("--final", action="store_true", help="maak de echte Welkom.show en Bedankt.show (variant strak) onder de bestaande show-id's")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    random.seed()
    shows = {"Welkom": [], "Bedankt": []}
    for soort in ("Welkom", "Bedankt"):
        for var in (VARIANTEN[:1] if a.final else VARIANTEN):
            sid, content, dias, video = make_show(soort, var, a.client_path.rstrip("/"), final=a.final)
            fn = os.path.join(a.outdir, content["name"] + ".show")
            with open(fn, "w", encoding="utf-8") as f:
                json.dump([sid, content], f, ensure_ascii=False)
            shows[soort].append((content["name"], dias, video))
            print("geschreven:", os.path.basename(fn))
    if a.preview:
        with open(a.preview, "w", encoding="utf-8") as f:
            f.write(preview(shows, a.still_dir))
        print("voorbeeld:", a.preview)


if __name__ == "__main__":
    main()
