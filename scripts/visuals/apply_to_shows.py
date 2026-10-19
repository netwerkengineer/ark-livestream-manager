#!/usr/bin/env python3
"""Koppelt een achtergrondvideo en een lichtkleur aan FreeShow-shows (songs).

Gebruik (draait op de machine waar de Shows-map staat):
  apply_to_shows.py <spec.json> --shows-dir <map> --backup-dir <map> --companion <http://host:8000>
spec.json: {"<showbestand>.show": {"video": "<slug>", "kleur": "Blauw"}, ...}

- Werkt altijd vanaf de reservekopie (die wordt bij de eerste keer gemaakt), dus herhaalbaar.
- Zet de achtergrond op de eerste dia van elke indeling en een dia-actie "Licht: <kleur>" op de eerste dia
  van de actieve indeling (HTTP-verzoek naar Companion, knop op pagina 1, rij 1).
- Schrijft via een tijdelijk bestand en hernoemen (NFS-rechten).
"""
import json, os, sys, shutil, time, random, string

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
        slug, kleur = cfg["video"], cfg["kleur"]
        c.setdefault("media", {})
        for k in [k for k, m in c["media"].items() if "Ark Visuals" in m.get("path", "")]: del c["media"][k]
        mid = "ark" + slug[:8] + rid(3)
        c["media"][mid] = {"name": slug + ".mp4", "path": "Z:\\FreeShow\\Media\\Motion backgrounds\\Ark Visuals\\" + slug + ".mp4",
                           "type": "video", "muted": True, "loop": True}
        for lid, l in c.get("layouts", {}).items():
            for i, sl in enumerate(l.get("slides", [])):
                # eerste dia krijgt de nieuwe achtergrond; oude achtergronden op latere dia's en op
                # kind-dia's (children) worden weggehaald, anders blijft daar de oude achtergrond staan
                if i == 0: sl["background"] = mid
                else: sl.pop("background", None)
                for ov in (sl.get("children") or {}).values():
                    if isinstance(ov, dict): ov.pop("background", None)
        lay = c["layouts"][c["settings"]["activeLayout"]]
        first = lay["slides"][0]
        acts = first.setdefault("actions", {}).setdefault("slideActions", [])
        acts[:] = [x for x in acts if not str(x.get("name", "")).startswith("Licht:")]
        acts.append({"id": rid(), "name": "Licht: " + kleur, "triggers": ["send_rest_command"],
                     "actionValues": {"send_rest_command": {"url": f"{comp}/api/location/1/1/{KLEUREN[kleur]}/press",
                                                            "method": "POST", "contentType": "", "payload": ""}},
                     "customActivation": "", "midiEnabled": False})
        c["timestamps"]["modified"] = int(time.time() * 1000)
        tmp = os.path.join(shows, ".ark-tmp-" + slug)
        json.dump(j, open(tmp, "w"), indent=2, ensure_ascii=False)
        os.chmod(tmp, 0o666); os.replace(tmp, p)
        print("ok", fn, "->", slug, kleur)

if __name__ == "__main__":
    main()
