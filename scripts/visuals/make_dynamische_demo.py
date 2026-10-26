#!/usr/bin/env python3
"""Demo-show "Dynamische lyrics demo" met vier richtingen achter elkaar, op korte stukjes tekst uit een bestaand lied (alleen om het idee te zien):

  1 Woord voor woord : elk woord een eigen tekstvak dat na elkaar binnenkomt
  2 Rollend          : drie regels (vorige gedimd, huidige helder, volgende gedimd); bij een nieuwe dia rolt alles een band omhoog
  3 Glans            : de basisstijl plus een lichtstreep die af en toe over de tekst veegt (overlay)
  4 Per onderdeel    : couplet rustig, refrein en bridge heftiger (andere kleur, grootte, snelheid en afstand)

Gebruik: make_dynamische_demo.py --fs <FreeShow-map> --client-path <pad> --bron "Heer, U Bent Goed - Opwekking 668" --glow gloed.webm --glans glans.webm [--voorbeeld map] [--uitvoeren]
Zonder --uitvoeren gebeurt er niets (droog). FreeShow moet dicht zijn. Reservekopie overlays.json: .bak-demo-<tijd>. Het bronlied verandert niet.
"""
import argparse, copy, json, os, random, shutil, subprocess, time, tempfile, re
from make_dynamische_lyrics import PALETTEN, FONT, KERN, runs, lijnen_van, rid

