#!/usr/bin/env python3
"""Maakt in FreeShow overlays en scenes om OBS te vervangen voor de livestream (RTMP-uitvoer):

  Overlays (categorie "Stream"):
    "Camera"      camera-item schermvullend, ONDER de dia (placeUnderSlide) zodat liedtekst/lower thirds erboven staan
    "Logo Ark"    het Ark Church-logo rechtsboven
  Scenes (gebonden aan de stream-uitvoer):
    "Stream: camera + liederen"   camera + logo, stijl "Livestream Liederen" (de transparante LT voor liederen en teksten)
    "Stream: camera volledig"     camera + logo, stijl "Livestream Video fullscreen" (dia's vullen het beeld)
    "Stream: dia's volledig"      alleen de dia's, geen camera (Welkom, Collecte Givt, Bedankt)

Gebruik: make_freeshow_scenes.py <FreeShow Config-map> --stream-output-id ID --camera-id ID --camera-group ID --camera-name "naam" --logo-path PAD
         --lyrics-style-id ID --video-style-id ID [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). FreeShow moet dicht zijn (het schrijft deze bestanden zelf terug). Reservekopie: <bestand>.bak-scenes-<tijd>.
Bestaande overlays/scenes van dit script (vaste id's) worden bijgewerkt; al het andere blijft staan.
"""
import argparse, json, os, shutil, time

CATEGORIE = "ark_stream"
OVERLAYS = {"ark_cam": "Camera", "ark_logo": "Logo Ark"}
SCENES = {"ark_scene_lt": "Stream: camera + liederen", "ark_scene_cam": "Stream: camera volledig", "ark_scene_dia": "Stream: dia's volledig"}


def overlay_camera(a, nu):
    return {"name": "Camera", "color": None, "category": CATEGORIE, "modified": nu, "placeUnderSlide": True,
            "items": [{"style": "top:0.00px;left:0.00px;height:1080.00px;width:1920.00px;", "type": "camera", "bindings": [a.stream_output_id],
                       "device": {"name": a.camera_name, "id": a.camera_id, "group": a.camera_group}, "fit": "fill"}]}


def overlay_logo(a, nu):
    return {"name": "Logo Ark", "color": None, "category": CATEGORIE, "modified": nu,
            "items": [{"style": "left:1690px;top:36px;width:190px;height:192px;", "type": "media", "src": a.logo_path, "fit": "contain", "bindings": [a.stream_output_id]}]}


def scenes(a, nu):
    b = [a.stream_output_id]
    return {"ark_scene_lt": {"name": "Stream: camera + liederen", "modified": nu, "bindings": b, "action": "",
                             "content": {"media": None, "style": a.lyrics_style_id, "overlays": ["ark_cam", "ark_logo"]}},
            "ark_scene_cam": {"name": "Stream: camera volledig", "modified": nu, "bindings": b, "action": "",
                              "content": {"media": None, "style": a.video_style_id, "overlays": ["ark_cam", "ark_logo"]}},
            "ark_scene_dia": {"name": "Stream: dia's volledig", "modified": nu, "bindings": b, "action": "",
                              "content": {"media": None, "style": a.video_style_id, "overlays": []}}}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("config")
    for x in ("stream-output-id", "camera-id", "camera-group", "camera-name", "logo-path", "lyrics-style-id", "video-style-id"): ap.add_argument("--" + x, required=True)
    ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    op, sp = os.path.join(a.config, "overlays.json"), os.path.join(a.config, "settings_synced.json")
    ov, st = json.load(open(op, encoding="utf-8")), json.load(open(sp, encoding="utf-8"))
    nu = int(time.time() * 1000)
    # controles: bestaan de stijlen en de uitvoer?
    for sid, label in ((a.lyrics_style_id, "liedjes-stijl"), (a.video_style_id, "video-stijl")):
        assert sid in st.get("styles", {}), f"{label} {sid} staat niet in settings_synced.json"
    nieuw_ov = {"ark_cam": overlay_camera(a, nu), "ark_logo": overlay_logo(a, nu)}; nieuw_sc = scenes(a, nu)
    print("Overlays:"); [print("  ", "bijwerken" if k in ov else "nieuw    ", k, v["name"]) for k, v in nieuw_ov.items()]
    print("Scenes:");   [print("  ", "bijwerken" if k in st.get("scenes", {}) else "nieuw    ", k, v["name"], "| stijl", st["styles"][v["content"]["style"]]["name"], "| overlays", v["content"]["overlays"]) for k, v in nieuw_sc.items()]
    print("Categorie 'Stream':", "bestaat" if CATEGORIE in st.get("overlayCategories", {}) else "nieuw")
    if not a.uitvoeren:
        print("\nDROOG: er is niets gewijzigd."); return
    tijd = time.strftime("%Y%m%d-%H%M%S")
    for p in (op, sp): shutil.copy2(p, f"{p}.bak-scenes-{tijd}")
    ov.update(nieuw_ov); st.setdefault("scenes", {}).update(nieuw_sc)
    st.setdefault("overlayCategories", {}).setdefault(CATEGORIE, {"name": "Stream", "icon": "camera"})
    for p, d in ((op, ov), (sp, st)):
        tmp = p + ".tmp-scenes"; json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, p)
    print(f"\nklaar: {len(nieuw_ov)} overlays en {len(nieuw_sc)} scenes geschreven (reservekopieën .bak-scenes-{tijd}).")


if __name__ == "__main__":
    main()
