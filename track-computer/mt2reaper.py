#!/usr/bin/env python3
"""
mt2reaper - zet een MultiTracks.com download (zip of uitgepakte map) om naar
een REAPER-project (.RPP) met:
  * alle stems op de juiste plek
  * de tempomap en maatsoortwisselingen uit het Ableton-project
  * de sectiemarkers (Intro, Verse 1, Chorus, ...)
  * 8 bus-folders, elk met een mono hardware-output naar de X32-kaart
  * een MIDI-track voor FreeShow (noot 0, kanaal 5, velocity = sectienummer)

Alleen Python 3 standaardbibliotheek. Gebruik:
    python3 mt2reaper.py "/pad/naar/Song.zip"
    python3 mt2reaper.py "/pad/naar/uitgepakte map"
    python3 mt2reaper.py "/pad/naar/map met veel zips" --all
Opties: --config busses.json   --samplerate 48000   --out /andere/map
"""
import argparse
import fnmatch
import gzip
import json
import os
import re
import subprocess
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# Standaard busindeling. Overschrijfbaar met --config busses.json
# 'out' = hardware-uitgang van de interface (1-based). Card 1-8 -> X32 ch 25-32.
# 'match' = bestandsnaam-patronen (hoofdletterongevoelig, fnmatch-stijl).
# 'live'  = stems die de band zelf speelt: worden geïmporteerd maar gemute.
# ---------------------------------------------------------------------------
DEFAULT_CONFIG = {
    "busses": [
        {"name": "CLICK",            "out": 1, "match": ["click*", "metronome*"]},
        {"name": "GUIDE",            "out": 2, "match": ["guide*", "cues*"]},
        {"name": "DRUMS / PERC",     "out": 3, "match": ["drum*", "perc*", "loop*", "kick*", "snare*", "toms*", "hat*", "cymbal*", "overhead*"]},
        {"name": "BASS",             "out": 4, "match": ["bass*", "synth bass*", "sub*", "808*"]},
        {"name": "KEYS",             "out": 5, "match": ["keys*", "piano*", "organ*", "rhodes*", "synth*", "wurli*", "b3*", "lead synth*", "arp*"]},
        {"name": "GITAREN",          "out": 6, "match": ["eg*", "ag*", "gtr*", "guitar*", "electric*", "acoustic*"]},
        {"name": "BGV / KOOR",       "out": 7, "match": ["choir*", "bgv*", "vox*", "vocal*", "voc*", "alto*", "tenor*", "soprano*", "gang*"]},
        {"name": "PADS / STRINGS / FX", "out": 8, "match": ["pad*", "string*", "orch*", "brass*", "horn*", "fx*", "synth fx*", "sfx*", "ambient*", "swell*"]},
    ],
    # Wordt geïmporteerd maar standaard gemute (speelt de band live).
    "live": ["drums*", "bass", "bass.wav", "keys", "keys.wav", "piano 1*", "eg 1*"],
    # Waar stems heen gaan die nergens matchen:
    "fallback_bus": "PADS / STRINGS / FX",
    # FreeShow: "Select slide by index" luistert standaard op kanaal 5, noot 0 (C-2).
    # midi_hw_out_index: positie van de MIDI-uitgang (bijv. IAC Driver) in
    # REAPER > Settings > MIDI Devices, tellend vanaf 0. -1 = niet instellen.
    # velocity_offset: aantal dia's vóór de eerste sectie. Bij 1 is dia 1 een (lege) startdia die
    # aan het begin van het nummer wordt gekozen (velocity 1) en is Intro = velocity 2.
    "freeshow": {"enabled": True, "channel": 5, "note": 0, "midi_hw_out_index": -1, "velocity_offset": 0,
                 "skip": ["count off", "count-in", "count in", ""]},
}

# Specifiekere patronen moeten voorrang krijgen op algemene (synth fx > synth*).
PRIORITY = [("synth fx*", "PADS / STRINGS / FX"), ("synth bass*", "BASS"), ("vox fx*", "BGV / KOOR")]


