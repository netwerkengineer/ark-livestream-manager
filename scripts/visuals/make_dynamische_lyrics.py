#!/usr/bin/env python3
"""Maakt van een bestaande liedshow een DYNAMISCHE variant (kopie met "(dynamisch)" in de naam; het origineel verandert niet):

  - elke tekstregel een eigen tekstvak (band); de regels komen na elkaar binnen (overgang "fly" + vertraging per regel, via item.actions.showTimer),
  - kernwoorden (God, Heer, Jezus, Halleluja, liefde, ...) met kleurverloop en gloed, de rest wit,
  - een bewegende lichtlaag (lichtvlekken + glinsters, make_glow_loop.py) als overlay onder de dia, aangezet vanaf de startdia.

Eigen ontwerp in de kleuren van het palet (ark, neon of goud); geen kopie van andermans lyric-video's.

Gebruik: make_dynamische_lyrics.py --fs <FreeShow-map> --client-path <pad zoals FreeShow het ziet> --bron "Heer, U Bent Goed - Opwekking 668"
         --glow <glow.webm> [--palet ark] [--voorbeeld out.html] [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). FreeShow moet dicht zijn voor het wegschrijven. Reservekopie van overlays.json: .bak-dyn-<tijd>.
"""
import argparse, copy, json, os, random, re, shutil, time

KERN = {w.lower() for w in """God Heer Here Jezus Jesus Christus Koning King Vader Father Geest Spirit Lord Halleluja Hallelujah Alleluia Amen Heilig Holy
liefde love genade grace glorie glory eer majesteit majesty vrede peace licht light leven life hemel heaven overwinning victory Redder Saviour Savior""".split()}
# (kleur begin, kleur eind, gloed): FreeShow toont geen `background-clip:text`, dus het kleurverloop wordt per LETTER opgebouwd (elke letter een eigen vaste kleur)
PALETTEN = {
    "ark": ((216, 255, 248), (79, 209, 197), "rgba(77,182,172,.95)"),
    "neon": ((95, 243, 255), (255, 107, 214), "rgba(255,107,214,.9)"),
    "goud": ((255, 241, 201), (255, 179, 71), "rgba(255,170,60,.95)"),
}
FONT = "font-family:CMGSans, Avenir, Arial, sans-serif;font-weight:bold;"
GROOTTE = 96
OVERLAY_ID, ACTIE_NAAM = "ark_ov_gloed", "Ark overlay: Gloed"


def rid(n=11):
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(n))


def runs(tekst, palet):
    van, naar, gloed = PALETTEN[palet]
    basis = f"{FONT}font-size:{GROOTTE}px;"
    gewoon = f"{basis}color:#ffffff;text-shadow:0px 4px 26px rgb(0 0 0 / 0.55);"
    uit, buf = [], ""
    for deel in re.split(r"(\s+)", tekst):
        kern = re.sub(r"[^\w]", "", deel).lower() in KERN and not deel.isspace()
        if kern:
            if buf: uit.append({"value": buf, "style": gewoon}); buf = ""
            n = max(len(deel) - 1, 1)
            for i, ch in enumerate(deel):  # kleurverloop van letter tot letter
                k = tuple(round(van[j] + (naar[j] - van[j]) * i / n) for j in range(3))
                uit.append({"value": ch, "style": f"{basis}font-style:italic;color:rgb({k[0]} {k[1]} {k[2]});text-shadow:0px 0px 22px {gloed}, 0px 0px 6px {gloed}, 0px 4px 24px rgb(0 0 0 / 0.45);"})
        else:
            buf += deel
    if buf: uit.append({"value": buf, "style": gewoon})
    return uit


def lijnen_van(item):
    return [("".join(r["value"] for r in l["text"])).replace("\xa0", " ").strip() for l in item.get("lines", []) if "".join(r["value"] for r in l["text"]).strip()]


def overgang(i):
    """Regels komen afwisselend van links en van rechts binnen (svelte "fly" doet zonder afstand alleen een fade, dus x/y expliciet)."""
    x = -220 if i % 2 == 0 else 220
    fly = {"type": "fly", "duration": 900, "easing": "cubic", "custom": {"x": x, "y": 0, "opacity": 0}}
    return {**fly, "in": dict(fly), "out": {"type": "fade", "duration": 350, "easing": "sine"}}


def bouw_items(lijnen, palet):
    n = len(lijnen); hoogte = 200; items = []
    for i, tekst in enumerate(lijnen):
        top = 540 - n * hoogte // 2 + i * hoogte
        items.append({"style": f"top:{top}px;left:60px;width:1800px;height:{hoogte}px;z-index:2;", "type": "text", "align": "align-items:center;", "auto": True, "textFit": "shrinkToFit",
                      "lines": [{"align": "text-align:center;", "text": runs(tekst, palet)}], "specialStyle": {"lineGap": 0, "lineBg": ""}, "bindings": [],
                      "actions": {"showTimer": round(i * 0.4, 2), "transition": overgang(i)}})
    return items


