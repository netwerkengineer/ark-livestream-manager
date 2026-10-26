#!/usr/bin/env python3
"""Maakt van een bestaand lied drie dynamische proefversies in FreeShow (het bronlied blijft onaangeroerd):

  "<Naam> (dynamisch: secties)"  couplet rustig, refrein/bridge heftig (goud, groter, sneller), met gloed-overlay
  "<Naam> (dynamisch: rollend)"  drie regels, vorige/volgende gedimd, regel voor regel binnen
  "<Naam> (dynamisch: doorrol)"  webpagina (scripts/lyrics-roll/server.py) met echte doorrol

Gebruik: make_dynamische_song.py --fs <FreeShow-map> --bron "Washed - Elevation Rhythm" [--heftig "regex"] [--uitvoeren]
Vereist de overlays uit make_dynamische_demo.py (gloed/glans). Zonder --uitvoeren gebeurt er niets. FreeShow moet dicht zijn."""
import argparse, copy, json, os, re, time
from make_dynamische_lyrics import lijnen_van, rid
from make_dynamische_demo import OV_GLOED, OV_GLANS, ROL_URL, basis, sectie, rollend, overlay_actie, tekstvak

HEFTIG = r"washed in the water|as good as new|all because of you|here i come"


def doorrol(lijnen):
    web = {"style": "top:0px;left:0px;width:1920px;height:1080px;z-index:3;", "type": "web", "web": {"src": ROL_URL, "noNavigation": True}, "bindings": []}
    tekst = tekstvak(440, 60, 1800, 200, [], 0, {"type": "none", "duration": 0}, "opacity:0;")
    tekst["lines"] = [{"align": "text-align:center;", "text": [{"value": t, "style": "font-size:40px;color:#ffffff;"}]} for t in lijnen]
    return [web, tekst]


def bouw(bron, variant, heftig_re):
    c0 = bron[1]; lay = list(c0["layouts"].values())[0]["slides"]; start, rest = lay[0], lay[1:]
    tek = [[l for it in c0["slides"][ls["id"]]["items"] if it.get("type") == "text" for l in lijnen_van(it)] for ls in rest]
    nieuwe = {}; volgorde = []
    s0 = copy.deepcopy(c0["slides"][start["id"]]); nieuwe[start["id"]] = s0; st = copy.deepcopy(start)
    st.setdefault("actions", {}).setdefault("slideActions", []).append(overlay_actie("Ark overlay: Gloed", OV_GLOED)); volgorde.append(st)
    for k, (ls, lijnen) in enumerate(zip(rest, tek)):
        if not lijnen: continue
        heftig = bool(re.search(heftig_re, " ".join(lijnen), re.I)); i = rid()
        if variant == "secties": items = sectie(lijnen, heftig)
        elif variant == "rollend": items = rollend(lijnen, tek[k - 1][-1] if k > 0 and tek[k - 1] else None, tek[k + 1][0] if k + 1 < len(tek) and tek[k + 1] else None, "ark")
        else: items = doorrol(lijnen)
        nieuwe[i] = {"group": "Refrein" if heftig else "Couplet", "color": "#ef4444" if heftig else "#4db6ac", "settings": {}, "notes": "", "items": items, "globalGroup": None}
        l = {"id": i}
        if variant != "doorrol": l["transition"] = {"type": "fade", "duration": 600, "easing": "sine"}
        volgorde.append(l)
    lid = "b" + rid(10); nu = int(time.time() * 1000)
    return {"name": f"{c0['name']} (dynamisch: {variant})", "private": False, "category": c0.get("category", "song"), "settings": {"activeLayout": lid, "template": None},
            "timestamps": {"created": nu, "modified": nu, "used": nu}, "quickAccess": {}, "meta": copy.deepcopy(c0.get("meta", {})), "slides": nieuwe,
            "layouts": {lid: {"name": "Default", "notes": "", "slides": volgorde}}, "media": copy.deepcopy(c0["media"])}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--bron", required=True); ap.add_argument("--heftig", default=HEFTIG); ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    bron = json.load(open(os.path.join(a.fs, "Shows", a.bron + ".show"), encoding="utf-8"))
    ov = json.load(open(os.path.join(a.fs, "Config", "overlays.json"), encoding="utf-8"))
    if OV_GLOED not in ov: raise SystemExit("overlay ark_ov_gloed ontbreekt: draai eerst make_dynamische_demo.py")
    for v in ("secties", "rollend", "doorrol"):
        c = bouw(bron, v, a.heftig); pad = os.path.join(a.fs, "Shows", f"{c['name']}.show")
        nid = json.load(open(pad, encoding="utf-8"))[0] if os.path.exists(pad) else rid()
        n = len(list(c["layouts"].values())[0]["slides"]); heftig = sum(1 for s in c["slides"].values() if s["group"] == "Refrein")
        print(f"{c['name']}: {n} dia's, {heftig} refrein/heftig, id {nid}")
        if a.uitvoeren:
            tmp = pad + ".tmp"; json.dump([nid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print("\nklaar." if a.uitvoeren else "\nDROOG: er is niets gewijzigd.")


if __name__ == "__main__":
    main()
