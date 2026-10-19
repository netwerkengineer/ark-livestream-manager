#!/usr/bin/env python3
"""Zet de lichtknoppen in de Companion-database (pagina 1): 8 losse kleuren (rij 1) en de paletten (rij 3).

Draai dit in de Companion-datamap met Companion GESTOPT (docker stop companion), als de eigenaar van de
bestanden (uid 1000). Gebruik: companion_palettes.py <db.sqlite> <palettes.json>
Elke knop doet niets als de variabele licht_auto op "uit" staat, en onthoudt kleur en tijd van de laatste wissel.
Herhaalbaar: bestaande Auto-knoppen worden opnieuw opgebouwd.
"""
import copy, json, random, shutil, sqlite3, string, sys

db, palfile = sys.argv[1], sys.argv[2]
PAL = json.load(open(palfile))
BASE_ID = 300
PALET_IDS = list(range(BASE_ID, BASE_ID + 30))
GROEPEN = [10, 30, 40, 50, 100, 110, 120, 130]      # LED-bars (globaal), ADJ, lightmaXX, SlimPAR, KLS-spots 1-4
KLEUREN = [("Rood", 1, 0xCC0000, 0xFFFFFF), ("Groen", 2, 0x00A020, 0xFFFFFF), ("Blauw", 3, 0x1E40FF, 0xFFFFFF),
           ("Amber", 4, 0xFFA000, 0x000000), ("Magenta", 5, 0xD020B0, 0xFFFFFF), ("Cyaan", 6, 0x00B8C8, 0x000000),
           ("UV", 7, 0x6020D0, 0xFFFFFF), ("Wit", 8, 0xFFFFFF, 0x000000)]

def nid(): return "".join(random.choices(string.ascii_letters + string.digits + "_-", k=21))
def O(v, expr=False): return {"value": v, "isExpression": expr}

c = sqlite3.connect(db)
QLC = upg = None
for iid, v in c.execute("select id,value from instances"):
    j = json.loads(v)
    if j.get("moduleId") == "massimo-callegari-qlcplus": QLC, upg = iid, j.get("lastUpgradeIndex")
tmpl = None
for cid, v in c.execute("select id,value from controls"):
    if "Smart Stekker 1" in v: tmpl = json.loads(v); break

def fn(f, status):
    return {"id": nid(), "definitionId": "setFunctionStatus", "connectionId": QLC,
            "options": {"functionID": O(str(f)), "status": O(status)}, "upgradeIndex": upg, "type": "action"}

def setvar(name, val):
    return {"type": "action", "id": nid(), "definitionId": "custom_variable_set_value", "connectionId": "internal",
            "options": {"name": O(name), "value": O(val)}, "upgradeIndex": None}

def gated(label, actions):
    cond = {"type": "feedback", "id": nid(), "definitionId": "check_expression", "connectionId": "internal",
            "options": {"expression": O('$(custom:licht_auto) == "aan"', True)}, "isInverted": O(False),
            "styleOverrides": [], "children": {}}
    return [{"type": "action", "id": nid(), "definitionId": "logic_if", "connectionId": "internal", "options": {},
             "children": {"condition": [cond], "actions": [setvar("licht_kleur", label), setvar("licht_tijd", "$(internal:time_hms)")] + actions,
                          "else_actions": []}, "upgradeIndex": None}]

def stop_palets(except_id=None):
    return [(i, "0") for i in PALET_IDS if i != except_id]

def pure_seq(name, k):
    # eerst de nieuwe kleur starten, daarna de rest stoppen: zo vloeit het over i.p.v. eerst uit te gaan
    seq = []
    if name == "UV":                                 # alleen de ADJ-bars hebben UV; de rest blijft staan
        seq += [(36, "1"), (67, "1")] + stop_palets()
        seq += [(30 + j, "0") for j in range(8) if j != 6]
    else:
        for g in GROEPEN: seq.append((g + k - 1, "1"))
        seq.append((67, "1"))
        seq += stop_palets()
        for g in GROEPEN: seq += [(g + j, "0") for j in range(8) if j != k - 1]
    seq += [(60 + j, "0") for j in range(7)]         # KLS-200 altijd wit
    return seq

def palet_seq(i):
    seq = [(BASE_ID + i, "1")] + stop_palets(BASE_ID + i)
    for g in GROEPEN + [60]: seq += [(g + j, "0") for j in range(8)]          # alle losse kleuren uit
    return seq

def button(label, bg, fg, seq_label, seq):
    j = copy.deepcopy(tmpl); j["feedbacks"] = []
    for l in j["style"]["layers"]:
        if l["id"] == "text0": l["text"]["value"] = label; l["color"]["value"] = fg
        if l["id"] == "box0": l["color"]["value"] = bg
    j["steps"] = {"0": {"action_sets": {"down": gated(seq_label, [fn(f, s) for f, s in seq]), "up": []}, "options": {"runWhileHeld": []}}}
    return j

def put(page, row, col, ctl):
    old = page["controls"].setdefault(str(row), {}).get(str(col))
    cid = old or "bank:" + nid()
    c.execute("delete from controls where id=?", (cid,))
    c.execute("insert into controls(id,value) values(?,?)", (cid, json.dumps(ctl)))
    page["controls"][str(row)][str(col)] = cid

page = json.loads(c.execute("select value from pages where id=1").fetchone()[0])
for col, (name, k, bg, fg) in enumerate(KLEUREN):
    put(page, 1, col, button("Auto " + name, bg, fg, name, pure_seq(name, k)))
for i, p in enumerate(PAL):
    h = int(p["main"], 16)
    lum = (0.299 * (h >> 16) + 0.587 * ((h >> 8) & 255) + 0.114 * (h & 255))
    put(page, 3, p["knop"], button("Licht " + p["naam"], h, 0x000000 if lum > 150 else 0xFFFFFF, p["naam"], palet_seq(i)))
c.execute("update pages set value=? where id=1", (json.dumps(page),))
c.commit(); c.close()
print("knoppen bijgewerkt:", len(KLEUREN), "kleuren en", len(PAL), "paletten")
