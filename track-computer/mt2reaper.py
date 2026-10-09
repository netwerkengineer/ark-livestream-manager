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

Eigen opname i.p.v. een MultiTracks-download: een map of zip met de stems en een
song.json (titel, key, bpm, timesig, secties in maten; zie song.example.json).
Controleren voor het uploaden:  python3 mt2reaper.py "/pad/naar/map" --check
"""
import argparse
import array
import base64
import fnmatch
import gzip
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
import wave
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


# ------------------------------- Eigen opname (song.json) -------------------
# Alternatief voor een MultiTracks/Ableton-download: een map of zip met de stems en een
# song.json met titel, toonsoort, tempo, maatsoort en secties in maten (zie
# song.example.json). Levert dezelfde gegevens als read_als.
AUDIO_EXT = (".wav", ".m4a", ".aif", ".aiff", ".mp3", ".flac", ".caf")


def _num(v, what):
    try:
        return float(v)
    except (TypeError, ValueError):
        raise SystemExit(f"song.json: {what} moet een getal zijn (gevonden: {v!r})")


def _timesig(v, what):
    m = re.match(r"^\s*(\d+)\s*/\s*(\d+)\s*$", str(v))
    if not m or int(m.group(2)) not in (1, 2, 4, 8, 16, 32):
        raise SystemExit(f"song.json: {what} moet een maatsoort zijn als \"4/4\" of \"6/8\" (gevonden: {v!r})")
    return int(m.group(1)), int(m.group(2))


def _bar_to_qn(bar, beat, sigs):
    """Maat (1 = eerste maat) + tel (1 = eerste tel) -> kwartnoten vanaf het begin.
    sigs: [(maat, (teller, noemer))] oplopend, begint bij maat 1."""
    whole = int(bar)
    qn, b, cur = 0.0, 1, sigs[0][1]
    idx = 0
    while b < whole:
        while idx + 1 < len(sigs) and sigs[idx + 1][0] <= b:
            idx += 1
        cur = sigs[idx][1]
        qn += cur[0] * 4.0 / cur[1]
        b += 1
    while idx + 1 < len(sigs) and sigs[idx + 1][0] <= whole:
        idx += 1
    cur = sigs[idx][1]
    qn += (bar - whole) * cur[0] * 4.0 / cur[1]      # gebroken maat
    qn += (beat - 1) * 4.0 / cur[1]                   # tel binnen de maat
    return qn


def read_song_json(path):
    root = os.path.dirname(path)
    try:
        with open(path, encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError) as e:
        raise SystemExit(f"song.json is niet te lezen: {e}")
    if not isinstance(j, dict):
        raise SystemExit("song.json: verwacht een object met title, bpm en sections")
    title = str(j.get("title") or "").strip()
    if not title:
        raise SystemExit("song.json: \"title\" ontbreekt")

    # maatsoort (in maten) -> kwartnoten
    raw = j.get("timesig", "4/4")
    sig_in = [[1, raw]] if isinstance(raw, str) else raw
    sigs = sorted([(int(_num(b, "maat in timesig")), _timesig(v, "timesig")) for b, v in sig_in])
    if not sigs or sigs[0][0] != 1:
        raise SystemExit("song.json: timesig moet bij maat 1 beginnen")
    timesig = [(_bar_to_qn(b, 1, sigs), ts) for b, ts in sigs]

    # tempo
    if "tempo" in j:
        tempo_in = [(int(_num(b, "maat in tempo")), _num(v, "tempo")) for b, v in j["tempo"]]
    elif "bpm" in j:
        tempo_in = [(1, _num(j["bpm"], "bpm"))]
    else:
        raise SystemExit("song.json: \"bpm\" (of \"tempo\": [[maat, bpm], ...]) ontbreekt")
    tempo_in.sort()
    if tempo_in[0][0] != 1:
        raise SystemExit("song.json: tempo moet bij maat 1 beginnen")
    if any(v < 20 or v > 400 for _, v in tempo_in):
        raise SystemExit("song.json: tempo buiten 20-400 bpm")
    tempo = [(_bar_to_qn(b, 1, sigs), v) for b, v in tempo_in]
    tm = TempoMap(tempo)

    # secties
    sections = []
    for entry in j.get("sections", []):
        if isinstance(entry, dict):
            name, bar, beat, sec = entry.get("name"), entry.get("bar"), entry.get("beat", 1), entry.get("sec")
        else:
            name = entry[0]
            bar = entry[1] if len(entry) > 1 else None
            beat, sec = (entry[2] if len(entry) > 2 else 1), None
        name = str(name or "").strip()
        if not name:
            raise SystemExit(f"song.json: sectie zonder naam: {entry!r}")
        if sec is not None:
            qn = tm_len_beats(tm, _num(sec, f"sec van {name}"))
        elif bar is not None:
            if _num(bar, f"maat van {name}") < 1:
                raise SystemExit(f"song.json: maat van \"{name}\" moet vanaf 1 tellen")
            qn = _bar_to_qn(_num(bar, f"maat van {name}"), _num(beat, f"tel van {name}"), sigs)
        else:
            raise SystemExit(f"song.json: sectie \"{name}\" heeft een \"bar\" (maat) of \"sec\" (seconden) nodig")
        sections.append((qn, name))
    sections.sort()
    if not sections:
        raise SystemExit("song.json: \"sections\" ontbreekt; zonder secties kan er niet gesprongen worden")

    # stems: opgegeven, anders alle audiobestanden in de map
    stems = []
    listed = j.get("stems")
    if listed:
        for s in listed:
            s = {"file": s} if isinstance(s, str) else dict(s)
            if not s.get("file"):
                raise SystemExit(f"song.json: stem zonder \"file\": {s!r}")
            if os.path.basename(s["file"]).startswith("._"):
                continue        # verborgen macOS-bijbestandje, geen audio
            stems.append({"name": s.get("name") or os.path.splitext(os.path.basename(s["file"]))[0],
                          "file": os.path.basename(s["file"]),
                          "start_beats": tm_len_beats(tm, _num(s.get("start", 0), "start")) if s.get("start") else 0.0,
                          "warped": False})
    else:
        found = {}
        for dp, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("__MACOSX", "peaks")]
            for f in sorted(files):
                if f.startswith("._") or f.startswith("Ark Click") or not f.lower().endswith(AUDIO_EXT):
                    continue
                base = os.path.splitext(f)[0]
                # .m4a met een omgezette .wav ernaast: de .wav
                if base not in found or f.lower().endswith(".wav"):
                    found[base] = f
        for base in sorted(found, key=str.lower):
            stems.append({"name": base, "file": found[base], "start_beats": 0.0, "warped": False})
    if not stems:
        raise SystemExit("song.json: geen audiobestanden (stems) gevonden naast song.json")

    # naam in MultiTracks-stijl ("Titel-Album-Toonsoort-120.00bpm"): daar halen de app
    # en de padspeler titel, toonsoort en tempo uit
    clean = lambda s: re.sub(r"\s+", " ", re.sub(r"[-\\/:*?\"<>|]+", " ", str(s))).strip()
    key = str(j.get("key") or "").strip()
    name = f"{clean(title)}-{clean(j.get('album') or 'Eigen opname')}"
    if re.match(r"^[A-G][#b]?m?$", key):
        name += f"-{key}-{tempo_in[0][1]:.2f}bpm"
    elif key:
        raise SystemExit(f"song.json: key \"{key}\" is geen toonsoort (bijv. C, Bb, F#m)")
    return {"tempo": tempo, "timesig": timesig, "markers": sections, "tracks": stems, "title": name}


def read_song(path):
    return read_song_json(path) if path.lower().endswith(".json") else read_als(path)


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
            live = is_live(st["name"], cfg)
            muted = st.get("muted", live)
            track_open(st["name"] + (" [LIVE]" if live else ""), [
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


# ------------------------------- Eigen click -------------------------------
# De click van MultiTracks is één afgemixt bestand (vaak achtsten met accenten). Daarom
# maken we zelf drie click-stems uit de tempomap: kwarten (accent op de 1), de tussenliggende
# achtsten en de tussenliggende zestienden. In de app krijgt elk een eigen fader en mute;
# samen klinken ze als een gewone click in de gekozen onderverdeling.
CLICK_SR = 48000
# Vaste MultiTracks-tikken (70 ms, 48 kHz mono, 16 bit): een sterke (accent) en een zachte (1,0 / 0,7 zoals
# de originele click). Voor nummers zonder click-stem (bijv. een eigen opname), zodat de eigen click overal
# hetzelfde klinkt.
CLICK_BANK = {
    "strong": (
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAAD//wAAAAAAAP////8AAAEAAQAAAAAAAAD//wAAAAAAAAAAAAABAAAA"
    "AQAAAAEAAAAAAAAAAAAAAAAAAAAAAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAAEA"
    "AgAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAP////8AAAIAAQAAAAAAAAAAAAAAAAAAAAAAAAD//wAAAQAAAAAAAAACAAEA"
    "AAAAAP////8AAAAAAAAAAAAAAAAAAP////8AAAAAAAAAAAEAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAD///7///8AAAAAAQAAAAAAAAAAAAAAAAAAAAAAAQAAAP//////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAABAAAAAAAAAAAAAAD/////AAAAAP//AAAAAAAAAAD//wAAAQAAAAAAAAAAAAAAAAAAAAAAAAD///7///8AAAAAAQAAAP//"
    "/v//////////////AAAAAAEAAAAAAAAAAAABAAAAAAAAAAEAAQAAAAAAAAABAAAA///+////AAABAAAAAAD//wAAAAABAAIA"
    "AQAAAP//AAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAABAAAAAAD//wAAAAD///7///8AAAAAAAAAAP//AAABAAAA"
    "/////wAAAAAAAAAA/////////f/5//L/7P/k/9r///+OAHIBLwKtAoEDLwSvAxoDqAMXBEUDEQICAaT/Lv6b/Ej60vdV9h72"
    "jfe6+b35Ivht+eD8KP3r+kb6iPs2/vYAegEdAq4EsgapCQEOqwyQBFv+EP+RAtQBt/4zAlIKQA0tDE8PUxbyF88QYApqCDED"
    "C/tg9GTthukj6VzjMOBS7+YCmAGk8NfsuwLfG3Yd+w2WBHIF5Ae/CPwFLfy28FH2TxOGJOsKCunG5LvlDN353Y/ZjcE+uKXI"
    "T9Vn1zLXptVg2qrlO+nk4nbjsPfSFG4ngjBcPNdOIGXWeP5//n/+fyV/93SRcDVn6lluSkAzwho3C/v5buAEyr667a3jqU6y"
    "J73FwGq7NrM+s3m3ZK6vmOaIYoWZhmSJgI63k3SajqjFvabR69sp3jDl1viJEUonIjgGP7k70TgfPBhCwkcVTJtPe1agYsNw"
    "oH3+f/5/o3JWYCBNkTd9IfML5vyo+tr51e144pzmWvWWAAgB/Pso+tz4vPTO9ncEPBQTHbEf0B4qGg4UQBCMDLcE8vmJ7p/j"
    "bNv31U7Q38i+wEq687MwqMiWiYZfgYSBPICXiE2YfKRlr0u758ny2arszABnEnYhTTKNRF5UJ12vXYVeCWeUdf5//n/+f/5/"
    "vXUDbMphe1VtRe00JCUXFNkBxPLu5QDaVNGIzGLJaMdoxZPDEMY7zkfY1uDq5LXj+OGw4+/mp+gE6FTmweWQ53zsbvO/96b2"
    "IfN08S3zpPbF+MD4o/eN9QvzbPI39dD6hQAUAwwCyv/V/u8APAW/CLIJEQhLBbcDRwMJAiAA7P7n/rYA1AR2CrEP4RI8FT8Z"
    "sx2HHwIfqR69H4QhZSLxISghEiG5ITchVx1PFi4NCQOX+gr1KPAI6+LmCeTm4ebe0dnE1JjS5dNP2NrdBuLR5UvrafJY+1EF"
    "2QxtECgSuhPYFNUU7xOYEkcQYg2OC3IKmghXBtkD/v80+m7zr+7f7gLzHfiu/Lv/1wDtAGwAcf+Q/oX9+/ug+tD5B/pz/NsA"
    "twVACj4OSREWE50T0hI7EG0LWQW//4n7xvhC95T2OvbU9bz16/aS+cn8lP9bARACSgKvAnMDSgSrBFIEZAM0AkkBwgDt/37+"
    "K/2Y/Lj8Zf2N/u3/EwGkAXsBogA8/4f9FPxe+zb7N/uE+1v8dv1w/iL/i//F/xsAxgC3AbUCawOiA3kDTgNhA6oD5QPWA3MD"
    "vgK7AZ0At/8u/xX/mf+XAGwBkAFMATYBbAG4AQ8CaQKUAnwCLAKFAXUAaf/0/hn/Xv9h/w7/cv7A/UD9Fv0g/SP9Gf0T/Rn9"
    "Nv2B/fP9Wf6a/sn+/P4z/4T///+CAL8AqAB6AGQAZACGANEAGgE8AVMBcgFzAUYBIAEhARgB1gBvAAcAqv9f/zH/Hf8X/yT/"
    "S/+E/7z/5P/9/xYAQgB1AJMAiwBhACsA9P+4/33/V/9N/1f/cf+S/6z/vf/Q/+P/7P/t/+z/7P/0////CQAMAAkABwAFAAAA"
    "/f8BAAoAEQARAAwABgAAAPb/7P/o/+r/6//r/+n/6v/s/+7/8P/w/+7/7P/t/+//8f/w/+//8P/1//j/+v/6//r/+P/3//j/"
    "+P/5//n/9//z//L/8v/y//P/9f/3//f/9P/y//P/9//6//r/+f/5//r/+v/6//f/8//w/+//8P/w//D/8f/x/+//8P/y//X/"
    "9v/3//j/+P/4//n/+//9//z//P/7//r/+P/1//P/9f/4//r/+//7//n/9//2//j//P/+//3/+//6//r/+f/2//X/9f/2//b/"
    "9v/3//j/9//1//X/9P/y/+//7f/t//D/9P/5//z//f/8//z//P/+//7/+v/3//X/9P/0//D/7v/v//H/8v/y//P/9P/0//X/"
    "+P/6//r/+P/4//v//P/7//j/+P/4//j/9v/z//D/7//w//H/8v/1//j/+v/6//r/+v/7//v//P/7//r/+P/2//T/8//1//b/"
    "9v/2//b/9//3//n/+v/5//f/9v/3//X/8//w//H/8//1//X/9v/5//v//P/8//z//f/7//v/+//6//n/9//2//b/8//x//D/"
    "9P/3//b/8f/v/+//8v/1//f/+f/4//f/9f/0//X/9v/3//b/9P/0//j//P/9//3//f/8//v/+f/6//r/+P/2//X/9//4//b/"
    "9//5//z/+//7//z//f/8//v/+v/5//j/9//4//j/9v/0//T/9P/0//T/9f/2//f/+P/3//b/9v/4//3//v/8//b/8v/z//T/"
    "9P/y//H/8v/z//T/9f/3//r//P///wAAAgABAP//+v/0//D/8P/x//L/8v/y//L/8v/z//X/9//3//f/9//4//f/+P/9////"
    "/f/5//f/+P/4//f/9//5//j/9//5//r/+f/3//n//P/6//T/7//v//L/8//0//X/9P/z//P/9f/4//r/+//9//7//f/7//v/"
    "/P/8//j/8//w//D/8f/y//P/9P/1//f/+f/7//v//P/7//n/+f/7//3//P/3//T/9f/4//n/+f/6//z//f/6//n/+f/4//j/"
    "+v/8//z/+//8//z/+//6//v//P/7//r/+//9//z/+//5//v/+v/6//j/+f/6//v/+//8//z//P/+/wAAAAD9//v/+v/7//v/"
    "+v/4//j/+v/8//3//P/7//r/+//8//v/+//7//r/+v/6//r/+//6//n/+P/3//j/+f/5//j/9v/2//f/9v/z//L/9f/4//n/"
    "+P/5//3//f/9//z//f/+//3//P/9////AAAAAAAA/P/2//T/9//5//b/9f/2//r/+P/0//P/+P/8//v/9//0//X/9f/y//H/"
    "8f/0//f/+f/6//v/+//9/wAAAgACAAAA/v/9//z/+f/1//L/8v/y//T/9f/3//j/9//2//j/+////////P/6//n/9v/y//L/"
    "8//y//H/8v/0//T/8//0//b/9//2//b/+P/6//j/9v/5//7////9//7//v/9//z//P/7//r/+f/5//z/AAAAAP///P/7//3/"
    "/f/7//n/+f/7//3//f/+//3//P/8//v/+//6//f/9v/0//T/9v/2//X/9f/3//v/+//6//r//P/8//r/+v/9/////v/8//v/"
    "+v/5//f/9//4//n/+v/7//z//f/9//3//f/+//3//P/8//7//f/6//f/+P/4//b/8//1//j/+f/3//j//P/9//r/+v/9//7/"
    "/P/5//r//P/9//7///////7//v///////f/7//v/+//6//n//P///////P/6//v//v////z/+v/6//z//P/7//n/+v/7//v/"
    "/P/8//z/+//6//r/+v/8//7///////7/+//6//v//f/9//7//v/+//3//v/+/////v/8//n/+P/5//n/+f/3//b/+P/6//v/"
    "+f/4//n/+v/4//X/9v/6//z/+//5//j/+f/5//r//P/8//z/+f/4//r//P/9//3//v////7/+//4//n/+v/7//v//P/+////"
    "/P/5//n/+f/4//n/+v/8//z/+f/4//j/+f/4//f/9//5//z///////7//f/8//3//f/9//3//P/6//f/9v/3//j/+P/3//j/"
    "+f/6//r/+v/7//v/+//8////AAAAAP7/+//5//f/9//3//X/8//0//f/+P/4//j/+f/7//3//f/8//v/+f/6//z//P/7//z/"
    "/f/+//7//f/9//z/+//6//v//f/+//7//f/8//3///8CAAIAAAD+//3//v////7//P/4//j//P///////P/7//z/+//5//j/"
    "+v/8//v/+f/3//b/9v/2//b/+P/5//n/9//2//X/9v/4//r/+v/5//v/+//8//v/+v/5//r//P/+/////v/8//z//f/8//r/"
    "+//8//z/+v/2//f/+f/6//r/+//7//r/+P/5//v//P/8//z//P/6//n/+f/5//n/9//4//n/+f/5//n/+v/7//r/+v/7//3/"
    "+//4//X/9v/3//f/+P/5//v//P/9//7//v/+///////+//3//v///////v/+//7//v/9/wAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
),
    "weak": (
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQAAAAAAAAAAAAAA//8AAAEAAQAAAP7//////wAAAAAAAAEAAQABAAEAAAAAAP//"
    "AAAAAP///////wAA//////7/AAAAAAAAAAAAAAAAAAAAAAEAAQAAAAEAAAAAAP//AAABAAEAAAACAAEAAAD//wAAAAD///7/"
    "AAAAAAAAAAAAAAAAAAD//wAAAAAAAAAAAAD///7///8AAAEA//////7/AAACAAIAAAD///3//v8AAAEAAAD///7/AAABAAEA"
    "AAAAAAAAAgABAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAD+//7/AAD//////v8AAAAAAAD+//7//v/+/wAAAAABAAEA"
    "AAD/////AAAAAAAAAAAAAAAAAAAAAAEAAQABAAEAAQAAAP7///8AAAAAAAD//wAAAQAAAAEAAgAAAP////8AAAAA/////wAA"
    "AAAAAP/////+//7///8AAAAAAAAAAAAA/////wAAAAAAAAAAAQACAAAAAAAAAAAAAAAAAAAA/////wAAAQAAAAAAAAAAAAEA"
    "AwADAAAAAAAAAAAAAAD+////AAD/////AAAAAAEAAgABAAAAAAD//////v8AAAEAAQABAAIAAgAAAP//AAABAAAAAAAAAAIA"
    "AAD//wAABAADAAAA//8AAAAAAAAAAAAA/v/9////AgADAAIAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAIAAgAAAAAAAAAAAAAA"
    "AgAEAAEA/v/+/wEAAAD9//z//v8AAP///f/+/wAAAQABAAAA/v///wAAAQAAAAAAAAAAAP///f/7//X/5v/X/+//JQBkAK8A"
    "CgFdAWYBSgFpAXsBRgEkAXIB1AGBAZEA6v+d/8f+hP0t/fr9h/4b/on92P3Q/rT+r/zx+pT7gf0J/7P/Wf9M/04B1AMLBDsC"
    "hwBMAJ0BZAPABMEFDQddCoMPehFjDVUIXQe3CCYIQQOi+kfyc+2p6/3rPe6P8LHx2fKB9LX1/fYM+vX+jAKFAMT5KfVe9iz5"
    "R/j480vyAfrSCeQX1hyVGe0SwA1qDTgQ8Q9YCdsA8Ptt+DHxXujt40njO+F83Rzd2OOo8IL+zweLDF8SehxrKIUyBzgDOSs6"
    "7D0CQJo9RDnfNOMvKiowJJAdhhMpBGTzr+Vd2lLRzcyHy0fKrMh6xyDHTcfOxb7Bq77VwO7HQ8+406TXhN0O467lk+Y/6Cjs"
    "BvLG9078wQDMBbkKRw8qE9gUNhMGENcPthYBJE4yMTwpQEo/BTu7NEYtHyXZHV8Z0Bd8GGsbXh/yICceJxiUEEgIxACX+1D4"
    "XvWf8gHynvXc/SkJAhT0GToZqhRuEI0OpQ7KDucMNAh1AaD6TPWj8GjqruHq1gnLXb/5tLKs5qdnpymqXq7IspW2WLn/u/PA"
    "bsp22BrpDvpbCXcVvR1qI3kpEzKrPEhHTlCKVhFZklddUqVKGELPOWoydyxSJ0ghuxmOEbAJYAL8+q3y5Oko4u7cpNsQ3/Dl"
    "3O3e9Nz5w/wJ/rr95/sW+aT1DfJf7wLv/vGU9+D8e/8o/1/8xvek8rbtsejR4yjgb94Z31Li6OYa6xju0++T8PfwvfEz8x71"
    "iff4+lf/mwOVBtoHYwiVCV4L3wyMDmoRURVaGbYcpx4iH/setB5VHn8eAiCLIh0lRCe+KM0oxSaWIocc+hSKDCkEyvyM9gnx"
    "YezZ6PnlAuOY397brdi01q/VZtVm1l/Z6d7o5r3v0ff//kQFFQonDV8O+A3ODIQLTwqZCWwJFQnfBy4FtABD+yb2PPJ38ILx"
    "xPQk+Q/++wIEBz4JKwkaB/YDnAC0/bz76fo/+7f8Mf+TAr0GMws9D04S/BPyE0ESYg/KC94HKgQUAZT+jfz7+rT5evhK91f2"
    "3PUP9vr2ffhW+i78vP3t/rz/EgDx/33/5/5K/rn9Tv0Z/TL9r/2E/oX/lQCEAQ0CFgKxAQQBOgCC///+v/68/u3+Qv+h//T/"
    "LABHAEoAPQAoABYADgAXACwARABZAGoAeQCIAI8AigB/AH0AjQCvANoACAE2AWUBkgG3AcwB0gHHAakBdQEsAdcAfAAkANj/"
    "m/9t/0z/OP8r/yD/Gf8W/xz/K/89/0n/UP9T/07/QP8t/x3/Gf8e/yn/N/9I/17/ef+V/7b/2f///ygAVQB9AJoAqwC3AMMA"
    "zQDSAM8AwgCqAI4AcgBXADsAIAAQAAwADQANAA4AEAAVABwAIQAhABsAEgAKAAEA9//q/97/0//J/8P/v/+//8b/0//i/+z/"
    "8v/2//f/9f/v/+f/5P/p/+//8f/w//L/9v/7////AAAAAP///v///wEAAAD///7//v/8//f/9v/5//z/+v/5//r/+//5//j/"
    "+P/4//f/9//4//n/+P/4//r/+//8//v/+//7//v/+v/5//r/+//7//n/+//+//7/+v/4//n/+f/2//X/+P/9//7//v/8//z/"
    "/f/+//7/+//6//r/+v/4//j/+f/6//v/+//7//v//f/9//3//P/7//r/+f/5//n/+f/5//z//v/+//r/+v/8//3//f/8//3/"
    "+//5//b/9//7//3//f/8//3//f/9//v/+f/4//f/+P/7//z//P/7//z//f/8//v/+v/4//b/9//6//3////+//v/+v/6//z/"
    "/f/7//f/9//5//r/+v/6//v//f/+//3//v////3/+v/5//r/+//5//f/+f/7//z/+//8//7//v/9//r/+v/7//z/+//6//n/"
    "/P/9//z/+v/6//3////+//v/+//9/////f/6//r//P/8//r/+v/6//r/+v/7//7//v/+//3//f/9//v/+v/8//z/+//5//r/"
    "/f/+//3//P/8//z//P/7//z//f/+//3//f/+//z/+//9/////v/8//v/+//7//r/+v/9/////f/8//v//P/8//z//P/6//j/"
    "+v/+/wAA///+//7//v/9//3//P/7//r/+v/9//3//P/4//v///8AAP///P/9//3//P/7//v/+//6//r//P/7//r/+v/8//v/"
    "+//7//3//f/8//z//P/7//v//P/9//3//v/+//7//f/8//z//f/+//3/+v/5//v////9//v/+//9//3//v/+//z/+f/4//z/"
    "///+//3///8AAAAA/f/7//3//v/+//3//P/8//3///8AAAAA/v/8//3//f/9//z/+//6//v//f/8//v/+////wAA/f/5//j/"
    "+v/7//v//P/8//v/+v/7//v/+//7//7///////////////3//P/8//v/+//6//r/+v/9//3//P/8//3//v/9//3//f/8//z/"
    "/f/9//3/+v/6//3//f/9//r/+v/5//r/+v/7//v/+//8//3//f/7//r//P///wAA/P/6//j/+P/6//3//v/9//3//v////3/"
    "+//8//3//P/5//j/+f/7//z//v////7//f/9//7//v/8//v/+//8//z//P/+///////+//7//f/8//z//P/9//3//v/+////"
    "/v/9//z//P/7//3//v////7/+//6//v//P/9//3//v/9//r/+////wAA/f/5//r/+//8//7//v/////////9//v/+v/8/wAA"
    "///9//z//P/8//v/+v/6//z//v/+//z//P/+/////f/7//v//P/8//z//P/7//z//P/8//3///////3//P/8//7//f/7//v/"
    "/f/9//z/+//9//7//v/8//v//f////7//f/+//7//f/8//z//f//////AAD///7///////z/+//9/wAA/f/7//3////+//7/"
    "//8AAAAA///+//3//P/8//z//P/9////AAD///7///8AAAAA/f/7//z//P/9//7///////7//f/9////AAD+//z/+//8//3/"
    "/P/6//v///8BAAAA/f/8//z/+//5//r//f///////v///////v/9//v/+//9//3//f/8//3//v/+//7//v/9//3///8AAAAA"
    "/f/7//7//v/9//z//f///////v8AAAAAAAD//wAAAAD9//j/+P/7//v//P/9/////v/+/wAA/v/8//v//f/+//3/+f/5//z/"
    "///9//v//P8AAAAA/v/8//z//P/8//v//f/+//3//P/8//z//f/9//3//P/+/wAAAQAAAP///f/9//z//f/9//z//P/+/wAA"
    "///+//3//f/+//7//f/8//v//f/9//z/+f/6//7////+//z//f/9//v/+f/6//3/AAD///z/+//8//3//f/8//3//f/9//3/"
    "+//7//v//v/+//3//f/+//3//f/8//v/+//9/wAAAAD+//3//f/9//z//P/+//7//v/9//z/+//8//3//f/7//r/+//8//z/"
    "+//7//3//f/9//z//f/+//7//P/7//7/AAD///z//P/8//z//P/9//z/+//6//z/AAAAAP///v/+/////f/7//r/+//6//r/"
    "+//+/////v///wAAAAD+//z/+//6//v//P/8//v/+//8//7//v/8//3//f/9//z//P/+//7//f/9//3//f/9//7///8AAP3/"
    "/P/9/wAAAAD+//n/+f/9/////v/8//z//v/+//z/+//7//3///////3//P/7//v/+v/6//z//f/9//z//P/8//3///////7/"
    "/f/+/wAA/v/7//z//f/+//7//f/8//v/+//8//z//P/8//7////9//n/9//7//7//v/8//v/+//8//v//P/+//3//P/9//7/"
    "/v/8//z//P/8//3//v/+//3//P/9/////f/7//z//v////7//P/7//v//f/9//z/+//+////AAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
),
}


def bank_sounds():
    try:
        pcm = {k: base64.b64decode(v) for k, v in CLICK_BANK.items()}
        strong, weak = (list(struct.unpack("<%dh" % (len(pcm[k]) // 2), pcm[k])) for k in ("strong", "weak"))
    except (ValueError, struct.error):
        return None
    scale = lambda h, f: [int(x * f) for x in h]
    return {"accent": strong, "quarter": scale(strong, 0.85), "eighth": weak, "sixteenth": scale(weak, 0.6)}


CLICK_STEMS = [
    # naam, bestand, standaard gemute
    ("Click 1/4", "Ark Click 1-4.wav", False),
    ("Click 1/8", "Ark Click 1-8.wav", True),
    ("Click 1/16", "Ark Click 1-16.wav", True),
]


def _blip(freq, amp, ms=30):
    n = int(CLICK_SR * ms / 1000)
    return [int(32767 * amp * math.sin(2 * math.pi * freq * i / CLICK_SR) * math.exp(-i / (CLICK_SR * 0.006)))
            for i in range(n)]


def sample_original_click(orig_path, tm, end_q):
    """Knipt één tik op de tel en één tik op de tussenliggende achtste uit de originele
    MultiTracks-click, zodat de eigen click hetzelfde klinkt. None als dat niet lukt."""
    if not orig_path or not os.path.exists(orig_path):
        return None
    tmp = os.path.join(tempfile.gettempdir(), f"ark-click-{os.getpid()}.wav")
    try:
        if shutil.which("afconvert"):
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{CLICK_SR}", "-c", "1", orig_path, tmp],
                           check=True, capture_output=True)
        else:  # server (Linux): ffmpeg
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", orig_path, "-ac", "1", "-ar", str(CLICK_SR),
                            "-c:a", "pcm_s16le", tmp], check=True, capture_output=True)
        with wave.open(tmp) as w:
            data = array.array("h", w.readframes(w.getnframes()))
    except (OSError, subprocess.CalledProcessError, wave.Error):
        return None
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    n = int(CLICK_SR * 0.07)  # 70 ms: de tikken duren ~50 ms
    fade = int(CLICK_SR * 0.005)

    def hit(offset):
        # eerste tel (of achtste) waar de originele click echt tikt
        q = offset
        while q < min(end_q, 256):
            start = int(round(tm.beats_to_sec(q) * CLICK_SR))
            seg = data[start:start + n]
            if len(seg) == n and max(abs(v) for v in seg) > 2000:
                seg = list(seg)
                for i in range(fade):
                    seg[n - fade + i] = int(seg[n - fade + i] * (fade - i) / fade)
                return seg
            q += 1
        return None

    quarter, eighth = hit(0.0), hit(0.5)
    if not quarter or not eighth:
        return None
    return {"accent": quarter, "quarter": quarter, "eighth": eighth,
            "sixteenth": [int(v * 0.6) for v in eighth]}


def generate_clicks(stems_dir, als, tm, song_len, orig_click=None):
    """Schrijft de drie click-stems (WAV, 48 kHz mono) en geeft ze terug als stems."""
    end_q = tm_len_beats(tm, song_len)
    # maatbegin uit de maatsoortwisselingen
    ts = sorted(als["timesig"])
    bar_starts, q = set(), 0.0
    while q <= end_q + 0.001:
        bar_starts.add(round(q * 4))
        cur = [s for b, s in ts if b <= q + 1e-6]
        num, den = cur[-1] if cur else (ts[0][1] if ts else (4, 4))
        q += num * 4.0 / den
    sounds = sample_original_click(orig_click, tm, end_q) or bank_sounds() or \
        {"accent": _blip(1600, 0.9), "quarter": _blip(1100, 0.75), "eighth": _blip(900, 0.5), "sixteenth": _blip(800, 0.35)}
    n_samples = int((song_len + 1) * CLICK_SR)
    layers = {name: array.array("h", bytes(2 * n_samples)) for name, _, _ in CLICK_STEMS}
    k = 0
    while k / 4.0 <= end_q:
        qn = k / 4.0
        if k % 4 == 0:
            layer, sound = "Click 1/4", ("accent" if k in bar_starts else "quarter")
        elif k % 2 == 0:
            layer, sound = "Click 1/8", "eighth"
        else:
            layer, sound = "Click 1/16", "sixteenth"
        start = int(round(tm.beats_to_sec(qn) * CLICK_SR))
        buf, blip = layers[layer], sounds[sound]
        for i, v in enumerate(blip):
            if start + i >= n_samples:
                break
            buf[start + i] = max(-32768, min(32767, buf[start + i] + v))
        k += 1
    stems = []
    for name, filename, muted in CLICK_STEMS:
        if orig_click is None:
            muted = True   # geen echte click om mee te lopen (live opname): de vaste click loopt licht uit de pas, dus standaard uit
        path = os.path.join(stems_dir, filename)
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(CLICK_SR)
            w.writeframes(layers[name].tobytes())
        stems.append({"name": name, "file": filename, "position": 0.0, "length": song_len,
                      "sr": CLICK_SR, "muted": muted, "generated": True})
    return stems


def add_click_to_rpp(rpp_path, clicks, stems_dir_rel):
    """Click-stems toevoegen aan een bestaand project (ook door REAPER opgeslagen), in de
    CLICK-map; de originele click wordt gemute. Mix en de rest van het project blijven."""
    text = open(rpp_path, encoding="utf-8").read()
    lines = text.split("\n")
    # trackblokken: van "  <TRACK" tot de bijbehorende "  >"
    blocks, i = [], 0
    while i < len(lines):
        if lines[i].startswith("  <TRACK"):
            j = i + 1
            while not lines[j].startswith("  >"):
                j += 1
            blocks.append([i, j])
            i = j + 1
        else:
            i += 1
    def name_of(b):
        for l in lines[b[0]:b[1]]:
            if l.strip().startswith("NAME "):
                return l.strip()[5:].strip("\"'")
        return ""
    def isbus(b):
        for k in range(b[0], b[1]):
            if lines[k].strip().startswith("ISBUS "):
                return k
        return None
    names = [name_of(b) for b in blocks]
    if any(n in ("Click 1/4", "Click 1/8", "Click 1/16") for n in names):
        # staan er al: alleen de itemlengte bijwerken (de WAV's zijn opnieuw gemaakt)
        length = max(st["length"] for st in clicks)
        changed, item_len = False, None
        for k, l in enumerate(lines):
            s = l.strip()
            if s.startswith("<ITEM"):
                item_len = None
            elif s.startswith("LENGTH ") and item_len is None:
                item_len = k
            elif s.startswith("FILE ") and "Ark Click " in s and item_len is not None:
                new = lines[item_len][:len(lines[item_len]) - len(lines[item_len].lstrip())] + f"LENGTH {length:.10f}"
                if lines[item_len] != new:
                    lines[item_len], changed = new, True
        if changed:
            open(rpp_path + ".tmp", "w", encoding="utf-8").write("\n".join(lines))
            os.replace(rpp_path + ".tmp", rpp_path)
        return False
    bus = next((k for k, n in enumerate(names) if re.match(r"(?i)^click\b.*->\s*out\s*\d+", n)), None)
    if bus is None:
        raise SystemExit("Geen CLICK-groep gevonden in het project")
    last = bus
    for k in range(bus + 1, len(blocks)):
        last = k
        line = lines[isbus(blocks[k])] if isbus(blocks[k]) is not None else ""
        if re.match(r"\s*ISBUS 2 ", line):
            break
        # originele click(s) muten
    for k in range(bus + 1, last + 1):
        for m in range(blocks[k][0], blocks[k][1]):
            if lines[m].strip().startswith("MUTESOLO "):
                parts = lines[m].split()
                lines[m] = lines[m][:len(lines[m]) - len(lines[m].lstrip())] + "MUTESOLO 1 " + " ".join(parts[2:])
    # de laatste child sluit de map niet meer af; de nieuwe laatste wel
    k = isbus(blocks[last])
    if k is not None:
        lines[k] = re.sub(r"ISBUS 2 -?\d+", "ISBUS 0 0", lines[k])
    new = []
    for n, st in enumerate(clicks):
        new += [
            f"  <TRACK {g()}",
            f"    NAME {q(st['name'])}",
            "    MAINSEND 1 0",
            f"    MUTESOLO {1 if st['muted'] else 0} 0 0",
            "    ISBUS 2 -1" if n == len(clicks) - 1 else "    ISBUS 0 0",
            "    <ITEM",
            "      POSITION 0",
            f"      LENGTH {st['length']:.10f}",
            "      LOOP 0",
            f"      NAME {q(st['file'])}",
            f"      IGUID {g()}",
            "      <SOURCE WAVE",
            f"        FILE {q(os.path.join(stems_dir_rel, st['file']))}",
            "      >",
            "    >",
            "  >",
        ]
    end = blocks[last][1]
    lines = lines[:end + 1] + new + lines[end + 1:]
    open(rpp_path + ".tmp", "w", encoding="utf-8").write("\n".join(lines))
    os.replace(rpp_path + ".tmp", rpp_path)
    return True


# ------------------------------- Main -------------------------------------
def find_song_root(folder):
    """Map met de songbeschrijving: een song.json (eigen opname, gaat voor) of een
    Ableton-set (.als) van MultiTracks."""
    for dirpath, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d != "__MACOSX"]
        for f in files:
            if f.lower() == "song.json":
                return dirpath, os.path.join(dirpath, f)
        for f in files:
            if f.lower().endswith(".als") and not f.startswith("._"):
                return dirpath, os.path.join(dirpath, f)
    return None, None


def convert(src, cfg, samplerate, out_dir=None, force=False, add_click=False):
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
        raise SystemExit(f"Geen .als-bestand of song.json gevonden in {folder}")

    als = read_song(als_path)
    tm = TempoMap(als["tempo"])
    title = als.get("title") or os.path.basename(os.path.normpath(root))

    stem_files, missing = [], []
    for t in als["tracks"]:
        if not t["file"]:
            continue
        # zoek het bestand (meestal in MultiTracks/)
        found = None
        # na omzetting is een .m4a weg en staat de .wav er nog
        wav_name = os.path.splitext(t["file"])[0] + ".wav"
        for dp, _, fs in os.walk(root):
            if t["file"] in fs or wav_name in fs:
                found = os.path.join(dp, t["file"] if t["file"] in fs else wav_name)
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
    song_len = max([s["length"] for s in stem_files] + [0])
    # de originele click: daaruit komt de klank van de eigen click
    orig_click = next((os.path.join(root, s["rel_dir"], s["file"]) for s in stem_files
                       if s["name"].lower().startswith("click") and pick_bus(s["name"], cfg) == pick_bus("click", cfg)), None)

    rpp_path = os.path.join(root, f"{safe(title)}.RPP")
    if add_click:
        if song_len <= 0:
            raise SystemExit(f"Geen stems gevonden in {root}; click niet gemaakt")
        clicks = generate_clicks(os.path.join(root, rel_dir), als, tm, song_len, orig_click)
        added = add_click_to_rpp(rpp_path, clicks, rel_dir)
        for st in stem_files:
            if st["name"].lower().startswith("click") and pick_bus(st["name"], cfg) == pick_bus("click", cfg):
                st["muted"] = True
        write_player_file(root, title, als, rel_dir, stem_files + [dict(c, rel_dir=rel_dir) for c in clicks], cfg)
        print(f"\n== {title}\n   Eigen click {'toegevoegd' if added else 'bijgewerkt (stond er al)'}\n   -> {rpp_path}")
        return {"title": title, "rpp": rpp_path, "skipped": True, "click": True}
    # Een bestaand project kan in REAPER aangepast en opgeslagen zijn (mix, mutes):
    # alleen met --force opnieuw maken.
    if os.path.exists(rpp_path) and not force:
        # audio kan door de cache-opruiming weg zijn geweest: eigen click opnieuw maken
        click_dir = os.path.join(root, rel_dir)
        if "Ark Click" in open(rpp_path, encoding="utf-8", errors="ignore").read() and song_len > 0 and \
                any(not os.path.exists(os.path.join(click_dir, f)) for _, f, _ in CLICK_STEMS):
            generate_clicks(click_dir, als, tm, song_len, orig_click)
        for st in stem_files:
            if st["name"].lower().startswith("click") and pick_bus(st["name"], cfg) == pick_bus("click", cfg):
                st["muted"] = True
        write_player_file(root, title, als, rel_dir, stem_files + [dict(c, rel_dir=rel_dir) for c in click_entries(click_dir, orig_click)], cfg)
        print(f"\n== {title}\n   Bestaat al, overgeslagen (gebruik --force om opnieuw te maken)\n   -> {rpp_path}")
        return {"title": title, "rpp": rpp_path, "skipped": True}

    if cfg.get("click", {}).get("enabled", True) and song_len > 0:
        # eigen click: de originele click-stem(s) standaard gemute
        for st in stem_files:
            if st["name"].lower().startswith("click") and pick_bus(st["name"], cfg) == pick_bus("click", cfg):
                st["muted"] = True
        for st in generate_clicks(os.path.join(root, rel_dir), als, tm, song_len, orig_click):
            st["rel_dir"] = rel_dir
            stem_files.append(st)
    rpp, per_bus, markers = build_rpp(title, als, rel_dir, stem_files, cfg, samplerate, root)
    with open(rpp_path, "w", encoding="utf-8") as f:
        f.write(rpp)
    write_player_file(root, title, als, rel_dir, stem_files, cfg)

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


# ------------------------------- Speelbestand voor ark-player ---------------
def click_entries(click_dir, orig_click):
    """De eigen click-stems die er staan, voor in het speelbestand (zelfde standaard-mute als generate_clicks)."""
    out = []
    for name, filename, muted in CLICK_STEMS:
        if os.path.exists(os.path.join(click_dir, filename)):
            out.append({"name": name, "file": filename, "position": 0.0, "muted": True if orig_click is None else muted})
    return out


def write_player_file(root, title, als, rel_dir, stem_files, cfg):
    """Schrijft ark-player.json naast het project: alles wat de eigen speler (ark-player) nodig heeft - stems met
    startpositie en standaard-mute, secties in seconden, tempo en maatsoort in kwartnoten. Het RPP blijft gewoon bestaan."""
    tm = TempoMap(als["tempo"])
    stems = []
    for st in stem_files:
        live = is_live(st["name"], cfg)
        muted = st.get("muted", live)
        stems.append({
            "file": os.path.normpath(os.path.join(st.get("rel_dir", rel_dir), st["file"])).replace(os.sep, "/"),
            "name": st["name"],
            "offset": round(float(st.get("position", 0.0)), 6),
            "mute": bool(muted),
        })
    sections = [{"name": name, "sec": round(tm.beats_to_sec(b), 6)} for b, name in als["markers"] if name]
    data = {
        "format": 1,
        "title": title,
        "stems": stems,
        "sections": sections,
        "tempo_qn": [[round(b, 6), round(bpm, 6)] for b, bpm in als["tempo"]],
        "timesig": [[round(b, 6), n, d] for b, (n, d) in als["timesig"]],
    }
    path = os.path.join(root, "ark-player.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    return path


def safe(s):
    return re.sub(r'[\\/:*?"<>|]+', "_", s).strip() or "song"


def check_song(source, cfg):
    """Controle vóór het uploaden: wat leest mt2reaper uit de map of song.json."""
    path = source
    if os.path.isdir(source):
        _, path = find_song_root(source)
    if not path or not os.path.exists(path):
        raise SystemExit(f"Geen song.json of .als gevonden in {source}")
    als = read_song(path)
    root = os.path.dirname(path)
    tm = TempoMap(als["tempo"])
    fmt = lambda s: f"{int(s // 60)}:{s % 60:04.1f}"
    print(f"Naam:      {als.get('title') or os.path.basename(root)}")
    print("Tempo:     " + ", ".join(f"{bpm:g} bpm" + (f" (vanaf {tm.beats_to_sec(b):.1f}s)" if b else "") for b, bpm in als["tempo"]))
    print("Maatsoort: " + ", ".join(f"{n}/{d}" for _, (n, d) in als["timesig"]))
    longest, problems = 0.0, []
    print("\nStems:")
    for st in als["tracks"]:
        found = next((os.path.join(dp, f) for dp, _, fs in os.walk(root) for f in fs
                      if f == st["file"] or f == os.path.splitext(st["file"])[0] + ".wav"), None)
        info = wav_info(found) if found and found.lower().endswith(".wav") else None
        if info:
            longest = max(longest, info[2] + tm.beats_to_sec(st["start_beats"]))
        bus = pick_bus(st["name"], cfg)
        live = " [LIVE: gemute]" if is_live(st["name"], cfg) else ""
        print(f"  {st['name']:<22} -> {bus}{live}" + ("" if found else "   <-- BESTAND ONTBREEKT"))
        if not found:
            problems.append(f"bestand ontbreekt: {st['file']}")
    print("\nSecties:")
    for qn, name in als["markers"]:
        sec = tm.beats_to_sec(qn)
        flag = "   <-- na het einde van de audio" if longest and sec >= longest else ""
        print(f"  {fmt(sec):>7}  {name}{flag}")
        if flag:
            problems.append(f"sectie \"{name}\" begint na het einde van de audio")
    if longest:
        print(f"\nLengte audio: {fmt(longest)}")
    print("\n" + ("Let op:\n  " + "\n  ".join(problems) if problems else "Ziet er goed uit."))


def main():
    ap = argparse.ArgumentParser(description="MultiTracks.com download -> REAPER project")
    ap.add_argument("source", help="zip-bestand, uitgepakte songmap, of (met --all) een map met zips/songmappen")
    ap.add_argument("--all", action="store_true", help="verwerk alle zips/songmappen in de map")
    ap.add_argument("--config", help="JSON met eigen busindeling (zie busses.example.json)")
    ap.add_argument("--samplerate", type=int, default=48000, help="projectsamplerate (X32 = 48000)")
    ap.add_argument("--out", help="uitpakmap voor een zip (standaard naast de zip)")
    ap.add_argument("--force", action="store_true", help="bestaande .RPP-projecten overschrijven")
    ap.add_argument("--add-click", action="store_true", help="alleen de eigen click (1/4, 1/8, 1/16) toevoegen aan een bestaand project")
    ap.add_argument("--check", action="store_true", help="alleen controleren (song.json of map): tempo, secties en stems tonen")
    ap.add_argument("--report-json", help="schrijf een JSON-rapport van de verwerkte nummers naar dit bestand")
    a = ap.parse_args()

    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if a.config:
        with open(a.config, encoding="utf-8") as f:
            cfg.update(json.load(f))

    if a.check:
        check_song(a.source, cfg)
        return
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
        reports.append(convert(a.source, cfg, a.samplerate, a.out, force=a.force, add_click=a.add_click))
    if a.report_json:
        with open(a.report_json, "w", encoding="utf-8") as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
