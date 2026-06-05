import tinytuya
import json

API_KEY = "REDACTED_TUYA_API_KEY"
API_SECRET = "REDACTED_TUYA_API_SECRET"
REGION = "eu"  # Europe Data Center

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
