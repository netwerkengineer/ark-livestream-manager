#!/usr/bin/env python3
"""Maakt van een bestaand lied drie dynamische proefversies in FreeShow (het bronlied blijft onaangeroerd):

  "<Naam> (dynamisch: secties)"  couplet rustig, refrein/bridge heftig (goud, groter, sneller), met gloed-overlay
  "<Naam> (dynamisch: rollend)"  drie regels, vorige/volgende gedimd, regel voor regel binnen
  "<Naam> (dynamisch: doorrol)"  webpagina (scripts/lyrics-roll/server.py) met echte doorrol

Gebruik: make_dynamische_song.py --fs <FreeShow-map> --bron "Washed - Elevation Rhythm" [--heftig "regex"] [--uitvoeren]
Vereist de overlays uit make_dynamische_demo.py (gloed/glans). Zonder --uitvoeren gebeurt er niets. FreeShow moet dicht zijn."""
import argparse, copy, json, os, re, shutil, time
from make_dynamische_lyrics import lijnen_van, rid
from make_dynamische_demo import OV_GLOED, OV_GLANS, ROL_URL, basis, sectie, rollend, overlay_actie, tekstvak

HEFTIG = r"washed in the water|as good as new|all because of you|here i come|took away my shame|nailed it to the cross"


BEAMER = ["default"]                         # uitvoer(en) in de zaal: daar tekent de webpagina de doorrol
STREAM = ["da5f3b88e33", "d972fc42792"]      # livestream-uitvoer(en) (NDI en RTMP): daar blijft de gewone liedtekst staan


def doorrol(lijnen):
    # De webpagina alleen in de zaal; de gewone tekst (nodig voor FreeShow's API) alleen op de livestream, waar de stijl "Livestream Liederen" hem onderin zet
    web = {"style": "top:0px;left:0px;width:1920px;height:1080px;z-index:3;", "type": "web", "web": {"src": ROL_URL, "noNavigation": True}, "bindings": list(BEAMER)}
    tekst = tekstvak(440, 60, 1800, 200, [], 0, {"type": "none", "duration": 0})
    tekst["lines"] = [{"align": "text-align:center;", "text": [{"value": t, "style": "font-size:40px;color:#ffffff;"}]} for t in lijnen]
    tekst["bindings"] = list(STREAM)
    return [web, tekst]


def overlays_alleen_zaal(fs, uitvoeren):
    """Gloed- en glans-overlay alleen op de zaaluitvoer (item-bindings), zodat ze niet over het camerabeeld in de livestream liggen."""
    pad = os.path.join(fs, "Config", "overlays.json"); ov = json.load(open(pad, encoding="utf-8")); n = 0
    for oid in (OV_GLOED, OV_GLANS):
        for it in ov.get(oid, {}).get("items", []):
            if it.get("bindings") != BEAMER: it["bindings"] = list(BEAMER); n += 1
    print(f"overlays alleen op de zaaluitvoer {BEAMER}: {n} item(s) aangepast")
    if uitvoeren and n:
        shutil.copy2(pad, f"{pad}.bak-zaal-{time.strftime('%Y%m%d-%H%M%S')}"); tmp = pad + ".tmp-zaal"; json.dump(ov, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)


# Washed (songmap: I V1 V2 C V3 V4 C C Vp B1 B1 B2 B1 R R R C E) als indexen in de dia's na de startdia; Vp (vamp) heeft geen tekst en blijft leeg
VOLGORDE_WASHED = "0-2,3-5,6-9,10-12,13-15,16-19,16-19,20-21,20-21,20-21,20-21,22-23,22-23,22-23,24-27"


def volgorde_lijst(tekst):
    uit = []
    for deel in tekst.split(","):
        a, _, b = deel.partition("-"); uit += list(range(int(a), int(b or a) + 1))
    return uit


def secs(t):
    m, _, x = t.partition(":"); return int(m) * 60 + float(x)


