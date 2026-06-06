import tinytuya
import sys
import json
import os
from concurrent.futures import ThreadPoolExecutor

def get_settings():
    candidates = [
        "/app/data/settings.json",
        "/mnt/data/docker/ark-livestream-manager/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
    return {}

def get_single_plug_status(plug_info):
    name = plug_info.get("name", plug_info.get("id"))
    plug_id = plug_info.get("id")
    ip = plug_info.get("ip")
    device_id = plug_info.get("deviceId")
    local_key = plug_info.get("localKey")
    version = float(plug_info.get("version", 3.5))

    result = {
        "id": plug_id,
        "name": name,
        "ip": ip,
        "is_online": False,
        "state": "unknown",
        "power_w": 0.0,
        "voltage_v": 0.0,
        "current_a": 0.0
    }

    if not ip or not device_id or not local_key:
        return result

    try:
        d = tinytuya.OutletDevice(device_id, ip, local_key)
        d.set_version(version)
        d.set_socketTimeout(0.8)  # Fast timeout for responsive UI
        status = d.status()
        if status and "Error" not in status:
            result["is_online"] = True
            dps = status.get("dps", {})
            result["state"] = "on" if dps.get("1") else "off"
            
            # Extract power parameters (LSC plug standard DPS keys)
            current_ma = dps.get("18", 0)
            power_01w = dps.get("19", 0)
            voltage_01v = dps.get("20", 0)

            result["current_a"] = round(current_ma / 1000.0, 3)
            result["power_w"] = round(power_01w / 10.0, 1)
            result["voltage_v"] = round(voltage_01v / 10.0, 1)
    except Exception:
        pass
    return result


def control_single_plug(plug_info, action):
    name = plug_info.get("name", plug_info.get("id"))
    ip = plug_info.get("ip")
    device_id = plug_info.get("deviceId")
    local_key = plug_info.get("localKey")
    version = float(plug_info.get("version", 3.5))

    if not ip or not device_id or not local_key:
        print(f"[{name}] Error: Missing IP, Device ID or Local Key configuration.")
        return False

    print(f"[{name}] Connecting to plug at {ip} (ID: {device_id}, Version: {version})...")
    try:
        d = tinytuya.OutletDevice(device_id, ip, local_key)
        d.set_version(version)
        
        if action == "on":
            print(f"[{name}] Turning ON...")
            status = d.turn_on()
            print(f"[{name}] Response: {status}")
            return True
        elif action == "off":
            print(f"[{name}] Turning OFF...")
            status = d.turn_off()
            print(f"[{name}] Response: {status}")
            return True
        elif action == "status":
            print(f"[{name}] Querying status...")
            status = d.status()
            print(f"[{name}] Response: {status}")
            return True
        else:
            print(f"[{name}] Unknown action: {action}")
            return False
    except Exception as e:
        print(f"[{name}] Error: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 control_plug.py [on|off|status|status_json] [plug_id]")
        sys.exit(1)

    action = sys.argv[1].lower()
    plug_id = sys.argv[2].lower() if len(sys.argv) > 2 else None

    settings = get_settings()
    plugs = settings.get("tuyaPlugs", [])

    if action == "status_json":
        target_plugs = []
        if not plug_id or plug_id == "all":
            target_plugs = plugs
            # Include legacy plug if no plugs configured but legacy details are set
            if not target_plugs:
                device_id = settings.get("tuyaDeviceId")
                device_ip = settings.get("tuyaDeviceIp")
                local_key = settings.get("tuyaLocalKey")
                version = settings.get("tuyaVersion", 3.5)
                if device_id and device_ip and local_key:
                    target_plugs = [{
                        "id": "legacy",
                        "name": "Legacy Home Plug",
                        "ip": device_ip,
                        "deviceId": device_id,
                        "localKey": local_key,
                        "version": version
                    }]
        else:
            p = next((x for x in plugs if x.get("id", "").lower() == plug_id), None)
            if not p:
                p = next((x for x in plugs if x.get("name", "").lower() == plug_id), None)
            if p:
                target_plugs = [p]
            elif plug_id == "legacy":
                device_id = settings.get("tuyaDeviceId")
                device_ip = settings.get("tuyaDeviceIp")
                local_key = settings.get("tuyaLocalKey")
                version = settings.get("tuyaVersion", 3.5)
                if device_id and device_ip and local_key:
                    target_plugs = [{
                        "id": "legacy",
                        "name": "Legacy Home Plug",
                        "ip": device_ip,
                        "deviceId": device_id,
                        "localKey": local_key,
                        "version": version
                    }]
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(get_single_plug_status, target_plugs))
        print(json.dumps(results))
        sys.exit(0)

    if not plug_id or plug_id == "legacy":
        # Fall back to legacy singular plug
        device_id = settings.get("tuyaDeviceId")
        device_ip = settings.get("tuyaDeviceIp")
        local_key = settings.get("tuyaLocalKey")
        version = settings.get("tuyaVersion", 3.5)

        if not device_id or not device_ip or not local_key:
            print("Error: No legacy plug configuration and no plug_id specified.")
            sys.exit(1)

        legacy_plug = {
            "id": "legacy",
            "name": "Legacy Home Plug",
            "ip": device_ip,
            "deviceId": device_id,
            "localKey": local_key,
            "version": version
        }
        success = control_single_plug(legacy_plug, action)
        sys.exit(0 if success else 1)

    if plug_id == "all":
        if not plugs:
            print("Warning: No plugs configured in settings.")
            sys.exit(0)
        
        overall_success = True
        for plug in plugs:
            success = control_single_plug(plug, action)
            if not success:
                overall_success = False
        sys.exit(0 if overall_success else 1)

    # Find the specific plug
    target_plug = next((p for p in plugs if p.get("id", "").lower() == plug_id), None)
    if not target_plug:
        # Fallback check if it matches a legacy run where name might be used
        target_plug = next((p for p in plugs if p.get("name", "").lower() == plug_id), None)

    if not target_plug:
        print(f"Error: Plug with ID/Name '{plug_id}' not found in settings.")
        sys.exit(1)

    success = control_single_plug(target_plug, action)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
