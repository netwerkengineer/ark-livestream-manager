#!/usr/bin/env python3
"""Zet de lichtknoppen in de Companion-database (pagina 1): 8 losse kleuren (rij 1) en de paletten (rij 3, en rij 2 vanaf kolom 2).

Draai dit in de Companion-datamap met Companion GESTOPT (docker stop companion), als de eigenaar van de
bestanden (uid 1000). Gebruik: companion_palettes.py <db.sqlite> <palettes.json>
Elke knop doet niets als de variabele licht_auto op "uit" staat, en onthoudt kleur en tijd van de laatste wissel.
Herhaalbaar: bestaande Auto-knoppen worden opnieuw opgebouwd.
"""
import copy, json, random, re, shutil, sqlite3, string, sys

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
def layered(j):
    return {l.get("id") for l in (j.get("style") or {}).get("layers", [])} >= {"text0", "box0"}

tmpl = None
for cid, v in c.execute("select id,value from controls"):
    if "Smart Stekker 1" in v: tmpl = json.loads(v); break
if tmpl is None:    # geen Smart Stekker-knop (bv. op productie): neem een bestaande Licht-/Auto-knop als uitgangspunt voor de opmaak
    for cid, v in c.execute("select id,value from controls"):
        j = json.loads(v)
        if layered(j) and re.search(r'"value":\s*"(Licht |Auto )', v): tmpl = j; break
if tmpl is None:    # anders een willekeurige knop met de lagen text0 en box0
    for cid, v in c.execute("select id,value from controls"):
        j = json.loads(v)
        if layered(j): tmpl = j; break
if tmpl is None:
    sys.exit("Geen knop gevonden die als sjabloon kan dienen - de database is niet aangepast.")

def fn(f, status):
    return {"id": nid(), "definitionId": "setFunctionStatus", "connectionId": QLC,
            "options": {"functionID": O(str(f)), "status": O(status)}, "upgradeIndex": upg, "type": "action"}

def setvar(name, val):
    return {"type": "action", "id": nid(), "definitionId": "custom_variable_set_value", "connectionId": "internal",
            "options": {"name": O(name), "value": O(val)}, "upgradeIndex": None}

def feedback(expr, overrides):
    # Knopkleur laten meeveranderen met de schakelaar licht_auto: overrides = [(element, eigenschap, waarde), ...]
    return {"id": nid(), "definitionId": "check_expression", "connectionId": "internal", "type": "feedback",
            "options": {"expression": O(expr, True)}, "isInverted": O(False), "children": {},
            "styleOverrides": [{"overrideId": nid(), "elementId": el, "elementProperty": prop, "override": {"isExpression": False, "value": val}}
                               for el, prop, val in overrides]}

UIT_UITERLIJK = [("box0", "color", 0x303030), ("text0", "color", 0x909090)]   # knop ziet er uitgeschakeld uit als automatisch licht uit staat

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
    j["feedbacks"] = [feedback('$(custom:licht_auto) == "uit"', UIT_UITERLIJK)]
    return j

def put(page, row, col, ctl):
    old = page["controls"].setdefault(str(row), {}).get(str(col))
    cid = old or "bank:" + nid()
    c.execute("delete from controls where id=?", (cid,))
    c.execute("insert into controls(id,value) values(?,?)", (cid, json.dumps(ctl)))
    page["controls"][str(row)][str(col)] = cid

def switch_button(label, val, bg):
    j = copy.deepcopy(tmpl); j["feedbacks"] = []
    for l in j["style"]["layers"]:
        if l["id"] == "text0": l["text"]["value"] = label; l["color"]["value"] = 0xFFFFFF
        if l["id"] == "box0": l["color"]["value"] = bg
    j["steps"] = {"0": {"action_sets": {"down": [setvar("licht_auto", val)], "up": []}, "options": {"runWhileHeld": []}}}
    # de knop die de huidige stand aangeeft licht fel op; de andere is gedimd
    actief = '$(custom:licht_auto) == "%s"' % val
    fel = 0x00D000 if val == "aan" else 0xFF0000
    j["feedbacks"] = [feedback(actief, [("box0", "color", fel)])]
    return j

# Oude Auto/Licht-knoppen op pagina 1 weghalen (de lichtknoppen staan nu op een eigen pagina)
p1 = json.loads(c.execute("select value from pages where id=1").fetchone()[0])
for r, cols in list(p1["controls"].items()):
    for col, cid in list(cols.items()):
        row = c.execute("select value from controls where id=?", (cid,)).fetchone()
        if row and re.search(r'"value":\s*"(Auto |Licht )', row[0]):
            c.execute("delete from controls where id=?", (cid,)); del cols[col]
c.execute("update pages set value=? where id=1", (json.dumps(p1),))

# Pagina 2 "Licht" opnieuw opbouwen
old = c.execute("select value from pages where id=2").fetchone()
page = json.loads(old[0]) if old else {"name": "Licht", "controls": {}, "id": nid()}
page["name"] = "Licht"
for r, cols in list(page["controls"].items()):
    for cid in cols.values(): c.execute("delete from controls where id=?", (cid,))
page["controls"] = {}
put(page, 0, 0, switch_button("Auto licht AAN", "aan", 0x1F3D1F))
put(page, 0, 1, switch_button("Auto licht UIT", "uit", 0x4A1F1F))
for col, (name, k, bg, fg) in enumerate(KLEUREN):
    put(page, 1, col, button("Auto " + name, bg, fg, name, pure_seq(name, k)))
for i, p in enumerate(PAL):
    h = int(p["main"], 16)
    lum = (0.299 * (h >> 16) + 0.587 * ((h >> 8) & 255) + 0.114 * (h & 255))
    put(page, 2 + p["knop"] // 8, p["knop"] % 8, button("Licht " + p["naam"], h, 0x000000 if lum > 150 else 0xFFFFFF, p["naam"], palet_seq(i)))
c.execute("delete from pages where id=2")
c.execute("insert into pages(id,value) values(2,?)", (json.dumps(page),))
c.commit(); c.close()
print("pagina Licht bijgewerkt:", len(KLEUREN), "kleuren en", len(PAL), "sferen")