def bouw(bron, variant, heftig_re, volgorde=None, reeks=None, tl=None):
    c0 = bron[1]; lay = list(c0["layouts"].values())[0]["slides"]; start, rest = lay[0], lay[1:]
    tek = [[l for it in c0["slides"][ls["id"]]["items"] if it.get("type") == "text" for l in lijnen_van(it)] for ls in rest]
    if reeks is not None: rest = [None] * len(reeks); tek = reeks   # reeks = regels per dia in de volgorde van een opname (lege lijst = lege dia)
    elif volgorde: rest = [rest[i] for i in volgorde]; tek = [tek[i] for i in volgorde]   # songmap-volgorde; een dia komt zo meerdere keren voor (elk een eigen kopie)
    nieuwe = {}; volgorde = []
    s0 = copy.deepcopy(c0["slides"][start["id"]]); nieuwe[start["id"]] = s0; st = copy.deepcopy(start)
    st.setdefault("actions", {}).setdefault("slideActions", []).extend([overlay_actie("Ark overlay: Gloed", OV_GLOED), overlay_actie("Ark overlay: Glans (aan)", OV_GLANS)]); volgorde.append(st)
    for k, (ls, lijnen) in enumerate(zip(rest, tek)):
        if not lijnen and reeks is None: continue
        heftig = bool(re.search(heftig_re, " ".join(lijnen), re.I)); i = rid()
        if not lijnen: items = []
        elif variant == "secties": items = sectie(lijnen, heftig)
        elif variant == "rollend": items = rollend(lijnen, tek[k - 1][-1] if k > 0 and tek[k - 1] else None, tek[k + 1][0] if k + 1 < len(tek) and tek[k + 1] else None, "ark")
        else: items = doorrol(lijnen)
        nieuwe[i] = {"group": "Refrein" if heftig else "Couplet", "color": "#ef4444" if heftig else "#4db6ac", "settings": {}, "notes": "", "items": items, "globalGroup": None}
        l = {"id": i}
        if variant != "doorrol": l["transition"] = {"type": "fade", "duration": 600, "easing": "sine"}
        volgorde.append(l)
    lid = "b" + rid(10); nu = int(time.time() * 1000)
    tijdlijn = None
    if tl:   # FreeShow-tijdlijn: audio + dia-wissels op tijd; de startdia start de tijdlijn (actie start_timeline)
        st.setdefault("actions", {}).setdefault("slideActions", []).append({"id": rid(), "name": "Start tijdlijn (opname + dia's)", "triggers": ["start_timeline"], "actionValues": {}, "customActivation": "", "midiEnabled": False})
        t0 = secs(tl["start"]); acties = [{"id": rid(6), "time": 0, "duration": tl["duur"], "name": os.path.basename(tl["audio"]), "type": "audio", "data": {"path": tl["audio"]}}]
        for i, e in enumerate(tl["events"]):
            acties.append({"id": rid(6), "time": int(round((secs(e["t"]) - t0) * 1000)), "name": f"dia {i + 1}", "type": "slide", "data": {"id": volgorde[i + 1]["id"], "index": i + 1}})
        tijdlijn = {"actions": acties}
    return {"name": f"{c0['name']} (dynamisch: {variant})", "private": False, "category": c0.get("category", "song"), "settings": {"activeLayout": lid, "template": None},
            "timestamps": {"created": nu, "modified": nu, "used": nu}, "quickAccess": {}, "meta": copy.deepcopy(c0.get("meta", {})), "slides": nieuwe,
            "layouts": {lid: {"name": "Default", "notes": "", "slides": volgorde, **({"timeline": tijdlijn} if tijdlijn else {})}}, "media": copy.deepcopy(c0["media"])}


