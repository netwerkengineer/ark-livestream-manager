"""
Scans the local network for Tuya devices (port 6668) and tries to match
each one against the plugs configured in this app's own settings.json (the
same tuyaPlugs list used by control_plug.py), so it always reflects
whatever devices are actually configured here instead of a fixed list.
"""
import tinytuya
import socket
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor


def get_settings():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "data", "settings.json"),
        "/app/data/settings.json",
        "/mnt/data/docker/ark-livestream-manager/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def load_devices_info():
    settings = get_settings()
    plugs = settings.get("tuyaPlugs") or []
    devices = [
        {"name": p.get("name") or p.get("id"), "id": p.get("deviceId"), "key": p.get("localKey")}
        for p in plugs
        if p.get("deviceId") and p.get("localKey")
    ]
    if not devices:
        print("No Tuya plugs with a deviceId/localKey found in settings.json (tuyaPlugs) - nothing to search for.")
        print("Configure your plugs at Instellingen -> Slimme Stekkers first, or edit data/settings.json directly.")
        sys.exit(1)
    return devices


devices_info = load_devices_info()


def check_ip(ip):
    try:
        s = socket.socket()
        s.settimeout(0.15)
        s.connect((ip, 6668))
        s.close()
        return ip
    except Exception:
        return None


# Find all active IPs on port 6668
subnets = [2, 10, 30, 40]
ips = []
for sub in subnets:
    ips.extend([f"192.168.{sub}.{i}" for i in range(1, 255)])

print(f"Scanning {len(ips)} IPs on subnets {subnets} for Tuya port 6668...")
with ThreadPoolExecutor(max_workers=100) as ex:
    found_ips = [r for r in ex.map(check_ip, ips) if r is not None]

print(f"Active Tuya IPs found: {found_ips}")

# Now test each device's key on each active IP
print("\nTesting keys against active Tuya IPs...")
for ip in found_ips:
    print(f"\nTesting IP: {ip}")
    matched = False
    for dev in devices_info:
        # tinytuya.OutletDevice handles status queries
        d = tinytuya.OutletDevice(dev["id"], ip, dev["key"])

        # Try both protocol 3.3 and 3.4
        for version in [3.3, 3.4, 3.1]:
            d.set_version(version)
            try:
                # Disable tinytuya debug output to keep logs clean
                tinytuya.set_debug(False)
                status = d.status()
                if status and "Error" not in status:
                    print(f"  [MATCH] Device: {dev['name']} | ID: {dev['id']} | Version: {version}")
                    print(f"  [STATUS] {status}")
                    matched = True
                    break
            except Exception:
                pass
        if matched:
            break
    if not matched:
        print(f"  [UNKNOWN] Could not decrypt device at {ip} with any of the configured keys.")
