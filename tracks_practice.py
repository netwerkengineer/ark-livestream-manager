#!/usr/bin/env python3
"""Oefenversie van een MultiTracks-download voor de oefenspeler in de app.

    python3 tracks_practice.py <download.zip> <uitvoermap>

Zet elke stem om naar AAC in stukken van CHUNK seconden (48 kHz), met een kleine
overlap ervoor en erna zodat de browser de stukken naadloos aan elkaar kan zetten.
Per tijdstuk komen de stukken van alle stems in één bestand (seg/<n>.bin), zodat de
speler één verzoek per CHUNK seconden doet in plaats van één per stem. Stille stukken
worden overgeslagen. Leest tempomap, maatsoort en secties uit het .als-bestand met
dezelfde code als mt2reaper (secties dus met dezelfde nummers als de regions in
REAPER) en maakt dezelfde eigen click (1/4, 1/8, 1/16).

Schrijft eerst naar <uitvoermap>.work en zet het resultaat pas aan het eind op zijn
plek; voortgang als JSON-regels op stdout.
"""
import array
import json
import os
import shutil
import subprocess
import sys
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "track-computer"))
import mt2reaper as m  # noqa: E402

VERSION = 1
SR = 48000
CHUNK = 10.0     # seconden per stuk
PRE = 0.2        # overlap vóór (AAC-encoder-vertraging)
POST = 0.3       # overlap erna (crossfade + afronding)
SILENT = 8       # piek onder deze waarde (16-bit) = stil stuk
BITRATE = {1: "64k", 2: "112k"}
AUDIO_EXT = (".wav", ".m4a", ".aif", ".aiff", ".mp3", ".flac", ".caf")


def progress(step, **kw):
    print(json.dumps({"step": step, **kw}), flush=True)


def ffprobe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=channels:format=duration", "-of", "json", path],
                         check=True, capture_output=True, text=True).stdout
    info = json.loads(out)
    return int(info["streams"][0]["channels"]), float(info["format"]["duration"])


def extract(zip_path, dest):
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            base = os.path.basename(name)
            if "__MACOSX" in name or base.startswith("._") or name.endswith("/"):
                continue
            if base.lower().endswith(".als") or base.lower().endswith(AUDIO_EXT):
                z.extract(name, dest)


def find_file(root, file_name):
    wav_name = os.path.splitext(file_name)[0] + ".wav"
    for dp, _, fs in os.walk(root):
        if file_name in fs:
            return os.path.join(dp, file_name)
        if wav_name in fs:
            return os.path.join(dp, wav_name)
    return None


def encode_chunk(pcm, channels, start, length, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.6f}", "-t", f"{length:.6f}", "-i", pcm,
                    "-ac", str(channels), "-c:a", "aac", "-b:a", BITRATE[channels], "-movflags", "+faststart", "-f", "mp4", out],
                   check=True, capture_output=True)


def chunk_ranges(duration):
    n = int(duration // CHUNK) + 1
    out = []
    for k in range(n):
        start = max(0.0, k * CHUNK - PRE)
        end = min(duration, (k + 1) * CHUNK + POST)
        out.append((start, end))
    return out


def stem_to_chunks(src, position, channels, duration, work, idx, pool):
    """Stem op de tijdlijn zetten (48 kHz PCM), in stukken knippen en coderen."""
    pcm = os.path.join(work, f"stem{idx}.wav")
    delay = int(round(position * SR))
    filters = [f"aresample={SR}"]
    if delay > 0:
        filters.append(f"adelay={delay}S:all=1")
    filters.append("apad")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", ",".join(filters), "-t", f"{duration:.6f}",
                    "-ac", str(channels), "-ar", str(SR), "-c:a", "pcm_s16le", pcm], check=True, capture_output=True)
    ranges = chunk_ranges(duration)
    # stille stukken overslaan; "stereo" met links = rechts wordt mono (halve bitrate)
    with wave.open(pcm) as w:
        frames = w.getnframes()
        if channels == 2:
            data = array.array("h", w.readframes(frames))
            if data[0::2] == data[1::2]:
                channels = 1
            del data
        audible = []
        for start, end in ranges:
            a, b = int(start * SR), min(frames, int(end * SR))
            w.setpos(min(a, frames))
            data = array.array("h", w.readframes(max(0, b - a)))
            audible.append(bool(data) and max(max(data), -min(data)) > SILENT)
        pcm_channels = w.getnchannels()
    outs = [os.path.join(work, f"s{idx}_{k}.m4a") if audible[k] else None for k in range(len(ranges))]
    jobs = [pool.submit(encode_chunk, pcm, min(channels, pcm_channels), s, e - s, o)
            for (s, e), o in zip(ranges, outs) if o]
    for j in jobs:
        j.result()
    os.remove(pcm)
    return outs, channels


