"""
One-off diagnostic: lists every device on your Tuya Cloud account (name,
ID, local key, IP, MAC) via the Tuya IoT Platform Cloud API. Needs your own
Cloud API credentials from https://iot.tuya.com (Cloud -> your project ->
Overview) - never hardcode these, pass them as environment variables:

    TUYA_API_KEY=... TUYA_API_SECRET=... python3 get_tuya_devices.py
"""
import tinytuya
import json
import os
import sys

API_KEY = os.environ.get("TUYA_API_KEY")
API_SECRET = os.environ.get("TUYA_API_SECRET")
REGION = os.environ.get("TUYA_API_REGION", "eu")  # Europe Data Center by default

if not API_KEY or not API_SECRET:
    print("Missing TUYA_API_KEY / TUYA_API_SECRET environment variables.")
    print("Usage: TUYA_API_KEY=... TUYA_API_SECRET=... python3 get_tuya_devices.py")
    sys.exit(1)

print("Connecting to Tuya Cloud...")
# Initialize Cloud API connection
c = tinytuya.Cloud(
    apiRegion=REGION,
    apiKey=API_KEY,
    apiSecret=API_SECRET
)

print("Fetching device list from Tuya Cloud...")
devices = c.getdevices()

if "result" in devices:
    print(f"\nSuccessfully retrieved {len(devices['result'])} devices from Tuya Cloud:")
    for dev in devices["result"]:
        name = dev.get("name")
        dev_id = dev.get("id")
        key = dev.get("local_key")
        ip = dev.get("ip")
        mac = dev.get("mac")
        status = "Online" if dev.get("online") else "Offline"

        print("-" * 50)
        print(f"Device Name: {name}")
        print(f"Device ID  : {dev_id}")
        print(f"Local Key  : {key}")
        print(f"Cloud IP   : {ip}")
        print(f"MAC Address: {mac}")
        print(f"Status     : {status}")
    print("-" * 50)

    # Save the output to a file inside /app for future reference
    with open("/app/tuya_devices_cloud.json", "w") as f:
        json.dump(devices["result"], f, indent=4)
    print("\nSaved full details to /app/tuya_devices_cloud.json")
else:
    print("\nError fetching devices from Tuya Cloud:")
    print(json.dumps(devices, indent=4))
