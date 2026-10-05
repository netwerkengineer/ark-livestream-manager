#!/usr/bin/env python3
"""
ark_tracks_agent - haalt via de livestream-manager geüploade MultiTracks-downloads op
naar deze Mac en zet ze om naar REAPER-projecten.

Draait als launchd-agent (~/Library/LaunchAgents/, zie README).
De Mac hoeft zelf niet bereikbaar te zijn: de agent vraagt de app elke paar seconden
of er iets nieuws is, downloadt het (hervatbaar), draait mt2reaper en meldt het
resultaat terug. Wat op de server verwijderd wordt, gaat hier naar ~/Tracks/_trash.

Schijfruimte: de server bewaart alle zips. Op deze Mac staat alleen de audio van songs die
nodig zijn (op een komende setlist, recent gespeeld of "altijd houden" - de server zegt welke).
Van de rest wordt alleen de audio verwijderd; het REAPER-project met mix en dia-blokken blijft,
en de audio komt terug zodra de song weer nodig is.

Instellingen: ~/Tracks/_tools/agent.json  {"server": "https://...", "token": "..."}
Alleen Python 3 standaardbibliotheek.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HOME = os.path.expanduser("~")
TOOLS = os.path.join(HOME, "Tracks", "_tools")
SONGS = os.path.join(HOME, "Tracks", "Songs")
TRASH = os.path.join(HOME, "Tracks", "_trash")
CONFIG = os.path.join(TOOLS, "agent.json")
STATE = os.path.join(TOOLS, "agent-state.json")
VERSION = "1"
POLL_SECONDS = 10
PROGRESS_EVERY = 5  # seconden tussen voortgangsmeldingen (de proxy limiteert het aantal verzoeken)
CHUNK = 1024 * 1024
AUDIO_EXT = (".wav", ".m4a", ".aif", ".aiff", ".mp3", ".flac", ".caf")
KEEP_FRESH_SECONDS = 24 * 3600  # net opgehaalde audio niet meteen weer weghalen


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


class Api:
    def __init__(self, server, token):
        self.base = server.rstrip("/") + "/api/tracks/agent"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "X-Agent-Host": socket.gethostname(),
            "X-Agent-Version": VERSION,
        }

    def request(self, path="", method="GET", body=None, headers=None, timeout=30):
        h = dict(self.headers, **(headers or {}))
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        return urllib.request.urlopen(req, timeout=timeout)

    def jobs(self):
        with self.request() as r:
            return json.load(r)

    def report(self, item_id, status, message="", report=None, important=True, local=None):
        """Status melden. Voortgang (important=False) is best effort; de eindstatus
        wordt bij 429/5xx/netwerkfouten opnieuw geprobeerd met oplopende wachttijd.
        status=None + local = alleen melden of de audio op deze Mac staat."""
        body = {"id": item_id, "message": message} if status else {"id": item_id}
        if status:
            body["status"] = status
        if local:
            body["local"] = local
        if report is not None:
            body["report"] = report
        delay = 2
        for attempt in range(8 if important else 1):
            try:
                with self.request(method="POST", body=body):
                    return True
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504):
                    log(f"status melden mislukt ({status}): HTTP {e.code}")
                    return False
                err = f"HTTP {e.code}"
            except Exception as e:
                err = str(e)
            if important:
                time.sleep(delay)
                delay = min(delay * 2, 60)
        log(f"status melden mislukt ({status}): {err}")
        return False


def safe_name(name):
    name = os.path.basename(name).replace("/", "_").lstrip(".")
    return name or "track.zip"


def download(api, item, dest):
    """Hervatbaar downloaden naar dest (+ .part)."""
    part = dest + ".part"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    size = item["size"]
    if have > size:
        os.remove(part)
        have = 0
    headers = {"Range": f"bytes={have}-"} if have else {}
    last_report = 0
    with api.request("/file/" + urllib.parse.quote(item["id"]), headers=headers, timeout=60) as r, open(part, "ab") as f:
        if have and r.status != 206:  # server negeerde Range: opnieuw beginnen
            f.seek(0)
            f.truncate()
            have = 0
        while True:
            buf = r.read(CHUNK)
            if not buf:
                break
            f.write(buf)
            have += len(buf)
            if time.time() - last_report >= PROGRESS_EVERY:
                last_report = time.time()
                pct = int(have * 100 / size) if size else 100
                api.report(item["id"], "downloading", f"Downloaden {pct}%", important=False)
    if os.path.getsize(part) != size:
        raise RuntimeError(f"Download onvolledig ({os.path.getsize(part)} van {size} bytes)")
    os.replace(part, dest)


def convert(zip_path):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        report_file = tmp.name
    cmd = [sys.executable, os.path.join(TOOLS, "mt2reaper.py"), zip_path,
           "--config", os.path.join(TOOLS, "busses.json"), "--report-json", report_file]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout).strip().splitlines()[-1] if (res.stderr or res.stdout).strip() else "mt2reaper mislukt")
    reports = load_json(report_file, [])
    try:
        os.remove(report_file)
    except OSError:
        pass
    if not reports:
        raise RuntimeError("mt2reaper gaf geen rapport")
    return reports[0], res.stdout


def rescan_reaper():
    """Laat de bridge in REAPER de songlijst meteen opnieuw inlezen."""
    value = urllib.parse.quote(f"agent{int(time.time())}\tscan", safe="")
    try:
        urllib.request.urlopen(f"http://127.0.0.1:8080/_/SET/EXTSTATE/ArkTracks/cmd/{value}", timeout=3).close()
    except Exception:
        pass  # REAPER draait niet; de bridge scant bij de volgende start


def process(api, item, state):
    item_id = item["id"]
    zip_name = safe_name(item["fileName"])
    zip_path = os.path.join(SONGS, zip_name)
    song_dir = os.path.splitext(zip_path)[0]
    log(f"Ophalen: {zip_name} ({item['size'] // (1024 * 1024)} MB)")
    api.report(item_id, "downloading", "Downloaden 0%", important=False)
    download(api, item, zip_path)

    api.report(item_id, "converting", "Omzetten naar REAPER-project", important=False)
    report, output = convert(zip_path)
    os.remove(zip_path)  # de server bewaart het origineel als backup
    report["dir"] = song_dir
    drop_originals(song_dir)
    log(output.strip())
    rescan_reaper()
    if report.get("skipped"):
        msg = "Stond al op de track-computer (bestaand project behouden)"
    else:
        msg = f"{report.get('stems', 0)} stems, {len(report.get('sections', []))} secties"
    if report.get("missing"):
        msg += f" - ontbreekt: {', '.join(report['missing'])}"
    state[item_id] = {"dir": song_dir, "rpp": report.get("rpp"), "fileName": item["fileName"],
                      "message": msg, "report": report, "local": "full", "fetchedAt": time.time()}
    save_json(STATE, state)
    api.report(item_id, "ready", msg, report, local="full")


def audio_files(song_dir):
    for dp, _, fs in os.walk(song_dir):
        for f in fs:
            if f.lower().endswith(AUDIO_EXT) and not f.startswith("._"):
                yield os.path.join(dp, f)


def has_audio(song_dir):
    return any(f.lower().endswith(".wav") for f in audio_files(song_dir))


def drop_originals(song_dir):
    """Na het omzetten naar WAV zijn de .m4a-originelen overbodig (de server heeft de zip)."""
    for f in list(audio_files(song_dir)):
        if not f.lower().endswith(".wav") and os.path.exists(os.path.splitext(f)[0] + ".wav"):
            os.remove(f)


def open_in_reaper():
    """Projecten die nu open staan in REAPER (die worden nooit kaal gemaakt)."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/_/GET/EXTSTATE/ArkTracks/state", timeout=3) as r:
            line = r.read().decode().split("\t", 3)[3]
        raw = line.replace("\\\\", "\x00").replace("\\t", "\t").replace("\\n", "\n").replace("\x00", "\\")
        return {t.get("path") for t in json.loads(raw).get("tabs", [])}
    except Exception:
        return None  # onbekend: dan niets weghalen


