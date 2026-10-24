#!/usr/bin/env python3
"""Livestream-lower thirds voor de collecte en "Volg ons", zonder OBS: in de zaal (Beamer, en de NDI-uitvoer) blijft de volledige dia staan, op de
RTMP-uitvoer "Youtube" komt de camera met een lower third eroverheen. Dat gaat met de bindings van een item (alleen tonen op die uitvoeren)
en met de scene "Stream: camera + liederen" (camera als media; de stijl daarvan toont de dia-achtergrond niet).

  Collecte Givt : alle bestaande items krijgen als binding de zaal-uitvoeren; dia 1 krijgt de Givt-lower third (PNG), dia 2 de QR-hoekkaart (PNG),
                  beide alleen voor Youtube; de override-actie wordt "Ark scene: camera + liederen".
  Volg ons      : nieuwe show met de schermvullende dia voor de zaal en de Volg ons-lower third voor Youtube.

De PNG's komen uit de map met OBS-afbeeldingen en worden gekopieerd naar <FreeShow>/Media/Ark Livestream/.

Gebruik: make_livestream_lt_shows.py --fs <FreeShow-map> --client-path <pad zoals FreeShow het ziet> --png-map <OBS afbeeldingen>
         --youtube-output ID --zaal-uitvoeren default,ID [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). FreeShow moet dicht zijn. Reservekopie: <fs>/_backup-livestream-lt-<tijd>/.
"""
import argparse, json, os, random, shutil, time

BESTANDEN = {  # doelnaam in Media/Ark Livestream  <-  bestand in de OBS-map
    "givt-lower-third.png": "New Givt (nieuw) - lower third.png",
    "givt-qr-hoek.png": "QR Givt - boven lower third.png",
    "volg-ons-lower-third.png": "Volg ons - lower third dekkend.png",
    "volg-ons-schermvullend.jpg": "Volg ons - schermvullend.jpg",
}
VOLG_ONS_ID, VOLG_ONS_LAYOUT = "a7c3e91b4d2", "ba7c3e91b4d"
SCENE_ID, SCENE_NAAM = "ark_scene_lt", "Ark scene: camera + liederen"


def rid(n=11):
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(n))


def beeld(src, bindings, fit="contain"):
    return {"style": "left:0px;top:0px;width:1920px;height:1080px;", "type": "media", "src": src, "fit": fit, "bindings": bindings}


def scene_actie():
    return {"id": rid(), "name": SCENE_NAAM, "triggers": ["start_scene"], "actionValues": {"start_scene": {"id": SCENE_ID}},
            "customActivation": "", "midiEnabled": False, "customData": {"start_scene": {"overrideCategoryAction": True}}}


def zet_scene_actie(layout_slide):
    acts = (layout_slide.setdefault("actions", {})).setdefault("slideActions", [])
    acts[:] = [x for x in acts if not str(x.get("name", "")).startswith("Ark scene:")] + [scene_actie()]


def patch_collecte(pad, a, zaal, yt, src):
    sid, c = json.load(open(pad, encoding="utf-8")); lay = list(c["layouts"].values())[0]["slides"]
    for n, ls in enumerate(lay):
        sl = c["slides"][ls["id"]]
        sl["items"] = [i for i in sl["items"] if not (i.get("type") == "media" and "Ark Livestream" in str(i.get("src", "")))]  # opnieuw draaien: oude LT-items weg
        for i in sl["items"]: i["bindings"] = list(zaal)
        sl["items"].append(beeld(src["givt-lower-third.png" if n == 0 else "givt-qr-hoek.png"], [yt]))
        zet_scene_actie(ls)
    return sid, c, f"{len(lay)} dia's: items -> zaal {zaal}, LT/QR -> {yt}, scene-actie {SCENE_NAAM}"


def maak_volg_ons(welkom_pad, src, zaal, yt):
    stijl_actie = []
    try:  # de stijlactie (NDI/Beamer) overnemen van de eerste dia van Welkom, als die er is
        _, w = json.load(open(welkom_pad, encoding="utf-8")); l0 = list(w["layouts"].values())[0]["slides"][0]
        stijl_actie = [x for x in (l0.get("actions") or {}).get("slideActions", []) if str(x.get("name", "")).startswith("Set style")]
    except Exception: pass
    slide = rid(); nu = int(time.time() * 1000)
    layout_slide = {"id": slide}; zet_scene_actie(layout_slide); layout_slide["actions"]["slideActions"] = stijl_actie + layout_slide["actions"]["slideActions"]
    content = {"name": "Volg ons", "private": False, "category": "presentation", "settings": {"activeLayout": VOLG_ONS_LAYOUT, "template": None},
               "timestamps": {"created": nu, "modified": nu, "used": nu}, "quickAccess": {}, "meta": {},
               "slides": {slide: {"group": "Volg ons", "color": None, "settings": {}, "notes": "", "items": [beeld(src["volg-ons-schermvullend.jpg"], list(zaal), "cover"), beeld(src["volg-ons-lower-third.png"], [yt])]}},
               "layouts": {VOLG_ONS_LAYOUT: {"name": "Default", "notes": "", "slides": [layout_slide]}}, "media": {}}
    return VOLG_ONS_ID, content


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--client-path", required=True); ap.add_argument("--png-map", required=True)
    ap.add_argument("--youtube-output", required=True); ap.add_argument("--zaal-uitvoeren", required=True); ap.add_argument("--uitvoeren", action="store_true")
    a = ap.parse_args(); zaal = [x for x in a.zaal_uitvoeren.split(",") if x]; yt = a.youtube_output; cp = a.client_path.rstrip("/")
    src = {k: f"{cp}/Media/Ark Livestream/{k}" for k in BESTANDEN}
    for k, v in BESTANDEN.items(): assert os.path.isfile(os.path.join(a.png_map, v)), f"ontbreekt: {v}"
    shows = os.path.join(a.fs, "Shows"); cpad = os.path.join(shows, "Collecte Givt.show"); vpad = os.path.join(shows, "Volg ons.show")
    sid, c, info = patch_collecte(cpad, a, zaal, yt, src); print("Collecte Givt:", info)
    vid, vc = maak_volg_ons(os.path.join(shows, "Welkom.show"), src, zaal, yt)
    print(f"Volg ons: {'bestaat, wordt vervangen' if os.path.exists(vpad) else 'nieuwe show'}; 1 dia (zaal: schermvullend, Youtube: LT), actie {SCENE_NAAM}")
    print("Media naar", f"{a.fs}/Media/Ark Livestream/:", list(BESTANDEN))
    if not a.uitvoeren: print("\nDROOG: er is niets gewijzigd."); return
    bk = os.path.join(a.fs, f"_backup-livestream-lt-{time.strftime('%Y%m%d-%H%M%S')}"); os.makedirs(bk)
    shutil.copy2(cpad, os.path.join(bk, "Collecte Givt.show"))
    if os.path.exists(vpad): shutil.copy2(vpad, os.path.join(bk, "Volg ons.show"))
    doel = os.path.join(a.fs, "Media", "Ark Livestream"); os.makedirs(doel, exist_ok=True)
    for k, v in BESTANDEN.items(): shutil.copy2(os.path.join(a.png_map, v), os.path.join(doel, k))
    now = int(time.time() * 1000); c["timestamps"] = {**(c.get("timestamps") or {}), "modified": now}
    for pad, i, cc in ((cpad, sid, c), (vpad, vid, vc)):
        tmp = pad + ".tmp-lt"; json.dump([i, cc], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print(f"\nklaar. Reservekopie: {bk}")


if __name__ == "__main__":
    main()
