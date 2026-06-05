import tinytuya
import socket
from concurrent.futures import ThreadPoolExecutor

# Credentials of the 3 Tuya devices
devices_info = [
    {
        "name": "LSC Power Plug (Smart Plug)",
        "id": "bfc7be66be541718f5fzrn",
        "key": "#y;FkR5y7YRaq$y>"
    },
    {
        "name": "Lamp Achtertuin",
        "id": "bf828b5fb527b2bf29hgfh",
        "key": "0767fca1ef42b73b"
    },
    {
        "name": "LSC LED Strip",
        "id": "bfec779ae08b6c1f21ch2s",
        "key": "a6a2fd270b0f5402"
    }
]

def check_ip(ip):
    try:
        s = socket.socket()
        s.settimeout(0.15)
        s.connect((ip, 6668))
        s.close()
        return ip
    except:
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
        print(f"  [UNKNOWN] Could not decrypt device at {ip} with any of the 3 keys.")
