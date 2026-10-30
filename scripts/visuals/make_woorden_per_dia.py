#!/usr/bin/env python3
"""Woorden-visual PER DIA: elke liedtekstdia van een arrangement start een eigen korte overlay (WebM met transparantie) met de kernwoorden en grote zinnen
van die dia. Zo klopt het beeld altijd met de tekst die je net hebt aangeklikt, hoe snel of langzaam de band ook gaat (de ene lange video loopt los van de dia's).

  - de woorden komen binnen vanaf het moment dat je de dia aanklikt (de vliegtijd van een woord wordt zo nodig iets uitgesteld);
  - dezelfde tekst krijgt dezelfde clip (twee varianten, zodat een herhaald refrein niet steeds precies hetzelfde doet);
  - een overlay verdwijnt zelf na zijn duur (displayDuration); een volgende dia start gewoon zijn eigen overlay.

Gebruik (FreeShow moet dicht zijn voor --uitvoeren):
  make_woorden_per_dia.py --fs ~/Documents/FreeShow --client-path ~/Documents/FreeShow --show "Washed - Elevation Rhythm" --arrangement "Songmap - Woorden (visual)" \\
      --tijdlijn washed_tijdlijn.json [--uitvoeren]
De tijdlijn (events met t + lines) is alleen om te schatten hoe lang een regel duurt; een tekst die er niet in staat krijgt 0,65 s per woord.
Draai dit NA make_dynamische_song.py --varianten woorden (dat maakt het arrangement opnieuw en zet er weer de lange video op).
"""
import argparse, concurrent.futures, hashlib, json, math, os, random, re, shutil, subprocess, sys, tempfile, time
from make_woorden_visual import event_cues, plekken, secs
from make_dynamische_song import OV_WOORDEN, OV_WOORDEN_TEKST, overlay_actie

HIER = os.path.dirname(os.path.abspath(__file__))
MAP = "Woorden per dia"
PREFIX = "Ark woorden:"
BEAMER = ["default"]


def dia_regels(c, layout):
    uit = []
    for i, sl in enumerate(layout["slides"]):
        s = c["slides"].get(sl["id"], {})
        regels = ["".join(r["value"] for r in ln["text"]).strip() for it in s.get("items", []) if it.get("type") == "text" for ln in it["lines"]]
        uit.append([r for r in regels if r])
    return uit


def spans(tl):
    t0 = secs(tl["start"]); ev = tl["events"]; per = {}
    for i, e in enumerate(ev):
        if not e["lines"]: continue
        te = (secs(ev[i + 1]["t"]) - t0) if i + 1 < len(ev) else secs(e["t"]) - t0 + 6
        per.setdefault(" | ".join(e["lines"]), []).append(max(2.0, (te - (secs(e["t"]) - t0)) * 0.85))
    return {k: sum(v) / len(v) for k, v in per.items()}


def clips_plannen(regels_per_dia, span_per_tekst):
    """Per dia de cues (tijd 0 = het aanklikken van de dia). Geeft [(dia-index, sleutel, cues, duur)]; dezelfde tekst + variant = dezelfde sleutel."""
    teller = {}; plan = []
    for i, regels in enumerate(regels_per_dia):
        if not regels: continue
        tekst = " | ".join(regels); n = teller.get(tekst, 0); teller[tekst] = n + 1; variant = n % 2
        woorden = sum(len(re.findall(r"[\w'’]+", r)) for r in regels); span = span_per_tekst.get(tekst, max(2.5, 0.65 * woorden))
        st = {"richting": (len(tekst) + variant * 2) % 4, "teller": {z: variant for z in ("oh",)}, "zoomsoort": variant}
        # de zin groot beeld: bij elke herhaling op een even plek (variant 0); bij variant 1 alleen de vliegers
        cues = event_cues(regels, 0.0, span, st, extra=True, forceer_zoom=False)
        if variant == 1: cues = [c for c in cues if c["soort"] == "vlieger"]   # elke tweede herhaling: alleen de vliegende woorden, geen grote zin
        if not cues: continue   # niets te tonen: die dia krijgt geen overlay
        for c in cues:   # een woord moet kunnen invliegen: niet eerder dan 40 % van zijn vliegtijd na het aanklikken
            c["t"] = round(max(c["t"], 0.4 * c["dur"] if c["soort"] == "vlieger" else 0.15), 2)
        cues.sort(key=lambda c: c["t"])
        sleutel = hashlib.sha1(json.dumps([tekst, variant]).encode()).hexdigest()[:10]
        plekken(cues, random.Random(sleutel))
        duur = max((c["t"] + (0.62 * c["dur"] if c["soort"] == "vlieger" else c["dur"] * 0.9) for c in cues), default=2.0) + 0.3
        plan.append((i, sleutel, cues, math.ceil(duur * 2) / 2, tekst, variant))
    return plan