def maak_show(bron, palet, naam):
    sid, c = copy.deepcopy(bron); nieuw_id = rid(); c["name"] = naam; nu = int(time.time() * 1000)
    c["timestamps"] = {"created": nu, "modified": nu, "used": nu}
    c.setdefault("settings", {})["template"] = None  # geen sjabloon ("Standaard"): FreeShow zou dat op het EERSTE tekstvak zetten en onze lettergrootte/-gewicht overschrijven
    omgezet = 0; omgezette_ids = set()
    for sid_, sl in c["slides"].items():
        tekstitems = [i for i in sl.get("items", []) if i.get("type") == "text" and lijnen_van(i)]
        if not tekstitems: continue
        lijnen = [l for i in tekstitems for l in lijnen_van(i)][:4]
        rest = [i for i in sl["items"] if i not in tekstitems]
        sl["items"] = rest + bouw_items(lijnen, palet); omgezet += 1; omgezette_ids.add(sid_)
    # Overgang op dianiveau (gaat vóór de stijl van de uitvoer): staat die stijl op "geen", dan wisselt FreeShow meteen en worden de overgangen per regel
    # niet gebruikt (de dia ervoor heeft andere item-overgangen). Met een fade op de dia loopt FreeShow de normale route en komen de invlieg-overgangen door.
    for lay in c["layouts"].values():
        for ls in lay["slides"]:
            if ls["id"] in omgezette_ids: ls["transition"] = {"type": "fade", "duration": 600, "easing": "sine"}
    return nieuw_id, c, omgezet


def zet_overlay_actie(c):
    """Op de eerste dia (startdia) van elk layout: de gloed-overlay aanzetten."""
    for lay in c["layouts"].values():
        eerste = lay["slides"][0]
        acts = (eerste.setdefault("actions", {})).setdefault("slideActions", [])
        if not any(a.get("name") == ACTIE_NAAM for a in acts):
            acts.append({"id": rid(), "name": ACTIE_NAAM, "triggers": ["id_select_overlay"], "actionValues": {"id_select_overlay": {"id": OVERLAY_ID}}, "customActivation": "", "midiEnabled": False})


def voorbeeld(pad, c, achtergrond, glow_png):
    css = "body{margin:0;background:#111;padding:8px}.b{position:relative;width:960px;height:540px;display:inline-block;margin:4px;overflow:hidden;background:#000 url('" + achtergrond + "') center/cover}.g{position:absolute;inset:0;background:url('" + glow_png + "') center/cover}.s{position:absolute;inset:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:top left}.it{position:absolute;display:flex;box-sizing:border-box}.ln{width:100%}"
    uit = [f"<!doctype html><meta charset=utf-8><style>{css}</style>"]; lay = list(c["layouts"].values())[0]["slides"]; gezien = 0
    for ls in lay:
        sl = c["slides"][ls["id"]]; ti = [i for i in sl["items"] if i.get("type") == "text"]
        if not ti: continue
        uit.append(f"<div class=b><div class=g></div><div class=s>")
        for it in ti:
            regels = "".join(f"<div class=ln style=\"{l['align']}\">" + "".join(f"<span style=\"{r['style']}\">{r['value']}</span>" for r in l["text"]) + "</div>" for l in it["lines"])
            uit.append(f"<div class=it style=\"{it['style']}{it['align']}\"><div style='width:100%'>{regels}</div></div>")
        uit.append("</div></div>"); gezien += 1
        if gezien >= 4: break
    open(pad, "w", encoding="utf-8").write("".join(uit))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--client-path", required=True); ap.add_argument("--bron", required=True)
    ap.add_argument("--glow", required=True); ap.add_argument("--palet", default="ark", choices=PALETTEN); ap.add_argument("--voorbeeld"); ap.add_argument("--achtergrond"); ap.add_argument("--glow-png")
    ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    pad = os.path.join(a.fs, "Shows", a.bron + ".show"); bron = json.load(open(pad, encoding="utf-8"))
    naam = a.bron.split(" - ")[0] + " (dynamisch)" + (" - " + a.bron.split(" - ", 1)[1] if " - " in a.bron else "")
    nid, c, n = maak_show(bron, a.palet, naam); zet_overlay_actie(c)
    bestaand = os.path.join(a.fs, "Shows", naam + ".show")
    if os.path.exists(bestaand): nid = json.load(open(bestaand, encoding="utf-8"))[0]  # zelfde show-id houden zodat de FreeShow-index klopt
    print(f"Nieuwe show: '{naam}' ({nid}) | {n} dia's omgezet | palet {a.palet} | overlay-actie op de startdia")
    if a.voorbeeld: voorbeeld(a.voorbeeld, c, a.achtergrond or "", a.glow_png or ""); print("voorbeeld:", a.voorbeeld)
    if not a.uitvoeren: print("\nDROOG: er is niets gewijzigd."); return
    t = time.strftime("%Y%m%d-%H%M%S"); cfg = os.path.join(a.fs, "Config"); op = os.path.join(cfg, "overlays.json"); shutil.copy2(op, f"{op}.bak-dyn-{t}")
    doel = os.path.join(a.fs, "Media", "Ark Effecten"); os.makedirs(doel, exist_ok=True); shutil.copy2(a.glow, os.path.join(doel, "gloed-loop.webm"))
    ov = json.load(open(op, encoding="utf-8")); nu = int(time.time() * 1000)
    ov[OVERLAY_ID] = {"name": "Gloed (lichtlaag)", "color": None, "category": "ark_stream", "modified": nu, "placeUnderSlide": True,
                      "items": [{"style": "left:0px;top:0px;width:1920px;height:1080px;", "type": "media", "src": f"{a.client_path.rstrip('/')}/Media/Ark Effecten/gloed-loop.webm", "fit": "cover", "muted": True, "loop": True}]}
    tmp = op + ".tmp-dyn"; json.dump(ov, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, op)
    nieuw_pad = os.path.join(a.fs, "Shows", naam + ".show"); tmp = nieuw_pad + ".tmp-dyn"; json.dump([nid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, nieuw_pad)
    print(f"\nklaar: {nieuw_pad}\noverlay '{OVERLAY_ID}' toegevoegd; reservekopie {op}.bak-dyn-{t}")


if __name__ == "__main__":
    main()
