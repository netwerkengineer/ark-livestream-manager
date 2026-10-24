#!/usr/bin/env python3
"""Transparante lower thirds voor liederen (livestream via NDI): witte letters zonder blok.

  LT Songs Transparant Zacht : witte letters, zachte schaduw, plus een heel lichte donkere verloop onderin (geen rand of blok) voor lichte beelden
  LT Songs Transparant Puur  : alleen witte letters met een zachte, brede schaduw

Gebruik: make_lt_transparant.py <uitvoermap> [--voorbeeld voorbeeld.html --achtergronden a.jpg b.jpg ...]
Schrijft <uitvoermap>/<naam>.fstemplate (importeren in FreeShow via Instellingen > Importeren of dubbelklik).
"""
import argparse, json, os

FONT = "CMGSans, Avenir, Arial, sans-serif"
SCHADUW_ZACHT = "text-shadow:0px 2px 14px rgb(0 0 0 / 0.65), 0px 0px 3px rgb(0 0 0 / 0.55);"
SCHADUW_PUUR = "text-shadow:0px 2px 18px rgb(0 0 0 / 0.8), 0px 0px 4px rgb(0 0 0 / 0.7), 0px 0px 40px rgb(0 0 0 / 0.5);"


def regel(tekst, schaduw):
    return {"align": "text-align: center;", "text": [{"value": tekst, "style": f"font-family:{FONT};font-size:64px;font-weight:bold;line-height:1.18;color:#FFFFFF;{schaduw}"}]}


def tekstvak(schaduw):
    return {"style": "left:160px;top:842px;width:1600px;height:178px;padding:14px 50px;background-color:rgb(0 0 0 / 0.0);z-index:2;",
            "type": "text", "align": "align-items:center;", "auto": True, "textFit": "shrinkToFit",
            "lines": [regel("LINE 1", schaduw), regel("LINE 2", schaduw)],
            "specialStyle": {"lineGap": 4, "lineBg": "rgb(0 0 0 / 0.0);"}, "bindings": [],
            "conditions": {"showItem": [[[[{"element": "text", "operator": "isNot", "data": "value", "value": ""}]]]]}}


def verloop(sterkte=0.5, hoogte=440):
    """Leeg tekstvak over de onderkant van het beeld met een verloop van transparant naar donker (sterkte = dekking onderaan)."""
    return {"style": f"z-index:1;left:0px;top:{1080 - hoogte}px;width:1920px;height:{hoogte}px;background-image:linear-gradient(to bottom, rgb(0 0 0 / 0.0) 0%, rgb(0 0 0 / {sterkte * 0.12:.2f}) 25%, rgb(0 0 0 / {sterkte * 0.44:.2f}) 55%, rgb(0 0 0 / {sterkte}) 100%);",
            "type": "text", "align": "align-items:center;",
            "lines": [{"align": "text-align:center;", "text": [{"value": "", "style": ""}]}], "bindings": []}


def verloop_schaduw(sterkte=0.7, spreid=260, blur=300):
    """Vlak net ONDER het beeld (niet zichtbaar) met een grote zachte schaduw naar boven: geeft een vloeiend verloop zonder harde rand en
    zonder background-image (dat toont FreeShow niet). De schaduw begint ~spreid px boven de onderrand en loopt over ~blur px uit."""
    k = f"rgb(0 0 0 / {sterkte})"
    return {"style": f"left:-400px;top:1080px;width:2720px;height:300px;background-color:rgb(0 0 0 / 0.0);box-shadow:0px 0px {blur}px {spreid}px {k};z-index:1;",
            "type": "text", "align": "align-items:center;",
            "lines": [{"align": "text-align:center;", "text": [{"value": "", "style": ""}]}], "bindings": []}


TEMPLATES = {
    "LT Songs Transparant Zacht": {"name": "LT Songs Transparant Zacht", "color": "#4DB6AC", "category": "song", "items": [tekstvak(SCHADUW_ZACHT), verloop()]},
    "LT Songs Transparant TEST Schaduwverloop": {"name": "LT Songs Transparant TEST Schaduwverloop", "color": "#E53935", "category": "song", "items": [tekstvak(SCHADUW_ZACHT), verloop_schaduw(0.75, 300, 340)]},
    "LT Songs Transparant Puur": {"name": "LT Songs Transparant Puur", "color": "#4DB6AC", "category": "song", "items": [tekstvak(SCHADUW_PUUR)]},
}


def voorbeeld(pad, achtergronden):
    css = ".b{position:relative;width:960px;height:540px;margin:6px;display:inline-block;overflow:hidden;background-size:cover;background-position:center}.s{position:absolute;inset:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:top left}.it{position:absolute;display:flex;box-sizing:border-box}.ln{width:100%}"
    out = [f"<!doctype html><meta charset=utf-8><style>body{{margin:0;background:#111;font-family:Helvetica}}{css}</style>"]
    for naam, t in TEMPLATES.items():
        for bg in achtergronden:
            out.append(f"<div class=b style=\"background-image:url('{bg}')\"><div class=s>")
            for it in t["items"]:
                lines = ""
                for i, l in enumerate(it["lines"]):
                    txt = {"LINE 1": "Heer U bent goed en Uw liefde", "LINE 2": "en trouw zijn voor eeuwig"}.get(l["text"][0]["value"], l["text"][0]["value"])
                    lines += f"<div class=ln style=\"{l['align']}\"><span style=\"{l['text'][0]['style']}\">{txt}</span></div>"
                out.append(f"<div class=it style=\"{it['style']}{it['align']}\"><div style='width:100%'>{lines}</div></div>")
            out.append("</div></div>")
        out.append("<br>")
    open(pad, "w", encoding="utf-8").write("".join(out))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("uit"); ap.add_argument("--voorbeeld"); ap.add_argument("--achtergronden", nargs="*", default=[])
    a = ap.parse_args(); os.makedirs(a.uit, exist_ok=True)
    for naam, t in TEMPLATES.items():
        json.dump(t, open(os.path.join(a.uit, naam + ".fstemplate"), "w", encoding="utf-8"), ensure_ascii=False)
    if a.voorbeeld: voorbeeld(a.voorbeeld, a.achtergronden)
    print("klaar:", sorted(os.listdir(a.uit)))
