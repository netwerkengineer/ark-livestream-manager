#!/usr/bin/env python3
"""Zet op alle dia's van een of meer shows de actie "Start scene" met de vlag "override category action", zodat de scene van de categorie
(bijv. "presentation" -> camera volledig) voor deze show wordt overgeslagen. Voor Welkom, Bedankt en Collecte Givt: scene "dia's volledig".

Gebruik: make_freeshow_show_scene.py <Shows-map> --shows "Welkom,Bedankt,Collecte Givt" --scene-id ark_scene_dia --scene-name "Ark scene: dia's volledig" [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). Met --uitvoeren: reservekopie van elke show in <Shows-map>/../_backup-scene-<tijd>/, daarna schrijven
via tijdelijk bestand; timestamps.modified wordt bijgewerkt (zodat de sync de nieuwste versie kiest). FreeShow moet dicht zijn.
"""
import argparse, json, os, random, shutil, time


def rid():
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(11))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("shows_map"); ap.add_argument("--shows", required=True)
    ap.add_argument("--scene-id", required=True); ap.add_argument("--scene-name", required=True); ap.add_argument("--uitvoeren", action="store_true")
    a = ap.parse_args(); tijd = time.strftime("%Y%m%d-%H%M%S"); bk = os.path.join(os.path.dirname(a.shows_map.rstrip("/")), f"_backup-scene-{tijd}")
    for naam in [n.strip() for n in a.shows.split(",") if n.strip()]:
        pad = os.path.join(a.shows_map, naam + ".show"); sid, c = json.load(open(pad, encoding="utf-8"))
        lay = list(c["layouts"].values())[0]["slides"]; nieuw = 0
        for sl in lay:
            acts = (sl.setdefault("actions", {})).setdefault("slideActions", [])
            if any(x.get("name") == a.scene_name for x in acts): continue
            acts.append({"id": rid(), "name": a.scene_name, "triggers": ["start_scene"], "actionValues": {"start_scene": {"id": a.scene_id}},
                         "customActivation": "", "midiEnabled": False, "customData": {"start_scene": {"overrideCategoryAction": True}}}); nieuw += 1
        print(f"{naam}: {len(lay)} dia's, actie toegevoegd op {nieuw}")
        if not a.uitvoeren or not nieuw: continue
        os.makedirs(bk, exist_ok=True); shutil.copy2(pad, os.path.join(bk, naam + ".show"))
        c["timestamps"] = {**(c.get("timestamps") or {}), "modified": int(time.time() * 1000)}
        tmp = pad + ".tmp-scene"; json.dump([sid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print("\nklaar" + (f" (reservekopieën in {bk})" if a.uitvoeren else " (DROOG: er is niets gewijzigd)"))


if __name__ == "__main__":
    main()
