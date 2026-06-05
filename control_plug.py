import tinytuya
import sys

DEVICE_ID = "REDACTED_TUYA_DEVICE_ID_1"
DEVICE_IP = "192.168.40.60"
LOCAL_KEY = "REDACTED_TUYA_LOCAL_KEY_1"

# Initialize the device
d = tinytuya.OutletDevice(DEVICE_ID, DEVICE_IP, LOCAL_KEY)
d.set_version(3.5)

if len(sys.argv) < 2:
    print("Usage: python3 control_plug.py [on|off|status]")
    sys.exit(1)

action = sys.argv[1].lower()

try:
    if action == "on":
        print("Turning plug ON...")
        status = d.turn_on()
        print("Status response:", status)
    elif action == "off":
        print("Turning plug OFF...")
        status = d.turn_off()
        print("Status response:", status)
    elif action == "status":
        print("Querying status...")
        status = d.status()
        print("Status response:", status)
    else:
        print(f"Unknown action: {action}")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
