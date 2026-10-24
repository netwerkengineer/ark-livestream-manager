#!/usr/bin/env python3
"""Zet de acties die de livestream-manager op dia's schrijft ook als losse ACTIES in FreeShow (tab Acties), zodat ze op zelfgemaakte
shows te zetten zijn of terug te zetten zijn als iemand per ongeluk een actie van een dia haalt.

  "Ark licht: <sfeer>"            HTTP-verzoek naar de Companion-knop van die sfeer (zelfde als de lichtactie in de liederen)
  "Ark stijl: livestream liederen" / "Ark stijl: livestream video"   stijlwissel van de livestream-uitvoer

FreeShow bewaart zijn acties in Config/settings_synced.json onder "midiIn". Bestaande acties blijven staan; een actie met dezelfde naam
wordt overgeslagen. Sluit FreeShow eerst af (FreeShow schrijft dit bestand zelf terug en zou de wijziging overschrijven).

Gebruik: make_freeshow_acties.py <Config/settings_synced.json> --companion-url http://192.168.2.222:8000 --livestream-output-id da5f3b88e33 [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). Met --uitvoeren: eerst een reservekopie <bestand>.bak-acties-<tijd>, dan schrijven via tijdelijk bestand.
"""
import argparse, json, os, random, shutil, sys, time

HIER = os.path.dirname(os.path.abspath(__file__))
SFEREN = os.path.join(HIER, "..", "..", "src", "lib", "sferen.json")
COMPANION_PAGINA = 2  # zie src/lib/sfeer.ts: pagina "Licht", sferen vanaf rij 2, acht per rij
STIJL_VIDEO, STIJL_LIEDEREN = "95740a329b1", "019efc0b745"  # stijl-id's zijn op elke machine gelijk


def rid(bestaand):
    while True:
        r = "".join(random.choice("0123456789abcdef") for _ in range(11))
        if r not in bestaand: return r


def knop_pad(knop):
    return f"{COMPANION_PAGINA}/{2 + knop // 8}/{knop % 8}"


def acties(companion_url, output_id):
    uit = []
    for s in json.load(open(SFEREN)):
        uit.append({"name": f"Ark licht: {s['naam']}", "triggers": ["send_rest_command"],
                    "actionValues": {"send_rest_command": {"url": f"{companion_url.rstrip('/')}/api/location/{knop_pad(s['knop'])}/press", "method": "POST", "contentType": "", "payload": ""}},
                    "customActivation": "", "midiEnabled": False})
    for naam, stijl in (("Ark stijl: livestream liederen", STIJL_LIEDEREN), ("Ark stijl: livestream video", STIJL_VIDEO)):
        uit.append({"name": naam, "triggers": ["change_output_style"],
                    "actionValues": {"change_output_style": {"styleOutputs": {"type": "specific", "outputs": {output_id: stijl}}}},
                    "customActivation": "", "midiEnabled": False})
    return uit


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("bestand"); ap.add_argument("--companion-url", required=True)
    ap.add_argument("--livestream-output-id", required=True); ap.add_argument("--uitvoeren", action="store_true")
    a = ap.parse_args(); random.seed()
    d = json.load(open(a.bestand, encoding="utf-8")); mi = d.setdefault("midiIn", {})
    namen = {v.get("name") for v in mi.values()}
    nieuw = [x for x in acties(a.companion_url, a.livestream_output_id) if x["name"] not in namen]
    print(f"{len(mi)} acties in FreeShow; {len(nieuw)} nieuwe toe te voegen, {len(acties(a.companion_url, a.livestream_output_id)) - len(nieuw)} bestaan al (zelfde naam).")
    for x in nieuw: print("  +", x["name"], "->", (x["actionValues"].get("send_rest_command") or {}).get("url") or list(x["actionValues"]["change_output_style"]["styleOutputs"]["outputs"].items()))
    if not a.uitvoeren or not nieuw:
        print("\nDROOG: er is niets gewijzigd." if not a.uitvoeren else "\nNiets te doen."); return
    bk = f"{a.bestand}.bak-acties-{time.strftime('%Y%m%d-%H%M%S')}"; shutil.copy2(a.bestand, bk); print("reservekopie:", bk)
    for x in nieuw: mi[rid(mi)] = x
    tmp = a.bestand + ".tmp-acties"; json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, a.bestand)
    print(f"klaar: {len(nieuw)} acties toegevoegd (nu {len(mi)}).")


if __name__ == "__main__":
    main()
