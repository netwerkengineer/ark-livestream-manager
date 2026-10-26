#!/usr/bin/env python3
"""Laat FreeShow de dia's van een lied wisselen op de tijden uit een tijdlijn (bijv. uit een opname), via de FreeShow-API (index_select_slide).
Je start de video/muziek zelf en drukt Enter op het moment dat die op --start staat (standaard de start uit de tijdlijn).

Gebruik: speel_tijdlijn.py --show "<pad naar .show>" --tijdlijn washed_tijdlijn.json [--vanaf 21:17] [--api http://127.0.0.1:5505/]
Dia-indexen: 0 = startdia, event i = dia i+1 (zoals make_dynamische_song.py --tijdlijn de show bouwt)."""
import argparse, json, time, urllib.request

def secs(t):
    m, _, s = t.partition(":"); return int(m) * 60 + float(s)

def stuur(api, actie):
    r = urllib.request.urlopen(urllib.request.Request(api, json.dumps(actie).encode(), {"content-type": "application/json"}), timeout=3); return r.read()

ap = argparse.ArgumentParser(); ap.add_argument("--show", required=True); ap.add_argument("--tijdlijn", required=True); ap.add_argument("--vanaf"); ap.add_argument("--api", default="http://127.0.0.1:5505/")
a = ap.parse_args()
show_id = json.load(open(a.show, encoding="utf-8"))[0]; tl = json.load(open(a.tijdlijn, encoding="utf-8"))
start = secs(tl["start"]); gebeurtenissen = [(start, 0)] + [(secs(e["t"]), i + 1) for i, e in enumerate(tl["events"])]
vanaf = secs(a.vanaf) if a.vanaf else start
huidig = [g for g in gebeurtenissen if g[0] <= vanaf]; komend = [g for g in gebeurtenissen if g[0] > vanaf]
input(f"Zet de video klaar op {int(vanaf//60)}:{vanaf%60:04.1f} en druk Enter op het moment dat je hem start... ")
t0 = time.monotonic()
if huidig: print("→ dia", huidig[-1][1]); stuur(a.api, {"action": "index_select_slide", "showId": show_id, "index": huidig[-1][1]})
for t, idx in komend:
    wacht = (t - vanaf) - (time.monotonic() - t0)
    if wacht > 0: time.sleep(wacht)
    print(f"{int(t//60)}:{t%60:04.1f} → dia {idx}"); stuur(a.api, {"action": "index_select_slide", "showId": show_id, "index": idx})
print("klaar")