OV_GLOED, OV_GLANS = "ark_ov_gloed", "ark_ov_glans"
CMG = os.environ.get("CMGSANS_MAP", "/private/tmp/claude-501/-Users-jeffreygo/e8c0863d-4b8f-4c9a-8c80-e3a86023c301/scratchpad/fsapp2/public/fonts")  # FreeShow-lettertype CMGSans (uit de app-bundel)
# FreeShow toont de woorden ~10% breder dan de CMGSans-meting (gemeten aan de echte uitvoer)
BREEDTE_FACTOR = 1.10
ROL_URL = "http://localhost:8099/roll.html?h=1080&v=" + str(int(time.time()))  # versie in de URL: FreeShow's webview bewaart anders de oude pagina in de cache  # scripts/lyrics-roll/server.py
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def meet(woorden, grootte=96):
    """Breedte in px van elk (tekst, cursief) bij `grootte` px vet, gemeten in Chrome (zelfde lettertype-keten als FreeShow)."""
    uniek = sorted(set(woorden)); data = json.dumps([[t, i] for t, i in uniek])
    ff = "".join(f"@font-face{{font-family:CMGSans;font-weight:bold;font-style:{st};src:url('file://{CMG}/{fn}')}}" for st, fn in (("normal", "CMGSans-Bold.woff2"), ("italic", "CMGSans-BoldItalic.woff2")))
    html = f"<!doctype html><meta charset=utf-8><style>{ff}</style><body><pre id=o></pre><script>const d={data};const r={{}};for(const [t,i] of d){{const s=document.createElement('span');s.style.cssText='{FONT}font-size:{grootte}px;white-space:pre;position:absolute;'+(i?'font-style:italic;':'');s.textContent=t;document.body.appendChild(s);r[t+'|'+i]=s.getBoundingClientRect().width;}}document.getElementById('o').textContent=JSON.stringify(r);</script>"
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f: f.write(html); pad = f.name
    uit = subprocess.run([CHROME, "--headless", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", "file://" + pad], capture_output=True, text=True).stdout
    return json.loads(re.search(r'<pre id="o">(.*?)</pre>', uit, re.S).group(1).replace("&quot;", '"'))


def tekstvak(top, left, width, hoogte, regel_runs, delay, overgang, extra_stijl=""):
    return {"style": f"top:{top}px;left:{left}px;width:{width}px;height:{hoogte}px;z-index:2;white-space:nowrap;{extra_stijl}", "type": "text", "align": "align-items:center;",
            "lines": [{"align": "text-align:center;", "text": regel_runs}], "specialStyle": {"lineGap": 0, "lineBg": ""}, "bindings": [],
            "actions": {"showTimer": round(delay, 2), "transition": {**overgang, "in": dict(overgang), "out": {"type": "fade", "duration": 300, "easing": "sine"}}}}


def fly(x=0, y=0, duur=800, easing="cubic"):
    return {"type": "fly", "duration": duur, "easing": easing, "custom": {"x": x, "y": y, "opacity": 0}}


def basis(lijnen, palet, grootte=96, afstand=220, duur=900, stap=0.4):
    n = len(lijnen); return [tekstvak(540 - n * 100 + i * 200, 60, 1800, 200, runs(t, palet), i * stap, fly(-afstand if i % 2 == 0 else afstand, 0, duur)) for i, t in enumerate(lijnen)]


def woorden(lijnen, palet, stap=0.16):
    n = len(lijnen); items = []; teller = 0
    alle = [(w, False) for t in lijnen for w in t.split()]
    # kernwoorden zijn cursief (per letter gekleurd); meet beide mogelijkheden
    metingen = meet([(w, False) for t in lijnen for w in t.split()] + [(w, True) for t in lijnen for w in t.split()] + [("a a", False), ("aa", False)])
    metingen = {k: v * BREEDTE_FACTOR for k, v in metingen.items()}
    ruimte = metingen["a a|false"] - metingen["aa|false"]
    for i, t in enumerate(lijnen):
        delen = t.split(); stukken = []
        for w in delen:
            r = runs(w, palet); kern = len(r) > 1 or (r and r[0]["style"].find("italic") >= 0)
            stukken.append((w, r, metingen[f"{w}|{'true' if kern else 'false'}"]))
        totaal = sum(b for _, _, b in stukken) + ruimte * (len(stukken) - 1); x = (1920 - totaal) / 2; top = 540 - n * 100 + i * 200
        for w, r, b in stukken:
            items.append(tekstvak(top, round(x - 60), round(b + 120), 200, r, teller * stap, fly(0, 70, 650, "cubic"))); x += b + ruimte; teller += 1
    return items


def rollend(huidig, vorige, volgende, palet):
    items = []; n = len(huidig); hoogte = 200; top0 = 540 - n * hoogte // 2
    dim = "opacity:0.35;"
    for i, t in enumerate(huidig): items.append(tekstvak(top0 + i * hoogte, 60, 1800, hoogte, runs(t, palet), 0.15 + 0.5 * i, fly(0, 160, 800, "cubic")))
    if vorige: items.append(tekstvak(top0 - 175, 60, 1800, 160, [{"value": vorige, "style": f"{FONT}font-size:64px;color:#ffffff;text-shadow:0px 4px 20px rgb(0 0 0 / 0.5);"}], 0, fly(0, 160, 800, "cubic"), dim))
    if volgende: items.append(tekstvak(top0 + n * hoogte + 15, 60, 1800, 160, [{"value": volgende, "style": f"{FONT}font-size:64px;color:#ffffff;text-shadow:0px 4px 20px rgb(0 0 0 / 0.5);"}], 0.15 + 0.5 * n, fly(0, 160, 800, "cubic"), dim))
    return items


def sectie(lijnen, heftig):
    if heftig:  # refrein/bridge: warm goud, groter, sneller, verder weg
        items = basis(lijnen, "goud", afstand=380, duur=650, stap=0.25)
        for it in items:
            for r in it["lines"][0]["text"]: r["style"] = r["style"].replace("font-size:96px", "font-size:104px")
        return items
    return basis(lijnen, "ark", afstand=110, duur=1200, stap=0.5)


def overlay_actie(naam, oid):
    return {"id": rid(), "name": naam, "triggers": ["id_select_overlay"], "actionValues": {"id_select_overlay": {"id": oid}}, "customActivation": "", "midiEnabled": False}


def bouw(bron, palet):
    sid, c = bron; lay = list(c["layouts"].values())[0]["slides"]
    tek = [[l for it in c["slides"][ls["id"]]["items"] if it.get("type") == "text" for l in lijnen_van(it)] for ls in lay[1:]]
    uniek = []
    for x in tek:
        if x and (not uniek or x != uniek[-1]): uniek.append(x)  # dubbele dia's overslaan
    tek = uniek[:8]  # alleen de eerste stukjes tekst
    s1, s2, s3, s4 = tek[0], tek[1], tek[2], tek[3]
    nieuwe = {}; volgorde = []
    def slide(groep, kleur, items, acties=None, trans=True):
        i = rid(); nieuwe[i] = {"group": groep, "color": kleur, "settings": {}, "notes": "", "items": items, "globalGroup": None}
        ls = {"id": i}
        if trans: ls["transition"] = {"type": "fade", "duration": 600, "easing": "sine"}
        if acties: ls["actions"] = {"slideActions": acties}
        volgorde.append(ls); return i
    start = lay[0]; nieuwe[start["id"]] = copy.deepcopy(c["slides"][start["id"]]); st = copy.deepcopy(start)
    st.setdefault("actions", {}).setdefault("slideActions", []).append(overlay_actie("Ark overlay: Gloed", OV_GLOED)); volgorde.append(st)
    # 1 woord voor woord
    slide("1 Woord voor woord", "#4db6ac", woorden(s1, palet)); slide("1 Woord voor woord", "#4db6ac", woorden(s2, palet))
    # 2 rollend (vorige/volgende uit de lijnen eromheen)
    reeks = [s1, s2, s3, s4]
    for k in range(3):
        vorige = reeks[k - 1][-1] if k > 0 else None; volgende = reeks[k + 1][0] if k + 1 < len(reeks) else None
        slide("2 Rollend", "#8b5cf6", rollend(reeks[k], vorige, volgende, palet))
    # 3 glans (aanzetten bij de eerste dia van de groep)
    slide("3 Glans", "#f59e0b", basis(s1, palet), [overlay_actie("Ark overlay: Glans (aan)", OV_GLANS)]); slide("3 Glans", "#f59e0b", basis(s2, palet))
    # 4 per onderdeel (glans uit bij de eerste dia)
    slide("4 Couplet (rustig)", "#4db6ac", sectie(s1, False), [overlay_actie("Ark overlay: Glans (uit)", OV_GLANS)]); slide("4 Refrein (heftig)", "#ef4444", sectie(s2, True)); slide("4 Bridge (heftig)", "#ef4444", sectie(s3, True))
    # 5 doorrol als webpagina (scripts/lyrics-roll): de dia bevat onzichtbare tekst voor FreeShow's API, de pagina tekent de beweging
    def doorrol(lijnen):
        web = {"style": "top:0px;left:0px;width:1920px;height:1080px;z-index:3;", "type": "web", "web": {"src": ROL_URL, "noNavigation": True}, "bindings": []}
        tekst = tekstvak(440, 60, 1800, 200, [], 0, {"type": "none", "duration": 0}, "opacity:0;")
        tekst["lines"] = [{"align": "text-align:center;", "text": [{"value": t, "style": "font-size:40px;color:#ffffff;"}]} for t in lijnen]
        return [web, tekst]
    for k, regels in enumerate((s1, s2, s3, s4)): slide("5 Doorrol (web)", "#22d3ee", doorrol(regels), [overlay_actie("Ark overlay: Glans (uit)", OV_GLANS)] if k == 0 else None, trans=False)
    nid = rid(); lid = "b" + rid(10)
    nc = {"name": "Dynamische lyrics demo", "private": False, "category": "song", "settings": {"activeLayout": lid, "template": None},
          "timestamps": {"created": int(time.time() * 1000), "modified": int(time.time() * 1000), "used": int(time.time() * 1000)}, "quickAccess": {}, "meta": {},
          "slides": nieuwe, "layouts": {lid: {"name": "Default", "notes": "", "slides": volgorde}}, "media": copy.deepcopy(c["media"])}
    return nid, nc, (s1, s2, s3, s4)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fs", required=True); ap.add_argument("--client-path", required=True); ap.add_argument("--bron", required=True)
    ap.add_argument("--glow", required=True); ap.add_argument("--glans", required=True); ap.add_argument("--palet", default="ark"); ap.add_argument("--voorbeeld"); ap.add_argument("--uitvoeren", action="store_true"); a = ap.parse_args()
    bron = json.load(open(os.path.join(a.fs, "Shows", a.bron + ".show"), encoding="utf-8")); nid, c, tekst = bouw(bron, a.palet)
    pad = os.path.join(a.fs, "Shows", "Dynamische lyrics demo.show")
    if os.path.exists(pad): nid = json.load(open(pad, encoding="utf-8"))[0]
    lay = list(c["layouts"].values())[0]["slides"]
    print(f"Demo-show: {len(lay)} dia's ({len(c['slides'])} unieke), id {nid}\nTekst: {tekst}")
    if a.voorbeeld:
        os.makedirs(a.voorbeeld, exist_ok=True); json.dump([nid, c], open(os.path.join(a.voorbeeld, "demo.show"), "w"), ensure_ascii=False)
    if not a.uitvoeren: print("\nDROOG: er is niets gewijzigd."); return
    t = time.strftime("%Y%m%d-%H%M%S"); op = os.path.join(a.fs, "Config", "overlays.json"); shutil.copy2(op, f"{op}.bak-demo-{t}")
    doel = os.path.join(a.fs, "Media", "Ark Effecten"); os.makedirs(doel, exist_ok=True); shutil.copy2(a.glow, os.path.join(doel, "gloed-loop.webm")); shutil.copy2(a.glans, os.path.join(doel, "glans-loop.webm"))
    ov = json.load(open(op, encoding="utf-8")); nu = int(time.time() * 1000); cp = a.client_path.rstrip("/")
    ov[OV_GLOED] = {"name": "Gloed (lichtlaag)", "color": None, "category": "ark_stream", "modified": nu, "placeUnderSlide": True,
                    "items": [{"style": "left:0px;top:0px;width:1920px;height:1080px;", "type": "media", "src": f"{cp}/Media/Ark Effecten/gloed-loop.webm", "fit": "cover", "muted": True, "loop": True}]}
    ov[OV_GLANS] = {"name": "Glans (streep over de tekst)", "color": None, "category": "ark_stream", "modified": nu,
                    "items": [{"style": "left:0px;top:0px;width:1920px;height:1080px;z-index:5;mix-blend-mode:screen;", "type": "media", "src": f"{cp}/Media/Ark Effecten/glans-loop.webm", "fit": "cover", "muted": True, "loop": True}]}
    tmp = op + ".tmp-demo"; json.dump(ov, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, op)
    tmp = pad + ".tmp-demo"; json.dump([nid, c], open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, pad)
    print(f"\nklaar: {pad}\nreservekopie overlays: {op}.bak-demo-{t}")


if __name__ == "__main__":
    main()