def een_show(bron, heftig_re, volgorde, reeks, tl, naam_behouden=False):
    """Alle varianten als arrangementen (layouts) in één show: Origineel + songmap-volgorde (3 stijlen) + opname-volgorde met tijdlijn (3 stijlen)."""
    c0 = bron[1]; nieuw = copy.deepcopy(c0); lay0 = list(nieuw["layouts"].values())[0]; lay0["name"] = "Origineel"
    eerste = next(iter(nieuw["layouts"])); namen = {"secties": "Secties (rustig/heftig)", "rollend": "Rollend", "doorrol": "Doorrol (webpagina)"}
    for soort, vg, rk, t in (("Songmap", volgorde, None, None), ("Opname", None, reeks, tl)):
        for v in ("secties", "rollend", "doorrol"):
            c = bouw(bron, v, heftig_re, vg, rk, t)
            if soort == "Opname" and rk is None: continue
            if soort == "Songmap" and not vg: continue
            nieuw["slides"].update(c["slides"]); lid, lay = next(iter(c["layouts"].items())); lay["name"] = f"{soort} - {namen[v]}"; nieuw["layouts"][lid] = lay
    nieuw["name"] = c0["name"] if naam_behouden else f"{c0['name']} (dynamisch)"; nieuw["settings"] = {**nieuw.get("settings", {}), "activeLayout": eerste}
    nu = int(time.time() * 1000); nieuw["timestamps"] = {**nieuw.get("timestamps", {}), "modified": nu}
    return nieuw


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--bron", required=True); ap.add_argument("--heftig", default=HEFTIG); ap.add_argument("--bron-pad", help="lees het bronlied uit dit bestand i.p.v. <fs>/Shows/<bron>.show (nodig als dat bestand al door --naam-behouden is vervangen)"); ap.add_argument("--volgorde", default="", help='dia-indexen, bv. "0-2,3-5,6-9" ("washed" = songmap-volgorde van Washed)'); ap.add_argument("--tijdlijn", help="JSON met events (t + lines) uit een opname: dia's in de volgorde van de opname"); ap.add_argument("--audio", help="mp3 van de opname (start op het begin van de tijdlijn); komt in <fs>/Media/Opnames en op de FreeShow-tijdlijn"); ap.add_argument("--client-path", help="FreeShow-map zoals de FreeShow-pc hem ziet (standaard --fs)"); ap.add_argument("--naam-behouden", action="store_true", help="met --een-show: de show krijgt naam en id van het bronlied (het origineel is het eerste arrangement) en vervangt het bestand, zodat de app-catalogus hem als dat lied vindt; reservekopie in <fs>/Shows/_backup-arrangementen-<datum>"); ap.add_argument("--een-show", action="store_true", help="alle varianten als arrangementen in één show (\"<naam> (dynamisch)\") in plaats van aparte shows"); ap.add_argument("--beamer-output", default=",".join(BEAMER), help="uitvoer-id('s) van de zaal (komma's)"); ap.add_argument("--stream-outputs", default=",".join(STREAM), help="uitvoer-id's van de livestream (komma's)"); ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    BEAMER[:] = a.beamer_output.split(","); STREAM[:] = a.stream_outputs.split(",")
    bron = json.load(open(a.bron_pad or os.path.join(a.fs, "Shows", a.bron + ".show"), encoding="utf-8"))
    ov = json.load(open(os.path.join(a.fs, "Config", "overlays.json"), encoding="utf-8"))
    if OV_GLOED not in ov: raise SystemExit("overlay ark_ov_gloed ontbreekt: draai eerst make_dynamische_demo.py")
    tdata = json.load(open(a.tijdlijn, encoding="utf-8")) if a.tijdlijn else None; reeks = [e["lines"] for e in tdata["events"]] if tdata else None; tl = None
    if a.audio:
        doel = os.path.join(a.fs, "Media", "Opnames", os.path.basename(a.audio)); cp = (a.client_path or a.fs).rstrip("/")
        dur = float(os.popen(f'ffprobe -v error -show_entries format=duration -of csv=p=0 "{a.audio}"').read().strip())
        tl = {"events": tdata["events"], "start": tdata["start"], "audio": f"{cp}/Media/Opnames/{os.path.basename(a.audio)}", "duur": int(dur)}
        if a.uitvoeren: os.makedirs(os.path.dirname(doel), exist_ok=True); shutil.copy2(a.audio, doel)
    overlays_alleen_zaal(a.fs, a.uitvoeren)
    if a.een_show:
        vg = volgorde_lijst(VOLGORDE_WASHED if a.volgorde == "washed" else a.volgorde) if a.volgorde else None
        c = een_show(bron, a.heftig, vg, reeks, tl, a.naam_behouden); pad = os.path.join(a.fs, "Shows", f"{c['name']}.show")
        nid = bron[0] if a.naam_behouden else (json.load(open(pad, encoding="utf-8"))[0] if os.path.exists(pad) else rid())
        if a.naam_behouden and a.uitvoeren and os.path.exists(pad):
            bk = os.path.join(a.fs, "Shows", "_backup-arrangementen-" + time.strftime("%Y%m%d-%H%M%S")); os.makedirs(bk); shutil.copy2(pad, bk); print("reservekopie:", bk)
        print(f"{c['name']}: {len(c['layouts'])} arrangementen, {len(c['slides'])} dia's, id {nid}\n  " + "\n  ".join(l["name"] for l in c["layouts"].values()))
        if a.uitvoeren: tmp = pad + ".tmp"; json.dump([nid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
        print("\nklaar." if a.uitvoeren else "\nDROOG: er is niets gewijzigd."); return
    for v in ("secties", "rollend", "doorrol"):
        c = bouw(bron, v, a.heftig, volgorde_lijst(VOLGORDE_WASHED if a.volgorde == "washed" else a.volgorde) if a.volgorde else None, reeks, tl)
        if reeks is not None: c["name"] = c["name"].replace("(dynamisch:", "(opname, dynamisch:")
        pad = os.path.join(a.fs, "Shows", f"{c['name']}.show")
        nid = json.load(open(pad, encoding="utf-8"))[0] if os.path.exists(pad) else rid()
        n = len(list(c["layouts"].values())[0]["slides"]); heftig = sum(1 for s in c["slides"].values() if s["group"] == "Refrein")
        print(f"{c['name']}: {n} dia's, {heftig} refrein/heftig, id {nid}")
        if a.uitvoeren:
            tmp = pad + ".tmp"; json.dump([nid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print("\nklaar." if a.uitvoeren else "\nDROOG: er is niets gewijzigd.")


if __name__ == "__main__":
    main()
