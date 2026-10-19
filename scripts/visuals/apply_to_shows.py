#!/usr/bin/env python3
"""Koppelt een achtergrondvideo en een lichtkleur aan FreeShow-shows (songs).

Gebruik (draait op de machine waar de Shows-map staat):
  apply_to_shows.py <spec.json> --shows-dir <map> --backup-dir <map> --companion <http://host:8000>
spec.json: {"<showbestand>.show": {"video": "<slug>", "palet": "<slug uit palettes.json>"}, ...}
(of "kleur": "Blauw" voor een losse kleur; palettes.json staat naast dit script)

- Werkt altijd vanaf de reservekopie (die wordt bij de eerste keer gemaakt), dus herhaalbaar.
- Maakt per indeling een lege startdia met de achtergrond en alle acties (stijl + "Licht: <naam>" als HTTP-verzoek
  naar Companion); de indeling "Tracks" wordt niet verschoven.
- Schrijft via een tijdelijk bestand en hernoemen (NFS-rechten).
"""
import copy, json, os, sys, shutil, time, random, string

HIER = os.path.dirname(os.path.abspath(__file__))

KLEUREN = {"Rood": 0, "Groen": 1, "Blauw": 2, "Amber": 3, "Magenta": 4, "Cyaan": 5, "UV": 6, "Wit": 7}

def rid(n=11): return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))

def main():
    a = sys.argv[1:]
    def opt(name):
        i = a.index(name); return a[i + 1]
    spec = json.load(open(a[0]))
    shows, backup, comp = opt("--shows-dir"), opt("--backup-dir"), opt("--companion").rstrip("/")
    os.makedirs(backup, exist_ok=True)
    for fn, cfg in spec.items():
        p = os.path.join(shows, fn); b = os.path.join(backup, fn)
        if not os.path.exists(p): print("ONTBREEKT", fn); continue
        if not os.path.exists(b): shutil.copy2(p, b)
        j = json.load(open(b)); c = j[1]
        slug = cfg["video"]
        if "palet" in cfg:
            pal = {x["slug"]: x for x in json.load(open(os.path.join(HIER, "palettes.json")))}[cfg["palet"]]
            naam, rij, kol = pal["naam"], 3, pal["knop"]
        else:
            naam, rij, kol = cfg["kleur"], 1, KLEUREN[cfg["kleur"]]
        c.setdefault("media", {})
        for k in [k for k, m in c["media"].items() if "Ark Visuals" in m.get("path", "")]: del c["media"][k]
        mid = "ark" + slug[:8] + rid(3)
        c["media"][mid] = {"name": slug + ".mp4", "path": "Z:\\FreeShow\\Media\\Motion backgrounds\\Ark Visuals\\" + slug + ".mp4",
                           "type": "video", "muted": True, "loop": True}
        # Lege startdia (zelfde opzet als bij de Tracks-indelingen): daar komen achtergrond en alle acties op.
        # De indeling "Tracks" wordt niet verschoven: de cuetabellen van Ark Tracks tellen de dia's daarvan.
        start_id = None
        action = {"id": rid(), "name": "Licht: " + naam, "triggers": ["send_rest_command"],
                  "actionValues": {"send_rest_command": {"url": f"{comp}/api/location/1/{rij}/{kol}/press",
                                                         "method": "POST", "contentType": "", "payload": ""}},
                  "customActivation": "", "midiEnabled": False}
        for lid, l in c.get("layouts", {}).items():
            sls = l.get("slides", [])
            if not sls: continue
            first_def = c["slides"].get(sls[0]["id"], {})
            is_start = str(first_def.get("group", "")).startswith("Start")
            if l.get("name") == "Tracks" and not is_start:
                continue
            if not is_start:
                if start_id is None:
                    start_id = rid()
                    c["slides"][start_id] = {"group": "Start (tracks)", "color": "#334155", "settings": {},
                                             "notes": "Lege startdia: hier hangen achtergrond, licht en stijl aan.",
                                             "items": [], "globalGroup": None}
                sls.insert(0, {"id": start_id})
                moved = sls[1].get("actions")                       # acties van de eerste tekstdia verhuizen mee
                if moved: sls[0]["actions"] = sls[1].pop("actions")
            st = sls[0]
            st["background"] = mid
            for i, sl in enumerate(sls):
                if i > 0: sl.pop("background", None)
                for ov in (sl.get("children") or {}).values():
                    if isinstance(ov, dict): ov.pop("background", None)
            acts = st.setdefault("actions", {}).setdefault("slideActions", [])
            acts[:] = [x for x in acts if not str(x.get("name", "")).startswith("Licht:")]
            acts.append(copy.deepcopy(action))
        c["timestamps"]["modified"] = int(time.time() * 1000)
        tmp = os.path.join(shows, ".ark-tmp-" + slug)
        json.dump(j, open(tmp, "w"), indent=2, ensure_ascii=False)
        os.chmod(tmp, 0o666); os.replace(tmp, p)
        print("ok", fn, "->", slug, naam)

if __name__ == "__main__":
    main()