def render(sleutel, cues, duur, map_uit, tijdlijn):
    uit = os.path.join(map_uit, f"woorden-{sleutel}.webm")
    if os.path.exists(uit): return uit
    cj = os.path.join(map_uit, f"cues-{sleutel}.json"); json.dump(cues, open(cj, "w", encoding="utf-8"), ensure_ascii=False)
    r = subprocess.run([sys.executable, os.path.join(HIER, "make_woorden_visual.py"), "--tijdlijn", tijdlijn, "--cues-in", cj, "--duur", str(duur), "--uit", uit], capture_output=True, text=True, cwd=HIER)
    if r.returncode or not os.path.exists(uit): raise SystemExit(f"renderen van {sleutel} mislukt:\n{r.stdout[-600:]}{r.stderr[-600:]}")
    os.remove(cj); return uit


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--client-path", required=True); ap.add_argument("--show", required=True); ap.add_argument("--arrangement", required=True)
    ap.add_argument("--tijdlijn", required=True); ap.add_argument("--clips", help="map voor de gerenderde clips (standaard een tijdelijke map naast de show); al bestaande clips worden hergebruikt")
    ap.add_argument("--parallel", type=int, default=3); ap.add_argument("--uitvoeren", action="store_true"); ap.add_argument("--beamer-output", default=",".join(BEAMER)); a = ap.parse_args()
    BEAMER[:] = a.beamer_output.split(",")
    pad = os.path.join(a.fs, "Shows", f"{a.show}.show"); sid, c = json.load(open(pad, encoding="utf-8"))
    layout = next((l for l in c["layouts"].values() if l["name"] == a.arrangement), None)
    if not layout: raise SystemExit(f'arrangement "{a.arrangement}" niet gevonden')
    tl = json.load(open(a.tijdlijn, encoding="utf-8")); plan = clips_plannen(dia_regels(c, layout), spans(tl))
    uniek = {}
    for i, sl, cues, duur, tekst, variant in plan: uniek.setdefault(sl, (cues, duur, tekst, variant))
    print(f"{len(plan)} liedtekstdia's, {len(uniek)} verschillende clips, samen {sum(d for _, d, _, _ in uniek.values()):.0f} s")
    for sl, (cues, duur, tekst, variant) in uniek.items(): print(f"  {sl} {'ab'[variant]} {duur:4.1f}s {len(cues):2} cues  {tekst[:70]}")
    if not a.uitvoeren: print("\nDROOG: er is niets gemaakt of gewijzigd."); return
    werk = a.clips or os.path.join(a.fs, "Media", "Ark Effecten", MAP); os.makedirs(werk, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(a.parallel) as ex:
        futs = {sl: ex.submit(render, sl, cues, duur, werk, os.path.abspath(a.tijdlijn)) for sl, (cues, duur, _, _) in uniek.items()}
        for sl, f in futs.items(): f.result(); print("klaar", sl, flush=True)
    t = time.strftime("%Y%m%d-%H%M%S"); op = os.path.join(a.fs, "Config", "overlays.json"); ov = json.load(open(op, encoding="utf-8")); cp = a.client_path.rstrip("/")
    cat = (ov.get("ark_ov_gloed") or {}).get("category"); nu = int(time.time() * 1000)
    for ok in [k for k in ov if k.startswith("ark_ov_w_")]: del ov[ok]
    for sl, (cues, duur, tekst, variant) in uniek.items():
        ov[f"ark_ov_w_{sl}"] = {"name": f"Woorden: {tekst[:40]} ({'ab'[variant]})", "color": None, "category": cat, "modified": nu, "placeUnderSlide": True, "displayDuration": duur,
                                "items": [{"style": "left:0px;top:0px;width:1920px;height:1080px;", "type": "media", "src": f"{cp}/Media/Ark Effecten/{MAP}/woorden-{sl}.webm", "fit": "cover", "muted": True, "loop": False, "bindings": list(BEAMER)}]}
    bk = os.path.join(a.fs, "Shows", f"_backup-perdia-{t}"); os.makedirs(bk); shutil.copy2(op, os.path.join(bk, "overlays.json")); shutil.copy2(pad, bk); tmp = op + ".tmp-perdia"; json.dump(ov, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, op)
    # acties op de dia's van het arrangement: de oude woorden-actie van de eerste tekstdia weg, per dia de eigen overlay
    for i, sl, *_ in plan:
        ls = layout["slides"][i]; acts = ls.setdefault("actions", {}).setdefault("slideActions", [])
        acts[:] = [x for x in acts if not x["name"].startswith(PREFIX) and x.get("actionValues", {}).get("id_select_overlay", {}).get("id") != OV_WOORDEN_TEKST]
        acts.append(overlay_actie(f"{PREFIX} {a.arrangement.split(' - ')[0]}", f"ark_ov_w_{sl}"))
    for ls in layout["slides"]:   # een dia zonder acties houdt geen lege actielijst over
        if not ls.get("actions", {}).get("slideActions", True): ls.pop("actions")
    c["timestamps"] = {**c.get("timestamps", {}), "modified": int(time.time() * 1000)}
    tmp = pad + ".tmp-perdia"; json.dump([sid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print(f"\nklaar: {len(plan)} dia's kregen een overlay. Reservekopie (show + overlays.json): {bk}")


if __name__ == "__main__":
    main()
