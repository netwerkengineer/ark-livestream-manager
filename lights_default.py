#!/usr/bin/env python3
"""Zet de verlichting op een standaardwaarde nadat de stekker van de lichtinstallatie (Iceray) is aangegaan.

De lampen in de zaal hangen aan verlengsnoeren met een eigen schakelaar en onthouden niets: ze lezen het DMX-signaal dat de Iceray uitstuurt. Staat er een
scène te draaien in QLC+ vanaf het moment dat de Iceray aan staat, dan krijgen ze die kleur zodra ze stroom krijgen. Dit script start die scène.

Wordt gestart door startup_pcs.py na het aanzetten van een stekker met de instelling `lightsDefault` (in tuyaPlugs):
  "lightsDefault": {
    "waitHost": "192.168.2.200",        # IP van de Iceray: wachten tot die antwoordt (ping)
    "waitSeconds": 300,                 # hoe lang maximaal wachten
    "delaySeconds": 45,                 # extra wachttijd nadat de Iceray antwoordt (QLC+/Art-Net zijn dan klaar)
    "companionButton": "2/2/7",         # Companion-knop (pagina/rij/kolom) van de standaard sfeer, bijv. Goud
    "label": "Goud",
    "fresnels": {"1": 120, "2": 120, "3": 120, "4": 120, "master": 255}   # optioneel; 0-255, via de sliders in QLC+ (81-85)
  }
Staat "automatisch licht" (Companion-variabele licht_auto) op "uit", dan gebeurt er niets, zodat een handmatige stand niet wordt overschreven.

Gebruik: lights_default.py <stekker-id>
"""
import base64, json, os, socket, struct, subprocess, sys, time
import urllib.error, urllib.request

from activity_log import log_activity
from startup_pcs import get_settings

SLIDERS = {"1": 81, "2": 82, "3": 83, "4": 84, "master": 85}


def ping(host, timeout=2):
    try:
        return subprocess.run(["ping", "-c", "1", "-W", str(timeout), host], capture_output=True, timeout=timeout + 3).returncode == 0
    except Exception:
        return False


def wacht_op_host(host, max_seconden, ping_fn=ping, sleep_fn=time.sleep, klok=time.time):
    einde = klok() + max_seconden
    while klok() < einde:
        if ping_fn(host): return True
        sleep_fn(3)
    return False


def companion_bases(settings):
    port = settings.get("companionPort") or 8000
    hosts = [settings.get("companionHost"), "127.0.0.1", "172.17.0.1", "companion"]
    return [f"http://{h}:{port}" for h in dict.fromkeys(h for h in hosts if h)]


def companion(settings, pad, methode="GET"):
    for basis in companion_bases(settings):
        try:
            req = urllib.request.Request(basis + pad, method=methode)
            with urllib.request.urlopen(req, timeout=3) as r:
                if 200 <= r.status < 300: return r.read().decode().strip()
        except Exception:
            continue
    return None


def ws_stuur(host, poort, berichten, pad="/qlcplusWS"):
    s = socket.create_connection((host, poort), timeout=6)
    sleutel = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET {pad} HTTP/1.1\r\nHost: {host}:{poort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {sleutel}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        d = s.recv(4096)
        if not d: raise ConnectionError("websocket-handshake mislukt")
        buf += d
    for tekst in berichten:
        p = tekst.encode(); masker = os.urandom(4)
        kop = bytes([0x81, 0x80 | len(p)]) if len(p) < 126 else bytes([0x81, 0xFE]) + struct.pack(">H", len(p))
        s.sendall(kop + masker + bytes(b ^ masker[i % 4] for i, b in enumerate(p)))
        time.sleep(0.05)
    s.close()


def main():
    plug_id = sys.argv[1] if len(sys.argv) > 1 else ""
    settings = get_settings()
    plug = next((p for p in settings.get("tuyaPlugs", []) if p.get("id") == plug_id), None)
    cfg = (plug or {}).get("lightsDefault")
    if not cfg:
        print(f"Geen lightsDefault voor stekker '{plug_id}'."); return 0
    label = cfg.get("label") or cfg.get("companionButton")
    log_activity("light", f"Standaardverlichting ({label}): wachten tot de Iceray online is")

    host = cfg.get("waitHost")
    if host and not wacht_op_host(host, int(cfg.get("waitSeconds", 300))):
        log_activity("light", f"Standaardverlichting overgeslagen: {host} (Iceray) antwoordde niet binnen {cfg.get('waitSeconds', 300)} s"); return 1
    time.sleep(int(cfg.get("delaySeconds", 45)))

    auto = companion(settings, "/api/custom-variable/licht_auto/value")
    if auto is not None and auto.lower() == "uit":
        log_activity("light", "Standaardverlichting overgeslagen: automatisch licht staat op 'uit'"); return 0

    knop = cfg.get("companionButton")
    gelukt = companion(settings, f"/api/location/{knop}/press", "POST") is not None if knop else True
    fres = cfg.get("fresnels") or {}
    if fres:
        try:
            qlc_host = settings.get("qlcHost") or "127.0.0.1"
            if qlc_host == "localhost": qlc_host = "127.0.0.1"
            ws_stuur(qlc_host, 9999, [f"{SLIDERS[k]}|{int(v)}" for k, v in fres.items() if k in SLIDERS])
        except Exception as e:
            gelukt = False; print(f"Fresnels zetten mislukt: {e}")
    log_activity("light", f"Standaardverlichting {'gezet' if gelukt else 'MISLUKT'}: {label}" + (f", fresnels {fres}" if fres else ""))
    return 0 if gelukt else 1


if __name__ == "__main__":
    sys.exit(main())
