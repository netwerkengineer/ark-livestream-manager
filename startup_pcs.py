#!/usr/bin/env python3
import json
import os
import subprocess
import time
import sys

def get_settings():
    candidates = [
        "/mnt/data/docker/ark-livestream-manager/data/settings.json",
        "/app/data/settings.json"
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading settings: {e}")
    return {}

def wait_for_ssh(user, host, max_attempts=60):
    print(f"Waiting for remote host {host} to become available via SSH...")
    for i in range(1, max_attempts + 1):
        res = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=no", "-o", "PasswordAuthentication=no", f"{user}@{host}", "echo 'online'"],
            capture_output=True, text=True
        )
        if res.returncode == 0:
            print(f"Host {host} is online!")
            return True
        print(f"Attempt {i}/{max_attempts}: Host {host} not reachable yet. Waiting 2s...")
        time.sleep(2)
    return False

def startup_single_plug(plug, settings):
    name = plug.get("name", plug.get("id"))
    plug_id = plug.get("id")
    host_ip = plug.get("hostIp")
    user = settings.get("sshUser", "jeffreygo")
    
    print(f"=== Starting Plug: {name} (ID: {plug_id}) ===")
    
    # 1. Turn on plug
    print(f"[{name}] Turning ON via control_plug.py...")
    subprocess.run(["python3", "/app/control_plug.py", "on", plug_id])
    
    # 2. If host IP is associated, wait for SSH and launch apps
    if host_ip:
        print(f"[{name}] Associated host IP found: {host_ip}")
        if wait_for_ssh(user, host_ip):
            print(f"[{name}] Waiting 5s for system resources to stabilize...")
            time.sleep(5)
            
            obs_host = settings.get("obsHost")
            freeshow_host = settings.get("freeShowHost")
            
            # Detect remote OS
            res = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", f"{user}@{host_ip}", "cmd.exe /c echo windows"], capture_output=True, text=True)
            is_win = "windows" in res.stdout.lower()
            
            # Case A: FreeShow Host (or home environment fallback)
            if host_ip == freeshow_host or host_ip == "192.168.2.20":
                print(f"[{name}] FreeShow host detected. Importing Sunday project...")
                subprocess.run(["python3", "/app/import_project.py"])
                
                if is_win:
                    print(f"[{name}] Launching FreeShow on Windows via schtasks...")
                    subprocess.run(["ssh", f"{user}@{host_ip}", "schtasks /run /tn StartFreeShow || powershell -Command \"Start-Process FreeShow\""])
                else:
                    print(f"[{name}] Launching FreeShow on Mac...")
                    subprocess.run(["ssh", f"{user}@{host_ip}", "open -a FreeShow"])
                
                # If OBS is on the same machine, launch it too
                if obs_host == host_ip or host_ip == "192.168.2.20":
                    if is_win:
                        print(f"[{name}] Launching OBS on Windows via schtasks...")
                        subprocess.run(["ssh", f"{user}@{host_ip}", "schtasks /run /tn StartOBS || powershell -Command \"Start-Process obs64\""])
                    else:
                        print(f"[{name}] Launching OBS on Mac...")
                        subprocess.run(["ssh", f"{user}@{host_ip}", "open -a OBS"])
            
            # Case B: OBS Host only
            elif host_ip == obs_host:
                if is_win:
                    print(f"[{name}] Launching OBS on Windows via schtasks...")
                    subprocess.run(["ssh", f"{user}@{host_ip}", "schtasks /run /tn StartOBS || powershell -Command \"Start-Process obs64\""])
                else:
                    print(f"[{name}] Launching OBS on Mac...")
                    subprocess.run(["ssh", f"{user}@{host_ip}", "open -a OBS"])
            
            else:
                # Custom host - just log and try standard apps if applicable
                print(f"[{name}] Host {host_ip} is online. No specific FreeShow/OBS role mapped, skipping app launch.")
                
            print(f"✅ [{name}] Startup sequence completed successfully.")
        else:
            print(f"❌ [{name}] Error: Host {host_ip} did not become online via SSH.")
            return False
    else:
        print(f"✅ [{name}] Plug turned ON (no host IP mapped).")
    
    return True

def main():
    settings = get_settings()
    plugs = settings.get("tuyaPlugs", [])
    user = settings.get("sshUser", "jeffreygo")
    
    plug_id = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    
    if not plugs:
        # Fall back to legacy singular plug setup (Home environment)
        print("Warning: No plugs in tuyaPlugs list. Falling back to legacy settings...")
        device_id = settings.get("tuyaDeviceId")
        device_ip = settings.get("tuyaDeviceIp")
        local_key = settings.get("tuyaLocalKey")
        
        if not device_id or not device_ip or not local_key:
            print("Error: No legacy plug configuration found.")
            sys.exit(1)
            
        legacy_plug = {
            "id": "legacy",
            "name": "Legacy Home Plug",
            "ip": device_ip,
            "deviceId": device_id,
            "localKey": local_key,
            "version": settings.get("tuyaVersion", 3.5),
            "hostIp": "192.168.2.20" # Home Mac Mini
        }
        success = startup_single_plug(legacy_plug, settings)
        sys.exit(0 if success else 1)
        
    if plug_id == "all":
        print(f"=== Starting all {len(plugs)} plugs ===")
        overall_success = True
        for plug in plugs:
            success = startup_single_plug(plug, settings)
            if not success:
                overall_success = False
        sys.exit(0 if overall_success else 1)
        
    # Find specific plug
    target_plug = next((p for p in plugs if p.get("id", "").lower() == plug_id), None)
    if not target_plug:
        target_plug = next((p for p in plugs if p.get("name", "").lower() == plug_id), None)
        
    if not target_plug:
        print(f"Error: Plug '{plug_id}' not found in settings.")
        sys.exit(1)
        
    success = startup_single_plug(target_plug, settings)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
