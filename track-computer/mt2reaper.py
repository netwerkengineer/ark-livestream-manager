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
import fnmatch
import gzip
import json
import math
import os
import re
import shutil
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
    sounds = sample_original_click(orig_click, tm, end_q) or \
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