def make_slim(api, item, entry, state):
    """Alleen de audio weghalen; project, mix en dia-blokken blijven staan."""
    freed = 0
    for f in list(audio_files(entry["dir"])):
        freed += os.path.getsize(f)
        os.remove(f)
    entry["local"] = "slim"
    save_json(STATE, state)
    log(f"Audio verwijderd (niet nodig): {item['fileName']} ({freed // (1024 * 1024)} MB vrij)")
    api.report(item["id"], None, local="slim")


def restore_audio(api, item, entry, state):
    """Audio opnieuw ophalen uit de zip op de server, zonder het project te overschrijven."""
    zip_path = os.path.join(SONGS, safe_name(item["fileName"]))
    log(f"Audio ophalen (nodig): {item['fileName']}")
    download(api, item, zip_path)
    dest = os.path.splitext(zip_path)[0]
    with zipfile.ZipFile(zip_path) as z:
        for member in z.infolist():
            name = member.filename
            if name.lower().endswith(AUDIO_EXT) and "__MACOSX" not in name and not os.path.basename(name).startswith("._"):
                target = os.path.join(dest, name)
                if not os.path.exists(target) and not os.path.exists(os.path.splitext(target)[0] + ".wav"):
                    z.extract(member, dest)
    os.remove(zip_path)
    convert(dest)  # alleen omzetten naar WAV: het bestaande project blijft staan
    drop_originals(entry["dir"])
    entry["local"] = "full"
    entry["fetchedAt"] = time.time()
    save_json(STATE, state)
    rescan_reaper()
    api.report(item["id"], None, local="full")


