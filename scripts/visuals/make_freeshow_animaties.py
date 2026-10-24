#!/usr/bin/env python3
"""Animeerde lower thirds voor de livestream als FreeShow-OVERLAYS (video met transparantie, WebM), alleen op de RTMP-uitvoer "Youtube".
Een overlay staat los van de dia: de zaal blijft het lied (of niets) tonen en de dia verandert niet. De overlay start met een actie of knop
en verdwijnt zelf na "displayDuration" (de video is dan afgelopen).

  Volg ons (animatie)               schuift in, blijft 10 s, schuift weg (12 s)
  Collecte lower third (animatie)   de Givt-balk, 15 s zichtbaar (17 s)
  QR Givt (animatie)                QR-kaart boven de lyricsbalk, herhaalt zich (cyclus van 45 s) tot je de overlay uitzet

Ook als losse acties ("Ark overlay: ..."), om op een dia of knop te zetten.

Gebruik: make_freeshow_animaties.py --fs <FreeShow-map> --client-path <pad zoals FreeShow het ziet> --webm-map <OBS afbeeldingen> --youtube-output ID [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). FreeShow moet dicht zijn. Reservekopieën: <bestand>.bak-anim-<tijd>.
"""
import argparse, json, os, random, shutil, time

CATEGORIE = "ark_stream"
VIDEOS = {  # doelnaam <- bronbestand
    "volg-ons-animatie.webm": "Volg ons - lower third animatie dekkend.webm",
    "givt-lt-animatie.webm": "New Givt lower third animatie.webm",
    "qr-givt-animatie.webm": "QR Givt - boven lower third animatie.webm",
}
OVERLAYS = [  # id, naam, video, duur (s) of None, herhalen
    ("ark_ov_volgons", "Volg ons (animatie)", "volg-ons-animatie.webm", 12, False),
    ("ark_ov_givt", "Collecte lower third (animatie)", "givt-lt-animatie.webm", 17, False),
    ("ark_ov_qr", "QR Givt (animatie)", "qr-givt-animatie.webm", None, True),
]


def rid(bestaand):
    while True:
        r = "".join(random.choice("0123456789abcdef") for _ in range(11))
        if r not in bestaand: return r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--client-path", required=True); ap.add_argument("--webm-map", required=True)
    ap.add_argument("--youtube-output", required=True); ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    cfg = os.path.join(a.fs, "Config"); op, sp = os.path.join(cfg, "overlays.json"), os.path.join(cfg, "settings_synced.json")
    for v in VIDEOS.values(): assert os.path.isfile(os.path.join(a.webm_map, v)), f"ontbreekt: {v}"
    ov, st = json.load(open(op, encoding="utf-8")), json.load(open(sp, encoding="utf-8")); mi = st.setdefault("midiIn", {}); nu = int(time.time() * 1000)
    cp = a.client_path.rstrip("/"); nieuw_ov, nieuw_ac = {}, []
    for oid, naam, video, duur, herhaal in OVERLAYS:
        o = {"name": naam, "color": None, "category": CATEGORIE, "modified": nu,
             "items": [{"style": "left:0px;top:0px;width:1920px;height:1080px;", "type": "media", "src": f"{cp}/Media/Ark Livestream/{video}", "fit": "contain",
                        "muted": True, "loop": herhaal, "bindings": [a.youtube_output]}]}
        if duur: o["displayDuration"] = duur
        nieuw_ov[oid] = o
        if not any(v.get("name") == f"Ark overlay: {naam}" for v in mi.values()):
            nieuw_ac.append({"name": f"Ark overlay: {naam}", "triggers": ["id_select_overlay"], "actionValues": {"id_select_overlay": {"id": oid}}, "customActivation": "", "midiEnabled": False})
    print("Overlays:"); [print("  ", "bijwerken" if k in ov else "nieuw    ", k, v["name"], "| duur", v.get("displayDuration", "tot uitgezet"), "| herhalen", v["items"][0]["loop"]) for k, v in nieuw_ov.items()]
    print("Acties:", [x["name"] for x in nieuw_ac] or "bestaan al"); print("Video's naar", f"{a.fs}/Media/Ark Livestream/:", list(VIDEOS))
    if not a.uitvoeren: print("\nDROOG: er is niets gewijzigd."); return
    t = time.strftime("%Y%m%d-%H%M%S")
    for p in (op, sp): shutil.copy2(p, f"{p}.bak-anim-{t}")
    doel = os.path.join(a.fs, "Media", "Ark Livestream"); os.makedirs(doel, exist_ok=True)
    for k, v in VIDEOS.items(): shutil.copy2(os.path.join(a.webm_map, v), os.path.join(doel, k))
    ov.update(nieuw_ov)
    for x in nieuw_ac: mi[rid(mi)] = x
    for p, d in ((op, ov), (sp, st)):
        tmp = p + ".tmp-anim"; json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, p)
    print(f"\nklaar: {len(nieuw_ov)} overlays, {len(nieuw_ac)} acties (reservekopieën .bak-anim-{t})")


if __name__ == "__main__":
    main()
