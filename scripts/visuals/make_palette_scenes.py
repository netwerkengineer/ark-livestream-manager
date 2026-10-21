#!/usr/bin/env python3
"""Zet per kleurenschema (palettes.json) een QLC+-scène in de werkruimte (functie-id 300 en hoger).

Gebruik: make_palette_scenes.py <werkruimte.qxw>
Hoofdkleur (met een beetje wit erdoor) op ADJ-bar en SlimPARs, accentkleur op de lightmaXX-bars,
de KLS-200 blijft wit (voor de keys). Een sfeer kan per lamp vaste waarden meegeven ("lampen": slimpar, adj, lightmaxx). Herhaalbaar: eerder gemaakte "Ark paletten" worden vervangen.
"""
import json, os, re, sys

BASE_ID = 300
PAD = "Ark paletten"

def rgb(h):
    h = h.lstrip('#'); return [int(h[i:i + 2], 16) for i in (0, 2, 4)]

def tint(c, w):   # richting wit voor lampen zonder wit-kanaal
    return [round(v + (255 - v) * w) for v in c]

def vals(*pairs):
    return ",".join(f"{c},{v}" for c, v in pairs)

def scene(fid, naam, main, accent, wit, lampen=None):
    m, a = tint(rgb(main), wit), tint(rgb(accent), wit)
    mr = rgb(main)
    lampen = lampen or {}
    if "slimpar" in lampen: m = lampen["slimpar"]                                 # per lamp live afgestelde waarden gaan voor de berekening
    if "lightmaxx" in lampen: a = lampen["lightmaxx"]
    adj = lampen.get("adj") or [mr[0], mr[1], mr[2], round(255 * wit * 0.9)]
    fx = []
    fx.append((4, [adj[0], adj[1], adj[2], adj[3], 0, 0]))                        # ADJ UB 9H: R G B W A UV
    for i in (13, 14, 15): fx.append((i, m))                                      # SlimPAR 56: R G B
    for i in (16, 17, 18): fx.append((i, [20, 255, 0, a[0], a[1], a[2]]))         # lightmaXX: ?, dimmer, ?, R G B
    for i in (19, 20): fx.append((i, [0, 255, 0] + [255] * 12))                   # KLS-200 blijft wit
    body = "\n".join(f'   <FixtureVal ID="{i}">{vals(*enumerate(v))}</FixtureVal>' for i, v in fx)
    return (f'  <Function ID="{fid}" Type="Scene" Name="Ark: {naam}" Path="{PAD}">\n'
            f'   <Speed FadeIn="1500" FadeOut="1500" Duration="0" />\n{body}\n  </Function>\n')

def main():
    qxw = sys.argv[1]
    pal = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "palettes.json")))
    s = open(qxw, encoding="utf-8").read()
    s = re.sub(r'\s*<Function ID="\d+" Type="Scene" Name="[^"]*" Path="%s">.*?</Function>' % re.escape(PAD), "", s, flags=re.S)
    new = "".join(scene(BASE_ID + i, p["naam"], p["main"], p["accent"], p["wit"], p.get("lampen")) for i, p in enumerate(pal))
    k = s.index("<Monitor")
    s = s[:k] + new + s[k:]
    open(qxw, "w", encoding="utf-8").write(s)
    print(f"{len(pal)} paletten in {qxw}: functie-id {BASE_ID}..{BASE_ID + len(pal) - 1}")

if __name__ == "__main__":
    main()