def remove_local(item_id, state):
    entry = state.pop(item_id, None)
    if entry and os.path.isdir(entry["dir"]):
        os.makedirs(TRASH, exist_ok=True)
        target = os.path.join(TRASH, f"{os.path.basename(entry['dir'])}-{int(time.time())}")
        shutil.move(entry["dir"], target)
        log(f"Verwijderd op de server, lokaal verplaatst naar {target}")
        rescan_reaper()
    save_json(STATE, state)


def manage_cache(api, item, entry, state, open_projects):
    """Audio alleen bewaren voor songs die nodig zijn; anders kaal maken (project blijft)."""
    if "needed" not in item:  # oudere server: niets weghalen
        return
    audio = has_audio(entry["dir"])
    if audio:
        drop_originals(entry["dir"])
    if item["needed"] and not audio:
        try:
            restore_audio(api, item, entry, state)
        except Exception as e:
            log(f"Audio ophalen mislukt voor {item['fileName']}: {e}")
    elif not item["needed"] and audio:
        recent = time.time() - entry.get("fetchedAt", 0) < KEEP_FRESH_SECONDS
        if open_projects is None or entry.get("rpp") in open_projects or recent:
            return
        make_slim(api, item, entry, state)
    elif entry.get("local") != ("full" if audio else "slim"):
        entry["local"] = "full" if audio else "slim"
        save_json(STATE, state)
        api.report(item["id"], None, local=entry["local"])


def main():
    cfg = load_json(CONFIG, None)
    if not cfg or not cfg.get("server") or not cfg.get("token"):
        log(f"Geen instellingen in {CONFIG}; verwacht {{\"server\": ..., \"token\": ...}}")
        sys.exit(1)
    api = Api(cfg["server"], cfg["token"])
    os.makedirs(SONGS, exist_ok=True)
    failed = {}  # id -> tijdstip, om een kapot bestand niet eindeloos opnieuw te proberen
    log(f"Agent gestart, server {cfg['server']}")

    while True:
        try:
            data = api.jobs()
            state = load_json(STATE, {})
            open_projects = open_in_reaper()
            for item_id in data.get("deleted", []):
                if item_id in state:
                    remove_local(item_id, state)
            for item in data.get("items", []):
                item_id = item["id"]
                local = state.get(item_id)
                present = local and os.path.exists(local.get("rpp") or "")
                if present:
                    # Server loopt achter (gemiste melding, herinstallatie van de app): bijwerken
                    msg = local.get("message") or "Staat klaar op de track-computer"
                    report = local.get("report") or {"rpp": local.get("rpp"), "dir": local.get("dir")}
                    if item["status"] != "ready" or item.get("message") != msg or item.get("hasProject") is False:
                        api.report(item_id, "ready", msg, report)
                    manage_cache(api, item, local, state, open_projects)
                    continue
                if item["status"] == "error":  # "Opnieuw proberen" in de app zet hem terug op "stored"
                    continue
                if time.time() - failed.get(item_id, 0) < 300:
                    continue
                try:
                    process(api, item, state)
                    failed.pop(item_id, None)
                except Exception as e:
                    failed[item_id] = time.time()
                    log(f"Fout bij {item.get('fileName')}: {e}")
                    api.report(item_id, "error", str(e))
        except urllib.error.HTTPError as e:
            log(f"Server antwoordde {e.code}" + (" (token klopt niet?)" if e.code == 401 else ""))
        except Exception as e:
            log(f"Server niet bereikbaar: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