def calibration(work, out_dir):
    """Een tik op precies 0,5 s, gecodeerd als een stuk: de speler meet daaraan hoeveel
    vertraging de AAC-decoder van die browser geeft."""
    pcm = os.path.join(work, "cal.wav")
    data = array.array("h", bytes(2 * int(SR * 1.5)))
    at = int(SR * 0.5)
    for i in range(48):
        data[at + i] = int(30000 * (1 - i / 48) * (1 if i % 2 == 0 else -1))
    with wave.open(pcm, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    encode_chunk(pcm, 1, 0.0, 1.5, os.path.join(out_dir, "calibration.m4a"))


def main():
    zip_path, out_dir = sys.argv[1], sys.argv[2]
    work = out_dir + ".work"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    try:
        progress("extract")
        src_dir = os.path.join(work, "src")
        extract(zip_path, src_dir)
        root, als_path = m.find_song_root(src_dir)
        if not als_path:
            raise SystemExit("Geen .als-bestand in de zip")
        als = m.read_als(als_path)
        tm = m.TempoMap(als["tempo"])
        cfg = json.loads(json.dumps(m.DEFAULT_CONFIG))
        with open(os.path.join(HERE, "track-computer", "busses.example.json")) as f:
            cfg.update(json.load(f))

        stems = []
        for t in als["tracks"]:
            if not t["file"]:
                continue
            path = find_file(root, t["file"])
            if not path:
                continue
            channels, length = ffprobe(path)
            stems.append({"name": t["name"], "path": path, "position": tm.beats_to_sec(t["start_beats"]),
                          "length": length, "channels": min(2, channels)})
        if not stems:
            raise SystemExit("Geen stems gevonden")
        duration = max(s["position"] + s["length"] for s in stems)

        # eigen click, net als in REAPER: origineel en 1/8, 1/16 standaard uit
        click_bus = m.pick_bus("click", cfg)
        orig_click = next((s["path"] for s in stems if s["name"].lower().startswith("click")
                           and m.pick_bus(s["name"], cfg) == click_bus), None)
        for s in stems:
            s["muted"] = s["path"] == orig_click
        for c in m.generate_clicks(work, als, tm, duration, orig_click):
            stems.append({"name": c["name"], "path": os.path.join(work, c["file"]), "position": 0.0,
                          "length": c["length"], "channels": 1, "muted": c["muted"]})

        # volgorde: per groep (busvolgorde), daarbinnen zoals in de download
        order = [b["name"] for b in cfg["busses"]]
        for s in stems:
            s["group"] = m.pick_bus(s["name"], cfg)
            s["live"] = m.is_live(s["name"], cfg)
        stems.sort(key=lambda s: order.index(s["group"]) if s["group"] in order else len(order))

        chunks_dir = os.path.join(work, "out")
        os.makedirs(os.path.join(chunks_dir, "seg"))
        per_stem = []
        with ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 2))) as pool:
            for i, s in enumerate(stems):
                progress("encode", stem=s["name"], done=i, total=len(stems))
                outs, s["channels"] = stem_to_chunks(s["path"], s["position"], s["channels"], duration, work, i, pool)
                per_stem.append(outs)

        progress("pack")
        ranges = chunk_ranges(duration)
        segments = []
        for k in range(len(ranges)):
            parts, offset = [], 0
            with open(os.path.join(chunks_dir, "seg", f"{k}.bin"), "wb") as f:
                for outs in per_stem:
                    if outs[k] is None:
                        parts.append(None)
                        continue
                    data = open(outs[k], "rb").read()
                    f.write(data)
                    parts.append([offset, len(data)])
                    offset += len(data)
                    os.remove(outs[k])
            segments.append({"start": round(ranges[k][0], 6), "end": round(ranges[k][1], 6), "size": offset, "parts": parts})
        calibration(work, chunks_dir)

        # secties = regions zoals mt2reaper ze schrijft (zelfde nummers)
        markers = [(b, tm.beats_to_sec(b), name) for b, name in als["markers"] if name]
        sections = []
        for idx, (b, pos, name) in enumerate(markers, 1):
            end = markers[idx][1] if idx < len(markers) else max(duration, pos + 1)
            sections.append({"id": idx, "name": name, "start": round(pos, 6), "end": round(end, 6), "beat": b})

        # maatstrepen (voor "volgende maat") en tempo (tellen <-> seconden)
        ts = sorted(als["timesig"])
        end_q = m.tm_len_beats(tm, duration)
        bars, q = [], 0.0
        while q <= end_q + 0.001:
            bars.append(round(tm.beats_to_sec(q), 6))
            cur = [s for b, s in ts if b <= q + 1e-6]
            num, den = cur[-1] if cur else (ts[0][1] if ts else (4, 4))
            q += num * 4.0 / den

        manifest = {
            "version": VERSION,
            "title": os.path.basename(os.path.normpath(root)),
            "duration": round(duration, 6),
            "sampleRate": SR,
            "chunk": CHUNK,
            "crossfade": 0.01,
            "groups": order,
            "stems": [{"name": s["name"], "group": s["group"], "live": s["live"], "muted": s["muted"],
                       "channels": s["channels"]} for s in stems],
            "segments": segments,
            "sections": sections,
            "tempo": [[b, round(tm.beats_to_sec(b), 6), bpm] for b, bpm in als["tempo"]],
            "bars": bars,
        }
        with open(os.path.join(chunks_dir, "manifest.json"), "w") as f:
            json.dump(manifest, f)

        progress("finish")
        old = out_dir + ".old"
        shutil.rmtree(old, ignore_errors=True)
        if os.path.exists(out_dir):
            os.rename(out_dir, old)
        os.rename(chunks_dir, out_dir)
        shutil.rmtree(old, ignore_errors=True)
        size = sum(seg["size"] for seg in segments)
        progress("done", stems=len(stems), segments=len(segments), bytes=size)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