# ------------------------------- Ableton ----------------------------------
def ableton_timesig(enum_value):
    """Ableton codeert maatsoort als (teller-1) + 99*log2(noemer)."""
    v = int(enum_value)
    den = 2 ** (v // 99)
    num = v % 99 + 1
    return num, den


def read_als(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    root = ET.fromstring(data)
    ls = root.find("LiveSet")

    # Tempo-events (tijd in tellen = kwartnoten)
    tempo_ev = []
    for t in root.iter("Tempo"):
        ev = t.findall("./ArrangerAutomation/Events/FloatEvent")
        manual = t.find("Manual")
        tempo_ev = [(max(0.0, float(e.get("Time"))), float(e.get("Value"))) for e in ev]
        if not tempo_ev and manual is not None:
            tempo_ev = [(0.0, float(manual.get("Value")))]
        break
    ts_ev = []
    for t in root.iter("TimeSignature"):
        ev = t.findall("./ArrangerAutomation/Events/EnumEvent")
        ts_ev = [(max(0.0, float(e.get("Time"))), ableton_timesig(e.get("Value"))) for e in ev]
        break
    if not tempo_ev:
        tempo_ev = [(0.0, 120.0)]
    if not ts_ev:
        ts_ev = [(0.0, (4, 4))]

    # Ableton gebruikt dubbele events op hetzelfde tijdstip voor sprongen:
    # het laatste event op een tijdstip is de nieuwe waarde.
    def collapse(events):
        out = {}
        for tm, val in events:
            out[tm] = val
        return sorted(out.items())

    tempo_ev = collapse(tempo_ev)
    ts_ev = collapse(ts_ev)

    markers = []
    for l in ls.findall("./Locators/Locators/Locator"):
        markers.append((float(l.find("Time").get("Value")), (l.find("Name").get("Value") or "").strip()))
    markers.sort()

    tracks = []
    for tr in ls.find("Tracks"):
        if tr.tag != "AudioTrack":
            continue
        name = tr.find("./Name/EffectiveName").get("Value")
        for clip in tr.iter("AudioClip"):
            fr = clip.find(".//SampleRef/FileRef")
            fname = fr.find("Name").get("Value") if fr is not None and fr.find("Name") is not None else None
            tracks.append({
                "name": name,
                "file": fname,
                "start_beats": float(clip.get("Time", "0")),
                "warped": clip.find("IsWarped").get("Value") == "true",
            })
    return {"tempo": tempo_ev, "timesig": ts_ev, "markers": markers, "tracks": tracks}


class TempoMap:
    """Rekent tellen (kwartnoten) om naar seconden met stapsgewijze tempowissels."""

    def __init__(self, tempo_events):
        self.ev = tempo_events  # [(beat, bpm)] gesorteerd

    def beats_to_sec(self, beat):
        sec, prev_b, prev_bpm = 0.0, 0.0, self.ev[0][1]
        for b, bpm in self.ev:
            if b >= beat:
                break
            sec += (b - prev_b) * 60.0 / prev_bpm
            prev_b, prev_bpm = b, bpm
        return sec + (beat - prev_b) * 60.0 / prev_bpm

    def bpm_at(self, beat):
        cur = self.ev[0][1]
        for b, bpm in self.ev:
            if b <= beat:
                cur = bpm
        return cur


# ------------------------------- WAV info ---------------------------------
def wav_info(path):
    """Geeft (samplerate, kanalen, lengte_sec) terug zonder externe libs."""
    import struct
    with open(path, "rb") as f:
        if f.read(4) not in (b"RIFF", b"RF64"):
            return None
        f.read(4)
        if f.read(4) != b"WAVE":
            return None
        sr = ch = bits = None
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                return None
            cid, size = hdr[:4], struct.unpack("<I", hdr[4:])[0]
            if cid == b"fmt ":
                fmt = f.read(size)
                _, ch, sr, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
                if size % 2:
                    f.read(1)
            elif cid == b"data":
                frames = size / (ch * bits / 8)
                return sr, ch, frames / sr
            else:
                f.seek(size + (size % 2), 1)


def as_wav(path):
    """MultiTracks levert stems soms als .m4a (AAC). Die worden (eenmalig) omgezet
    naar een WAV ernaast met macOS' eigen afconvert: WAV speelt het betrouwbaarst af."""
    if path.lower().endswith(".wav"):
        return path
    wav = os.path.splitext(path)[0] + ".wav"
    if not os.path.exists(wav):
        tmp = wav + ".part"
        res = subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI24", path, tmp], capture_output=True, text=True)
        if res.returncode != 0 or not os.path.exists(tmp):
            raise SystemExit(f"Omzetten naar WAV mislukt voor {os.path.basename(path)}: {res.stderr.strip()}")
        os.replace(tmp, wav)
    return wav


# ------------------------------- Mapping ----------------------------------
def pick_bus(stem, cfg):
    s = stem.lower()
    for pat, bus in PRIORITY:
        if fnmatch.fnmatch(s, pat) and any(b["name"] == bus for b in cfg["busses"]):
            return bus
    for b in cfg["busses"]:
        if any(fnmatch.fnmatch(s, p.lower()) for p in b["match"]):
            return b["name"]
    return cfg["fallback_bus"]


def is_live(stem, cfg):
    s = stem.lower()
    return any(fnmatch.fnmatch(s, p.lower()) for p in cfg["live"])


# ------------------------------- RPP writer -------------------------------
def g():
    return "{" + str(uuid.uuid4()).upper() + "}"


def q(s):
    # RPP-strings: dubbele quotes; als de naam zelf " bevat, gebruik '
    return "'" + s + "'" if '"' in s else '"' + s + '"'


def build_rpp(song_title, als, stems_dir_rel, stem_files, cfg, samplerate, stems_abs_dir):
    tm = TempoMap(als["tempo"])
    L = []
    w = L.append
    first_bpm = als["tempo"][0][1]
    n0, d0 = als["timesig"][0][1]
    w('<REAPER_PROJECT 0.1 "7.0/mt2reaper" 0')
    w("  RIPPLE 0")
    w(f"  SAMPLERATE {samplerate} 0 0")
    w(f"  TEMPO {first_bpm:g} {n0} {d0}")
    w("  MASTERMUTESOLO 1")  # master staat uit: alles gaat via de bus-hardware-outs
    w("  MASTER_NCH 2 2")

    # Tempo-envelope: combineer tempo- en maatsoortwissels
    points = {}
    for b, bpm in als["tempo"]:
        points.setdefault(b, {})["bpm"] = bpm
    for b, ts in als["timesig"]:
        points.setdefault(b, {})["ts"] = ts
    w("  <TEMPOENVEX")
    w("    ACT 1 -1")
    w("    VIS 1 0 1")
    w("    LANEHEIGHT 0 0")
    w("    ARM 0")
    w("    DEFSHAPE 1 -1 -1")
    for b in sorted(points):
        p = points[b]
        bpm = p.get("bpm", tm.bpm_at(b))
        line = f"    PT {tm.beats_to_sec(b):.10f} {bpm:.10f} 1"
        if "ts" in p:
            num, den = p["ts"]
            line += f" {num + (den << 16)} 0 1"
        w(line)
    w("  >")

    song_len = max([s["length"] for s in stem_files] + [0])

    # Secties als regions (van sectiestart tot de volgende sectie, de laatste tot
    # het einde van het nummer). REAPER kan dan muzikaal springen: "ga naar region
    # X als de huidige region uit is" (smooth seek), net als de Playback-app.
    sec_markers = []
    for b, name in als["markers"]:
        if name:
            sec_markers.append((b, tm.beats_to_sec(b), name))
    for idx, (b, pos, name) in enumerate(sec_markers, 1):
        end = sec_markers[idx][1] if idx < len(sec_markers) else max(song_len, pos + 1)
        w(f"  MARKER {idx} {pos:.14f} {q(name)} 1 0 1 B {g()} 0 0")
        w(f'  MARKER {idx} {end:.14f} "" 1')

    # Groepeer stems per bus
    per_bus = {b["name"]: [] for b in cfg["busses"]}
    for st in stem_files:
        per_bus[pick_bus(st["name"], cfg)].append(st)

    def track_open(name, extra):
        w(f"  <TRACK {g()}")
        w(f"    NAME {q(name)}")
        for e in extra:
            w("    " + e)

    # FreeShow MIDI-track (eerst, zodat hij bovenaan staat)
    fs = cfg.get("freeshow", {})
    if fs.get("enabled"):
        extra = ["MAINSEND 0 0", "ISBUS 0 0", "MUTESOLO 0 0 0"]
        dev = fs.get("midi_hw_out_index", -1)
        if dev is not None and int(dev) >= 0:
            extra.append(f"MIDIOUT {int(dev) * 32} -1")  # REAPER: apparaat*32 + kanaal (0 = originele kanalen)
        track_open("FreeShow MIDI", extra)
        ch = int(fs.get("channel", 5)) - 1
        note = int(fs.get("note", 0))
        skip = [s.lower() for s in fs.get("skip", [])]
        offset = int(fs.get("velocity_offset", 0))
        evs = []
        if offset > 0:
            # startdia aan het begin van het nummer (bijv. voor licht/visuals in FreeShow)
            evs.append((0, f"{0x90 | ch:02x} {note:02x} 01"))
            evs.append((96, f"{0x80 | ch:02x} {note:02x} 00"))
        slide = 0
        for b, pos, name in sec_markers:
            if name.lower() in skip:
                continue
            slide += 1
            tick = int(round(b * 960))
            evs.append((tick, f"{0x90 | ch:02x} {note:02x} {min(slide + offset, 127):02x}"))
            evs.append((tick + 96, f"{0x80 | ch:02x} {note:02x} 00"))
        evs.sort(key=lambda e: e[0])
        w("    <ITEM")
        w("      POSITION 0")
        w(f"      LENGTH {song_len:.10f}")
        w("      LOOP 0")
        w('      NAME "FreeShow cues"')
        w(f"      IGUID {g()}")
        w("      <SOURCE MIDI")
        w("        HASDATA 1 960 QN")
        last = 0
        for tick, data in evs:
            w(f"        E {tick - last} {data}")
            last = tick
        end_tick = int(round(tm_len_beats(tm, song_len) * 960))
        w(f"        E {max(0, end_tick - last)} b{ch:x} 7b 00")
        w(f"        GUID {g()}")
        w("      >")
        w("    >")
        w("  >")

    # Bus-folders met stems
    for bus in cfg["busses"]:
        stems = per_bus[bus["name"]]
        hw = 1024 + (int(bus["out"]) - 1)  # 1024 = mono-uitgang
        label = f"{bus['name']} -> Out {bus['out']}"
        base = ["MAINSEND 0 0", f"HWOUT {hw} 0 1 0 0 0 0 -1:U -1"]
        if not stems:
            track_open(label, base + ["ISBUS 0 0"])
            w("  >")
            continue
        track_open(label, base + ["ISBUS 1 1"])
        w("  >")
        for i, st in enumerate(stems):
            last = i == len(stems) - 1
            muted = is_live(st["name"], cfg)
            track_open(st["name"] + (" [LIVE]" if muted else ""), [
                "MAINSEND 1 0",
                f"MUTESOLO {1 if muted else 0} 0 0",
                "ISBUS 2 -1" if last else "ISBUS 0 0",
            ])
            w("    <ITEM")
            w(f"      POSITION {st['position']:.10f}")
            w(f"      LENGTH {st['length']:.10f}")
            w("      LOOP 0")
            w(f"      NAME {q(st['file'])}")
            w(f"      IGUID {g()}")
            w("      <SOURCE WAVE")
            w(f"        FILE {q(os.path.join(stems_dir_rel, st['file']))}")
            w("      >")
            w("    >")
            w("  >")
    w(">")
    return "\n".join(L) + "\n", per_bus, sec_markers


def tm_len_beats(tm, seconds):
    # inverse van beats_to_sec via bisectie (eenvoudig en robuust)
    lo, hi = 0.0, 10000.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if tm.beats_to_sec(mid) < seconds:
            lo = mid
        else:
            hi = mid
    return lo


# ------------------------------- Main -------------------------------------
def find_song_root(folder):
    for dirpath, dirs, files in os.walk(folder):
        for f in files:
            if f.lower().endswith(".als") and not f.startswith("._"):
                return dirpath, os.path.join(dirpath, f)
    return None, None


def convert(src, cfg, samplerate, out_dir=None, force=False):
    if os.path.isfile(src) and src.lower().endswith(".zip"):
        dest = out_dir or os.path.splitext(src)[0]
        if not os.path.isdir(dest):
            with zipfile.ZipFile(src) as z:
                z.extractall(dest)
        folder = dest
    else:
        folder = src
    root, als_path = find_song_root(folder)
    if not als_path:
        raise SystemExit(f"Geen .als-bestand gevonden in {folder}")

    als = read_als(als_path)
    tm = TempoMap(als["tempo"])
    title = os.path.basename(os.path.normpath(root))

    stem_files, missing = [], []
    for t in als["tracks"]:
        if not t["file"]:
            continue
        # zoek het bestand (meestal in MultiTracks/)
        found = None
        for dp, _, fs in os.walk(root):
            if t["file"] in fs:
                found = os.path.join(dp, t["file"])
                break
        if not found:
            missing.append(t["file"])
            continue
        found = as_wav(found)
        info = wav_info(found)
        length = info[2] if info else 0.0
        rel_dir = os.path.relpath(os.path.dirname(found), root)
        stem_files.append({
            "name": t["name"],
            "file": os.path.basename(found),
            "rel_dir": rel_dir,
            "position": tm.beats_to_sec(t["start_beats"]),
            "length": length,
            "sr": info[0] if info else None,
        })
    rel_dir = stem_files[0]["rel_dir"] if stem_files else "MultiTracks"

    rpp_path = os.path.join(root, f"{safe(title)}.RPP")
    # Een bestaand project kan in REAPER aangepast en opgeslagen zijn (mix, mutes):
    # alleen met --force opnieuw maken.
    if os.path.exists(rpp_path) and not force:
        print(f"\n== {title}\n   Bestaat al, overgeslagen (gebruik --force om opnieuw te maken)\n   -> {rpp_path}")
        return {"title": title, "rpp": rpp_path, "skipped": True}

    rpp, per_bus, markers = build_rpp(title, als, rel_dir, stem_files, cfg, samplerate, root)
    with open(rpp_path, "w", encoding="utf-8") as f:
        f.write(rpp)

    # Rapport
    print(f"\n== {title}")
    bpms = sorted({round(b, 2) for _, b in als['tempo']})
    print(f"   Tempo: {', '.join(f'{b:g}' for b in bpms)} BPM   Stems: {len(stem_files)}   Markers: {len(markers)}")
    srs = {s['sr'] for s in stem_files if s['sr']}
    if srs and samplerate not in srs:
        print(f"   Let op: stems zijn {', '.join(str(s) for s in srs)} Hz; REAPER resamplet live naar {samplerate} Hz.")
    for bus in cfg["busses"]:
        names = [s["name"] + (" (mute)" if is_live(s["name"], cfg) else "") for s in per_bus[bus["name"]]]
        print(f"   Out {bus['out']:>2} {bus['name']:<22} {', '.join(names) or '-'}")
    if missing:
        print(f"   ONTBREEKT: {', '.join(missing)}")
    print(f"   -> {rpp_path}")
    return {
        "title": title,
        "rpp": rpp_path,
        "skipped": False,
        "tempo": bpms,
        "stems": len(stem_files),
        "sections": [name for _, _, name in markers],
        "busses": {bus["name"]: [s["name"] + (" [LIVE]" if is_live(s["name"], cfg) else "") for s in per_bus[bus["name"]]]
                   for bus in cfg["busses"]},
        "missing": missing,
        "samplerates": sorted(srs),
    }


def safe(s):
    return re.sub(r'[\\/:*?"<>|]+', "_", s).strip() or "song"


def main():
    ap = argparse.ArgumentParser(description="MultiTracks.com download -> REAPER project")
    ap.add_argument("source", help="zip-bestand, uitgepakte songmap, of (met --all) een map met zips/songmappen")
    ap.add_argument("--all", action="store_true", help="verwerk alle zips/songmappen in de map")
    ap.add_argument("--config", help="JSON met eigen busindeling (zie busses.example.json)")
    ap.add_argument("--samplerate", type=int, default=48000, help="projectsamplerate (X32 = 48000)")
    ap.add_argument("--out", help="uitpakmap voor een zip (standaard naast de zip)")
    ap.add_argument("--force", action="store_true", help="bestaande .RPP-projecten overschrijven")
    ap.add_argument("--report-json", help="schrijf een JSON-rapport van de verwerkte nummers naar dit bestand")
    a = ap.parse_args()

    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if a.config:
        with open(a.config, encoding="utf-8") as f:
            cfg.update(json.load(f))

    reports = []
    if a.all:
        items = sorted(os.listdir(a.source))
        for it in items:
            p = os.path.join(a.source, it)
            if it.lower().endswith(".zip") and not os.path.isdir(os.path.splitext(p)[0]):
                reports.append(convert(p, cfg, a.samplerate, force=a.force))
            elif os.path.isdir(p) and find_song_root(p)[1]:
                reports.append(convert(p, cfg, a.samplerate, force=a.force))
        print(f"\n{len(reports)} nummer(s) verwerkt.")
    else:
        reports.append(convert(a.source, cfg, a.samplerate, a.out, force=a.force))
    if a.report_json:
        with open(a.report_json, "w", encoding="utf-8") as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
